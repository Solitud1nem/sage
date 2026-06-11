/**
 * Deterministic website-pipeline plan (M12.1.3): registry-driven executor
 * resolution by exact capability, evaluator wiring, honest throw when a
 * capability has no active agent.
 */
import { describe, it, expect } from 'vitest';

import type { AgentRecordV2 } from '@sage/core';

import { buildWebsiteClassification } from '../../src/parent/website-plan.js';

const agent = (addr: string, capability: string, price: bigint, active = true): AgentRecordV2 =>
  ({
    id: addr,
    endpoint: 'https://sage-workers.fly.dev',
    profileUri: '',
    capabilities: [{ name: capability, price }],
    registeredAt: 0n,
    active,
  }) as unknown as AgentRecordV2;

const FULL_REGISTRY = [
  agent('0x' + '1'.repeat(40), 'copywrite', 30_000n),
  agent('0x' + '2'.repeat(40), 'build-website', 80_000n),
  agent('0x' + '3'.repeat(40), 'package-archive', 10_000n),
  agent('0x' + '4'.repeat(40), 'qa-website', 30_000n),
];

describe('buildWebsiteClassification', () => {
  it('builds the four-step plan with registry executors, prices and evaluator wiring', () => {
    const c = buildWebsiteClassification(FULL_REGISTRY);

    expect(c.decomposability).toBe('composite');
    expect(c.stakes).toBe('low');
    const subs = c.proposed_plan;
    expect(subs.map((s) => s.type)).toEqual([
      'copywrite',
      'build-website',
      'qa-website',
      'package-archive',
    ]);
    // Dependency chain: builder ← copy, packager ← builder; QA judges builder.
    expect(subs[1]!.depends_on).toEqual([1]);
    expect(subs[3]!.depends_on).toEqual([2]);
    expect(subs[2]!.evaluates).toBe(2);
    expect(subs[2]!.depends_on).toBeUndefined(); // evaluator must not depend_on (plan-runner rule)
    // Executors + prices straight from the registry.
    expect(subs[0]!.executor_address).toBe('0x' + '1'.repeat(40));
    expect(subs[1]!.estimated_cost_units).toBe(80_000n);
    expect(c.estimated_total_cost_units).toBe(150_000n);
  });

  it('picks the cheapest active agent per capability (foreign undercut wins)', () => {
    const undercut = agent('0x' + 'f'.repeat(40), 'build-website', 50_000n);
    const c = buildWebsiteClassification([...FULL_REGISTRY, undercut]);
    expect(c.proposed_plan[1]!.executor_address).toBe('0x' + 'f'.repeat(40));
    expect(c.proposed_plan[1]!.estimated_cost_units).toBe(50_000n);
  });

  it('ignores inactive agents and throws an honest error on a missing capability', () => {
    const withoutQa = FULL_REGISTRY.filter((a) => a.capabilities[0]!.name !== 'qa-website');
    expect(() => buildWebsiteClassification(withoutQa)).toThrow(/no active agent .*qa-website/);

    const inactiveQa = [...withoutQa, agent('0x' + '4'.repeat(40), 'qa-website', 30_000n, false)];
    expect(() => buildWebsiteClassification(inactiveQa)).toThrow(/qa-website/);
  });
});

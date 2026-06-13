/**
 * Deterministic research-pipeline plan (M12.2.1): searcher → extract×N
 * (per-source, each carrying its source_index token) → synthesizer that
 * depends on the searcher AND every extract; registry-driven executor
 * resolution; honest throw when a capability has no active agent.
 */
import { describe, it, expect } from 'vitest';

import type { AgentRecordV2 } from '@sage/core';

import { buildResearchClassification } from '../../src/parent/research-plan.js';
import {
  RESEARCH_SOURCE_COUNT,
  RESEARCH_FAILURE_DEMO_MARKER,
  sourceIndexFromSpec,
} from '../../src/shared/research.js';

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
  agent('0x' + '1'.repeat(40), 'web-search', 40_000n),
  agent('0x' + '2'.repeat(40), 'extract-content', 10_000n),
  agent('0x' + '3'.repeat(40), 'synthesize-report', 80_000n),
  agent('0x' + '4'.repeat(40), 'fact-check', 60_000n),
];

describe('buildResearchClassification', () => {
  it('builds searcher → extract×N → synthesizer + fact-check evaluator', () => {
    const c = buildResearchClassification(FULL_REGISTRY);

    expect(c.decomposability).toBe('composite');
    const subs = c.proposed_plan;
    // searcher + N extracts + synthesizer + fact-check evaluator.
    expect(subs).toHaveLength(RESEARCH_SOURCE_COUNT + 3);
    expect(subs[0]!.type).toBe('web-search');
    expect(subs[0]!.depends_on).toBeUndefined(); // root — gets the question as `source`

    const extracts = subs.slice(1, 1 + RESEARCH_SOURCE_COUNT);
    for (const [i, e] of extracts.entries()) {
      expect(e.type).toBe('extract-content');
      expect(e.depends_on).toEqual([1]);
      // The machine-readable joint: spec carries this slot's source index.
      expect(sourceIndexFromSpec(e.spec)).toBe(i + 1);
    }

    const synthId = 1 + RESEARCH_SOURCE_COUNT + 1;
    const synth = subs[synthId - 1]!;
    expect(synth.type).toBe('synthesize-report');
    // Searcher (the question) + every extract (the evidence).
    expect(synth.depends_on).toEqual([1, ...extracts.map((_, i) => i + 2)]);

    const factCheck = subs[subs.length - 1]!;
    expect(factCheck.type).toBe('fact-check');
    expect(factCheck.evaluates).toBe(synthId);
    // Evaluator must not declare depends_on (plan-runner rule).
    expect(factCheck.depends_on).toBeUndefined();
  });

  it('prices the run from the registry: 0.04 + N×0.01 + 0.08 + 0.06', () => {
    const c = buildResearchClassification(FULL_REGISTRY);
    expect(c.estimated_total_cost_units).toBe(
      40_000n + BigInt(RESEARCH_SOURCE_COUNT) * 10_000n + 80_000n + 60_000n,
    );
  });

  it('picks the cheapest active agent per capability (foreign undercut wins)', () => {
    const undercut = agent('0x' + 'f'.repeat(40), 'extract-content', 5_000n);
    const c = buildResearchClassification([...FULL_REGISTRY, undercut]);
    for (const e of c.proposed_plan.slice(1, 1 + RESEARCH_SOURCE_COUNT)) {
      expect(e.executor_address).toBe('0x' + 'f'.repeat(40));
      expect(e.estimated_cost_units).toBe(5_000n);
    }
  });

  it('failure-demo variant marks the synthesizer spec; pipeline does not', () => {
    const synthIdx = 1 + RESEARCH_SOURCE_COUNT; // 0-based index of synthesizer
    const demo = buildResearchClassification(FULL_REGISTRY, 'failure-demo');
    expect(demo.proposed_plan[synthIdx]!.type).toBe('synthesize-report');
    expect(demo.proposed_plan[synthIdx]!.spec).toContain(RESEARCH_FAILURE_DEMO_MARKER);
    // Only the synthesizer carries it — not the fact-checker or extracts.
    expect(demo.proposed_plan[synthIdx + 1]!.spec).not.toContain(RESEARCH_FAILURE_DEMO_MARKER);

    const honest = buildResearchClassification(FULL_REGISTRY);
    expect(honest.proposed_plan[synthIdx]!.spec).not.toContain(RESEARCH_FAILURE_DEMO_MARKER);
    // Same shape/cost either way — the failure is staged in execution, not the plan.
    expect(demo.estimated_total_cost_units).toBe(honest.estimated_total_cost_units);
  });

  it('throws an honest error on a missing or inactive capability', () => {
    const withoutFc = FULL_REGISTRY.filter((a) => a.capabilities[0]!.name !== 'fact-check');
    expect(() => buildResearchClassification(withoutFc)).toThrow(/no active agent .*fact-check/);

    const inactive = [...withoutFc, agent('0x' + '4'.repeat(40), 'fact-check', 60_000n, false)];
    expect(() => buildResearchClassification(inactive)).toThrow(/fact-check/);
  });
});

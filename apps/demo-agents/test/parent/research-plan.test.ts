/**
 * Deterministic research-pipeline plan (M12.2.1): searcher → extract×N
 * (per-source, each carrying its source_index token) → synthesizer that
 * depends on the searcher AND every extract; registry-driven executor
 * resolution; honest throw when a capability has no active agent.
 */
import { describe, it, expect } from 'vitest';

import type { AgentRecordV2 } from '@sage/core';

import { buildResearchClassification } from '../../src/parent/research-plan.js';
import { RESEARCH_SOURCE_COUNT, sourceIndexFromSpec } from '../../src/shared/research.js';

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
];

describe('buildResearchClassification', () => {
  it('builds searcher → extract×N → synthesizer with correct dependencies', () => {
    const c = buildResearchClassification(FULL_REGISTRY);

    expect(c.decomposability).toBe('composite');
    const subs = c.proposed_plan;
    expect(subs).toHaveLength(RESEARCH_SOURCE_COUNT + 2);
    expect(subs[0]!.type).toBe('web-search');
    expect(subs[0]!.depends_on).toBeUndefined(); // root — gets the question as `source`

    const extracts = subs.slice(1, 1 + RESEARCH_SOURCE_COUNT);
    for (const [i, e] of extracts.entries()) {
      expect(e.type).toBe('extract-content');
      expect(e.depends_on).toEqual([1]);
      // The machine-readable joint: spec carries this slot's source index.
      expect(sourceIndexFromSpec(e.spec)).toBe(i + 1);
    }

    const synth = subs[subs.length - 1]!;
    expect(synth.type).toBe('synthesize-report');
    // Searcher (the question) + every extract (the evidence).
    expect(synth.depends_on).toEqual([1, ...extracts.map((_, i) => i + 2)]);
  });

  it('prices the run from the registry: 0.04 + N×0.01 + 0.08', () => {
    const c = buildResearchClassification(FULL_REGISTRY);
    expect(c.estimated_total_cost_units).toBe(
      40_000n + BigInt(RESEARCH_SOURCE_COUNT) * 10_000n + 80_000n,
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

  it('throws an honest error on a missing or inactive capability', () => {
    const withoutSynth = FULL_REGISTRY.filter(
      (a) => a.capabilities[0]!.name !== 'synthesize-report',
    );
    expect(() => buildResearchClassification(withoutSynth)).toThrow(
      /no active agent .*synthesize-report/,
    );

    const inactive = [...withoutSynth, agent('0x' + '3'.repeat(40), 'synthesize-report', 80_000n, false)];
    expect(() => buildResearchClassification(inactive)).toThrow(/synthesize-report/);
  });
});

import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  Decomposability,
  Stakes,
  SubTask,
  ClassificationResult,
  Plan,
} from '../src/index.js';

describe('plan types — shape smoke', () => {
  it('SubTask accepts a minimal record', () => {
    const sub: SubTask = {
      id: 1,
      type: 'summarize-text',
      estimated_cost_units: 100_000n,
      deadline_offset_s: 3600,
      spec: 'summarize the attached article in 5 bullets',
    };
    expect(sub.id).toBe(1);
    expect(sub.type).toBe('summarize-text');
    expect(sub.estimated_cost_units).toBe(100_000n);
  });

  it('SubTask accepts optional executor_address and depends_on', () => {
    const sub: SubTask = {
      id: 2,
      type: 'translate-text',
      executor_address: '0xa61b00000000000000000000000000000000001c',
      estimated_cost_units: 150_000n,
      deadline_offset_s: 7200,
      depends_on: [1],
      spec: 'translate the summary to French',
    };
    expect(sub.executor_address).toMatch(/^0x[0-9a-f]+$/);
    expect(sub.depends_on).toEqual([1]);
  });

  it('ClassificationResult carries full §4 shape including signal_trace', () => {
    const result: ClassificationResult = {
      decomposability: 'composite',
      stakes: 'low',
      confidence_decomposability: 0.85,
      confidence_stakes: 0.92,
      estimated_total_cost_units: 250_000n,
      estimated_duration_ms: 15_000,
      proposed_plan: [
        {
          id: 1,
          type: 'summarize-text',
          estimated_cost_units: 100_000n,
          deadline_offset_s: 3600,
          spec: 'summarize the article',
        },
        {
          id: 2,
          type: 'translate-text',
          estimated_cost_units: 150_000n,
          deadline_offset_s: 3600,
          depends_on: [1],
          spec: 'translate the summary',
        },
      ],
      reasoning: 'two-step composite: summarize then translate',
      signal_trace: {
        lexical: ['summarize', 'translate'],
        semantic: ['sequential dependency between sub-steps'],
        stakes: [],
      },
    };
    expect(result.proposed_plan).toHaveLength(2);
    expect(result.proposed_plan[1].depends_on).toEqual([1]);
    expect(result.signal_trace.lexical).toContain('summarize');
  });

  it('Plan drops classifier-only fields and keeps approved snapshot', () => {
    const plan: Plan = {
      brief: 'summarize the article and translate it to French',
      decomposability: 'composite',
      stakes: 'low',
      subtasks: [
        {
          id: 1,
          type: 'summarize-text',
          estimated_cost_units: 100_000n,
          deadline_offset_s: 3600,
          spec: 'summarize the article',
        },
      ],
      estimated_total_cost_units: 100_000n,
      estimated_duration_ms: 8_000,
    };
    expect(plan.brief).toContain('summarize');
    expect(plan.subtasks[0].id).toBe(1);
    // Plan does NOT carry confidence / signal_trace / reasoning — that's
    // ClassificationResult territory.
    expectTypeOf<Plan>().not.toHaveProperty('confidence_decomposability');
    expectTypeOf<Plan>().not.toHaveProperty('signal_trace');
    expectTypeOf<Plan>().not.toHaveProperty('reasoning');
    expectTypeOf<Plan>().not.toHaveProperty('proposed_plan');
  });

  it('Decomposability and Stakes are string literal unions', () => {
    const d1: Decomposability = 'one-shot';
    const d2: Decomposability = 'composite';
    const s1: Stakes = 'low';
    const s2: Stakes = 'high';
    expect([d1, d2, s1, s2]).toEqual(['one-shot', 'composite', 'low', 'high']);
  });
});

import { describe, it, expect } from 'vitest';
import { classifyBrief, __testing } from '../../src/parent/classify.js';

const env = { openaiApiKey: undefined } as const;

describe('classifyBrief — mock templates', () => {
  it('classifies "translate this paragraph" as one-shot / low-stakes', async () => {
    const r = await classifyBrief('translate this paragraph', env);
    expect(r.decomposability).toBe('one-shot');
    expect(r.stakes).toBe('low');
    expect(r.proposed_plan).toHaveLength(1);
    expect(r.proposed_plan[0]?.type).toBe('translate-text');
  });

  it('classifies "summarize this article" as one-shot / low-stakes', async () => {
    const r = await classifyBrief('summarize this article', env);
    expect(r.decomposability).toBe('one-shot');
    expect(r.proposed_plan[0]?.type).toBe('summarize-text');
  });

  it('classifies "research X and write a report" as composite', async () => {
    const r = await classifyBrief(
      'research the top 3 stablecoin yield products on Base and write a comparative report',
      env,
    );
    expect(r.decomposability).toBe('composite');
    expect(r.proposed_plan.length).toBeGreaterThanOrEqual(2);
    expect(r.proposed_plan[1]?.depends_on).toEqual([1]);
  });

  it('classifies "plan a Tokyo trip" as composite with 3 sub-tasks', async () => {
    const r = await classifyBrief('plan a Tokyo trip', env);
    expect(r.decomposability).toBe('composite');
    expect(r.proposed_plan).toHaveLength(3);
    expect(r.proposed_plan[2]?.depends_on).toEqual([2]);
  });

  it('classifies "send $500 USDC to 0xabc" as one-shot / high-stakes', async () => {
    const r = await classifyBrief('send $500 USDC to 0xabc', env);
    expect(r.decomposability).toBe('one-shot');
    expect(r.stakes).toBe('high');
    expect(r.proposed_plan[0]?.type).toBe('transfer-funds');
  });

  it('falls back to clarify-with-user for unknown briefs', async () => {
    const r = await classifyBrief('please water my plants tomorrow at noon', env);
    expect(r.proposed_plan).toHaveLength(1);
    expect(r.proposed_plan[0]?.type).toBe('clarify-with-user');
    expect(r.confidence_decomposability).toBeLessThan(0.7);
  });
});

describe('classifyBrief — heuristic is applied post-mock', () => {
  it('halves confidence_decomposability when 2+ composite cues are present', async () => {
    const r = await classifyBrief(
      'research the top 3 stablecoin yield products on Base and write a comparative report',
      env,
    );
    // Raw mock confidence is 0.88. Heuristic should detect "research" + "top 3"
    // (+ "compare" inside "comparative") → ≥2 cues → halved.
    expect(r.confidence_decomposability).toBeLessThanOrEqual(0.88 / 2 + 1e-6);
    expect(r.signal_trace.lexical).toEqual(
      expect.arrayContaining(['heuristic:research']),
    );
  });

  it('halves confidence_stakes when send + $-value are present', async () => {
    const r = await classifyBrief('send $500 USDC to 0xabc', env);
    // Raw mock stakes confidence is 0.91 → halved by heuristic.
    expect(r.confidence_stakes).toBeLessThanOrEqual(0.91 / 2 + 1e-6);
    expect(r.signal_trace.stakes).toEqual(
      expect.arrayContaining(['heuristic:send']),
    );
  });

  it('does not adjust when no heuristic cues fire', async () => {
    // "translate this paragraph" has no composite verbs / scope quantifiers /
    // irreversibility verbs / $-values → mock confidences pass through.
    const r = await classifyBrief('translate this paragraph', env);
    expect(r.confidence_decomposability).toBe(0.92);
    expect(r.confidence_stakes).toBe(0.95);
  });
});

describe('classifyBrief — template internals', () => {
  it('exposes templates for inspection', () => {
    expect(__testing.TEMPLATES.length).toBeGreaterThanOrEqual(5);
    const ids = __testing.TEMPLATES.map((t) => t.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'translate-one-shot',
        'summarize-one-shot',
        'research-and-report',
        'plan-trip',
        'send-funds',
      ]),
    );
  });

  it('every template build() returns a §4-shaped ClassificationResult', () => {
    for (const t of __testing.TEMPLATES) {
      const r = t.build();
      expect(['one-shot', 'composite']).toContain(r.decomposability);
      expect(['low', 'high']).toContain(r.stakes);
      expect(r.confidence_decomposability).toBeGreaterThanOrEqual(0);
      expect(r.confidence_decomposability).toBeLessThanOrEqual(1);
      expect(r.confidence_stakes).toBeGreaterThanOrEqual(0);
      expect(r.confidence_stakes).toBeLessThanOrEqual(1);
      expect(r.proposed_plan.length).toBeGreaterThanOrEqual(1);
      expect(typeof r.estimated_total_cost_units).toBe('bigint');
      expect(r.signal_trace).toHaveProperty('lexical');
      expect(r.signal_trace).toHaveProperty('semantic');
      expect(r.signal_trace).toHaveProperty('stakes');
    }
  });

  it('fallback returns clarify-with-user with sub-threshold confidence', () => {
    const r = __testing.fallbackClassification();
    expect(r.proposed_plan[0]?.type).toBe('clarify-with-user');
    expect(r.confidence_decomposability).toBeLessThan(0.7);
  });
});

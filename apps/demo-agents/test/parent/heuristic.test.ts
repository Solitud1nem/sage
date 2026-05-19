import { describe, it, expect } from 'vitest';
import type { ClassificationResult } from '@sage/core';
import { applyHeuristicAdjustment } from '../../src/parent/heuristic.js';

/**
 * Build a neutral ClassificationResult with explicit confidences so tests can
 * assert exactly how the heuristic moved them.
 */
function makeClassification(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    decomposability: 'composite',
    stakes: 'low',
    confidence_decomposability: 0.8,
    confidence_stakes: 0.8,
    estimated_total_cost_units: 0n,
    estimated_duration_ms: 0,
    proposed_plan: [],
    reasoning: '',
    signal_trace: { lexical: [], semantic: [], stakes: [] },
    ...overrides,
  };
}

describe('applyHeuristicAdjustment — decomposability', () => {
  it('does not adjust when no composite cues match', () => {
    const result = applyHeuristicAdjustment('translate this paragraph', makeClassification());
    expect(result.confidence_decomposability).toBe(0.8);
    expect(result.signal_trace.lexical).toEqual([]);
  });

  it('does not adjust when only one composite cue matches', () => {
    const result = applyHeuristicAdjustment('plan a Tokyo trip', makeClassification());
    expect(result.confidence_decomposability).toBe(0.8);
    expect(result.signal_trace.lexical).toEqual(['heuristic:plan']);
  });

  it('halves confidence_decomposability when two composite verbs match', () => {
    const result = applyHeuristicAdjustment(
      'research the market and analyze the players',
      makeClassification(),
    );
    expect(result.confidence_decomposability).toBeCloseTo(0.4);
    expect(result.signal_trace.lexical).toEqual(
      expect.arrayContaining(['heuristic:research', 'heuristic:analyze']),
    );
  });

  it('halves when one composite verb + one scope quantifier match', () => {
    const result = applyHeuristicAdjustment(
      'research the top 5 yield products',
      makeClassification(),
    );
    expect(result.confidence_decomposability).toBeCloseTo(0.4);
    expect(result.signal_trace.lexical).toEqual(
      expect.arrayContaining(['heuristic:research', 'heuristic:top N']),
    );
  });

  it('matches "top N" scope quantifier with various digits', () => {
    const r1 = applyHeuristicAdjustment('top 3 reasons', makeClassification());
    const r2 = applyHeuristicAdjustment('top 100 results', makeClassification());
    expect(r1.signal_trace.lexical).toContain('heuristic:top N');
    expect(r2.signal_trace.lexical).toContain('heuristic:top N');
  });

  it('does not double-count the same verb appearing twice', () => {
    const result = applyHeuristicAdjustment(
      'research, research, more research',
      makeClassification(),
    );
    // Only one distinct cue ⇒ no halving.
    expect(result.confidence_decomposability).toBe(0.8);
  });
});

describe('applyHeuristicAdjustment — stakes', () => {
  it('does not adjust when no stakes cues match', () => {
    const result = applyHeuristicAdjustment('summarize this article', makeClassification());
    expect(result.confidence_stakes).toBe(0.8);
    expect(result.signal_trace.stakes).toEqual([]);
  });

  it('halves on a single irreversibility verb', () => {
    const result = applyHeuristicAdjustment('send the report to Bob', makeClassification());
    expect(result.confidence_stakes).toBeCloseTo(0.4);
    expect(result.signal_trace.stakes).toContain('heuristic:send');
  });

  it('halves on a $-value pattern alone', () => {
    const result = applyHeuristicAdjustment('move $500 to the savings pile', makeClassification());
    expect(result.confidence_stakes).toBeCloseTo(0.4);
    expect(result.signal_trace.stakes).toContain('heuristic:$amount');
  });

  it('halves on an "N USDC" pattern', () => {
    const result = applyHeuristicAdjustment('transfer 1000 USDC', makeClassification());
    expect(result.confidence_stakes).toBeCloseTo(0.4);
    expect(result.signal_trace.stakes).toEqual(
      expect.arrayContaining(['heuristic:transfer', 'heuristic:N USDC']),
    );
  });

  it('halves only once when multiple stakes cues match', () => {
    const result = applyHeuristicAdjustment(
      'send $500 USDC to 0xabc',
      makeClassification({ confidence_stakes: 0.9 }),
    );
    expect(result.confidence_stakes).toBeCloseTo(0.45);
    expect(result.signal_trace.stakes.length).toBeGreaterThanOrEqual(3);
  });
});

describe('applyHeuristicAdjustment — purity', () => {
  it('does not mutate the input classification', () => {
    const input = makeClassification({ confidence_decomposability: 0.9, confidence_stakes: 0.9 });
    const inputSnapshot = JSON.parse(
      JSON.stringify(input, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    );
    applyHeuristicAdjustment(
      'research the top 3 stablecoin yields and analyze them',
      input,
    );
    const afterSnapshot = JSON.parse(
      JSON.stringify(input, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    );
    expect(afterSnapshot).toEqual(inputSnapshot);
  });

  it('returns the same output for the same input', () => {
    const brief = 'research and analyze the top 3';
    const a = applyHeuristicAdjustment(brief, makeClassification());
    const b = applyHeuristicAdjustment(brief, makeClassification());
    expect(a.confidence_decomposability).toBe(b.confidence_decomposability);
    expect(a.confidence_stakes).toBe(b.confidence_stakes);
    expect(a.signal_trace).toEqual(b.signal_trace);
  });

  it('preserves LLM-emitted signal_trace entries when appending heuristic matches', () => {
    const result = applyHeuristicAdjustment(
      'send 100 USDC',
      makeClassification({
        signal_trace: {
          lexical: ['llm-emitted-lex'],
          semantic: ['llm-emitted-sem'],
          stakes: ['llm-emitted-stakes'],
        },
      }),
    );
    expect(result.signal_trace.lexical).toContain('llm-emitted-lex');
    expect(result.signal_trace.semantic).toContain('llm-emitted-sem');
    expect(result.signal_trace.stakes).toContain('llm-emitted-stakes');
    expect(result.signal_trace.stakes).toEqual(
      expect.arrayContaining(['heuristic:send', 'heuristic:N USDC']),
    );
  });

  it('is case-insensitive on verb keywords', () => {
    const result = applyHeuristicAdjustment('RESEARCH and ANALYZE the data', makeClassification());
    expect(result.confidence_decomposability).toBeCloseTo(0.4);
  });
});

/**
 * Evaluator-coverage rule (M13.2.2, ADR-0023 §Layer 1.2): foreign-executor
 * work must be gated by a first-party evaluator. Opt-in via FIRST_PARTY_AGENTS.
 */
import { describe, it, expect } from 'vitest';
import type { Plan, SubTask } from '@sage/core';

import { checkEvaluatorCoverage, checkQuarantine } from '../../src/orchestrator/plan-guards.js';

const FP1 = `0x${'1'.repeat(40)}` as `0x${string}`;
const FP2 = `0x${'a'.repeat(40)}` as `0x${string}`;
const FOREIGN = `0x${'2'.repeat(40)}` as `0x${string}`;

const firstParty = new Set([FP1.toLowerCase(), FP2.toLowerCase()]);

function sub(id: number, opts: Partial<SubTask> = {}): SubTask {
  return { id, type: 't', estimated_cost_units: 1000n, deadline_offset_s: 600, spec: 's', ...opts };
}
function plan(subtasks: SubTask[]): Plan {
  return {
    brief: 'b',
    decomposability: 'composite',
    stakes: 'low',
    subtasks,
    estimated_total_cost_units: 0n,
    estimated_duration_ms: 0,
  };
}

describe('checkEvaluatorCoverage', () => {
  it('is disabled (always null) when the allowlist is empty', () => {
    const p = plan([sub(1, { executor_address: FOREIGN })]);
    expect(checkEvaluatorCoverage(p, new Set())).toBeNull();
  });

  it('accepts an all-first-party plan with no evaluators', () => {
    const p = plan([sub(1, { executor_address: FP1 }), sub(2, { executor_address: FP2 })]);
    expect(checkEvaluatorCoverage(p, firstParty)).toBeNull();
  });

  it('matches first-party addresses case-insensitively', () => {
    const p = plan([sub(1, { executor_address: FP1.toUpperCase() as `0x${string}` })]);
    expect(checkEvaluatorCoverage(p, firstParty)).toBeNull();
  });

  it('rejects a foreign worker with no evaluator (invariant A)', () => {
    const p = plan([sub(1, { executor_address: FOREIGN })]);
    expect(checkEvaluatorCoverage(p, firstParty)).toMatch(/foreign executor.*no evaluator/i);
  });

  it('accepts a foreign worker gated by a first-party evaluator', () => {
    const p = plan([
      sub(1, { executor_address: FOREIGN }),
      sub(2, { executor_address: FP1, evaluates: 1 }),
    ]);
    expect(checkEvaluatorCoverage(p, firstParty)).toBeNull();
  });

  it('rejects a foreign evaluator even when it covers the worker (invariant B)', () => {
    const p = plan([
      sub(1, { executor_address: FP1 }),
      sub(2, { executor_address: FOREIGN, evaluates: 1 }),
    ]);
    expect(checkEvaluatorCoverage(p, firstParty)).toMatch(/foreign evaluator/i);
  });

  it('does not flag an unassigned executor as foreign', () => {
    const p = plan([sub(1, {})]); // no executor_address
    expect(checkEvaluatorCoverage(p, firstParty)).toBeNull();
  });

  it('accepts a research-shaped plan (first-party workers + first-party evaluator)', () => {
    const p = plan([
      sub(1, { executor_address: FP1 }), // searcher
      sub(2, { executor_address: FP1, depends_on: [1] }), // extractor
      sub(3, { executor_address: FP2, depends_on: [1, 2] }), // synthesizer
      sub(4, { executor_address: FP1, evaluates: 3 }), // fact-checker
    ]);
    expect(checkEvaluatorCoverage(p, firstParty)).toBeNull();
  });

  it('accepts a foreign synthesizer judged by a first-party fact-checker', () => {
    const p = plan([
      sub(1, { executor_address: FP1 }),
      sub(2, { executor_address: FOREIGN, depends_on: [1] }), // foreign worker
      sub(3, { executor_address: FP1, evaluates: 2 }), // first-party evaluator covers it
    ]);
    expect(checkEvaluatorCoverage(p, firstParty)).toBeNull();
  });
});

describe('checkQuarantine (M13.2.4)', () => {
  const CEILING = 100_000n;
  const noProven = new Set<string>();

  it('is disabled when the allowlist is empty', () => {
    const p = plan([sub(1, { executor_address: FOREIGN, estimated_cost_units: 999_999n })]);
    expect(checkQuarantine(p, new Set(), noProven, CEILING)).toBeNull();
  });

  it('caps an unproven foreign agent above the ceiling', () => {
    const p = plan([sub(1, { executor_address: FOREIGN, estimated_cost_units: CEILING + 1n })]);
    expect(checkQuarantine(p, firstParty, noProven, CEILING)).toMatch(/unproven foreign agent/i);
  });

  it('allows an unproven foreign agent at or below the ceiling', () => {
    const p = plan([sub(1, { executor_address: FOREIGN, estimated_cost_units: CEILING })]);
    expect(checkQuarantine(p, firstParty, noProven, CEILING)).toBeNull();
  });

  it('does not cap a first-party agent', () => {
    const p = plan([sub(1, { executor_address: FP1, estimated_cost_units: 5_000_000n })]);
    expect(checkQuarantine(p, firstParty, noProven, CEILING)).toBeNull();
  });

  it('does not cap a PROVEN foreign agent', () => {
    const proven = new Set([FOREIGN.toLowerCase()]);
    const p = plan([sub(1, { executor_address: FOREIGN, estimated_cost_units: 5_000_000n })]);
    expect(checkQuarantine(p, firstParty, proven, CEILING)).toBeNull();
  });

  it('ignores unassigned executors', () => {
    const p = plan([sub(1, { estimated_cost_units: 5_000_000n })]);
    expect(checkQuarantine(p, firstParty, noProven, CEILING)).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ClassificationResult } from '@sage/core';
import {
  classificationToPlan,
  executePlan,
  classifyAndExecute,
  __testing,
} from '../../src/parent/agent.js';
import { demoRegistry } from '../../src/shared/sse.js';

function makeClassification(): ClassificationResult {
  return {
    decomposability: 'composite',
    stakes: 'low',
    confidence_decomposability: 0.8,
    confidence_stakes: 0.85,
    estimated_total_cost_units: 200_000n,
    estimated_duration_ms: 20_000,
    proposed_plan: [
      {
        id: 1,
        type: 'translate-text',
        estimated_cost_units: 200_000n,
        deadline_offset_s: 600,
        spec: 'translate me',
        executor_address: '0xa61b00000000000000000000000000000000001c',
      },
    ],
    reasoning: 'one-step',
    signal_trace: { lexical: [], semantic: [], stakes: [] },
  };
}

/** Minimal bundle whose sage.tasks.* never resolve — we only test registration shape. */
function noopBundle() {
  const pending = new Promise(() => {}); // never resolves
  return {
    sage: {
      tasks: {
        createTask: () => pending,
        getTask: () => pending,
        approvePayment: () => pending,
      },
    },
    publicClient: { waitForTransactionReceipt: () => pending },
  };
}

describe('classificationToPlan', () => {
  it('keeps axes, subtasks, and cost/duration; drops classifier-only fields', () => {
    const c = makeClassification();
    const plan = classificationToPlan('brief text', c);
    expect(plan.brief).toBe('brief text');
    expect(plan.decomposability).toBe(c.decomposability);
    expect(plan.stakes).toBe(c.stakes);
    expect(plan.subtasks).toBe(c.proposed_plan);
    expect(plan.estimated_total_cost_units).toBe(c.estimated_total_cost_units);
    expect(plan.estimated_duration_ms).toBe(c.estimated_duration_ms);
    // Plan does NOT carry confidence_* / signal_trace / reasoning.
    expect((plan as unknown as { confidence_decomposability?: number }).confidence_decomposability)
      .toBeUndefined();
    expect((plan as unknown as { signal_trace?: unknown }).signal_trace).toBeUndefined();
  });
});

describe('executePlan', () => {
  // Silence the unhandled-promise console.error from the noop bundle.
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
  });

  it('returns a runId and the documented streamUrl prefix', () => {
    const plan = classificationToPlan('demo', makeClassification());
    const { runId, streamUrl } = executePlan(plan, noopBundle() as never);
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(streamUrl).toBe(`${__testing.STREAM_URL_PREFIX}${runId}`);
  });

  it('registers the runId in demoRegistry', () => {
    const plan = classificationToPlan('demo', makeClassification());
    const { runId } = executePlan(plan, noopBundle() as never);
    expect(demoRegistry.get(runId)).not.toBeNull();
  });

  it('mints a fresh runId on every call', () => {
    const plan = classificationToPlan('demo', makeClassification());
    const a = executePlan(plan, noopBundle() as never).runId;
    const b = executePlan(plan, noopBundle() as never).runId;
    expect(a).not.toBe(b);
  });
});

describe('classifyAndExecute (mock classifier)', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
  });

  it('returns classification + runId + streamUrl for a known mock template', async () => {
    const r = await classifyAndExecute('translate this paragraph', noopBundle() as never, {});
    expect(r.classification.decomposability).toBe('one-shot');
    expect(r.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.streamUrl).toBe(`${__testing.STREAM_URL_PREFIX}${r.runId}`);
  });
});

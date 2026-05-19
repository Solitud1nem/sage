import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyBrief, __testing } from '../../src/parent/classify.js';

/**
 * Captures trace events emitted by `console.error` and parses them back to
 * objects. Non-JSON lines are dropped.
 */
function setupTraceCapture(): { events: Array<Record<string, unknown>>; restore: () => void } {
  const events: Array<Record<string, unknown>> = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
    if (typeof line !== 'string') return;
    try {
      events.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      /* not a JSON-line trace event */
    }
  });
  return { events, restore: () => spy.mockRestore() };
}

function validRawJson(): string {
  return JSON.stringify({
    decomposability: 'composite',
    stakes: 'low',
    confidence_decomposability: 0.85,
    confidence_stakes: 0.9,
    estimated_total_cost_units: '350000',
    estimated_duration_ms: 30000,
    proposed_plan: [
      {
        id: 1,
        type: 'research-web',
        estimated_cost_units: '200000',
        deadline_offset_s: 1800,
        spec: 'gather sources',
      },
    ],
    reasoning: 'one step',
    signal_trace: { lexical: ['research'], semantic: [], stakes: [] },
  });
}

function okResponse(args: string): Response {
  return new Response(
    JSON.stringify({
      choices: [
        { message: { tool_calls: [{ function: { name: 'submit_classification', arguments: args } }] } },
      ],
    }),
    { status: 200 },
  );
}

describe('classify trace events', () => {
  let capture: ReturnType<typeof setupTraceCapture>;
  beforeEach(() => {
    capture = setupTraceCapture();
  });
  afterEach(() => {
    capture.restore();
  });

  it('mock path emits 4 events in order: started → raw → heuristic_applied → completed', async () => {
    await classifyBrief('translate this paragraph', {});
    const names = capture.events.map((e) => e.event);
    expect(names).toEqual([
      'parent.classify.started',
      'parent.classify.raw',
      'parent.classify.heuristic_applied',
      'parent.classify.completed',
    ]);
    const started = capture.events[0]!;
    expect(started.mode).toBe('mock');
    expect(started.brief_len).toBe('translate this paragraph'.length);
  });

  it('happy LLM path emits 5 events incl. llm_attempt(ok)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(validRawJson()));
    await classifyBrief('research X', { openaiApiKey: 'sk-test', fetchImpl: fetchMock });
    const names = capture.events.map((e) => e.event);
    expect(names).toEqual([
      'parent.classify.started',
      'parent.classify.llm_attempt',
      'parent.classify.raw',
      'parent.classify.heuristic_applied',
      'parent.classify.completed',
    ]);
    const attempt = capture.events.find((e) => e.event === 'parent.classify.llm_attempt')!;
    expect(attempt.attempt).toBe(1);
    expect(attempt.ok).toBe(true);
  });

  it('retry-success emits two llm_attempt events (fail then ok)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(okResponse(validRawJson()));
    await classifyBrief('research X', { openaiApiKey: 'sk-test', fetchImpl: fetchMock });
    const attempts = capture.events.filter((e) => e.event === 'parent.classify.llm_attempt');
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.ok).toBe(false);
    expect(attempts[0]?.reason).toMatch(/503/);
    expect(attempts[1]?.ok).toBe(true);
  });

  it('double failure emits both fails + degraded event', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('net1'))
      .mockRejectedValueOnce(new Error('net2'));
    await classifyBrief('research X', { openaiApiKey: 'sk-test', fetchImpl: fetchMock });
    const names = capture.events.map((e) => e.event);
    expect(names).toContain('parent.classify.degraded');
    const attempts = capture.events.filter((e) => e.event === 'parent.classify.llm_attempt');
    expect(attempts.every((e) => e.ok === false)).toBe(true);
    const degraded = capture.events.find((e) => e.event === 'parent.classify.degraded')!;
    expect(degraded.reason).toBe('net2');
  });

  it('heuristic_applied event records before/after confidences and matched cues', async () => {
    await classifyBrief(
      'research the top 3 stablecoin yield products on Base and write a report',
      {},
    );
    const ev = capture.events.find((e) => e.event === 'parent.classify.heuristic_applied');
    expect(ev).toBeDefined();
    const before = ev!.before as Record<string, number>;
    const after = ev!.after as Record<string, number>;
    expect(after.confidence_decomposability).toBeLessThan(before.confidence_decomposability!);
    const cues = ev!.composite_cues as string[];
    expect(cues.length).toBeGreaterThanOrEqual(2);
    expect(cues.some((c) => c.startsWith('heuristic:'))).toBe(true);
  });

  it('completed event carries final post-heuristic values matching the returned result', async () => {
    const result = await classifyBrief('translate this', {});
    const completed = capture.events.find((e) => e.event === 'parent.classify.completed')!;
    expect(completed.decomposability).toBe(result.decomposability);
    expect(completed.stakes).toBe(result.stakes);
    expect(completed.confidence_decomposability).toBe(result.confidence_decomposability);
    expect(completed.plan_len).toBe(result.proposed_plan.length);
  });

  it('every event carries a monotonically non-decreasing timestamp', async () => {
    await classifyBrief('translate this', {});
    const timestamps = capture.events.map((e) => e.ts as number);
    const sorted = [...timestamps].sort((a, b) => a - b);
    expect(timestamps).toEqual(sorted);
    expect(timestamps.every((t) => Number.isFinite(t))).toBe(true);
  });
});

describe('briefPreview', () => {
  const { briefPreview } = __testing;
  it('returns full string when below limit', () => {
    expect(briefPreview('hello world')).toBe('hello world');
  });
  it('truncates long strings with ellipsis', () => {
    const long = 'a'.repeat(120);
    const out = briefPreview(long);
    expect(out.length).toBe(81); // 80 chars + '…'
    expect(out.endsWith('…')).toBe(true);
  });
});

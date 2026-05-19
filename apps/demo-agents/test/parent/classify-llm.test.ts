import { describe, it, expect, vi } from 'vitest';
import { classifyBrief, __testing } from '../../src/parent/classify.js';

/** Minimal valid raw classification matching the function schema. */
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
      {
        id: 2,
        type: 'summarize-text',
        estimated_cost_units: '150000',
        deadline_offset_s: 1200,
        depends_on: [1],
        spec: 'synthesize',
      },
    ],
    reasoning: 'two-step composite',
    signal_trace: {
      lexical: ['research'],
      semantic: ['sequential dependency'],
      stakes: [],
    },
  });
}

/** Build a Response-like object compatible with vitest's stubGlobal('fetch'). */
function okResponse(toolArgs: string): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: { name: 'submit_classification', arguments: toolArgs },
              },
            ],
          },
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function httpErrorResponse(status = 500, body = 'upstream error'): Response {
  return new Response(body, { status });
}

function malformedToolCallResponse(): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: 'not a tool_call' } }] }),
    { status: 200 },
  );
}

describe('classifyBrief — real LLM path', () => {
  it('parses a valid tool_call response and applies heuristic post-classify', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(validRawJson()));
    const r = await classifyBrief('research the top 3 yield products on Base', {
      openaiApiKey: 'sk-test',
      fetchImpl: fetchMock,
    });
    expect(r.decomposability).toBe('composite');
    expect(r.proposed_plan).toHaveLength(2);
    expect(r.estimated_total_cost_units).toBe(350_000n);
    // Heuristic should fire on "research" + "top 3" (composite verb + scope quantifier).
    expect(r.confidence_decomposability).toBeLessThan(0.85);
    expect(r.signal_trace.lexical).toEqual(
      expect.arrayContaining(['heuristic:research', 'heuristic:top N']),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on malformed response, succeeds on second attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(malformedToolCallResponse())
      .mockResolvedValueOnce(okResponse(validRawJson()));
    const r = await classifyBrief('research X', {
      openaiApiKey: 'sk-test',
      fetchImpl: fetchMock,
    });
    expect(r.decomposability).toBe('composite');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on HTTP 5xx error, succeeds on second attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(httpErrorResponse(503, 'temporarily unavailable'))
      .mockResolvedValueOnce(okResponse(validRawJson()));
    const r = await classifyBrief('research X', {
      openaiApiKey: 'sk-test',
      fetchImpl: fetchMock,
    });
    expect(r.decomposability).toBe('composite');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on network error (rejected promise), succeeds on second attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(okResponse(validRawJson()));
    const r = await classifyBrief('research X', {
      openaiApiKey: 'sk-test',
      fetchImpl: fetchMock,
    });
    expect(r.decomposability).toBe('composite');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns degraded classification on double failure (both malformed)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(malformedToolCallResponse())
      .mockResolvedValueOnce(malformedToolCallResponse());
    const r = await classifyBrief('research X', {
      openaiApiKey: 'sk-test',
      fetchImpl: fetchMock,
    });
    expect(r.confidence_decomposability).toBe(0);
    expect(r.confidence_stakes).toBe(0);
    expect(r.decomposability).toBe('composite');
    expect(r.stakes).toBe('high');
    expect(r.proposed_plan[0]?.type).toBe('clarify-with-user');
    expect(r.signal_trace.semantic.some((s) => s.startsWith('degraded:'))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns degraded classification on double network failure', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('still down'));
    const r = await classifyBrief('research X', {
      openaiApiKey: 'sk-test',
      fetchImpl: fetchMock,
    });
    expect(r.confidence_decomposability).toBe(0);
    expect(r.proposed_plan[0]?.type).toBe('clarify-with-user');
  });

  it('honors env.useMock=true even with an API key (forces mock path)', async () => {
    const fetchMock = vi.fn();
    const r = await classifyBrief('translate this paragraph', {
      openaiApiKey: 'sk-test',
      useMock: true,
      fetchImpl: fetchMock,
    });
    expect(r.proposed_plan[0]?.type).toBe('translate-text');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('validateAndConvert — schema enforcement', () => {
  const { validateAndConvert } = __testing;

  it('accepts a minimal valid shape', () => {
    const parsed = JSON.parse(validRawJson());
    const r = validateAndConvert(parsed);
    expect(r.decomposability).toBe('composite');
    expect(r.proposed_plan[0]?.estimated_cost_units).toBe(200_000n);
  });

  it('rejects bad decomposability enum', () => {
    const bad = { ...JSON.parse(validRawJson()), decomposability: 'wat' };
    expect(() => validateAndConvert(bad)).toThrow(/decomposability/);
  });

  it('rejects bad stakes enum', () => {
    const bad = { ...JSON.parse(validRawJson()), stakes: 'medium' };
    expect(() => validateAndConvert(bad)).toThrow(/stakes/);
  });

  it('rejects confidence out of [0,1]', () => {
    const bad = { ...JSON.parse(validRawJson()), confidence_decomposability: 1.5 };
    expect(() => validateAndConvert(bad)).toThrow(/confidence_decomposability/);
  });

  it('rejects non-decimal-string cost_units', () => {
    const bad = { ...JSON.parse(validRawJson()), estimated_total_cost_units: '0xdead' };
    expect(() => validateAndConvert(bad)).toThrow(/estimated_total_cost_units/);
  });

  it('rejects empty proposed_plan', () => {
    const bad = { ...JSON.parse(validRawJson()), proposed_plan: [] };
    expect(() => validateAndConvert(bad)).toThrow(/proposed_plan/);
  });

  it('rejects missing signal_trace channels', () => {
    const raw = JSON.parse(validRawJson());
    raw.signal_trace = { lexical: ['a'], semantic: ['b'] };
    expect(() => validateAndConvert(raw)).toThrow(/signal_trace/);
  });

  it('keeps executor_address only when it is a valid 0x-address', () => {
    const raw = JSON.parse(validRawJson());
    raw.proposed_plan[0].executor_address = 'not-an-address';
    const r = validateAndConvert(raw);
    expect(r.proposed_plan[0]?.executor_address).toBeUndefined();
  });

  it('preserves executor_address when properly formatted', () => {
    const raw = JSON.parse(validRawJson());
    raw.proposed_plan[0].executor_address = '0xa61b00000000000000000000000000000000001c';
    const r = validateAndConvert(raw);
    expect(r.proposed_plan[0]?.executor_address).toBe(
      '0xa61b00000000000000000000000000000000001c',
    );
  });

  it('keeps depends_on when non-empty array of integers', () => {
    const parsed = JSON.parse(validRawJson());
    const r = validateAndConvert(parsed);
    expect(r.proposed_plan[1]?.depends_on).toEqual([1]);
  });
});

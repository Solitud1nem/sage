import { describe, it, expect, vi } from 'vitest';
import { judgeDispute, __testing } from '../../src/parent/council.js';

function verdictResponse(args: object): Response {
  return new Response(
    JSON.stringify({
      choices: [
        { message: { tool_calls: [{ function: { name: 'submit_verdict', arguments: JSON.stringify(args) } }] } },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

const CASE = {
  spec: 'Translate to French',
  result: 'Bonjour le monde',
  reason: 'this is wrong',
};

describe('council mock path', () => {
  it('refunds the client when the result is empty/too short', async () => {
    const v = await judgeDispute({ spec: 'x', result: '', reason: 'nothing came back' }, { useMock: true });
    expect(v.outcome).toBe('client');
  });

  it('splits when the complaint has merit but a result exists', async () => {
    const v = await judgeDispute(
      { spec: 'Summarize', result: 'A reasonably long summary of the article.', reason: 'incomplete summary' },
      { useMock: true },
    );
    expect(v.outcome).toBe('split');
    expect(v.executorSharePct).toBe(50);
  });

  it('favors the worker when the dispute looks unfounded', async () => {
    const v = await judgeDispute(
      { spec: 'Translate', result: 'Bonjour le monde, voici une traduction complète.', reason: 'I changed my mind' },
      { useMock: true },
    );
    expect(v.outcome).toBe('worker');
  });
});

describe('council LLM path', () => {
  it('parses a worker verdict from a tool_call', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      verdictResponse({ outcome: 'worker', reasoning: 'Result satisfies the instruction.' }),
    );
    const v = await judgeDispute(CASE, { openaiApiKey: 'sk-test', fetchImpl: fetchMock });
    expect(v.outcome).toBe('worker');
    expect(v.reasoning).toMatch(/satisfies/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('parses + clamps a split verdict', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      verdictResponse({ outcome: 'split', executor_share_pct: 150, reasoning: 'partial' }),
    );
    const v = await judgeDispute(CASE, { openaiApiKey: 'sk-test', fetchImpl: fetchMock });
    expect(v.outcome).toBe('split');
    expect(v.executorSharePct).toBe(99); // clamped from 150
  });

  it('retries once on a 5xx then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream', { status: 503 }))
      .mockResolvedValueOnce(verdictResponse({ outcome: 'client', reasoning: 'empty result' }));
    const v = await judgeDispute(CASE, { openaiApiKey: 'sk-test', fetchImpl: fetchMock });
    expect(v.outcome).toBe('client');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('degrades to client (refund) on double failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('x', { status: 503 }))
      .mockResolvedValueOnce(new Response('x', { status: 503 }));
    const v = await judgeDispute(CASE, { openaiApiKey: 'sk-test', fetchImpl: fetchMock });
    expect(v.outcome).toBe('client');
    expect(v.reasoning).toMatch(/unavailable/i);
  });

  it('does not retry on a permanent 4xx — degrades immediately', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('bad key', { status: 401 }));
    const v = await judgeDispute(CASE, { openaiApiKey: 'sk-bad', fetchImpl: fetchMock });
    expect(v.outcome).toBe('client');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('validateVerdict', () => {
  const { validateVerdict } = __testing;

  it('rejects an unknown outcome', () => {
    expect(() => validateVerdict({ outcome: 'maybe', reasoning: 'x' })).toThrow(/outcome/);
  });

  it('defaults a split with no share to 50', () => {
    expect(validateVerdict({ outcome: 'split', reasoning: 'x' })).toEqual({
      outcome: 'split',
      executorSharePct: 50,
      reasoning: 'x',
    });
  });

  it('drops executor_share_pct for non-split outcomes', () => {
    const v = validateVerdict({ outcome: 'worker', executor_share_pct: 30, reasoning: 'ok' });
    expect(v).toEqual({ outcome: 'worker', reasoning: 'ok' });
  });

  it('supplies a fallback reasoning when missing', () => {
    expect(validateVerdict({ outcome: 'client' }).reasoning).toBe('No reasoning provided.');
  });
});

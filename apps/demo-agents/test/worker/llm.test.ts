/** Chat helper (M12.1.1) — throw-on-failure semantics (CR.2 at the executor layer). */
import { describe, it, expect } from 'vitest';

import { chat } from '../../src/worker/llm.js';

function fakeFetch(status: number, body: unknown) {
  const calls: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_url: unknown, init?: { body?: unknown }) => {
    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return { ok: status < 400, status, json: async () => body } as Response;
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const OK = { choices: [{ message: { content: 'hello' } }] };

describe('chat', () => {
  it('returns content and forwards model/json knobs', async () => {
    const { calls, fetchImpl } = fakeFetch(200, OK);
    const out = await chat({
      apiKey: 'k',
      system: 's',
      user: 'u',
      maxTokens: 100,
      json: true,
      model: 'gpt-4o',
      fetchImpl,
    });
    expect(out).toBe('hello');
    expect(calls[0]).toMatchObject({
      model: 'gpt-4o',
      max_tokens: 100,
      response_format: { type: 'json_object' },
    });
  });

  it('throws on HTTP error with the API message', async () => {
    const { fetchImpl } = fakeFetch(429, { error: { message: 'rate limited' } });
    await expect(chat({ apiKey: 'k', system: 's', user: 'u', maxTokens: 10, fetchImpl })).rejects.toThrow(
      /rate limited/,
    );
  });

  it('throws on an error field even with HTTP 200', async () => {
    const { fetchImpl } = fakeFetch(200, { error: { message: 'quota' } });
    await expect(chat({ apiKey: 'k', system: 's', user: 'u', maxTokens: 10, fetchImpl })).rejects.toThrow(/quota/);
  });

  it('throws on empty content', async () => {
    const { fetchImpl } = fakeFetch(200, { choices: [{ message: {} }] });
    await expect(chat({ apiKey: 'k', system: 's', user: 'u', maxTokens: 10, fetchImpl })).rejects.toThrow(
      /no content/,
    );
  });
});

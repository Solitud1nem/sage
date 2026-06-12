/**
 * Anthropic Messages client (M12.1.6): request shape (headers, structured
 * outputs, image attachment), text extraction, throw-semantics on error /
 * refusal / truncation.
 */
import { describe, it, expect } from 'vitest';

import { anthropicChat, ANTHROPIC_MODELS } from '../../src/shared/anthropic.js';

function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
  return { impl, calls };
}

const okBody = {
  content: [{ type: 'text', text: '{"hello":"world"}' }],
  stop_reason: 'end_turn',
};

describe('anthropicChat', () => {
  it('sends the documented request shape with structured outputs', async () => {
    const { impl, calls } = fakeFetch(200, okBody);
    const schema = { type: 'object', properties: { hello: { type: 'string' } }, required: ['hello'], additionalProperties: false };
    const out = await anthropicChat({
      apiKey: 'sk-test',
      model: ANTHROPIC_MODELS.opus,
      system: 'sys',
      user: 'usr',
      maxTokens: 1000,
      jsonSchema: schema,
      fetchImpl: impl,
    });

    expect(out).toBe('{"hello":"world"}');
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(body['model']).toBe('claude-opus-4-8');
    expect(body['max_tokens']).toBe(1000);
    expect(body['system']).toBe('sys');
    expect(body['output_config']).toEqual({ format: { type: 'json_schema', schema } });
    expect(body['messages']).toEqual([{ role: 'user', content: 'usr' }]);
    // No sampling params, no thinking config — removed/omitted on Opus 4.8.
    expect(body['temperature']).toBeUndefined();
    expect(body['thinking']).toBeUndefined();
  });

  it('attaches a PNG as a base64 image block before the text', async () => {
    const { impl, calls } = fakeFetch(200, okBody);
    await anthropicChat({
      apiKey: 'k',
      model: ANTHROPIC_MODELS.sonnet,
      system: 's',
      user: 'judge this',
      maxTokens: 500,
      imagePngB64: 'aGk=',
      fetchImpl: impl,
    });
    const body = JSON.parse(String(calls[0]!.init.body)) as {
      messages: Array<{ content: Array<{ type: string; source?: { data?: string } }> }>;
    };
    expect(body.messages[0]!.content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'aGk=' },
    });
    expect(body.messages[0]!.content[1]).toEqual({ type: 'text', text: 'judge this' });
  });

  it('joins multiple text blocks and ignores non-text blocks', async () => {
    const { impl } = fakeFetch(200, {
      content: [
        { type: 'thinking', text: 'nope' },
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
      stop_reason: 'end_turn',
    });
    await expect(
      anthropicChat({ apiKey: 'k', model: 'm', system: 's', user: 'u', maxTokens: 10, fetchImpl: impl }),
    ).resolves.toBe('ab');
  });

  const failures: Array<[string, number, unknown, RegExp]> = [
    ['HTTP error with API message', 400, { error: { message: 'bad params' } }, /bad params/],
    ['HTTP error without body', 500, null, /HTTP 500/],
    ['safety refusal', 200, { content: [], stop_reason: 'refusal' }, /refused/],
    ['max_tokens truncation', 200, { content: [{ type: 'text', text: 'partial' }], stop_reason: 'max_tokens' }, /truncated/],
    ['no text content', 200, { content: [], stop_reason: 'end_turn' }, /no text content/],
  ];
  for (const [name, status, body, pattern] of failures) {
    it(`throws on ${name}`, async () => {
      const { impl } = fakeFetch(status, body);
      await expect(
        anthropicChat({ apiKey: 'k', model: 'm', system: 's', user: 'u', maxTokens: 10, fetchImpl: impl }),
      ).rejects.toThrow(pattern);
    });
  }
});

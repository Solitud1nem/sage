/**
 * Evaluator handler harness (M12.0.3): case decode, mock verdicts, LLM
 * function-calling path, and the no-verdict-on-breakage discipline.
 */
import { describe, it, expect } from 'vitest';

import { makeEvaluatorHandler, MOCK_FAIL_MARKER } from '../../src/worker/handlers/evaluator.js';
import {
  encodeEvaluationCase,
  decodeVerdict,
} from '../../src/shared/evaluation.js';
import type { HandlerContext } from '../../src/worker/handlers/index.js';

const CASE = encodeEvaluationCase({ instruction: 'write the page', result: 'page content' });

const ctx = (openaiApiKey?: string): HandlerContext => ({
  identityId: 'qa',
  capability: 'qa-website',
  openaiApiKey,
});

function llmFetch(args: unknown, ok = true) {
  const calls: Array<{ body: Record<string, unknown> }> = [];
  const fetchImpl = (async (_url: unknown, init?: { body?: unknown }) => {
    calls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () =>
        ok
          ? {
              choices: [
                { message: { tool_calls: [{ function: { arguments: JSON.stringify(args) } }] } },
              ],
            }
          : { error: { message: 'boom' } },
    } as Response;
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('keyless (mock) mode', () => {
  it('passes a clean result with a decodable verdict', async () => {
    const handler = makeEvaluatorHandler({ criteria: 'anything' });
    const out = await handler({ spec: 'judge it', material: CASE }, ctx());
    expect(decodeVerdict(out)).toMatchObject({ pass: true });
  });

  it('fails a result carrying the mock marker (managed failure-run demos)', async () => {
    const failCase = encodeEvaluationCase({
      instruction: 'write',
      result: `bad output ${MOCK_FAIL_MARKER}`,
    });
    const handler = makeEvaluatorHandler({ criteria: 'anything' });
    const out = await handler({ spec: 'judge it', material: failCase }, ctx());
    expect(decodeVerdict(out)).toMatchObject({ pass: false });
  });
});

describe('no-verdict-on-breakage discipline', () => {
  it('returns plain text (no verdict) when the case is missing or undecodable', async () => {
    const handler = makeEvaluatorHandler({ criteria: 'anything' });
    expect(decodeVerdict(await handler({ spec: 's', material: null }, ctx()))).toBeNull();
    expect(decodeVerdict(await handler({ spec: 's', material: 'not json' }, ctx()))).toBeNull();
  });

  it('returns plain text when the LLM errors out', async () => {
    const { fetchImpl } = llmFetch({}, false);
    const handler = makeEvaluatorHandler({ criteria: 'c', fetchImpl });
    const out = await handler({ spec: 's', material: CASE }, ctx('sk-key'));
    expect(decodeVerdict(out)).toBeNull();
    expect(out).toMatch(/Evaluation failed/);
  });

  it('returns plain text when the judge omits the verdict call', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: {} }] }),
    })) as unknown as typeof fetch;
    const handler = makeEvaluatorHandler({ criteria: 'c', fetchImpl });
    const out = await handler({ spec: 's', material: CASE }, ctx('sk-key'));
    expect(decodeVerdict(out)).toBeNull();
  });
});

describe('LLM mode', () => {
  it('renders criteria + case into the prompt and returns the judge verdict', async () => {
    const { calls, fetchImpl } = llmFetch({ pass: false, reasons: ['claim 2 unsupported'], score: 35 });
    const handler = makeEvaluatorHandler({ criteria: 'all citations must resolve', fetchImpl });
    const out = await handler({ spec: 'fact-check it', material: CASE }, ctx('sk-key'));

    expect(decodeVerdict(out)).toEqual({
      pass: false,
      reasons: ['claim 2 unsupported'],
      score: 35,
    });
    const body = calls[0]!.body as { messages: Array<{ role: string; content: string }> };
    expect(body.messages[0]!.content).toContain('all citations must resolve');
    expect(body.messages[1]!.content).toContain('write the page');
    expect(body.messages[1]!.content).toContain('page content');
  });

  it('drops an out-of-range score instead of failing the verdict', async () => {
    const { fetchImpl } = llmFetch({ pass: true, reasons: [], score: 250 });
    const handler = makeEvaluatorHandler({ criteria: 'c', fetchImpl });
    const out = await handler({ spec: 's', material: CASE }, ctx('sk-key'));
    expect(decodeVerdict(out)).toEqual({ pass: true, reasons: [] });
  });
});

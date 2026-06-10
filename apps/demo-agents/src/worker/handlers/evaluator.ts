/**
 * Evaluator handler harness (M12.0.3, ADR-0020 п.5).
 *
 * Fact-checker, QA gate and second reviewer are all instances of this one
 * harness with different criteria: the handler receives an EvaluationCase
 * (the judged step's instruction + result, via the ADR-0018 inputs channel),
 * judges it against the capability's criteria, and returns an
 * EvaluationVerdict envelope — which the plan-runner turns into payment
 * (pass) or the dispute → council hook (fail).
 *
 * Output discipline mirrors the plan-runner's failure posture: when the
 * harness CANNOT judge (missing/undecodable case, LLM hard-down), it returns
 * plain non-verdict text — the plan-runner decodes `null` and degrades to the
 * legacy approve path. A fabricated `pass:false` on harness breakage would
 * dispute an innocent executor; a fabricated `pass:true` would rubber-stamp.
 * Neither is acceptable, so breakage = no verdict.
 *
 * Concrete evaluator identities (qa-website, fact-check, …) register in
 * IDENTITY_TABLE + HANDLERS as their pipelines land (M12.1+).
 */

import { decodeEvaluationCase, encodeVerdict } from '../../shared/evaluation.js';
import type { CapabilityHandler } from './index.js';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o-mini';

export interface EvaluatorHarnessSpec {
  /** What this evaluator instance checks — rendered into the judge prompt. */
  readonly criteria: string;
  /** Test seam. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Deterministic mock marker: in keyless runs (local dev, tests, managed
 * "failure run" demos per ADR-0020) a result containing this literal fails
 * evaluation; anything else passes.
 */
export const MOCK_FAIL_MARKER = '[EVAL-FAIL]';

const VERDICT_TOOL = {
  type: 'function',
  function: {
    name: 'submit_verdict',
    description: 'Submit your evaluation verdict for the executor result.',
    parameters: {
      type: 'object',
      properties: {
        pass: { type: 'boolean', description: 'true when the result satisfies the criteria' },
        reasons: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific findings; on fail these become the dispute reason.',
        },
        score: { type: 'number', minimum: 0, maximum: 100 },
      },
      required: ['pass', 'reasons'],
    },
  },
} as const;

export function makeEvaluatorHandler(spec: EvaluatorHarnessSpec): CapabilityHandler {
  const fetchImpl = spec.fetchImpl ?? fetch;

  return async (job, ctx) => {
    const evalCase = job.material !== null ? decodeEvaluationCase(job.material) : null;
    if (!evalCase) {
      // No judgeable case → no verdict (see header). Plain text on purpose.
      return 'Evaluation skipped: no decodable evaluation case in task material.';
    }

    if (!ctx.openaiApiKey) {
      const fail = evalCase.result.includes(MOCK_FAIL_MARKER);
      return encodeVerdict({
        pass: !fail,
        reasons: fail
          ? [`mock evaluator: result contains ${MOCK_FAIL_MARKER}`]
          : ['mock evaluator: no API key, deterministic pass'],
      });
    }

    const res = await fetchImpl(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You are a paid evaluator in an AI-agent task-escrow protocol. An executor was given an instruction and submitted a result; you judge whether the result satisfies the criteria below. Be strict but fair: judge the submitted result only — not style preferences. Always answer via the submit_verdict function.\n\nCRITERIA:\n' +
              spec.criteria,
          },
          {
            role: 'user',
            content: `INSTRUCTION GIVEN TO EXECUTOR:\n${evalCase.instruction}\n\nRESULT SUBMITTED:\n${evalCase.result}`,
          },
        ],
        tools: [VERDICT_TOOL],
        tool_choice: { type: 'function', function: { name: 'submit_verdict' } },
      }),
    });

    const data = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
      error?: { message?: string };
    } | null;
    if (!res.ok || data?.error) {
      return `Evaluation failed: ${data?.error?.message ?? `HTTP ${res.status}`}`;
    }
    const rawArgs = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!rawArgs) {
      return 'Evaluation failed: judge returned no verdict call.';
    }
    let parsed: { pass?: unknown; reasons?: unknown; score?: unknown };
    try {
      parsed = JSON.parse(rawArgs) as typeof parsed;
    } catch {
      return 'Evaluation failed: judge verdict arguments were not valid JSON.';
    }
    if (typeof parsed.pass !== 'boolean') {
      return 'Evaluation failed: judge verdict missing boolean pass.';
    }
    const reasons = Array.isArray(parsed.reasons)
      ? parsed.reasons.filter((r): r is string => typeof r === 'string')
      : [];
    const score =
      typeof parsed.score === 'number' && parsed.score >= 0 && parsed.score <= 100
        ? parsed.score
        : undefined;
    return encodeVerdict({ pass: parsed.pass, reasons, ...(score !== undefined ? { score } : {}) });
  };
}

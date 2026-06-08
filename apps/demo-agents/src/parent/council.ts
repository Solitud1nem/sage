/**
 * Off-chain council v1 — single LLM-judge for disputed sub-tasks (ADR-0019).
 *
 * When a client disputes a Completed sub-task, the council receives the
 * sub-task instruction (`spec`), the executor's `result`, and the client's
 * dispute `reason`, and returns a verdict:
 *
 *   - `worker` → executor performed the work → on-chain `Paid` (full).
 *   - `client` → work missing / wrong → on-chain `Refunded` (full).
 *   - `split`  → partial → on-chain `Split` with `executorSharePct` of the amount.
 *
 * Trust posture (ADR-0008 / ADR-0019): this is an automated transparent
 * referee — its `reasoning` is shown to the user — NOT an impartial third
 * party or a trustless mechanism. Human escalation is the appeal layer (M11.5).
 *
 * Dispatch mirrors `classify.ts`: real gpt-4o-mini via function-calling when a
 * key is present, deterministic mock otherwise. On repeated LLM failure the
 * verdict degrades to `client` — the conservative default is to NOT pay the
 * executor when the judge cannot decide.
 */

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o-mini';

/** Council outcome — maps to on-chain resolveDispute in the orchestrator. */
export type CouncilOutcome = 'worker' | 'client' | 'split';

export interface CouncilVerdict {
  readonly outcome: CouncilOutcome;
  /** Executor's share 0..100 — present (and meaningful) only when outcome is `split`. */
  readonly executorSharePct?: number;
  /** 1-2 sentence justification, surfaced in the UI. */
  readonly reasoning: string;
}

/** What the judge weighs. `amount` is informational context for the LLM. */
export interface DisputeCase {
  readonly spec: string;
  readonly result: string;
  readonly reason: string;
}

export interface CouncilEnv {
  readonly openaiApiKey?: string;
  readonly useMock?: boolean;
  readonly fetchImpl?: typeof fetch;
}

function trace(event: string, payload: Record<string, unknown>): void {
  console.error(JSON.stringify({ ts: Date.now(), event, ...payload }));
}

const SYSTEM_PROMPT = `You are the dispute arbiter for an AI-agent task-escrow protocol. A client paid into escrow for a sub-task; an executor agent submitted a result; the client is disputing it. Decide who the escrowed funds go to.

You receive:
- INSTRUCTION: what the executor was asked to do.
- RESULT: what the executor submitted.
- DISPUTE REASON: why the client is contesting payment.

Choose exactly one outcome via the submit_verdict function:
- "worker": the result substantively satisfies the instruction; the dispute is unfounded. Funds go fully to the executor.
- "client": the result is missing, empty, off-task, or clearly fails the instruction. Funds are refunded fully to the client.
- "split": the result is partially acceptable — some real work was done but it falls short. Set executor_share_pct (1-99) to the fraction the executor earns.

Judge the WORK against the INSTRUCTION, not the client's feelings. A correct result with an unfounded complaint → "worker". An empty/echoed/irrelevant result → "client". Be fair to the executor when the work is genuinely good. Give a 1-2 sentence reasoning the user will read.`;

const VERDICT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_verdict',
    description: 'Submit the dispute verdict.',
    parameters: {
      type: 'object',
      properties: {
        outcome: { type: 'string', enum: ['worker', 'client', 'split'] },
        executor_share_pct: {
          type: 'integer',
          minimum: 1,
          maximum: 99,
          description: 'Executor share 1-99; required only when outcome is "split".',
        },
        reasoning: { type: 'string' },
      },
      required: ['outcome', 'reasoning'],
      additionalProperties: false,
    },
  },
};

interface OpenAIChatResponse {
  choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
  error?: { message?: string };
}

class CouncilError extends Error {
  readonly transient: boolean;
  constructor(message: string, transient = true) {
    super(message);
    this.transient = transient;
  }
}

/**
 * Validate + normalize the raw tool-call JSON into a CouncilVerdict.
 * Clamps a split share into 1..99; falls back a `split` with no/garbage share
 * to a 50/50 rather than rejecting (the outcome judgment is the important part).
 */
function validateVerdict(raw: unknown): CouncilVerdict {
  if (!raw || typeof raw !== 'object') throw new CouncilError('verdict is not an object');
  const r = raw as { outcome?: unknown; executor_share_pct?: unknown; reasoning?: unknown };
  if (r.outcome !== 'worker' && r.outcome !== 'client' && r.outcome !== 'split') {
    throw new CouncilError(`bad outcome: ${String(r.outcome)}`);
  }
  const reasoning = typeof r.reasoning === 'string' && r.reasoning.length > 0 ? r.reasoning : 'No reasoning provided.';
  if (r.outcome !== 'split') {
    return { outcome: r.outcome, reasoning };
  }
  let pct = typeof r.executor_share_pct === 'number' && Number.isFinite(r.executor_share_pct)
    ? Math.round(r.executor_share_pct)
    : 50;
  if (pct < 1) pct = 1;
  if (pct > 99) pct = 99;
  return { outcome: 'split', executorSharePct: pct, reasoning };
}

async function callOpenAIOnce(
  c: DisputeCase,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<CouncilVerdict> {
  const userContent =
    `INSTRUCTION:\n${c.spec}\n\nRESULT:\n${c.result}\n\nDISPUTE REASON:\n${c.reason}`;
  const res = await fetchImpl(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      tools: [VERDICT_TOOL],
      tool_choice: { type: 'function', function: { name: 'submit_verdict' } },
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const transient = res.status >= 500 || res.status === 429;
    throw new CouncilError(`OpenAI ${res.status}: ${body.slice(0, 200)}`, transient);
  }

  const data = (await res.json()) as OpenAIChatResponse;
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0]?.function;
  if (!toolCall || toolCall.name !== 'submit_verdict' || !toolCall.arguments) {
    throw new CouncilError(`missing tool_call (got ${JSON.stringify(data).slice(0, 200)})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolCall.arguments);
  } catch (err) {
    throw new CouncilError(`tool_call.arguments not valid JSON: ${(err as Error).message}`);
  }
  return validateVerdict(parsed);
}

/**
 * Conservative degraded verdict when the LLM judge can't be reached/parsed:
 * refund the client. Better to withhold payment on judge failure than to pay
 * out an unverified result (ADR-0019).
 */
function degradedVerdict(reason: string): CouncilVerdict {
  return {
    outcome: 'client',
    reasoning: `Council unavailable (${reason}); defaulting to refund the client pending review.`,
  };
}

/**
 * Deterministic mock judge for tests / no-key local dev. Heuristic:
 *   - empty / very short result → client (executor produced nothing usable);
 *   - reason signals the work is missing/wrong → split (partial), unless the
 *     result is clearly substantive → worker;
 *   - otherwise → worker.
 * Intentionally simple — real judgment is the LLM path.
 */
function mockVerdict(c: DisputeCase): CouncilVerdict {
  const result = c.result.trim();
  if (result.length < 10) {
    return { outcome: 'client', reasoning: 'Mock: result is empty or too short to satisfy the instruction.' };
  }
  const reasonLc = c.reason.toLowerCase();
  const complains = ['wrong', 'incomplete', 'missing', 'partial', 'not what', 'incorrect'].some((s) =>
    reasonLc.includes(s),
  );
  if (complains) {
    return { outcome: 'split', executorSharePct: 50, reasoning: 'Mock: partial credit — result present but the complaint has merit.' };
  }
  return { outcome: 'worker', reasoning: 'Mock: result appears to satisfy the instruction; dispute looks unfounded.' };
}

/**
 * Judge a disputed sub-task. Real LLM path when a key is present (retry-once on
 * transient failure, degrade to `client` on repeated failure); deterministic
 * mock otherwise.
 */
export async function judgeDispute(c: DisputeCase, env: CouncilEnv): Promise<CouncilVerdict> {
  const useReal = !!env.openaiApiKey && env.useMock !== true;
  trace('council.judge.started', { mode: useReal ? 'llm' : 'mock', reason_len: c.reason.length, result_len: c.result.length });

  if (!useReal) {
    const v = mockVerdict(c);
    trace('council.judge.completed', { mode: 'mock', outcome: v.outcome, share: v.executorSharePct ?? null });
    return v;
  }

  const apiKey = env.openaiApiKey as string;
  const fetchImpl = env.fetchImpl ?? fetch;
  try {
    const v = await callOpenAIOnce(c, apiKey, fetchImpl);
    trace('council.judge.completed', { mode: 'llm', attempt: 1, outcome: v.outcome, share: v.executorSharePct ?? null });
    return v;
  } catch (err1) {
    const reason1 = err1 instanceof Error ? err1.message : String(err1);
    const transient1 = err1 instanceof CouncilError ? err1.transient : true;
    trace('council.judge.attempt', { attempt: 1, ok: false, reason: reason1, transient: transient1 });
    if (!transient1) {
      const v = degradedVerdict(reason1);
      trace('council.judge.degraded', { reason: reason1, after_attempt: 1 });
      return v;
    }
    try {
      const v = await callOpenAIOnce(c, apiKey, fetchImpl);
      trace('council.judge.completed', { mode: 'llm', attempt: 2, outcome: v.outcome, share: v.executorSharePct ?? null });
      return v;
    } catch (err2) {
      const reason2 = err2 instanceof Error ? err2.message : String(err2);
      trace('council.judge.degraded', { reason: reason2, after_attempt: 2 });
      return degradedVerdict(reason2);
    }
  }
}

export const __testing = {
  validateVerdict,
  mockVerdict,
  degradedVerdict,
  callOpenAIOnce,
  SYSTEM_PROMPT,
  VERDICT_TOOL,
};

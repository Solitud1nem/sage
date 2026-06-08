/**
 * Brief classifier for the parent agent.
 *
 * Dispatch:
 * - If `env.openaiApiKey` is set and `env.useMock !== true` → call OpenAI
 *   gpt-4o-mini via function-calling (modern `tools` API) and parse the
 *   structured JSON response into a `ClassificationResult`.
 * - Otherwise → use the deterministic mock (5 templates + clarify-with-user
 *   fallback). Same dispatch flow keeps unit tests offline-fast.
 *
 * In both modes, the heuristic cross-check (`heuristic.ts`) runs post-
 * classification, per `classification-trigger-design.md` §5.
 *
 * Failure handling on the real LLM path:
 * - Retry once on malformed response (missing field, bad enum, non-parseable
 *   bigint, etc.) or network error.
 * - On second failure → emit a conservative degraded `ClassificationResult`
 *   with `confidence_* = 0` so downstream behavior forces composite + high
 *   (maximum ceremony) per §5 asymmetric-bias rule.
 */

import type { ClassificationResult, SubTask } from '@sage/core';
import { applyHeuristicAdjustment } from './heuristic.js';

// ────────────────────────────────────────────────────────────────────────
// Structured trace logging
// ────────────────────────────────────────────────────────────────────────

/**
 * Emit one structured trace line to stderr. Shape: `{ts, event, ...payload}`.
 * Used by classify pipeline so each step (start / LLM attempt / raw response /
 * heuristic adjustment / final) is independently queryable in Fly logs and
 * easy to forward to PostHog later (M10.4.5) without changing call sites.
 *
 * Why stderr: keeps logs out of any HTTP response paths and is captured by
 * Fly's log collector identically to stdout. JSON-line format is one line
 * per event by convention.
 */
function trace(event: string, payload: Record<string, unknown>): void {
  console.error(JSON.stringify({ ts: Date.now(), event, ...payload }));
}

/** Truncate a brief for log payloads — never log full content (length still useful). */
function briefPreview(brief: string, n = 80): string {
  return brief.length <= n ? brief : `${brief.slice(0, n)}…`;
}

/**
 * Resolves an LLM-emitted task type to a registered executor in
 * AgentRegistryV2 (M11.3). Returns `null` when no registry agent supports
 * the capability — caller (frontend) falls back to env-var resolver.
 *
 * The orchestrator builds this callback by pre-fetching active agents from
 * the registry and combining with `registry-resolver.ts` matching logic.
 * Classifier code stays chain-agnostic by accepting the resolver as a callback.
 */
export type RegistryResolver = (
  taskType: string,
) => { address: `0x${string}`; price: bigint; capability: string } | null;

/**
 * Runtime environment threaded through every parent-agent call.
 */
export interface ParentEnv {
  /** OpenAI API key. When absent (or `useMock: true`), the mock path is used. */
  readonly openaiApiKey?: string;
  /** Force the mock path even if `openaiApiKey` is set. Useful for local dev / tests. */
  readonly useMock?: boolean;
  /** Override the `fetch` implementation used to call OpenAI. Test seam. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Optional registry-driven executor resolver (M11.3). When provided,
   * `classifyBrief` post-processes the proposed plan, filling
   * `executor_address` + adjusting `estimated_cost_units` from the
   * registry price. Absent or null result → field stays unset and frontend
   * falls back to its env-var resolver.
   */
  readonly resolveExecutor?: RegistryResolver;
}

// ────────────────────────────────────────────────────────────────────────
// Real LLM path
// ────────────────────────────────────────────────────────────────────────

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o-mini';

const SYSTEM_PROMPT = `You classify user briefs for an AI-agent task-escrow protocol along two axes.

DECOMPOSABILITY:
- "one-shot": exactly one deliverable, one executor, fits in a single LLM call or deterministic operation.
- "composite": deliverable depends on multiple sub-deliverables, different specializations, or sequential dependencies between steps.

STAKES:
- "low": total cost < 0.50 USDC, outcome reversible, no external side effects, familiar task type.
- "high": cost above threshold, irreversible outcome (booked / posted / signed / on-chain transfer), regulated context, novel brief.

SIGNALS (record what you weighed in signal_trace):
- Lexical: verb phrases ("translate/summarize" → one-shot bias, "research/plan/compare/analyze/audit" → composite bias), scope quantifiers ("top N", "all", "across"), conjunctions ("and then", "based on").
- Semantic: expertise diversity, sequential dependency, tool-call diversity.
- Stakes: numeric $ values, irreversibility verbs ("send/post/buy/transfer/sign/book"), domain context (legal/medical/financial).

CONTRACT:
- Always call the submit_classification function exactly once with the structured output. Do not return free-form text.
- For one-shot, proposed_plan length === 1.
- For composite, proposed_plan has 2-8 entries with explicit depends_on edges where execution is sequential.
- estimated_cost_units and estimated_total_cost_units are STRINGS of USDC base units (6 decimals; "100000" = 0.1 USDC).
- confidence_* values are your self-reported confidence 0..1. A deterministic heuristic layer runs after you, so be honest about uncertainty.
- reasoning: 1-2 sentences shown to the user on the plan card.

When uncertain, bias toward "composite" and "high" — the cost of unnecessary friction is one extra click; the cost of silently executing wrong work is real money.`;

/** JSON-schema describing `ClassificationResult` for OpenAI function-calling. */
const CLASSIFY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_classification',
    description: 'Submit the structured classification for the user brief.',
    parameters: {
      type: 'object',
      properties: {
        decomposability: { type: 'string', enum: ['one-shot', 'composite'] },
        stakes: { type: 'string', enum: ['low', 'high'] },
        confidence_decomposability: { type: 'number', minimum: 0, maximum: 1 },
        confidence_stakes: { type: 'number', minimum: 0, maximum: 1 },
        estimated_total_cost_units: {
          type: 'string',
          description: 'USDC base units (6 decimals) as a decimal string. Example: "100000" = 0.1 USDC.',
        },
        estimated_duration_ms: { type: 'integer', minimum: 0 },
        proposed_plan: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              id: { type: 'integer', minimum: 1 },
              type: { type: 'string' },
              executor_address: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
              estimated_cost_units: { type: 'string' },
              deadline_offset_s: { type: 'integer', minimum: 0 },
              depends_on: { type: 'array', items: { type: 'integer' } },
              spec: { type: 'string' },
            },
            required: ['id', 'type', 'estimated_cost_units', 'deadline_offset_s', 'spec'],
            additionalProperties: false,
          },
        },
        reasoning: { type: 'string' },
        signal_trace: {
          type: 'object',
          properties: {
            lexical: { type: 'array', items: { type: 'string' } },
            semantic: { type: 'array', items: { type: 'string' } },
            stakes: { type: 'array', items: { type: 'string' } },
          },
          required: ['lexical', 'semantic', 'stakes'],
          additionalProperties: false,
        },
      },
      required: [
        'decomposability',
        'stakes',
        'confidence_decomposability',
        'confidence_stakes',
        'estimated_total_cost_units',
        'estimated_duration_ms',
        'proposed_plan',
        'reasoning',
        'signal_trace',
      ],
      additionalProperties: false,
    },
  },
};

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      tool_calls?: Array<{
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  error?: { message?: string };
}

/** Raw JSON shape we expect back from the LLM (pre-validation). */
interface RawClassification {
  decomposability: string;
  stakes: string;
  confidence_decomposability: number;
  confidence_stakes: number;
  estimated_total_cost_units: string;
  estimated_duration_ms: number;
  proposed_plan: Array<{
    id: number;
    type: string;
    executor_address?: string;
    estimated_cost_units: string;
    deadline_offset_s: number;
    depends_on?: number[];
    spec: string;
  }>;
  reasoning: string;
  signal_trace: { lexical: string[]; semantic: string[]; stakes: string[] };
}

/**
 * Classifier-side error wrapper. `transient` distinguishes errors that
 * are worth retrying (5xx, 429, network blip, malformed LLM response —
 * default) from errors where retrying is pointless (4xx with bad key
 * or content filtering — `transient: false`). The retry wrapper in
 * `classifyLLM` short-circuits to the degraded result on permanent
 * failures, saving a wasted second call.
 */
class ClassifierError extends Error {
  readonly transient: boolean;
  constructor(message: string, transient: boolean = true) {
    super(message);
    this.transient = transient;
  }
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function parseBigIntStrict(s: unknown, field: string): bigint {
  if (typeof s !== 'string' || !/^\d+$/.test(s)) {
    throw new ClassifierError(`field ${field} is not a non-negative decimal string: ${String(s)}`);
  }
  return BigInt(s);
}

function validateAndConvert(raw: unknown): ClassificationResult {
  if (!raw || typeof raw !== 'object') {
    throw new ClassifierError('top-level response is not an object');
  }
  const r = raw as Partial<RawClassification>;

  if (!isOneOf(r.decomposability, ['one-shot', 'composite'] as const)) {
    throw new ClassifierError(`bad decomposability: ${String(r.decomposability)}`);
  }
  if (!isOneOf(r.stakes, ['low', 'high'] as const)) {
    throw new ClassifierError(`bad stakes: ${String(r.stakes)}`);
  }
  const cd = r.confidence_decomposability;
  const cs = r.confidence_stakes;
  if (typeof cd !== 'number' || cd < 0 || cd > 1) {
    throw new ClassifierError(`bad confidence_decomposability: ${String(cd)}`);
  }
  if (typeof cs !== 'number' || cs < 0 || cs > 1) {
    throw new ClassifierError(`bad confidence_stakes: ${String(cs)}`);
  }
  if (typeof r.estimated_duration_ms !== 'number' || r.estimated_duration_ms < 0) {
    throw new ClassifierError(`bad estimated_duration_ms: ${String(r.estimated_duration_ms)}`);
  }
  if (!Array.isArray(r.proposed_plan) || r.proposed_plan.length < 1) {
    throw new ClassifierError('proposed_plan must be a non-empty array');
  }
  if (typeof r.reasoning !== 'string') {
    throw new ClassifierError('reasoning must be a string');
  }
  if (!r.signal_trace || typeof r.signal_trace !== 'object') {
    throw new ClassifierError('signal_trace must be an object');
  }
  const st = r.signal_trace;
  if (!Array.isArray(st.lexical) || !Array.isArray(st.semantic) || !Array.isArray(st.stakes)) {
    throw new ClassifierError('signal_trace channels must be arrays');
  }

  const totalCost = parseBigIntStrict(r.estimated_total_cost_units, 'estimated_total_cost_units');

  const subtasks: SubTask[] = r.proposed_plan.map((p, idx) => {
    if (!p || typeof p !== 'object') {
      throw new ClassifierError(`proposed_plan[${idx}] is not an object`);
    }
    if (typeof p.id !== 'number' || !Number.isInteger(p.id)) {
      throw new ClassifierError(`proposed_plan[${idx}].id is not an integer`);
    }
    if (typeof p.type !== 'string' || p.type.length === 0) {
      throw new ClassifierError(`proposed_plan[${idx}].type is missing`);
    }
    if (typeof p.deadline_offset_s !== 'number' || p.deadline_offset_s < 0) {
      throw new ClassifierError(`proposed_plan[${idx}].deadline_offset_s is invalid`);
    }
    if (typeof p.spec !== 'string') {
      throw new ClassifierError(`proposed_plan[${idx}].spec is not a string`);
    }
    const cost = parseBigIntStrict(p.estimated_cost_units, `proposed_plan[${idx}].estimated_cost_units`);

    const subtask: SubTask = {
      id: p.id,
      type: p.type,
      estimated_cost_units: cost,
      deadline_offset_s: p.deadline_offset_s,
      spec: p.spec,
      ...(p.executor_address && /^0x[a-fA-F0-9]{40}$/.test(p.executor_address)
        ? { executor_address: p.executor_address as `0x${string}` }
        : {}),
      ...(Array.isArray(p.depends_on) && p.depends_on.length > 0
        ? { depends_on: p.depends_on.slice() }
        : {}),
    };
    return subtask;
  });

  return {
    decomposability: r.decomposability,
    stakes: r.stakes,
    confidence_decomposability: cd,
    confidence_stakes: cs,
    estimated_total_cost_units: totalCost,
    estimated_duration_ms: r.estimated_duration_ms,
    proposed_plan: subtasks,
    reasoning: r.reasoning,
    signal_trace: {
      lexical: st.lexical.slice(),
      semantic: st.semantic.slice(),
      stakes: st.stakes.slice(),
    },
  };
}

async function callOpenAIOnce(
  brief: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<ClassificationResult> {
  const res = await fetchImpl(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: brief },
      ],
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: 'function', function: { name: 'submit_classification' } },
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // 5xx and 429 are transient; other 4xx (401/403/422/content-filter) are
    // permanent — retrying with the same payload won't change the answer.
    const transient = res.status >= 500 || res.status === 429;
    throw new ClassifierError(
      `OpenAI ${res.status}: ${body.slice(0, 200)}`,
      transient,
    );
  }

  const data = (await res.json()) as OpenAIChatResponse;
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0]?.function;
  if (!toolCall || toolCall.name !== 'submit_classification' || !toolCall.arguments) {
    throw new ClassifierError(
      `missing tool_call (got ${JSON.stringify(data).slice(0, 200)})`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolCall.arguments);
  } catch (err) {
    throw new ClassifierError(`tool_call.arguments is not valid JSON: ${(err as Error).message}`);
  }
  return validateAndConvert(parsed);
}

function degradedClassification(reason: string): ClassificationResult {
  return {
    decomposability: 'composite',
    stakes: 'high',
    confidence_decomposability: 0,
    confidence_stakes: 0,
    estimated_total_cost_units: 0n,
    estimated_duration_ms: 0,
    proposed_plan: [
      {
        id: 1,
        type: 'clarify-with-user',
        estimated_cost_units: 0n,
        deadline_offset_s: 0,
        spec: `Classifier degraded (${reason}). Please retry or split into smaller steps.`,
      },
    ],
    reasoning: 'Classifier failed twice. Falling back to conservative composite/high default per §5.',
    signal_trace: { lexical: [], semantic: [`degraded:${reason}`], stakes: [] },
  };
}

async function classifyLLM(
  brief: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<ClassificationResult> {
  try {
    const r = await callOpenAIOnce(brief, apiKey, fetchImpl);
    trace('parent.classify.llm_attempt', { attempt: 1, ok: true });
    return r;
  } catch (err1) {
    const reason1 = err1 instanceof Error ? err1.message : String(err1);
    const transient1 = err1 instanceof ClassifierError ? err1.transient : true;
    trace('parent.classify.llm_attempt', {
      attempt: 1,
      ok: false,
      reason: reason1,
      transient: transient1,
    });

    // Permanent failure → don't burn a second call.
    if (!transient1) {
      trace('parent.classify.degraded', { reason: reason1, after_attempt: 1 });
      return degradedClassification(reason1);
    }

    try {
      const r = await callOpenAIOnce(brief, apiKey, fetchImpl);
      trace('parent.classify.llm_attempt', { attempt: 2, ok: true });
      return r;
    } catch (err2) {
      const reason2 = err2 instanceof Error ? err2.message : String(err2);
      const transient2 = err2 instanceof ClassifierError ? err2.transient : true;
      trace('parent.classify.llm_attempt', {
        attempt: 2,
        ok: false,
        reason: reason2,
        transient: transient2,
      });
      trace('parent.classify.degraded', { reason: reason2, after_attempt: 2 });
      return degradedClassification(reason2);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Mock path (preserved from M10.1.5 — used when no API key or useMock=true)
// ────────────────────────────────────────────────────────────────────────

interface MockTemplate {
  readonly id: string;
  readonly matches: (lowerBrief: string) => boolean;
  readonly build: () => ClassificationResult;
}

const TEMPLATES: readonly MockTemplate[] = [
  {
    id: 'translate-one-shot',
    matches: (l) =>
      l.includes('translate') && !l.includes('summariz') && !l.includes('research'),
    build: () => ({
      decomposability: 'one-shot',
      stakes: 'low',
      confidence_decomposability: 0.92,
      confidence_stakes: 0.95,
      estimated_total_cost_units: 100_000n,
      estimated_duration_ms: 8_000,
      proposed_plan: [
        {
          id: 1,
          type: 'translate-text',
          estimated_cost_units: 100_000n,
          deadline_offset_s: 600,
          spec: '<mock> translate the provided text',
        },
      ],
      reasoning:
        'Single translation step; no scope quantifiers; reversible. One-shot, low-stakes.',
      signal_trace: {
        lexical: ['translate'],
        semantic: ['single-verb imperative'],
        stakes: [],
      },
    }),
  },
  {
    id: 'summarize-one-shot',
    matches: (l) => l.includes('summariz') && !l.includes('and') && !l.includes('translate'),
    build: () => ({
      decomposability: 'one-shot',
      stakes: 'low',
      confidence_decomposability: 0.94,
      confidence_stakes: 0.96,
      estimated_total_cost_units: 80_000n,
      estimated_duration_ms: 7_000,
      proposed_plan: [
        {
          id: 1,
          type: 'summarize-text',
          estimated_cost_units: 80_000n,
          deadline_offset_s: 600,
          spec: '<mock> summarize the provided article',
        },
      ],
      reasoning:
        'Single summarization step; no sub-step dependencies. One-shot, low-stakes.',
      signal_trace: {
        lexical: ['summarize'],
        semantic: ['single-verb imperative'],
        stakes: [],
      },
    }),
  },
  {
    id: 'research-and-report',
    matches: (l) => l.includes('research') && (l.includes('report') || l.includes('write')),
    build: () => ({
      decomposability: 'composite',
      stakes: 'low',
      confidence_decomposability: 0.88,
      confidence_stakes: 0.9,
      estimated_total_cost_units: 350_000n,
      estimated_duration_ms: 45_000,
      proposed_plan: [
        {
          id: 1,
          type: 'research-web',
          estimated_cost_units: 200_000n,
          deadline_offset_s: 1800,
          spec: '<mock> gather source material per the brief',
        },
        {
          id: 2,
          type: 'summarize-text',
          estimated_cost_units: 150_000n,
          deadline_offset_s: 1200,
          depends_on: [1],
          spec: '<mock> synthesize the research into a comparative report',
        },
      ],
      reasoning:
        'Two-step composite: research the source material, then synthesize into a report. Sequential dependency.',
      signal_trace: {
        lexical: ['research', 'write', 'report'],
        semantic: ['sequential dependency', 'expertise diversity (research + writing)'],
        stakes: [],
      },
    }),
  },
  {
    id: 'plan-trip',
    matches: (l) => l.includes('plan') && l.includes('trip'),
    build: () => ({
      decomposability: 'composite',
      stakes: 'low',
      confidence_decomposability: 0.83,
      confidence_stakes: 0.78,
      estimated_total_cost_units: 500_000n,
      estimated_duration_ms: 60_000,
      proposed_plan: [
        {
          id: 1,
          type: 'research-web',
          estimated_cost_units: 200_000n,
          deadline_offset_s: 1800,
          spec: '<mock> research destination logistics (flights, neighborhoods, attractions)',
        },
        {
          id: 2,
          type: 'summarize-text',
          estimated_cost_units: 150_000n,
          deadline_offset_s: 1200,
          depends_on: [1],
          spec: '<mock> synthesize a day-by-day itinerary draft',
        },
        {
          id: 3,
          type: 'translate-text',
          estimated_cost_units: 150_000n,
          deadline_offset_s: 1200,
          depends_on: [2],
          spec: '<mock> produce a phrasebook of useful local phrases',
        },
      ],
      reasoning:
        'Three-step composite covering research, itinerary synthesis, and a phrasebook. Sequential dependencies.',
      signal_trace: {
        lexical: ['plan', 'trip'],
        semantic: ['expertise diversity', 'sequential dependency'],
        stakes: [],
      },
    }),
  },
  {
    id: 'send-funds',
    matches: (l) => /\bsend\b/.test(l) && (/\$\d/.test(l) || /\busdc\b/.test(l)),
    build: () => ({
      decomposability: 'one-shot',
      stakes: 'high',
      confidence_decomposability: 0.96,
      confidence_stakes: 0.91,
      estimated_total_cost_units: 50_000n,
      estimated_duration_ms: 5_000,
      proposed_plan: [
        {
          id: 1,
          type: 'transfer-funds',
          estimated_cost_units: 50_000n,
          deadline_offset_s: 300,
          spec: '<mock> execute the on-chain transfer as specified in the brief',
        },
      ],
      reasoning:
        'Single irreversible transfer. One-shot but high-stakes because of the dollar value and "send" verb.',
      signal_trace: {
        lexical: ['send'],
        semantic: [],
        stakes: ['dollar value', 'irreversibility verb "send"'],
      },
    }),
  },
];

function fallbackClassification(): ClassificationResult {
  return {
    decomposability: 'composite',
    stakes: 'low',
    confidence_decomposability: 0.3,
    confidence_stakes: 0.5,
    estimated_total_cost_units: 0n,
    estimated_duration_ms: 5_000,
    proposed_plan: [
      {
        id: 1,
        type: 'clarify-with-user',
        estimated_cost_units: 0n,
        deadline_offset_s: 0,
        spec: 'This brief did not match a known template. Please rephrase or split into smaller steps.',
      },
    ],
    reasoning:
      'Mock classifier — brief did not match a known template. Falling back to a clarification step (§7).',
    signal_trace: {
      lexical: [],
      semantic: ['no template match'],
      stakes: [],
    },
  };
}

function classifyMock(brief: string): ClassificationResult {
  const lower = brief.toLowerCase();
  const template = TEMPLATES.find((t) => t.matches(lower));
  return template ? template.build() : fallbackClassification();
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/**
 * Classify a user brief. Returns the heuristic-adjusted classification.
 *
 * Emits structured trace events at every pipeline step (see `trace()`).
 * On the happy path the event sequence is:
 *   started → llm_attempt(ok) → raw → heuristic_applied → completed
 * On retry-success:
 *   started → llm_attempt(fail) → llm_attempt(ok) → raw → heuristic_applied → completed
 * On double failure:
 *   started → llm_attempt(fail) → llm_attempt(fail) → degraded → raw → heuristic_applied → completed
 * Mock path skips llm_attempt events.
 */
export async function classifyBrief(
  brief: string,
  env: ParentEnv,
): Promise<ClassificationResult> {
  const useReal = !!env.openaiApiKey && env.useMock !== true;
  const mode = useReal ? 'llm' : 'mock';
  trace('parent.classify.started', {
    mode,
    brief_len: brief.length,
    brief_preview: briefPreview(brief),
  });

  const raw = useReal
    ? await classifyLLM(brief, env.openaiApiKey as string, env.fetchImpl ?? fetch)
    : classifyMock(brief);

  trace('parent.classify.raw', {
    mode,
    decomposability: raw.decomposability,
    stakes: raw.stakes,
    confidence_decomposability: raw.confidence_decomposability,
    confidence_stakes: raw.confidence_stakes,
    plan_len: raw.proposed_plan.length,
  });

  const adjusted = applyHeuristicAdjustment(brief, raw);

  const addedLexical = adjusted.signal_trace.lexical.filter((s) => s.startsWith('heuristic:'));
  const addedStakes = adjusted.signal_trace.stakes.filter((s) => s.startsWith('heuristic:'));
  trace('parent.classify.heuristic_applied', {
    before: {
      confidence_decomposability: raw.confidence_decomposability,
      confidence_stakes: raw.confidence_stakes,
    },
    after: {
      confidence_decomposability: adjusted.confidence_decomposability,
      confidence_stakes: adjusted.confidence_stakes,
    },
    composite_cues: addedLexical,
    stakes_cues: addedStakes,
  });

  // M11.3.X: the orchestrator is the sole authority on executor selection.
  // First strip any LLM-emitted `executor_address` unconditionally — the
  // model classifies capability, it never designates *who* executes; left
  // unchecked it occasionally echoes a recipient address from the brief
  // (e.g. "summarize wallet 0xABC…") into this field (GOTCHAS 2026-05-22).
  // Then, when a registry resolver is wired (chains with AgentRegistryV2),
  // fill `executor_address` + `estimated_cost_units` from the registry.
  // Sub-tasks the registry can't resolve — and every sub-task on chains
  // without a V2 registry (e.g. Arc) — arrive with no executor; the
  // frontend surfaces them as unassigned for manual pick in the plan-editor.
  const stripped = {
    ...adjusted,
    proposed_plan: adjusted.proposed_plan.map(stripExecutor),
  };
  const withRegistry = env.resolveExecutor
    ? { ...stripped, proposed_plan: augmentPlanFromRegistry(stripped.proposed_plan, env.resolveExecutor) }
    : stripped;

  trace('parent.classify.completed', {
    mode,
    decomposability: withRegistry.decomposability,
    stakes: withRegistry.stakes,
    confidence_decomposability: withRegistry.confidence_decomposability,
    confidence_stakes: withRegistry.confidence_stakes,
    plan_len: withRegistry.proposed_plan.length,
    registry_resolved: env.resolveExecutor
      ? withRegistry.proposed_plan.filter((s) => !!s.executor_address).length
      : 0,
  });

  return withRegistry;
}

/**
 * Drop any `executor_address` from a sub-task. Used to neutralize
 * LLM-emitted addresses before registry resolution — the model never gets
 * to pick the executor (see `classifyBrief`). Returns the sub-task
 * unchanged when no address is present.
 */
function stripExecutor(sub: SubTask): SubTask {
  if (!sub.executor_address) return sub;
  const { executor_address: _stripped, ...rest } = sub;
  return rest;
}

/**
 * Apply registry-resolver to each sub-task. Pure data transformation; no
 * I/O. Callers pass a plan whose `executor_address` fields are already
 * stripped (see `stripExecutor`), so the registry is the only source of an
 * executor here. Sub-tasks the resolver can't match keep no executor — the
 * frontend surfaces them as unassigned for a manual pick.
 */
function augmentPlanFromRegistry(
  proposedPlan: readonly SubTask[],
  resolveExecutor: RegistryResolver,
): SubTask[] {
  return proposedPlan.map((sub) => {
    const match = resolveExecutor(sub.type);
    if (match === null) return sub;
    return {
      ...sub,
      executor_address: match.address,
      // Trust the registry price over the classifier estimate — agents
      // priced themselves, that's the canonical figure.
      estimated_cost_units: match.price,
    };
  });
}

/**
 * Internal symbols exposed for unit-tests only. Not part of the stable
 * public API of this module.
 */
export const __testing = {
  TEMPLATES,
  fallbackClassification,
  classifyMock,
  callOpenAIOnce,
  validateAndConvert,
  degradedClassification,
  classifyLLM,
  trace,
  briefPreview,
  SYSTEM_PROMPT,
  CLASSIFY_TOOL,
};

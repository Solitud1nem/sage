/**
 * Evaluation codec — shared between the parent (plan-runner spawns evaluator
 * tasks) and the generic worker (evaluator handler judges them). M12.0.3,
 * ADR-0020 п.5: fact-checker / QA / second-reviewer are instances of ONE paid
 * evaluator role; this file defines the wire shapes that make that role
 * uniform.
 *
 * Lives in `src/shared/` for the same reason as `composite-codec.ts`: the
 * worker bundle must not import from `src/parent/` (workers ship as separate
 * processes with their own bundles).
 *
 * Two shapes:
 *
 * - **EvaluationCase** — what the evaluator receives as MATERIAL (via the
 *   ADR-0018 `inputs` channel): the instruction the executor was given and
 *   the result it submitted. JSON-encoded so the harness can present both
 *   to the judge model unambiguously.
 *
 * - **EvaluationVerdict** — what the evaluator returns as its task result:
 *   `{pass, reasons[], score?}` wrapped in a `verdict` key. `pass:false`
 *   raises the dispute → council hook (ADR-0019) on the evaluated task;
 *   reasons feed the dispute reason. Kept inspectable on-chain (ADR-0007).
 *
 * Decoders are permissive-to-null like the other codecs: a malformed case /
 * verdict returns `null` and the caller degrades loudly instead of throwing —
 * an evaluator must never be able to wedge a plan with garbage output.
 */

export interface EvaluationCase {
  /** The instruction the EVALUATED executor was given (its `spec`). */
  readonly instruction: string;
  /** The result the evaluated executor submitted (decoded, not the URI). */
  readonly result: string;
}

/**
 * Optional evaluator-produced artifact reference (M12.1.2): the QA gate
 * uploads a rendered screenshot to the R2 store and points at it here so the
 * UI can preview the judged output. Structurally mirrors the worker's
 * `ArtifactRef` — declared independently because `shared/` must not import
 * from `worker/` (separate bundles, see header).
 */
export interface VerdictScreenshot {
  readonly sha256: string;
  readonly size: number;
  readonly mime: string;
  readonly url: string;
}

export interface EvaluationVerdict {
  /** true → release the evaluated step's payment; false → dispute hook. */
  readonly pass: boolean;
  /** Human-readable findings; on fail they become the dispute reason. */
  readonly reasons: readonly string[];
  /** Optional 0..100 quality score for UI display. */
  readonly score?: number;
  /** Optional rendered-output screenshot for UI preview (M12.1.2 QA gate). */
  readonly screenshot?: VerdictScreenshot;
}

export function encodeEvaluationCase(c: EvaluationCase): string {
  return JSON.stringify({ evaluation_case: { instruction: c.instruction, result: c.result } });
}

export function decodeEvaluationCase(text: string): EvaluationCase | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const c = (parsed as { evaluation_case?: unknown }).evaluation_case;
  if (!c || typeof c !== 'object') return null;
  const { instruction, result } = c as { instruction?: unknown; result?: unknown };
  if (typeof instruction !== 'string' || typeof result !== 'string') return null;
  return { instruction, result };
}

export function encodeVerdict(v: EvaluationVerdict): string {
  return JSON.stringify({
    verdict: {
      pass: v.pass,
      reasons: [...v.reasons],
      ...(v.score !== undefined ? { score: v.score } : {}),
      ...(v.screenshot !== undefined ? { screenshot: v.screenshot } : {}),
    },
  });
}

/**
 * Permissive screenshot decode: a malformed screenshot is dropped, never a
 * reason to reject an otherwise valid verdict — the preview is a UI nicety,
 * the pass/fail decision must survive without it.
 */
function decodeScreenshot(raw: unknown): VerdictScreenshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const { sha256, size, mime, url } = raw as Record<string, unknown>;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) return null;
  if (typeof mime !== 'string' || typeof url !== 'string') return null;
  return { sha256, size, mime, url };
}

export function decodeVerdict(text: string): EvaluationVerdict | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const v = (parsed as { verdict?: unknown }).verdict;
  if (!v || typeof v !== 'object') return null;
  const { pass, reasons, score, screenshot } = v as {
    pass?: unknown;
    reasons?: unknown;
    score?: unknown;
    screenshot?: unknown;
  };
  if (typeof pass !== 'boolean') return null;
  const reasonList = Array.isArray(reasons)
    ? reasons.filter((r): r is string => typeof r === 'string')
    : [];
  const validScore =
    typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100;
  const shot = decodeScreenshot(screenshot);
  return {
    pass,
    reasons: reasonList,
    ...(validScore ? { score } : {}),
    ...(shot ? { screenshot: shot } : {}),
  };
}

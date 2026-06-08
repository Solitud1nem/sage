/**
 * Composite-envelope codec — shared between all worker agents.
 *
 * The parent-agent's `parent-id-codec` wraps each sub-task's spec in a
 * `data:application/json,{parent,spec}` envelope so off-chain indexers
 * can reconstruct the parent → sub-task graph from `TaskCreated` events.
 * Worker agents need to detect that envelope and extract the inner
 * `spec` string so their LLM prompt switches from "summarize/translate
 * this content" (3-mode path) to "execute this instruction" (composite
 * path).
 *
 * This is the worker-side counterpart to `parent/parent-id-codec.ts`.
 * Both decode the same envelope; both inline the logic rather than
 * sharing a single module — the worker needs to stay independent of
 * the parent module (workers ship as separate Fly processes with their
 * own bundles). Keeping the function in `src/shared/` lets all four
 * workers share one copy without pulling in `src/parent/`.
 *
 * The function is intentionally permissive on the way out: any failure
 * to parse / shape-validate returns `null`, leaving the caller to fall
 * through to the original raw-content handling. We do NOT throw —
 * workers see arbitrary on-chain specs (3-mode demo path, composite
 * path, future paths) and a noisy decoder would mask real input bugs.
 */

export const COMPOSITE_PREFIX = 'data:application/json,';

/**
 * Decode the inner `spec` instruction from a composite envelope.
 *
 * Returns:
 *   - the `spec` string when `specUri` is a well-formed envelope
 *     (`data:application/json,` + URL-encoded JSON + `{parent, spec}`
 *     fields where `spec` is a string and `parent` is present);
 *   - `null` for any non-envelope URI or any malformed envelope.
 *
 * `null` is the dual-mode signal to fall back to 3-mode raw-content
 * handling. Callers should not treat `null` as an error.
 */
export function decodeCompositeSpec(specUri: string): string | null {
  const env = decodeCompositeEnvelope(specUri);
  return env ? env.spec : null;
}

/**
 * Decoded composite envelope from a worker's point of view (ADR-0018):
 *   - `spec`    — the instruction (what to do);
 *   - `source`  — the original payload, material for a root sub-task;
 *   - `inputs`  — upstream dependency results keyed by sub id, material for a
 *                 dependent sub-task.
 * `source`/`inputs` are present only when the parent attached them.
 */
export interface CompositeEnvelope {
  spec: string;
  source?: string;
  inputs?: Record<number, string>;
}

/**
 * Decode the full composite envelope. Returns the `{spec, source?, inputs?}`
 * object for a well-formed envelope, or `null` for any non-envelope /
 * malformed URI (the dual-mode signal to fall back to 3-mode raw handling).
 *
 * Permissive on optional fields: a malformed `source`/`inputs` is dropped,
 * never failing the decode — the worker can still act on `spec` alone.
 */
export function decodeCompositeEnvelope(specUri: string): CompositeEnvelope | null {
  if (!specUri.startsWith(COMPOSITE_PREFIX)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(specUri.slice(COMPOSITE_PREFIX.length));
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as { spec?: unknown; parent?: unknown; source?: unknown; inputs?: unknown };
  if (typeof p.spec !== 'string' || !p.parent) return null;
  const env: CompositeEnvelope = { spec: p.spec };
  if (typeof p.source === 'string') env.source = p.source;
  const inputs = parseInputs(p.inputs);
  if (inputs !== undefined) env.inputs = inputs;
  return env;
}

/**
 * Materialize the worker's working text from an envelope per the ADR-0018
 * convention: prefer `inputs` (this is a dependent sub-task — operate on the
 * upstream result), else `source` (root sub-task), else `null` (let the caller
 * fall back to treating `spec` as self-contained). Multiple `inputs` are
 * concatenated in ascending sub-id order, separated by a blank line.
 */
export function materialFromEnvelope(env: CompositeEnvelope): string | null {
  if (env.inputs) {
    const ids = Object.keys(env.inputs)
      .map(Number)
      .filter((n) => Number.isInteger(n))
      .sort((a, b) => a - b);
    if (ids.length > 0) {
      return ids.map((id) => env.inputs![id]).join('\n\n');
    }
  }
  if (typeof env.source === 'string' && env.source.length > 0) {
    return env.source;
  }
  return null;
}

/** Worker-side counterpart of the parent codec's input validator. */
function parseInputs(raw: unknown): Record<number, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<number, string> = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1) continue;
    if (typeof v !== 'string') continue;
    out[n] = v;
    count += 1;
  }
  return count > 0 ? out : undefined;
}

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
  const p = parsed as { spec?: unknown; parent?: unknown };
  if (typeof p.spec !== 'string' || !p.parent) return null;
  return p.spec;
}

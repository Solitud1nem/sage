/**
 * Codec for parent-child task linkage embedded in TaskEscrow `specUri`.
 *
 * Why a data URI: `TaskCreated` event only exposes `specUri` to off-chain
 * indexers. To reconstruct the parent → sub-task graph (per ADR-0007), the
 * parent_id has to ride along inside this field. We pick a `data:application/json`
 * wrapper so the spec stays inspectable in block explorers and humans can
 * eyeball it without a decoder.
 *
 * Wire format:
 *   `data:application/json,<percent-encoded-JSON>`
 *
 * The decoded JSON object has shape (per ADR-0018):
 *   `{ "parent": { "run": "<runId>", "sub": <subTaskId> },
 *      "spec": "<instruction>",
 *      "source"?: "<original payload text>",
 *      "inputs"?: { "<depSubId>": "<upstream result>", ... } }`
 *
 * The `spec` field carries the executor-facing INSTRUCTION (what to do). The
 * optional `source` carries the original brief payload verbatim (the MATERIAL
 * for a root sub-task), and `inputs` carries upstream dependency results keyed
 * by sub id (the MATERIAL for a dependent sub-task) — see ADR-0018. Both are
 * optional so the legacy `{parent, spec}` envelope and the 3-mode raw-text
 * path keep working unchanged. The `parent` field is what the off-chain
 * indexer reads to rebuild the plan graph.
 */

export interface ParentId {
  /** Plan run identifier (one per `/composite/execute` invocation). */
  readonly run: string;
  /** Sub-task ordinal within the plan (matches `SubTask.id`, 1-indexed). */
  readonly sub: number;
  /**
   * Delegation depth of THIS task below the user-initiated run (ADR-0007
   * guard, M12.0.3): tasks spawned directly by the orchestrator's plan-runner
   * (workers and evaluators alike) are depth 1; a future parent-as-worker
   * spawning a nested run from such a task would mint depth 2, and so on.
   * Optional on the wire — legacy envelopes without it read as depth 1.
   * The plan-runner refuses to execute beyond its max-depth, which is what
   * breaks pathological delegate-forever recursion.
   */
  readonly depth?: number;
}

/** Optional content fields attached to a sub-task envelope (ADR-0018). */
export interface EnvelopeContent {
  /** Original brief payload, verbatim — material for a root sub-task. */
  readonly source?: string;
  /** Upstream dependency results keyed by sub id — material for a dependent sub-task. */
  readonly inputs?: Readonly<Record<number, string>>;
}

/** Full decoded envelope: linkage + instruction + optional material. */
export interface DecodedEnvelope extends EnvelopeContent {
  readonly parent: ParentId;
  readonly spec: string;
}

const DATA_URI_PREFIX = 'data:application/json,';

interface EncodedPayload {
  parent: ParentId;
  spec: string;
  source?: string;
  inputs?: Record<number, string>;
}

/**
 * Encode a parent_id, sub-task spec, and optional content into a single
 * `data:application/json` specUri ready for `TaskEscrow.createTask`.
 *
 * `source`/`inputs` keys are omitted entirely when not supplied, so the wire
 * format is byte-identical to the legacy `{parent, spec}` envelope for
 * callers that don't pass content (back-compat).
 *
 * @param parent   Parent run + sub-task identifier pair.
 * @param spec     Executor-facing instruction for this sub-task.
 * @param content  Optional `{source, inputs}` material (ADR-0018).
 */
export function encodeParentId(
  parent: ParentId,
  spec: string,
  content?: EnvelopeContent,
): string {
  if (!Number.isInteger(parent.sub) || parent.sub < 1) {
    throw new Error(`encodeParentId: sub must be a positive integer, got ${parent.sub}`);
  }
  if (parent.run.length === 0) {
    throw new Error('encodeParentId: run must be a non-empty string');
  }
  if (parent.depth !== undefined && (!Number.isInteger(parent.depth) || parent.depth < 1)) {
    throw new Error(`encodeParentId: depth must be a positive integer, got ${parent.depth}`);
  }
  const payload: EncodedPayload = {
    parent: {
      run: parent.run,
      sub: parent.sub,
      ...(parent.depth !== undefined ? { depth: parent.depth } : {}),
    },
    spec,
  };
  if (content?.source !== undefined) {
    payload.source = content.source;
  }
  // Only attach `inputs` when it carries at least one entry — an empty object
  // is indistinguishable from "no upstream material" and just bloats the URI.
  if (content?.inputs && Object.keys(content.inputs).length > 0) {
    payload.inputs = { ...content.inputs };
  }
  return `${DATA_URI_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`;
}

/**
 * Extract the `{run, sub}` pair from a specUri. Returns `null` if the URI is
 * not a properly-formatted parent-id envelope (wrong prefix, bad JSON, missing
 * `parent`, etc.). The off-chain indexer uses this to filter `TaskCreated`
 * events for parent-spawned sub-tasks.
 */
export function decodeParentId(specUri: string): ParentId | null {
  const payload = decodePayload(specUri);
  if (!payload) return null;
  return payload.parent;
}

/**
 * Extract the sub-task `spec` text from a specUri. Returns `null` if the URI
 * is not in the expected envelope shape. Worker agents that opt into the
 * composite flow can use this to recover the spec from the wrapper.
 *
 * Note: the existing 4 workers (summarizer/translator/vision/sentiment) do
 * NOT call this — they pass `specUri` directly to OpenAI. The wrapper is
 * still valid JSON text so summarization works tolerably; full integration
 * is deferred to a future worker generation.
 */
export function decodeSpec(specUri: string): string | null {
  const payload = decodePayload(specUri);
  if (!payload) return null;
  return payload.spec;
}

/**
 * Decode the full envelope — linkage + instruction + optional `source`/`inputs`
 * material (ADR-0018). Returns `null` for non-envelope or malformed URIs.
 * Optional content fields are included only when present and well-typed;
 * malformed optional fields are dropped (permissive), never failing the decode.
 */
export function decodeEnvelope(specUri: string): DecodedEnvelope | null {
  const payload = decodePayload(specUri);
  if (!payload) return null;
  const env: DecodedEnvelope = { parent: payload.parent, spec: payload.spec };
  return {
    ...env,
    ...(payload.source !== undefined ? { source: payload.source } : {}),
    ...(payload.inputs !== undefined ? { inputs: payload.inputs } : {}),
  };
}

/**
 * Validate the optional `inputs` field. JSON object keys are strings, so we
 * rebuild a `Record<number, string>` from numeric-string keys, dropping any
 * entry whose key isn't a positive integer or whose value isn't a string.
 * Returns undefined when the field is absent or yields no valid entries.
 */
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

function decodePayload(specUri: string): EncodedPayload | null {
  if (typeof specUri !== 'string' || !specUri.startsWith(DATA_URI_PREFIX)) return null;
  const encoded = specUri.slice(DATA_URI_PREFIX.length);
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
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
  const p = parsed as Partial<EncodedPayload>;
  if (!p.parent || typeof p.parent !== 'object') return null;
  const { run, sub, depth } = p.parent;
  if (typeof run !== 'string' || run.length === 0) return null;
  if (typeof sub !== 'number' || !Number.isInteger(sub) || sub < 1) return null;
  if (typeof p.spec !== 'string') return null;
  // depth is optional; a malformed value degrades to "absent" (legacy = 1)
  // rather than failing the whole decode — the guard consumer treats both
  // the same and a hostile envelope gains nothing by omitting it.
  const validDepth = typeof depth === 'number' && Number.isInteger(depth) && depth >= 1;
  const result: EncodedPayload = {
    parent: { run, sub, ...(validDepth ? { depth } : {}) },
    spec: p.spec,
  };
  if (typeof p.source === 'string') result.source = p.source;
  const inputs = parseInputs(p.inputs);
  if (inputs !== undefined) result.inputs = inputs;
  return result;
}

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
 * The decoded JSON object has shape:
 *   `{ "parent": { "run": "<runId>", "sub": <subTaskId> }, "spec": "<text>" }`
 *
 * The `spec` field carries the executor-facing instructions (what existing
 * workers like `summarizer/agent.ts` pass to OpenAI). The `parent` field is
 * what the off-chain indexer reads to rebuild the plan graph.
 */

export interface ParentId {
  /** Plan run identifier (one per `/composite/execute` invocation). */
  readonly run: string;
  /** Sub-task ordinal within the plan (matches `SubTask.id`, 1-indexed). */
  readonly sub: number;
}

const DATA_URI_PREFIX = 'data:application/json,';

interface EncodedPayload {
  parent: ParentId;
  spec: string;
}

/**
 * Encode a parent_id and sub-task spec into a single `data:application/json`
 * specUri ready to be passed to `TaskEscrow.createTask`.
 *
 * @param parent  Parent run + sub-task identifier pair.
 * @param spec    Executor-facing instructions for this sub-task.
 */
export function encodeParentId(parent: ParentId, spec: string): string {
  if (!Number.isInteger(parent.sub) || parent.sub < 1) {
    throw new Error(`encodeParentId: sub must be a positive integer, got ${parent.sub}`);
  }
  if (parent.run.length === 0) {
    throw new Error('encodeParentId: run must be a non-empty string');
  }
  const payload: EncodedPayload = { parent: { run: parent.run, sub: parent.sub }, spec };
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
  const { run, sub } = p.parent;
  if (typeof run !== 'string' || run.length === 0) return null;
  if (typeof sub !== 'number' || !Number.isInteger(sub) || sub < 1) return null;
  if (typeof p.spec !== 'string') return null;
  return { parent: { run, sub }, spec: p.spec };
}

/**
 * Agent data-handling manifest (M13.4.5 · ADR-0023 §Layer 2.5 · ADR-0024 §4).
 *
 * An agent declares *who runs it, what model it uses, and how it handles task
 * content* in a manifest carried by the AgentRegistryV2 `profileUri`. The
 * manifest is a public, falsifiable promise: per ADR-0024 §4 a foreign host is
 * a third party Sage cannot technically constrain, so Sage (a) requires the
 * declaration, (b) bounds exposure by other means (escrow / evaluator /
 * least-privilege), and (c) treats a violation of the declared terms as a
 * dispute / reputation event. Per ADR-0023 §Layer 2.5 an absent or invalid
 * manifest makes an agent ineligible for guarantee-mode routing.
 *
 * Encoding: an inline `data:application/json,<url-encoded-json>` URI, the same
 * self-contained convention the demo uses for `specUri` — zero hosting infra,
 * and the manifest is small public metadata (not user content), so writing it
 * on-chain is appropriate. A hosted HTTPS/IPFS `profileUri` is a future option;
 * `parseAgentManifest` only decodes the inline form (synchronous, no fetch).
 *
 * Chain-agnostic — no EVM/Solana/NEAR assumptions.
 */

/** Where the agent's model runs. `self-hosted` = operator's own weights. */
export type ProviderType = 'anthropic' | 'openai' | 'self-hosted' | 'other';

/** Who operates the agent. Identity may be pseudonymous (ADR-0023 §Layer 2.5). */
export interface ManifestOperator {
  /** Operator name or handle. Non-empty. */
  readonly name: string;
  /** Optional contact (email / URL / handle). */
  readonly contact?: string;
  /** True when `name` is a pseudonym rather than a legal identity. */
  readonly pseudonymous?: boolean;
}

/** The model/provider the agent uses, with the privacy posture of that tier. */
export interface ManifestModel {
  readonly provider: ProviderType;
  /** Model identifier (e.g. `claude-sonnet-4-6`, `gpt-4o`). Non-empty. */
  readonly model: string;
  /** Provider tier does not retain request/response data beyond serving it. */
  readonly zeroRetention: boolean;
  /** Provider tier does not train on request/response data. */
  readonly noTraining: boolean;
}

/** How the operator handles task content off-chain (ADR-0024 §4). */
export interface ManifestDataHandling {
  /** Days task content is retained after settlement. `0` = none beyond the task. */
  readonly retentionDays: number;
  /** Whether task content may be used for anything beyond performing the task. */
  readonly secondaryUse: boolean;
  /** Declared third parties that see task content (LLM provider, storage, …). */
  readonly subProcessors: readonly string[];
}

/** A complete agent manifest. `version` gates future schema evolution. */
export interface AgentManifest {
  readonly version: 1;
  readonly operator: ManifestOperator;
  readonly model: ManifestModel;
  readonly dataHandling: ManifestDataHandling;
}

const MANIFEST_DATA_URI_PREFIX = 'data:application/json,';
const PROVIDERS: ReadonlySet<string> = new Set<ProviderType>([
  'anthropic',
  'openai',
  'self-hosted',
  'other',
]);

/** Encode a manifest into a `profileUri`-ready inline data URI. */
export function encodeAgentManifest(manifest: AgentManifest): string {
  return `${MANIFEST_DATA_URI_PREFIX}${encodeURIComponent(JSON.stringify(manifest))}`;
}

/**
 * Parse and validate a manifest from a `profileUri`. Returns the normalized
 * manifest, or `null` when the URI is not an inline manifest or any field is
 * missing / malformed. Strict by design: a half-valid manifest is treated as
 * no manifest (ADR-0023 §Layer 2.5 — invalid ⇒ not guarantee-eligible).
 * Unknown extra fields are dropped, not rejected, so the schema can grow.
 */
export function parseAgentManifest(profileUri: string): AgentManifest | null {
  if (typeof profileUri !== 'string' || !profileUri.startsWith(MANIFEST_DATA_URI_PREFIX)) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(decodeURIComponent(profileUri.slice(MANIFEST_DATA_URI_PREFIX.length)));
  } catch {
    return null;
  }
  return validateAgentManifest(raw);
}

/**
 * Validate an already-parsed value against the manifest schema. Exposed
 * separately from `parseAgentManifest` so callers that fetched a hosted profile
 * (future HTTPS/IPFS path) can validate the JSON body directly.
 */
export function validateAgentManifest(raw: unknown): AgentManifest | null {
  if (!isRecord(raw) || raw['version'] !== 1) return null;

  const operator = raw['operator'];
  if (!isRecord(operator) || !isNonEmptyString(operator['name'])) return null;
  if (operator['contact'] !== undefined && typeof operator['contact'] !== 'string') return null;
  if (operator['pseudonymous'] !== undefined && typeof operator['pseudonymous'] !== 'boolean') {
    return null;
  }

  const model = raw['model'];
  if (
    !isRecord(model) ||
    typeof model['provider'] !== 'string' ||
    !PROVIDERS.has(model['provider']) ||
    !isNonEmptyString(model['model']) ||
    typeof model['zeroRetention'] !== 'boolean' ||
    typeof model['noTraining'] !== 'boolean'
  ) {
    return null;
  }

  const dh = raw['dataHandling'];
  if (
    !isRecord(dh) ||
    typeof dh['retentionDays'] !== 'number' ||
    !Number.isFinite(dh['retentionDays']) ||
    dh['retentionDays'] < 0 ||
    typeof dh['secondaryUse'] !== 'boolean' ||
    !Array.isArray(dh['subProcessors']) ||
    !dh['subProcessors'].every((s): s is string => typeof s === 'string')
  ) {
    return null;
  }

  // Re-build from validated fields only — drops any unknown keys.
  return {
    version: 1,
    operator: {
      name: operator['name'],
      ...(operator['contact'] !== undefined ? { contact: operator['contact'] } : {}),
      ...(operator['pseudonymous'] !== undefined
        ? { pseudonymous: operator['pseudonymous'] }
        : {}),
    },
    model: {
      provider: model['provider'] as ProviderType,
      model: model['model'],
      zeroRetention: model['zeroRetention'],
      noTraining: model['noTraining'],
    },
    dataHandling: {
      retentionDays: dh['retentionDays'],
      secondaryUse: dh['secondaryUse'],
      subProcessors: [...dh['subProcessors']],
    },
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

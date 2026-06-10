/**
 * Agent identities hosted by the generic worker (ADR-0020 п.3: identity ≠
 * процесс). An identity is a wallet + ONE capability + a price; the process
 * is just a host that multiplexes N of them.
 *
 * The table below is the single source of truth for which identities exist.
 * Which subset a given process actually hosts is selected at boot via the
 * `WORKER_IDENTITIES` env (comma-separated ids) — this is how the ADR's
 * "orchestrator + 1–2 worker-процесса" split works without code changes:
 * the same image runs with different `WORKER_IDENTITIES` values.
 *
 * Private keys are NEVER stored here. Each identity reads its key from
 * `<ID>_PRIVATE_KEY` (id upper-cased, dashes → underscores), set as a Fly
 * secret. Missing key for a selected identity = fail-fast at boot.
 *
 * Registration in AgentRegistryV2 (endpoint + capability + price) is a
 * separate, manual step — M12.0.4. The worker itself never registers.
 */

export interface IdentityConfig {
  /** Stable slug; also the env-var prefix: 'copywriter' → COPYWRITER_PRIVATE_KEY. */
  readonly id: string;
  /** Canonical capability name as registered in AgentRegistryV2 (M12.0.4). */
  readonly capability: string;
  /** Flat per-task price in USDC base units (6 decimals). Economic floor for accept. */
  readonly priceUnits: bigint;
}

/**
 * All identities the generic worker knows how to host. M12.1+ pipeline
 * capabilities (copywriter / builder / packager, …) land here as they are
 * implemented. `echo` is the каркас placeholder: a real, dispatchable
 * identity used by unit tests and local smoke runs; it is never registered
 * in the registry, so no classifier-routed task ever reaches it.
 */
export const IDENTITY_TABLE: readonly IdentityConfig[] = [
  { id: 'echo', capability: 'echo', priceUnits: 10_000n }, // 0.01 USDC
];

export interface LoadedIdentity extends IdentityConfig {
  readonly privateKey: `0x${string}`;
}

/** 'copywriter' → 'COPYWRITER_PRIVATE_KEY'; 'fact-checker' → 'FACT_CHECKER_PRIVATE_KEY'. */
export function privateKeyEnvName(id: string): string {
  return `${id.toUpperCase().replace(/-/g, '_')}_PRIVATE_KEY`;
}

/**
 * Resolve the identity set this process hosts and bind each to its key.
 *
 * - `WORKER_IDENTITIES` absent/empty → host every identity in the table.
 * - Unknown id in the csv → throw (a typo must not silently drop an identity).
 * - Missing `<ID>_PRIVATE_KEY` for a selected identity → throw (fail-fast at
 *   boot, before any HTTP traffic; a worker that boots is a worker whose
 *   identities can all sign).
 */
export function loadIdentities(
  env: Record<string, string | undefined> = process.env,
  table: readonly IdentityConfig[] = IDENTITY_TABLE,
): LoadedIdentity[] {
  const csv = env['WORKER_IDENTITIES']?.trim();
  let selected: readonly IdentityConfig[];
  if (csv) {
    const ids = csv.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    selected = ids.map((id) => {
      const found = table.find((t) => t.id === id);
      if (!found) {
        throw new Error(
          `WORKER_IDENTITIES names unknown identity "${id}" — known: ${table.map((t) => t.id).join(', ')}`,
        );
      }
      return found;
    });
  } else {
    selected = table;
  }

  if (selected.length === 0) {
    throw new Error('No identities selected — WORKER_IDENTITIES is empty and so is the table.');
  }

  return selected.map((cfg) => {
    const envName = privateKeyEnvName(cfg.id);
    const key = env[envName];
    if (!key) {
      throw new Error(`Identity "${cfg.id}" selected but ${envName} is not set.`);
    }
    return { ...cfg, privateKey: key as `0x${string}` };
  });
}

/**
 * Environment validation. Fails fast on missing/invalid vars at boot.
 *
 * No zod dependency — we keep demo-agents dep-light per AGENTS.md "no
 * dependencies without explicit necessity". Hand-rolled validation is a
 * dozen lines.
 */

export interface OrchestratorEnv {
  privateKey: `0x${string}`;
  rpcUrl: string;
  port: number;
  openaiApiKey: string | undefined;
  summarizerAddress: `0x${string}` | undefined;
  translatorAddress: `0x${string}` | undefined;
  visionAddress: `0x${string}` | undefined;
  sentimentAddress: `0x${string}` | undefined;
  taskAmount: bigint;
  allowedOrigins: string[];
  sponsorMinBalanceUsdc: bigint;
  /**
   * Ceilings for client-supplied composite plans (code review 2026-06-09,
   * finding H1). `/api/demo/composite/execute` escrows client-controlled
   * amounts from the sponsor wallet — without a server-side bound a single
   * crafted plan can drain the wallet to an arbitrary executor address.
   * Defaults sized against the classifier's own output range (≤0.2 USDC per
   * sub-task, ≤0.5 USDC per plan in practice) with headroom.
   */
  maxSubtaskUnits: bigint;
  maxPlanSubtasks: number;
  maxPlanTotalUnits: bigint;
  /**
   * ADR-0007 run-level guards (M12.0.3) — bound what a run actually DOES
   * (evaluator steps + dispute retries included), where the three caps above
   * bound what a submitted plan promises. Enforced inside the plan-runner
   * before every createTask.
   */
  maxRunSpendUnits: bigint;
  maxRunTasks: number;
  maxPlanDepth: number;
  /**
   * Shared secret for the gateway→orchestrator hop. When set, expensive
   * POST endpoints require the `x-sage-gateway` header to match — closing
   * the direct-to-Fly bypass of the gateway's rate limit. Optional so the
   * Fly secret and the Worker secret can be rolled out in either order.
   */
  gatewayKey: string | undefined;
  /**
   * First-party agent addresses (lowercased) — Sage's own identities. Any
   * executor NOT in this set is treated as FOREIGN, which triggers the
   * evaluator-coverage rule (M13.2.2, ADR-0023 §Layer 1.2): foreign work must
   * be gated by an evaluator, and evaluators must be first-party. EMPTY by
   * default → the rule is disabled and every executor is trusted, so the
   * current all-first-party demo is unaffected until the operator opts in.
   */
  firstPartyAgents: ReadonlySet<string>;
  /**
   * Gateway reputation endpoint (M13.1.2). When set, the composite classifier
   * ranks executor candidates by reputation (best-first) instead of cheapest;
   * unset / unreachable → cheapest-first, so this degrades safely.
   */
  reputationUrl: string | undefined;
  /**
   * Quarantine (M13.2.4): an unproven foreign agent (foreign + fewer than
   * `quarantineProvenMin` settled tasks) may only run a sub-task whose value
   * is ≤ this. Default 0.1 USDC. Only enforced when `firstPartyAgents` is set.
   */
  quarantineMaxUnits: bigint;
  /** Settled-task count at which a foreign agent graduates out of quarantine. */
  quarantineProvenMin: number;
  /**
   * Demo-only intake gate (M13.4.1, ADR-0024 §1 / ADR-0025). The current flow
   * writes task content as PLAINTEXT on-chain (`specUri`) and public-by-hash to
   * R2 — acceptable for the public demo, never for real user data. When `true`
   * (the default) the demo is open. A deployment that sets `DEMO_MODE=false`
   * has NO plaintext-intake path until the encrypted, commitment-on-chain model
   * (M13.4.3) ships, so every content-writing intake endpoint is refused with
   * 403. Permissive-by-default mirrors the other opt-in guards above and keeps
   * the live demo unaffected.
   */
  demoMode: boolean;
}

export function loadOrchestratorEnv(): OrchestratorEnv {
  return {
    privateKey: requireHex('PRIVATE_KEY', 64),
    rpcUrl: process.env.RPC_URL ?? 'https://mainnet.base.org',
    port: parseIntEnv('PORT', 3000),
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    summarizerAddress: optHex('SUMMARIZER_ADDRESS', 40),
    translatorAddress: optHex('TRANSLATOR_ADDRESS', 40),
    visionAddress: optHex('VISION_ADDRESS', 40),
    sentimentAddress: optHex('SENTIMENT_ADDRESS', 40),
    // 0.001 USDC default (USDC has 6 decimals → 1000 base units)
    taskAmount: BigInt(process.env.TASK_AMOUNT ?? '1000'),
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000,http://localhost:3001')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // If sponsor balance (USDC 6 decimals) drops below this, reject new demo-starts.
    // 5 USDC = 5_000_000 base units.
    sponsorMinBalanceUsdc: BigInt(process.env.SPONSOR_MIN_BALANCE_USDC ?? '5000000'),
    // 0.5 USDC per sub-task, 8 sub-tasks, 2 USDC per plan.
    maxSubtaskUnits: BigInt(process.env.MAX_SUBTASK_UNITS ?? '500000'),
    maxPlanSubtasks: parseBoundedIntEnv('MAX_PLAN_SUBTASKS', 8, 1, 64),
    maxPlanTotalUnits: BigInt(process.env.MAX_PLAN_TOTAL_UNITS ?? '2000000'),
    // 3 USDC actual-spend ceiling per run: plan cap (2 USDC) + headroom for
    // evaluator steps and dispute-retry re-spawns.
    maxRunSpendUnits: BigInt(process.env.MAX_RUN_SPEND_UNITS ?? '3000000'),
    maxRunTasks: parseBoundedIntEnv('MAX_RUN_TASKS', 12, 1, 64),
    maxPlanDepth: parseBoundedIntEnv('MAX_PLAN_DEPTH', 1, 1, 4),
    gatewayKey: process.env.DEMO_GATEWAY_KEY || undefined,
    firstPartyAgents: parseAddressSet('FIRST_PARTY_AGENTS'),
    reputationUrl: process.env.REPUTATION_URL || undefined,
    // 0.1 USDC ceiling for unproven foreign agents; proven after 5 settled tasks.
    quarantineMaxUnits: BigInt(process.env.QUARANTINE_MAX_UNITS ?? '100000'),
    quarantineProvenMin: parseBoundedIntEnv('QUARANTINE_PROVEN_MIN', 5, 1, 1000),
    // Default true — the demo accepts plaintext intake. Set DEMO_MODE=false on a
    // deployment that must not accept plaintext content (real-user, pre-encryption).
    demoMode: parseBoolEnv('DEMO_MODE', true),
  };
}

/**
 * Fail-loud money-env check for non-6-decimal settlement tokens (ADR-0026).
 *
 * Every bigint knob above defaults to a USDC-sized value (6 decimals). On a
 * chain whose settlement token has different decimals (WMON = 18 on Monad),
 * those defaults are economic nonsense: caps become dust (every run blocked)
 * or floors become dust (guards silently disabled). Rather than guessing a
 * conversion (decimals ≠ FX — 1 WMON is not 1 USDC), the deployment MUST set
 * the amounts explicitly in the settlement token's base units.
 *
 * Call at boot once the chain config is known. No-op for 6-decimal chains,
 * throws with the full missing-var list otherwise — the same fail-loud
 * posture as the CHAIN env rule (GOTCHAS).
 */
export function assertMoneyEnvForSettlement(
  settlement: { readonly symbol: string; readonly decimals: number } | undefined,
): void {
  if (!settlement || settlement.decimals === 6) return;
  const required = [
    'TASK_AMOUNT',
    'SPONSOR_MIN_BALANCE_USDC',
    'MAX_SUBTASK_UNITS',
    'MAX_PLAN_TOTAL_UNITS',
    'MAX_RUN_SPEND_UNITS',
  ];
  // Quarantine ceiling only bites when the foreign-agent framework is armed.
  if (process.env.FIRST_PARTY_AGENTS) required.push('QUARANTINE_MAX_UNITS');
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Settlement token ${settlement.symbol} has ${settlement.decimals} decimals — ` +
        `the 6-decimal USDC defaults would be economic nonsense. Set explicitly (in ` +
        `${settlement.symbol} base units, 1 ${settlement.symbol} = 1e${settlement.decimals}): ` +
        missing.join(', '),
    );
  }
}

/** Parse a boolean env var. Unset → fallback; `false`/`0`/`no`/`off` → false;
 *  anything else → true. */
function parseBoolEnv(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return !/^(false|0|no|off)$/i.test(v.trim());
}

/** Parse a comma-separated list of EVM addresses into a lowercased Set. Empty
 *  when unset — the caller treats an empty set as "feature disabled". */
function parseAddressSet(name: string): ReadonlySet<string> {
  const v = process.env[name];
  if (!v) return new Set();
  const out = new Set<string>();
  for (const raw of v.split(',')) {
    const a = raw.trim().toLowerCase();
    if (!a) continue;
    if (!/^0x[0-9a-f]{40}$/.test(a)) {
      throw new Error(`${name} contains a non-address entry: "${raw.trim()}"`);
    }
    out.add(a);
  }
  return out;
}

function requireHex(name: string, hexChars: number): `0x${string}` {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  if (!/^0x[0-9a-fA-F]+$/.test(v)) throw new Error(`${name} is not a hex string`);
  if (v.length !== hexChars + 2) {
    throw new Error(`${name} must be 0x-prefixed ${hexChars}-char hex (got ${v.length - 2})`);
  }
  return v as `0x${string}`;
}

function optHex(name: string, hexChars: number): `0x${string}` | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  if (!/^0x[0-9a-fA-F]+$/.test(v) || v.length !== hexChars + 2) {
    throw new Error(`${name} is not a ${hexChars}-char hex address`);
  }
  return v as `0x${string}`;
}

function parseBoundedIntEnv(name: string, fallback: number, min: number, max: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}]`);
  }
  return n;
}

function parseIntEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0 || n > 65535) {
    throw new Error(`${name} is not a valid port number`);
  }
  return n;
}

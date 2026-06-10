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
  };
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

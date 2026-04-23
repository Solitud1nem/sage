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
  taskAmount: bigint;
  allowedOrigins: string[];
  sponsorMinBalanceUsdc: bigint;
}

export function loadOrchestratorEnv(): OrchestratorEnv {
  return {
    privateKey: requireHex('PRIVATE_KEY', 64),
    rpcUrl: process.env.RPC_URL ?? 'https://mainnet.base.org',
    port: parseIntEnv('PORT', 3000),
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    summarizerAddress: optHex('SUMMARIZER_ADDRESS', 40),
    translatorAddress: optHex('TRANSLATOR_ADDRESS', 40),
    // 0.001 USDC default (USDC has 6 decimals → 1000 base units)
    taskAmount: BigInt(process.env.TASK_AMOUNT ?? '1000'),
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000,http://localhost:3001')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // If sponsor balance (USDC 6 decimals) drops below this, reject new demo-starts.
    // 5 USDC = 5_000_000 base units.
    sponsorMinBalanceUsdc: BigInt(process.env.SPONSOR_MIN_BALANCE_USDC ?? '5000000'),
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

function parseIntEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0 || n > 65535) {
    throw new Error(`${name} is not a valid port number`);
  }
  return n;
}

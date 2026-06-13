/**
 * Per-identity runtimes for the generic worker.
 *
 * Each hosted identity gets its own sage client bundle (wallet client +
 * nonceManager are per-account), built through the existing
 * `createSageFromConfig` from `src/shared/` — imported read-only, per the
 * "shared/ не менять до M12.4.1" freeze. Only the chain resolution is local,
 * and deliberately STRICTER than `loadConfig`'s: the worker refuses to boot
 * without an explicit CHAIN / CHAIN_ID. The shared loader's RPC-URL sniffing
 * fallback once sent a prod deploy to Sepolia silently (GOTCHAS, `CHAIN=mainnet`
 * entry) — a scale-to-zero worker that wakes up on the wrong chain would
 * fail in the least observable way possible, so implicit resolution is out.
 */

import type { Address, PublicClient } from 'viem';
import { base, baseSepolia, arcTestnet } from '@sage/adapter-evm';

import { createSageFromConfig, type AgentConfig, type ChainKey } from '../shared/config.js';
import type { LoadedIdentity } from './identities.js';

export type SageBundle = ReturnType<typeof createSageFromConfig>;

export interface IdentityRuntime {
  readonly identity: LoadedIdentity;
  readonly address: Address;
  readonly bundle: SageBundle;
}

export interface WorkerRuntime {
  readonly runtimes: readonly IdentityRuntime[];
  /** Lower-cased executor address → runtime, for reconciliation dispatch. */
  readonly byAddress: ReadonlyMap<string, IdentityRuntime>;
  /** Any identity's public client — all share the same RPC/chain config. */
  readonly publicClient: PublicClient;
  readonly escrowAddress: Address;
  readonly chain: ChainKey;
  readonly openaiApiKey: string | undefined;
  readonly anthropicApiKey: string | undefined;
  readonly serperApiKey: string | undefined;
}

/** Explicit-only chain resolution; throws instead of sniffing. */
export function resolveChainStrict(env: Record<string, string | undefined>): ChainKey {
  const chain = env['CHAIN'];
  if (chain === 'mainnet' || chain === 'base') return 'mainnet';
  if (chain === 'sepolia' || chain === 'base-sepolia') return 'sepolia';
  if (chain === 'arc' || chain === 'arc-testnet') return 'arc-testnet';
  const chainId = env['CHAIN_ID'];
  if (chainId === '8453') return 'mainnet';
  if (chainId === '84532') return 'sepolia';
  if (chainId === '5042002') return 'arc-testnet';
  throw new Error(
    'Generic worker requires an explicit CHAIN (mainnet|sepolia|arc) or CHAIN_ID — ' +
      'no RPC-URL sniffing here, see GOTCHAS (a missing CHAIN once sent prod to Sepolia).',
  );
}

/** Default RPC per chain — mirrors loadConfig's CHAIN_MAP fallback. */
const DEFAULT_RPC: Record<ChainKey, string> = {
  mainnet: base.rpc,
  sepolia: baseSepolia.rpc,
  'arc-testnet': arcTestnet.rpc,
};

export function buildWorkerRuntime(
  identities: readonly LoadedIdentity[],
  env: Record<string, string | undefined> = process.env,
): WorkerRuntime {
  const chain = resolveChainStrict(env);
  // Not part of AgentConfig (protected shared/config.ts) — worker-only knobs.
  const anthropicApiKey = env['ANTHROPIC_API_KEY'];
  const serperApiKey = env['SERPER_API_KEY'];
  const baseConfig: Omit<AgentConfig, 'privateKey'> = {
    rpcUrl: env['RPC_URL'] ?? DEFAULT_RPC[chain],
    openaiApiKey: env['OPENAI_API_KEY'],
    port: parseInt(env['PORT'] ?? '3100', 10),
    chain,
  };

  const runtimes: IdentityRuntime[] = identities.map((identity) => {
    const bundle = createSageFromConfig({ ...baseConfig, privateKey: identity.privateKey });
    return { identity, address: bundle.account.address, bundle };
  });

  const first = runtimes[0];
  if (!first) throw new Error('buildWorkerRuntime called with zero identities');

  const byAddress = new Map<string, IdentityRuntime>();
  for (const rt of runtimes) {
    const key = rt.address.toLowerCase();
    if (byAddress.has(key)) {
      throw new Error(
        `Identities "${byAddress.get(key)!.identity.id}" and "${rt.identity.id}" share wallet ${rt.address} — ` +
          'each identity must have its own key (identity = кошелёк + capability + цена).',
      );
    }
    byAddress.set(key, rt);
  }

  return {
    runtimes,
    byAddress,
    publicClient: first.bundle.publicClient,
    escrowAddress: first.bundle.chainConfig.contracts.taskEscrow,
    chain,
    openaiApiKey: baseConfig.openaiApiKey,
    anthropicApiKey,
    serperApiKey,
  };
}

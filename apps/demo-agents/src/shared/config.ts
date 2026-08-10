import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  nonceManager,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base as baseMainnetChain, baseSepolia as baseSepoliaChain } from 'viem/chains';
import { createSageClient, base, baseSepolia, arcTestnet, monadTestnet } from '@sage/adapter-evm';
import type { ChainConfig } from '@sage/adapter-evm';

export type ChainKey = 'mainnet' | 'sepolia' | 'arc-testnet' | 'monad-testnet';

export interface AgentConfig {
  privateKey: `0x${string}`;
  rpcUrl: string;
  openaiApiKey: string | undefined;
  port: number;
  chain: ChainKey;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function resolveChain(env: string | undefined): ChainKey {
  if (env === 'mainnet' || env === 'base') return 'mainnet';
  if (env === 'sepolia' || env === 'base-sepolia') return 'sepolia';
  if (env === 'arc' || env === 'arc-testnet') return 'arc-testnet';
  if (env === 'monad' || env === 'monad-testnet') return 'monad-testnet';
  // CHAIN_ID is authoritative when set. Falls through to RPC sniffing
  // for legacy configs.
  const chainId = process.env['CHAIN_ID'];
  if (chainId === '8453') return 'mainnet';
  if (chainId === '84532') return 'sepolia';
  if (chainId === '5042002') return 'arc-testnet';
  if (chainId === '10143') return 'monad-testnet';
  // Last-resort URL sniff. Note: proxied RPCs (e.g. through a Cloudflare
  // Worker) won't contain 'mainnet'/'sepolia' tokens -- set CHAIN or
  // CHAIN_ID explicitly in those deployments.
  const rpc = process.env['RPC_URL'] ?? '';
  if (rpc.includes('arc.network')) return 'arc-testnet';
  if (rpc.includes('monad')) return 'monad-testnet';
  if (rpc.includes('mainnet') && !rpc.includes('sepolia')) return 'mainnet';
  return 'sepolia';
}

// viem doesn't ship a built-in Arc definition. Native currency is USDC
// (decorative for our paths -- we don't use viem's gas estimation here,
// the RPC returns gas pricing in USDC base-units directly).
const arcTestnetViem: Chain = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.network'] },
  },
  blockExplorers: {
    default: { name: 'Arcscan', url: 'https://testnet.arcscan.app' },
  },
  testnet: true,
});

// viem doesn't ship a Monad testnet definition either. Native currency MON,
// 18 decimals; settlement runs in WMON through the same escrow bytecode
// (ADR-0026 — approve-path, wrap at the edges).
const monadTestnetViem: Chain = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.monad.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Monadscan', url: 'https://testnet.monadscan.com' },
  },
  testnet: true,
});

const CHAIN_MAP: Record<ChainKey, { viem: Chain; sage: ChainConfig }> = {
  mainnet: { viem: baseMainnetChain, sage: base },
  sepolia: { viem: baseSepoliaChain, sage: baseSepolia },
  'arc-testnet': { viem: arcTestnetViem, sage: arcTestnet },
  'monad-testnet': { viem: monadTestnetViem, sage: monadTestnet },
};

export function loadConfig(defaultPort: number): AgentConfig {
  const chain = resolveChain(process.env['CHAIN']);
  return {
    privateKey: requireEnv('PRIVATE_KEY') as `0x${string}`,
    rpcUrl: process.env['RPC_URL'] ?? CHAIN_MAP[chain].sage.rpc,
    openaiApiKey: process.env['OPENAI_API_KEY'],
    port: parseInt(process.env['PORT'] ?? String(defaultPort), 10),
    chain,
  };
}

export function createSageFromConfig(config: AgentConfig) {
  // Attach viem's nonceManager (jsonRpc source) so nonces are tracked
  // locally per (chainId, address) and assignment is serialized in-process.
  // Without it, every sponsor-side write fetches the nonce via the RPC's
  // getTransactionCount(pending). Behind the Cloudflare -> Alchemy proxy
  // that value lags right after a confirmed tx, so the next createTask
  // reuses a nonce still in the mempool -> "replacement transaction
  // underpriced". The composite plan-runner fires several sponsor txs per
  // run and hit this deterministically on sub-task #2. nonceManager also
  // serializes nonce assignment across overlapping runs in the same
  // process. See GOTCHAS 2026-04-29 (nonce race) + plan-runner.ts:274.
  const account = privateKeyToAccount(config.privateKey, { nonceManager });
  const { viem: viemChain, sage: sageChain } = CHAIN_MAP[config.chain];
  // Export sage chain config so callers (workers) can read per-chain
  // contract addresses (taskEscrow, agentRegistry, usdc) without having
  // to re-derive via chain === 'mainnet' ? base : baseSepolia
  // tertiaries -- which silently break the moment we add a third chain
  // (e.g. Arc -> falls through to baseSepolia by default). See GOTCHAS
  // 2026-05-22.

  // Backend-path auth header for the Worker RPC gate. The Worker enforces
  // an allow-list on /api/rpc: browsers pass on the Origin header, the
  // orchestrator (Node -- no Origin) passes via this shared secret. Absent
  // in local dev when RPC_URL points straight at a public node.
  const backendKey = process.env['SAGE_BACKEND_KEY'];
  const transportOpts = backendKey
    ? { fetchOptions: { headers: { 'x-sage-backend': backendKey } } }
    : undefined;

  // Bumped from viem's default 4s. The four worker agents
  // (summarizer/translator/vision/sentiment) each use watchContractEvent
  // on TaskCreated; at 4s x 4 = ~86k requests/day exhausted the
  // Cloudflare Workers Free-tier 100k/day quota on 2026-05-13. At 15s
  // baseline is ~23k/day, plenty of headroom. Average task detection
  // latency goes from 2s to ~7.5s -- acceptable demo UX.
  const POLL_INTERVAL_MS = 15_000;

  const publicClient = createPublicClient({
    chain: viemChain,
    transport: http(config.rpcUrl, transportOpts),
    pollingInterval: POLL_INTERVAL_MS,
  });

  const walletClient = createWalletClient({
    account,
    chain: viemChain,
    transport: http(config.rpcUrl, transportOpts),
    pollingInterval: POLL_INTERVAL_MS,
  });

  const sage = createSageClient({
    chain: sageChain,
    walletClient,
    publicClient,
  });

  return { sage, account, publicClient, walletClient, chainConfig: sageChain };
}

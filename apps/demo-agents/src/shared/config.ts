import { createPublicClient, createWalletClient, http, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base as baseMainnetChain, baseSepolia as baseSepoliaChain } from 'viem/chains';
import { createSageClient, base, baseSepolia } from '@sage/adapter-evm';
import type { ChainConfig } from '@sage/adapter-evm';

export interface AgentConfig {
  privateKey: `0x${string}`;
  rpcUrl: string;
  openaiApiKey: string | undefined;
  port: number;
  chain: 'mainnet' | 'sepolia';
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function resolveChain(env: string | undefined): 'mainnet' | 'sepolia' {
  if (env === 'mainnet' || env === 'base') return 'mainnet';
  if (env === 'sepolia' || env === 'base-sepolia') return 'sepolia';
  // CHAIN_ID is authoritative when set. Falls through to RPC sniffing
  // for legacy configs.
  const chainId = process.env['CHAIN_ID'];
  if (chainId === '8453') return 'mainnet';
  if (chainId === '84532') return 'sepolia';
  // Last-resort URL sniff. Note: proxied RPCs (e.g. through a Cloudflare
  // Worker) won't contain 'mainnet'/'sepolia' tokens — set CHAIN or
  // CHAIN_ID explicitly in those deployments.
  const rpc = process.env['RPC_URL'] ?? '';
  if (rpc.includes('mainnet') && !rpc.includes('sepolia')) return 'mainnet';
  return 'sepolia';
}

const CHAIN_MAP: Record<'mainnet' | 'sepolia', { viem: Chain; sage: ChainConfig }> = {
  mainnet: { viem: baseMainnetChain, sage: base },
  sepolia: { viem: baseSepoliaChain, sage: baseSepolia },
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
  const account = privateKeyToAccount(config.privateKey);
  const { viem: viemChain, sage: sageChain } = CHAIN_MAP[config.chain];

  // Backend-path auth header for the Worker RPC gate. The Worker enforces
  // an allow-list on /api/rpc: browsers pass on the Origin header, the
  // orchestrator (Node — no Origin) passes via this shared secret. Absent
  // in local dev when RPC_URL points straight at a public node.
  const backendKey = process.env['SAGE_BACKEND_KEY'];
  const transportOpts = backendKey
    ? { fetchOptions: { headers: { 'x-sage-backend': backendKey } } }
    : undefined;

  const publicClient = createPublicClient({
    chain: viemChain,
    transport: http(config.rpcUrl, transportOpts),
  });

  const walletClient = createWalletClient({
    account,
    chain: viemChain,
    transport: http(config.rpcUrl, transportOpts),
  });

  const sage = createSageClient({
    chain: sageChain,
    walletClient,
    publicClient,
  });

  return { sage, account, publicClient, walletClient };
}

import { createPublicClient, createWalletClient, http } from 'viem';
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
  // Auto-detect from RPC_URL
  const rpc = process.env['RPC_URL'] ?? '';
  if (rpc.includes('mainnet') && !rpc.includes('sepolia')) return 'mainnet';
  return 'sepolia';
}

const CHAIN_MAP: Record<'mainnet' | 'sepolia', { viem: typeof baseMainnetChain; sage: ChainConfig }> = {
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

  const publicClient = createPublicClient({
    chain: viemChain,
    transport: http(config.rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: viemChain,
    transport: http(config.rpcUrl),
  });

  const sage = createSageClient({
    chain: sageChain,
    walletClient,
    publicClient,
  });

  return { sage, account, publicClient, walletClient };
}

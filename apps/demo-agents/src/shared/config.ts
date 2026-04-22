import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia as baseSepoliaChain } from 'viem/chains';
import { createSageClient, baseSepolia } from '@sage/adapter-evm';

export interface AgentConfig {
  privateKey: `0x${string}`;
  rpcUrl: string;
  openaiApiKey: string | undefined;
  port: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function loadConfig(defaultPort: number): AgentConfig {
  return {
    privateKey: requireEnv('PRIVATE_KEY') as `0x${string}`,
    rpcUrl: process.env['RPC_URL'] ?? baseSepolia.rpc,
    openaiApiKey: process.env['OPENAI_API_KEY'],
    port: parseInt(process.env['PORT'] ?? String(defaultPort), 10),
  };
}

export function createSageFromConfig(config: AgentConfig) {
  const account = privateKeyToAccount(config.privateKey);

  const publicClient = createPublicClient({
    chain: baseSepoliaChain,
    transport: http(config.rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepoliaChain,
    transport: http(config.rpcUrl),
  });

  const sage = createSageClient({
    chain: baseSepolia,
    walletClient,
    publicClient,
  });

  return { sage, account, publicClient, walletClient };
}

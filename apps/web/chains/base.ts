/**
 * Sage chain configuration for Base mainnet + Sepolia.
 *
 * Addresses are deployed via CreateX + CREATE3 (ADR-0001) — identical across every
 * EVM we support. Extend this map when we add Arbitrum / Optimism / BNB in v2.1.
 */

export interface SageChainConfig {
  chainId: 8453 | 84532;
  name: string;
  displayName: string;
  explorer: string;
  rpcUrl: string;
  contracts: {
    agentRegistry: `0x${string}`;
    taskEscrow: `0x${string}`;
    usdc: `0x${string}`;
    eas: `0x${string}`;
    easSchemaRegistry: `0x${string}`;
    createX: `0x${string}`;
  };
  x402FacilitatorDefault: string;
}

export const BASE_MAINNET: SageChainConfig = {
  chainId: 8453,
  name: 'base',
  displayName: 'Base',
  explorer: 'https://basescan.org',
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? 'https://mainnet.base.org',
  contracts: {
    agentRegistry: '0x5e95F92FeEb4D46249DC3525C58596856029c661',
    taskEscrow: '0x12aeF3529b8404709125b727bA3Db40cD5453E1e',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    eas: '0x4200000000000000000000000000000000000021',
    easSchemaRegistry: '0x4200000000000000000000000000000000000020',
    createX: '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed',
  },
  x402FacilitatorDefault: 'https://facilitator.coinbase.com',
};

export const BASE_SEPOLIA: SageChainConfig = {
  chainId: 84532,
  name: 'baseSepolia',
  displayName: 'Base Sepolia',
  explorer: 'https://sepolia.basescan.org',
  rpcUrl: 'https://sepolia.base.org',
  contracts: {
    agentRegistry: '0x5e95f92feeb4d46249dc3525c58596856029c661',
    taskEscrow: '0x12aef3529b8404709125b727ba3db40cd5453e1e',
    // USDC on Base Sepolia (Circle faucet-eligible)
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    eas: '0x4200000000000000000000000000000000000021',
    easSchemaRegistry: '0x4200000000000000000000000000000000000020',
    createX: '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed',
  },
  x402FacilitatorDefault: 'https://facilitator.coinbase.com',
};

/** All chains Sage is deployed to, keyed by chainId. */
export const SAGE_CHAINS = {
  8453: BASE_MAINNET,
  84532: BASE_SEPOLIA,
} as const satisfies Record<8453 | 84532, SageChainConfig>;

/** Default chain for landing + demo. */
export const DEFAULT_CHAIN = BASE_MAINNET;

/** Basescan tx URL helper. */
export function txUrl(chainId: number | 8453 | 84532, hash: string): string {
  const cfg = SAGE_CHAINS[chainId as 8453 | 84532] ?? DEFAULT_CHAIN;
  return `${cfg.explorer}/tx/${hash}`;
}

/** Basescan address URL helper. */
export function addressUrl(chainId: number | 8453 | 84532, address: string): string {
  const cfg = SAGE_CHAINS[chainId as 8453 | 84532] ?? DEFAULT_CHAIN;
  return `${cfg.explorer}/address/${address}`;
}

/**
 * Sage chain configuration for the live chain set.
 *
 * Base mainnet + Base Sepolia use CreateX + CREATE3 for deterministic
 * same-addresses (ADR-0001). Arc testnet is on the live set as of
 * 2026-05-21 via Arachnid CREATE2 (ADR-0015 bridge — different addresses
 * than Base by design; CreateX not deployed on Arc). When v2.1 lands
 * Arbitrum / Optimism / BNB they share the Base same-address pattern.
 *
 * Per-chain optional fields cover the cases where the original ADR-0006
 * shape (eas, easSchemaRegistry, createX, x402FacilitatorDefault) does
 * not apply — Arc has none of these. Existing Base configs carry them
 * as required-by-data even though the type marks them optional.
 */

import { ARC_TESTNET } from './arc';

export interface SageChainConfig {
  chainId: 8453 | 84532 | 5042002;
  name: string;
  displayName: string;
  explorer: string;
  rpcUrl: string;
  contracts: {
    agentRegistry: `0x${string}`;
    taskEscrow: `0x${string}`;
    usdc: `0x${string}`;
    /** EAS attestation contract — present on OP-stack chains, absent on Arc. */
    eas?: `0x${string}`;
    /** EAS schema registry — pairs with `eas`. */
    easSchemaRegistry?: `0x${string}`;
    /** CreateX factory — present on Base + most EVM chains, NOT on Arc per ADR-0015. */
    createX?: `0x${string}`;
  };
  /** Coinbase x402 facilitator — supports Base; not Arc. */
  x402FacilitatorDefault?: string;
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
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7E',
    eas: '0x4200000000000000000000000000000000000021',
    easSchemaRegistry: '0x4200000000000000000000000000000000000020',
    createX: '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed',
  },
  x402FacilitatorDefault: 'https://facilitator.coinbase.com',
};

/** All chains Sage is live on, keyed by chainId. */
export const SAGE_CHAINS = {
  8453: BASE_MAINNET,
  84532: BASE_SEPOLIA,
  5042002: ARC_TESTNET,
} as const satisfies Record<8453 | 84532 | 5042002, SageChainConfig>;

/** Default chain for landing + demo. */
export const DEFAULT_CHAIN = BASE_MAINNET;

/** Block-explorer tx URL helper. */
export function txUrl(chainId: number, hash: string): string {
  const cfg = SAGE_CHAINS[chainId as keyof typeof SAGE_CHAINS] ?? DEFAULT_CHAIN;
  return `${cfg.explorer}/tx/${hash}`;
}

/** Block-explorer address URL helper. */
export function addressUrl(chainId: number, address: string): string {
  const cfg = SAGE_CHAINS[chainId as keyof typeof SAGE_CHAINS] ?? DEFAULT_CHAIN;
  return `${cfg.explorer}/address/${address}`;
}

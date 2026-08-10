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

import { ARC_TESTNET, ARC_TESTNET_CHAIN_ID } from './arc';
import { MONAD_TESTNET, MONAD_TESTNET_CHAIN_ID } from './monad';

/** Base chain ids — single source for the literals (CR.14). */
export const BASE_MAINNET_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;

/** Every chain id Sage web knows about. */
export type SageChainId =
  | typeof BASE_MAINNET_CHAIN_ID
  | typeof BASE_SEPOLIA_CHAIN_ID
  | typeof ARC_TESTNET_CHAIN_ID
  | typeof MONAD_TESTNET_CHAIN_ID;

export interface SageChainConfig {
  chainId: SageChainId;
  name: string;
  displayName: string;
  explorer: string;
  rpcUrl: string;
  contracts: {
    agentRegistry: `0x${string}`;
    /** V2 AgentRegistry (M11.2). Capability + price + rich-profile fields. */
    agentRegistryV2?: `0x${string}`;
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
  /**
   * Settlement-token metadata (ADR-0026). Absent = USDC posture (6 decimals,
   * "USDC" label) — Base / Sepolia / Arc. Monad settles in WMON (18 decimals);
   * amount formatting and labels follow this field via `settlementOf()`.
   */
  settlement?: { symbol: string; decimals: number };
}

/** Settlement metadata for a chain id — USDC/6 unless the config overrides. */
export function settlementOf(chainId: number): { symbol: string; decimals: number } {
  const cfg = SAGE_CHAINS[chainId as keyof typeof SAGE_CHAINS] as SageChainConfig | undefined;
  return cfg?.settlement ?? { symbol: 'USDC', decimals: 6 };
}

export const BASE_MAINNET: SageChainConfig = {
  chainId: BASE_MAINNET_CHAIN_ID,
  name: 'base',
  displayName: 'Base',
  explorer: 'https://basescan.org',
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? 'https://mainnet.base.org',
  contracts: {
    agentRegistry: '0x5e95F92FeEb4D46249DC3525C58596856029c661',
    // V2 AgentRegistry (M11.2): capability + price + rich-profile fields.
    agentRegistryV2: '0x8df78599868Ec740C26F0eb0b660519b166cDd9e',
    // V3 (arbitration-aware, ADR-0017): 0x61c585630B32eee0b8c00306047c301B56419a81.
    // V2 (deprecated, in-flight only): 0x12aeF3529b8404709125b727bA3Db40cD5453E1e.
    taskEscrow: '0x61c585630B32eee0b8c00306047c301B56419a81',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    eas: '0x4200000000000000000000000000000000000021',
    easSchemaRegistry: '0x4200000000000000000000000000000000000020',
    createX: '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed',
  },
  x402FacilitatorDefault: 'https://facilitator.coinbase.com',
};

export const BASE_SEPOLIA: SageChainConfig = {
  chainId: BASE_SEPOLIA_CHAIN_ID,
  name: 'baseSepolia',
  displayName: 'Base Sepolia',
  explorer: 'https://sepolia.basescan.org',
  rpcUrl: 'https://sepolia.base.org',
  contracts: {
    agentRegistry: '0x5e95f92feeb4d46249dc3525c58596856029c661',
    // V2 AgentRegistry (M11.2): capability + price + rich-profile fields.
    agentRegistryV2: '0x8df78599868ec740c26f0eb0b660519b166cdd9e',
    // V3 (arbitration-aware, ADR-0017): 0x61c585630b32eee0b8c00306047c301b56419a81.
    // V2 (deprecated, in-flight only): 0x12aef3529b8404709125b727ba3db40cd5453e1e.
    taskEscrow: '0x61c585630b32eee0b8c00306047c301b56419a81',
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
  [BASE_MAINNET_CHAIN_ID]: BASE_MAINNET,
  [BASE_SEPOLIA_CHAIN_ID]: BASE_SEPOLIA,
  [ARC_TESTNET_CHAIN_ID]: ARC_TESTNET,
  [MONAD_TESTNET_CHAIN_ID]: MONAD_TESTNET,
} as const satisfies Record<SageChainId, SageChainConfig>;

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

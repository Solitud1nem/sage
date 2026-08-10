/**
 * Monad testnet chain config for Sage web UI — LIVE as of 2026-08-10
 * (ADR-0026, M14).
 *
 * Deployed via CreateX + CREATE3 (canonical on Monad — unlike Arc, no
 * bridge deployer): AgentRegistryV2 shares the Base address (same deployer
 * + same salt), TaskEscrowV2 lives at the new `sage:escrow-wmon:v1` salt
 * because its settlement token is WMON, not USDC. WMON is WETH9-style —
 * 18 decimals, NO EIP-2612 permit — so createTask runs the approve-path
 * and every amount rendered for this chain uses 18-decimal formatting
 * (`settlement` field below).
 *
 * Deploy trail: docs/runbooks/deploy-monad-testnet.md +
 * docs/runbooks/monad-testnet-verification-2026-08-10.md.
 */

import { defineChain } from 'viem';

import type { SageChainConfig } from './base';

/** Monad testnet chain id — single source for the literal (CR.14 pattern). */
export const MONAD_TESTNET_CHAIN_ID = 10143;

export const MONAD_TESTNET: SageChainConfig = {
  chainId: MONAD_TESTNET_CHAIN_ID,
  name: 'monad-testnet',
  displayName: 'Monad',
  explorer: 'https://testnet.monadscan.com',
  rpcUrl: 'https://testnet-rpc.monad.xyz',
  contracts: {
    // v1 registry is NOT deployed on Monad (V2-only chain) — fail-loud
    // zero sentinel, mirroring the adapter-evm config.
    agentRegistry: '0x0000000000000000000000000000000000000000',
    // Same address as Base (CREATE3, salt sage:registry:v2). Deploy tx:
    // 0x5b64d8c863b60b9a2ed937d52ad35b7bfddd623e9a929ca1765bc561709bba70
    agentRegistryV2: '0x8df78599868Ec740C26F0eb0b660519b166cDd9e',
    // TaskEscrowV2 with WMON settlement (salt sage:escrow-wmon:v1). Deploy tx:
    // 0x63bdb6927cb44f389ab81138ccab6d860774d228add46eea21362e92db7c717d
    taskEscrow: '0xcc01a4F195f9c991A7BEB2c513cc30267fFfdAac',
    // Canonical wrapped MON (field name historical — settlement token).
    usdc: '0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541',
    createX: '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed',
    // EAS / schema registry omitted — OP-stack predeploys, absent on Monad.
  },
  // x402FacilitatorDefault omitted — Monad runs its own facilitator
  // (USDC-denominated); Sage's WMON escrow path is independent (ADR-0003).
  settlement: { symbol: 'WMON', decimals: 18 },
};

/** viem `Chain` for Monad testnet — viem ships no built-in definition.
 *  Mirrors `apps/demo-agents/src/shared/config.ts`. */
export const monadTestnetChain = defineChain({
  id: MONAD_TESTNET_CHAIN_ID,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: [MONAD_TESTNET.rpcUrl] },
  },
  blockExplorers: {
    default: { name: 'Monadscan', url: MONAD_TESTNET.explorer },
  },
  testnet: true,
});

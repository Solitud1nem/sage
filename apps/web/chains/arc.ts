/**
 * Arc testnet chain config for Sage web UI — LIVE as of 2026-05-21.
 *
 * Per ADR-0015 (bridge state): Sage's own `AgentRegistry` + `TaskEscrow`
 * are deployed on Arc testnet via Arachnid CREATE2, NOT via CreateX (not
 * present on Arc). Same `@sage/adapter-evm` SDK code drives Arc and Base;
 * the only divergence is per-chain contract addresses, USDC address, and
 * the chain metadata.
 *
 * Migration path: when Arc publishes ERC-8183 / ERC-8004 reference
 * contracts at canonical addresses (or mainnet ships with them native),
 * Arc support migrates to `@sage/adapter-arc` per ADR-0014, ADR-0016
 * records the cutover, and this file goes through a corresponding
 * change. Until then, this is the canonical Arc surface.
 *
 * Deploy trail: see `docs/runbooks/deploy-arc-testnet.md` +
 * `docs/runbooks/arc-testnet-verification-2026-05-21.md`.
 */

import type { SageChainConfig } from './base';

export const ARC_TESTNET: SageChainConfig = {
  chainId: 5042002,
  name: 'arc-testnet',
  displayName: 'Arc',
  explorer: 'https://testnet.arcscan.app',
  rpcUrl: 'https://rpc.testnet.arc.network',
  contracts: {
    // Deployed 2026-05-21 via Arachnid CREATE2. Tx:
    // https://testnet.arcscan.app/tx/0x6fa2eff00879df8cb268cfc2c37ca1f59f8c90ccd728196257f7353a6906fffa
    agentRegistry: '0xD100d7CE4f610dDb59C276AF293aA79F9Fcff936',
    // Deployed 2026-05-21. Tx:
    // https://testnet.arcscan.app/tx/0xb6ce44abcdd1cbf7e8862ae8a13755b59ad0c43701ecfec57128cc1112a37f29
    taskEscrow: '0xA9e6Dc31F21149868C0fd43C83038C74cC8Ffcdb',
    // Verified canonical Circle USDC v2 on Arc testnet (decimals=6,
    // version="2", EIP-2612 permit intact). See
    // docs/runbooks/arc-testnet-verification-2026-05-21.md.
    usdc: '0x3600000000000000000000000000000000000000',
    // EAS / EAS schema registry / CreateX intentionally omitted — not
    // deployed on Arc per docs.arc.io contract-addresses reference.
  },
  // x402FacilitatorDefault intentionally omitted — Coinbase x402 doesn't
  // facilitate Arc at time of writing; Sage's task-escrow path on Arc
  // works independently of x402 (ADR-0003).
};

/**
 * UI hover-text describing the bridge state, surfaced from the chain
 * row in `/docs/architecture`. Updated to reflect the live-bridge state
 * after deploy.
 */
export const ARC_TESTNET_NOTE =
  'Live on testnet via Arachnid CREATE2 deploy per ADR-0015 (interim bridge). Native ERC-8183/8004 wrap remains target — see ADR-0014.';

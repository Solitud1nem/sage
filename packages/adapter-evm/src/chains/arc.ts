/**
 * Arc testnet chain config for Sage protocol (bridge state per ADR-0015).
 *
 * Per ADR-0015, this is the *interim* Arc support: we deploy our own
 * `AgentRegistry` + `TaskEscrow` on Arc testnet via the Arachnid CREATE2
 * deployer because Arc does not yet have ERC-8183 / ERC-8004 reference
 * contracts deployed. When Arc publishes those (or mainnet ships with
 * them natively), this config moves to `@sage/adapter-arc` per ADR-0014's
 * native-wrap design and ADR-0016 records the migration.
 *
 * Fields specific to this chain:
 *   - `chainId: 5042002` — Arc testnet, per `docs.arc.io/arc/references/connect-to-arc`.
 *   - `usdc: 0x3600...` — verified canonical USDC v2 (decimals=6, version="2",
 *     EIP-2612 permit interface intact). See
 *     `docs/runbooks/arc-testnet-verification-2026-05-21.md`.
 *   - `agentRegistry` / `taskEscrow` — TBD until first deploy. Will be
 *     filled by the operator after `forge script script/DeployArc.s.sol`
 *     completes (see `docs/runbooks/deploy-arc-testnet.md`).
 *   - `eas` / `easSchemaRegistry` / `createX` — omitted (not deployed on
 *     Arc per `docs.arc.io`). `ChainConfig` makes these optional for that
 *     reason.
 *   - `x402FacilitatorDefault` — omitted (Coinbase's x402 facilitator
 *     doesn't currently support Arc; Sage's task-escrow path on Arc works
 *     independently of x402 — see ADR-0003).
 *
 * The `agentRegistry` and `taskEscrow` addresses are typed as
 * `0x${string}` but use the all-zeros sentinel until the real deploy
 * happens. Any call against these addresses pre-deploy will revert with
 * a non-existent-contract error — that's the intended fail-loud
 * behaviour so we don't accidentally ship a config pointing nowhere.
 */

import type {ChainConfig} from './base.js';

export const arcTestnet: ChainConfig = {
    chainId: 5042002,
    name: 'arc-testnet',
    rpc: 'https://rpc.testnet.arc.network',
    explorer: 'https://testnet.arcscan.app',
    contracts: {
        // TBD — fill after `forge script script/DeployArc.s.sol` succeeds.
        agentRegistry: '0x0000000000000000000000000000000000000000',
        // TBD — fill after deploy.
        taskEscrow: '0x0000000000000000000000000000000000000000',
        // Verified canonical Circle USDC v2 on Arc testnet (decimals=6,
        // version="2", EIP-2612 permit intact).
        usdc: '0x3600000000000000000000000000000000000000',
        // EAS / EAS schema registry / CreateX intentionally omitted —
        // not deployed on Arc per docs.arc.io.
    },
    // x402FacilitatorDefault intentionally omitted — Coinbase x402 does
    // not facilitate Arc at time of writing.
};

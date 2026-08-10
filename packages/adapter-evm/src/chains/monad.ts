/**
 * Monad testnet chain config for Sage protocol (ADR-0026).
 *
 * Deployed 2026-08-10 via CreateX + CREATE3 (CreateX is canonical on Monad,
 * confirmed live — unlike Arc, no bridge deployer needed). Verification
 * record: `docs/runbooks/monad-testnet-verification-2026-08-10.md`.
 *
 * Fields specific to this chain:
 *   - `chainId: 10143` — Monad testnet, per `docs.monad.xyz/developer-essentials/testnets`.
 *   - `usdc: 0xFb8b…C541` — the field name is historical (ADR-0004 era);
 *     on Monad it holds **WMON**, the canonical wrapped native MON that
 *     TaskEscrowV2 settles in (ADR-0026, whitepaper §4.4). 18 decimals,
 *     WETH9-style, **no EIP-2612 permit** (`DOMAIN_SEPARATOR()`/`nonces()`
 *     return empty — verified live) — hence `settlement.permit: false`,
 *     which routes `createTask` through the approve-path.
 *   - `agentRegistry` (v1) — all-zeros sentinel: the legacy v1 registry is
 *     NOT deployed on Monad (V2-only chain). Any v1 call fails loud against
 *     the zero address — same intentional posture as pre-deploy Arc.
 *   - `agentRegistryV2` — same address as Base: same deployer + same
 *     CREATE3 salt (`sage:registry:v2`) per ADR-0001 invariant.
 *   - `taskEscrow` — TaskEscrowV2 bytecode at the NEW `sage:escrow-wmon:v1`
 *     salt (different token ⇒ deliberately different address, ADR-0026).
 *   - `eas` / `easSchemaRegistry` — omitted (OP-stack predeploys, absent here).
 *   - `x402FacilitatorDefault` — omitted: Monad runs its own x402
 *     facilitator (`x402-facilitator.molandak.org`), USDC-денominated;
 *     Sage's WMON escrow path is independent of it (ADR-0003).
 */

import type {ChainConfig} from './base.js';

export const monadTestnet: ChainConfig = {
    chainId: 10143,
    name: 'monad-testnet',
    rpc: 'https://testnet-rpc.monad.xyz',
    explorer: 'https://testnet.monadscan.com',
    contracts: {
        // v1 registry not deployed on Monad — fail-loud sentinel (see header).
        agentRegistry: '0x0000000000000000000000000000000000000000',
        // Same address as Base/Sepolia (CREATE3, salt sage:registry:v2).
        // Deploy tx: 0x5b64d8c863b60b9a2ed937d52ad35b7bfddd623e9a929ca1765bc561709bba70 (block 52461940)
        agentRegistryV2: '0x8df78599868Ec740C26F0eb0b660519b166cDd9e',
        // TaskEscrowV2 with WMON settlement (salt sage:escrow-wmon:v1).
        // Deploy tx: 0x63bdb6927cb44f389ab81138ccab6d860774d228add46eea21362e92db7c717d (block 52461965)
        taskEscrow: '0xcc01a4F195f9c991A7BEB2c513cc30267fFfdAac',
        // Canonical wrapped MON (field name historical — see header).
        usdc: '0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541',
        createX: '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed',
    },
    settlement: {
        symbol: 'WMON',
        decimals: 18,
        permit: false,
    },
};

# `@sage/adapter-arc`

Arc adapter for Sage protocol.

**Status: Experimental scaffold reserved for the native-wrap future.**
Runtime operations throw `NotImplementedError`. This package does **not**
drive today's Arc traffic — that goes through `@sage/adapter-evm` with the
`arcTestnet` chain config (per [ADR-0015](../../docs/adr/0015-arc-deploy-bridge.md)).
This package becomes the active Arc client when Arc publishes ERC-8183 +
ERC-8004 reference contracts; until then it stays as a structural
declaration of intent.

## Where Arc traffic actually flows today

| Layer | What it uses |
|------|------|
| Contracts on Arc testnet | Our `AgentRegistry` + `TaskEscrow` deployed via Arachnid CREATE2 on 2026-05-21. Addresses in `packages/adapter-evm/src/chains/arc.ts`. |
| SDK client | `createSageClient({ chain: arcTestnet, ... })` from `@sage/adapter-evm`. |
| Web | `apps/web/chains/arc.ts` exports `ARC_TESTNET: SageChainConfig`. `SAGE_CHAINS` includes chainId `5042002`. |
| Web architecture page | Arc row in the chain table, status "Live (bridge)", link to ADR-0015. |

This package (`@sage/adapter-arc`) is **not imported anywhere** in the
runtime path right now. That is deliberate. See *Why scaffold-only* for the
substrate constraints and *Migration trigger* for what flips it on.

## What this package is meant to become

A `ChainAdapter` implementation (per `@sage/core`) for Arc, Circle's L1
for stablecoin finance. When ERC-8183 + ERC-8004 reference contracts
ship on Arc, this package will wrap Arc's native Job + Agent Identity
primitives so that the same `@sage/core` SDK surface that drives Base
today also drives Arc — **without** the bridge contracts we deploy via
ADR-0015.

The intent: on chains that have a native task-escrow primitive, Sage
adapts to it. On chains that don't (Base today; Arc today as of
2026-05-21), Sage deploys its own. The `ChainAdapter` interface is the
seam. The bridge under ADR-0015 retires when ADR-0014's substrate
arrives.

## Why scaffold-only

As of 2026-05-21:

- Arc is testnet-only. Mainnet is "expected 2026" with no published date
  (Circle announcement: <https://www.arc.network/>).
- ERC-8183 and ERC-8004 are draft EIPs. The reference contracts on Arc
  testnet do not have addresses we are willing to bake into the SDK yet.
- CreateX deployment on Arc has not been confirmed in the canonical
  `pcaversaccio/createx` deployment matrix; the same-address strategy
  from ADR-0001 cannot be assumed.

Rather than ship a half-working adapter with mock RPC and fake
transaction hashes, this package ships a **production-shape scaffold**
with explicit `NotImplementedError`s and an ADR documenting the
intended design.

## Decision record

- [ADR-0014](../../docs/adr/0014-arc-adapter-native-erc-8183.md) —
  Accepted, partially superseded by ADR-0015. Future-state design:
  `@sage/adapter-arc` wraps native ERC-8183 + ERC-8004 on Arc when those
  exist as deployed reference contracts.
- [ADR-0015](../../docs/adr/0015-arc-deploy-bridge.md) — Accepted.
  Interim bridge: Sage's own `AgentRegistry` + `TaskEscrow` deployed on
  Arc testnet via Arachnid CREATE2 (since ERC-8183/8004 references are
  not yet on Arc). Active Arc support flows through `@sage/adapter-evm`
  with the `arcTestnet` chain config. Migration trigger documented in
  the ADR.

## What's here

| Path | What it does |
|------|-------------|
| `src/index.ts` | Exports `createSageArcClient()` returning a `ChainAdapter` where every method throws `NotImplementedError`. Also exports the error class itself so callers can gate UI on the scaffolded state. |
| `src/chain.ts` | `ARC_TESTNET_CHAIN_INFO` — chainId `'5042002'`, explorer `https://testnet.arcscan.app` (both confirmed via `docs.arc.io` 2026-05-21). The interim bridge (ADR-0015) uses the same values via `@sage/adapter-evm`; when this package becomes active per ADR-0014, no chain-info change is needed. |
| `src/abi/` | Empty; see [`src/abi/README.md`](./src/abi/README.md) for what goes here (ERC-8183 + ERC-8004 ABIs, when reference contracts on Arc testnet are confirmed). |
| `test/index.test.ts` | Conformance tests: structural compliance with `ChainAdapter`, and a check that every operation throws `NotImplementedError` with the expected message shape. |

## Usage today

```ts
import { createSageArcClient, NotImplementedError } from '@sage/adapter-arc';

const arc = createSageArcClient();

// Compiles and runs:
console.log(arc.chain.name);  // 'Arc'

// Throws NotImplementedError with a clear message + pointer to ADR-0014:
try {
  await arc.tasks.createTask({ /* ... */ });
} catch (err) {
  if (err instanceof NotImplementedError) {
    // gate UI: "Arc is coming when testnet stabilises"
  }
}
```

## What it would take to remove the scaffold

The full implementation checklist:

- [x] Confirm Arc testnet chainId and primary public RPC endpoint. Update `src/chain.ts`. *(Done 2026-05-21 — chainId 5042002, RPC `https://rpc.testnet.arc.network`.)*
- [x] Confirm Arc testnet block explorer URL. Update `src/chain.ts`. *(Done — `https://testnet.arcscan.app`.)*
- [ ] **Identify deployed ERC-8183 Job reference contract on Arc testnet.** Add ABI under `src/abi/`. *(Blocked — not present in `docs.arc.io/arc/references/contract-addresses` as of 2026-05-21. Triggers migration when published per ADR-0014.)*
- [ ] **Identify deployed ERC-8004 Agent Identity reference contract on Arc testnet.** Add ABI under `src/abi/`. *(Same blocker.)*
- [ ] Replace `NotImplementedError` returns in `src/index.ts` with real ERC-8183/8004 calls. Mirror the file layout of `@sage/adapter-evm/src` (`agent-registry.ts` → `agent-identity.ts`, `task-escrow.ts` → `job.ts`).
- [ ] Update `createSageArcClient()` signature to accept a viem `walletClient` + `publicClient` bundle (mirroring `createSageClient` from `@sage/adapter-evm`).
- [ ] Replace structural conformance tests with operation roundtrip tests against Arc testnet.
- [ ] When this package becomes active, write ADR-0016 documenting the cutover and update `apps/web/chains/arc.ts` to source from `@sage/adapter-arc` instead of the `@sage/adapter-evm` bridge config.
- [ ] Smoke a single composite plan across Base + Arc through `@sage/adapter-arc` to verify the `ChainAdapter` abstraction holds end-to-end via the native primitives.

## Where Arc fits in the bigger picture

Per [ADR-0008](../../docs/adr/0008-sage-angle-position.md): Sage is
positioned as multi-chain settlement infrastructure for AI agents,
distinguished by observable decomposition. Arc is the first sibling
chain to Base — multi-chain Sage is operational on two chains as of
2026-05-21 (Base mainnet directly, Arc testnet via the ADR-0015
bridge). The bridge state is the honest stake while ERC-8183/8004
substrate matures; this scaffold is the eventual home of native-wrap
Arc support, kept warm so the transition is local and reversible.

See also `docs/research/observable-decomposition.md` §4 ("The Sage
angle") for how chain choice fits into the decomposition pattern: the
parent agent treats sub-tasks identically across chains, and the
adapter is what carries the per-chain settlement primitive
underneath.

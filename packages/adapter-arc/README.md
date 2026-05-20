# `@sage/adapter-arc`

Arc adapter for Sage protocol. **Status: Experimental scaffold** — Arc
testnet integration is structural-only at this stage; runtime operations
throw `NotImplementedError`.

## What this package is

A `ChainAdapter` implementation (per `@sage/core`) for Arc, Circle's L1
for stablecoin finance. When complete, it will wrap Arc's native
ERC-8183 Job and ERC-8004 Agent Identity primitives so that the same
`@sage/core` SDK surface that drives Base today also drives Arc — without
deploying our `TaskEscrow` / `AgentRegistry` contracts to Arc.

The intent: on chains that have a native task-escrow primitive, Sage
adapts to it. On chains that don't (Base today), Sage deploys its own.
The `ChainAdapter` interface is the seam.

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

See [`docs/adr/0014-arc-adapter-native-erc-8183.md`](../../docs/adr/0014-arc-adapter-native-erc-8183.md)
for the Accepted decision: Sage on Arc wraps native ERC-8183 + ERC-8004,
does not deploy `TaskEscrow` / `AgentRegistry` on Arc.

## What's here

| Path | What it does |
|------|-------------|
| `src/index.ts` | Exports `createSageArcClient()` returning a `ChainAdapter` where every method throws `NotImplementedError`. Also exports the error class itself so callers can gate UI on the scaffolded state. |
| `src/chain.ts` | `ARC_TESTNET_CHAIN_INFO` with placeholder `chainId: '0'` and `explorerUrl: 'https://explorer.arc.network'` — replace when Arc publishes stable testnet endpoints. |
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

- [ ] Confirm Arc testnet chainId and primary public RPC endpoint. Update `src/chain.ts`.
- [ ] Confirm Arc testnet block explorer URL. Update `src/chain.ts`.
- [ ] Identify deployed ERC-8183 Job reference contract on Arc testnet. Add ABI under `src/abi/`.
- [ ] Identify deployed ERC-8004 Agent Identity reference contract on Arc testnet. Add ABI under `src/abi/`.
- [ ] Replace `NotImplementedError` returns in `src/index.ts` with real ERC-8183/8004 calls. Mirror the file layout of `@sage/adapter-evm/src` (`agent-registry.ts` → `agent-identity.ts`, `task-escrow.ts` → `job.ts`).
- [ ] Update `createSageArcClient()` signature to accept a viem `walletClient` + `publicClient` bundle (mirroring `createSageClient` from `@sage/adapter-evm`).
- [ ] Replace structural conformance tests with operation roundtrip tests against Arc testnet.
- [ ] Update web `apps/web/chains/arc.ts` from `status: 'planned'` to `status: 'live'` (when end-to-end roundtrip works against Arc testnet).
- [ ] Smoke a single composite plan across Base + Arc to verify the `ChainAdapter` abstraction holds end-to-end.

## Where Arc fits in the bigger picture

Per [ADR-0008](../../docs/adr/0008-sage-angle-position.md): Sage is
positioned as multi-chain settlement infrastructure for AI agents,
distinguished by observable decomposition. The Arc adapter is the first
sibling chain to Base — the chain that turns "multi-chain" from a claim
into running code (or, today, into running scaffolding with a path to
running code).

See also `docs/research/observable-decomposition.md` §4 ("The Sage
angle") for how chain choice fits into the decomposition pattern: the
parent agent treats sub-tasks identically across chains, and the
adapter is what carries the per-chain settlement primitive
underneath.

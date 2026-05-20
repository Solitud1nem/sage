# adapter-arc ABIs (placeholder)

This directory is intentionally empty. When the Arc adapter moves from
scaffold to real implementation, the ABIs that ship here will be:

- **ERC-8183 Job** — composable on-chain Jobs. Status at time of writing
  (2026-05-21): draft EIP. Authoritative source when stable:
  <https://eips.ethereum.org/EIPS/eip-8183> (replace with the canonical
  link once the EIP is finalised; the number may shift if the draft is
  renumbered during review).
- **ERC-8004 Agent Identity** — agent registration and discovery primitive
  native to Arc. Status: draft EIP. Authoritative source:
  <https://eips.ethereum.org/EIPS/eip-8004>.

## What to put here

When ready, add one TypeScript file per ABI, exported as a `const` assertion
in the style used by `@sage/adapter-evm`:

```ts
// erc-8183-job.ts
export const erc8183JobAbi = [
  // … parsed ABI entries …
] as const;
```

Then re-export from `adapter-arc/src/index.ts` for advanced consumers, the
same way `taskEscrowAbi` and `agentRegistryAbi` are exported from the EVM
adapter.

## What NOT to put here yet

- Do not copy the ABIs from a draft EIP. Drafts move; locking them into our
  SDK risks shipping a stale ABI that does not match what Arc actually
  deploys.
- Do not synthesize ABIs from prose specifications. Wait for reference
  contracts on Arc testnet, take the ABI from their deployed bytecode (or
  from the contract source that Arc Foundation publishes).
- Do not stub fake ABIs to make tests compile. The conformance tests in
  `test/index.test.ts` are designed to work against `NotImplementedError`
  — no fake ABI required.

## Why this gate matters

ADR-0014's correctness depends on Sage adapting to Arc's native
primitives rather than projecting our `TaskEscrow` shape onto them. The
ABIs we ship here are the contract between that intent and the
implementation. Shipping the wrong ABI early would commit us to a shape
we don't control — exactly what the ADR is trying to avoid.

See: ADR-0014 (`docs/adr/0014-arc-adapter-native-erc-8183.md`).

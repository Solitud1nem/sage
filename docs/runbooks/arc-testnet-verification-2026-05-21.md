# Arc testnet — pre-deploy verification (2026-05-21)

One-time verification done before Path B (per [ADR-0015](../adr/0015-arc-deploy-bridge.md))
that the assumptions our `TaskEscrow` / `AgentRegistry` deployments depend on
actually hold on Arc testnet. Pass = green-light to deploy. Fail = revisit ADR.

**Verdict:** PASS. All critical checks green.

## Method

All checks run via `cast` (Foundry 1.5.1) against `https://rpc.testnet.arc.network` on 2026-05-21.
Re-runnable verbatim from the repo root with `cast` installed:

```bash
ARC_RPC="https://rpc.testnet.arc.network"
USDC="0x3600000000000000000000000000000000000000"
ARACHNID="0x4e59b44847b379578588920cA78FbF26c0B4956C"

cast chain-id --rpc-url "$ARC_RPC"
cast call --rpc-url "$ARC_RPC" "$USDC" "decimals()(uint8)"
cast call --rpc-url "$ARC_RPC" "$USDC" "name()(string)"
cast call --rpc-url "$ARC_RPC" "$USDC" "symbol()(string)"
cast call --rpc-url "$ARC_RPC" "$USDC" "version()(string)"
cast call --rpc-url "$ARC_RPC" "$USDC" "DOMAIN_SEPARATOR()(bytes32)"
cast call --rpc-url "$ARC_RPC" "$USDC" "PERMIT_TYPEHASH()(bytes32)"
cast call --rpc-url "$ARC_RPC" "$USDC" "nonces(address)(uint256)" "0x0000000000000000000000000000000000000000"
cast call --rpc-url "$ARC_RPC" "$USDC" "balanceOf(address)(uint256)" "0x0000000000000000000000000000000000000000"
cast call --rpc-url "$ARC_RPC" "$USDC" "allowance(address,address)(uint256)" "0x0000000000000000000000000000000000000000" "0x0000000000000000000000000000000000000000"
cast code --rpc-url "$ARC_RPC" "$ARACHNID"
```

## Results

| Check | Expected by `TaskEscrow` | Actual on Arc | Status |
|-------|--------------------------|---------------|--------|
| chainId | published `5042002` per `docs.arc.io` | `5042002` | ✅ |
| `USDC.decimals()` | `6` (matches `TaskEscrow` USDC handling) | `6` | ✅ |
| `USDC.name()` | `"USDC"` (used in EIP-2612 domain) | `"USDC"` | ✅ |
| `USDC.symbol()` | `"USDC"` | `"USDC"` | ✅ |
| `USDC.version()` | `"2"` (Circle's canonical USDC v2 — same as Base) | `"2"` | ✅ — identical to Base USDC v2 |
| `USDC.DOMAIN_SEPARATOR()` | valid `bytes32`, non-zero | `0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0` | ✅ |
| `USDC.PERMIT_TYPEHASH()` | EIP-2612 canonical: `keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)")` = `0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9` | `0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9` | ✅ exact match |
| `USDC.nonces(addr)` | returns `uint256` | `0` for zero-addr | ✅ |
| `USDC.balanceOf(addr)` | returns `uint256` | `865034288137121` for zero-addr (testnet dust) | ✅ |
| `USDC.allowance(o, s)` | returns `uint256` | `0` for (zero, zero) | ✅ |
| Arachnid CREATE2 deployer code | minimal deployer at `0x4e59b44847b379578588920cA78FbF26c0B4956C`, ~69 bytes | code prefix `0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f580…`, 141 hex chars (~69 bytes) | ✅ canonical |
| Block timestamps strictly monotonic | NOT REQUIRED by `TaskEscrow` — `deadline_offset_s` defaults to 600s | confirmed multiple blocks share timestamp (43312308+43312309 both `1779349726`); deltas ~0-2s | ⚠️ noted, not blocking |

## Interpretation

- `TaskEscrow.createTaskWithPermit(...)` will work on Arc identically to Base. The same `signTypedData` flow that the web `useWalletDemo` hook produces on Base produces a valid EIP-2612 permit on Arc — `version: "2"`, `name: "USDC"`, and `PERMIT_TYPEHASH` are all identical.
- `TaskEscrow.createTask(...)` (the sponsor-side path used by `demo-agents/orchestrator`) needs `IERC20.transferFrom`. USDC at `0x3600…` exposes the standard ERC-20 interface — we did not roundtrip an actual transfer here (no funded wallet yet), but `balanceOf` and `allowance` resolve correctly and the contract is the canonical Circle USDC v2 (per `version()`), which is the same code that runs on Base. We are accepting the small residual risk that Arc's deployment has a config divergence that surfaces only on state-changing calls; this gets verified end-to-end on the first roundtrip during deploy.
- Block timestamp non-monotonicity is documented in `https://docs.arc.io/arc/references/evm-compatibility`. Our `deadline_offset_s` defaults are 600s (10 min) and `GRACE_PERIOD` is 300s (5 min); both are orders of magnitude larger than any plausible inter-block timestamp skip on Arc, so no `TaskEscrow` state machine transitions are at risk.

## Out of scope for this verification

- **EIP-712 domain validation roundtrip** — sign a typed-data permit on Arc and submit it via `permit()`. Not done because we have no funded wallet yet; the static interface checks above are a strong proxy for `version: "2"` USDC behaviour. Will be covered by the first `TaskEscrow.createTaskWithPermit` smoke after deploy.
- **`transferFrom` semantics** — same reason. Will be covered on first task lifecycle.
- **Faucet flow** — Alex coordinates faucet runs against existing EOAs. Verification here covers contract-level assumptions only.

## Next steps (Path B per ADR-0015)

1. Add `arcTestnet` chain config to `@sage/adapter-evm/src/chains/arc.ts`.
2. Update Foundry deploy script for Arachnid CREATE2 (vs CreateX) on chains where CreateX is absent.
3. Acquire funded sponsor + worker wallet balances (faucet — Alex).
4. Deploy `AgentRegistry` + `TaskEscrow` to Arc testnet.
5. Verify deployment via `arcscan.app` and roundtrip a `createTask → acceptTask → completeTask → approvePayment` smoke.
6. Wire `apps/web/chains/arc.ts` as a live `SageChainConfig`.
7. End-to-end demo via `/demo/composite` on Arc.

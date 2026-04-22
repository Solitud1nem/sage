# Slither Review — Sage v2.0 Contracts

**Date:** 2026-04-22
**Slither version:** 0.11.5
**Contracts analyzed:** AgentRegistry.sol, TaskEscrow.sol (+ interfaces)
**Result:** 0 high, 0 medium, 10 informational/low findings

## Summary

| Severity | Count | Action |
|----------|-------|--------|
| High | 0 | — |
| Medium | 0 | — |
| Low | 7 | Acknowledged (timestamp usage by design) |
| Informational | 3 | Acknowledged (naming, benign reentrancy) |

## Findings

### 1. reentrancy-benign — TaskEscrow.createTask

**Detector:** `reentrancy-benign`
**Description:** External call to `USDC.permit()` before state write (`_tasks[taskId]`).
**Risk:** None. `permit()` only sets an ERC-20 allowance — it cannot reenter `createTask` meaningfully. The function also has `nonReentrant` modifier.
**Action:** Acknowledged, no change needed.

### 2. timestamp — deadline and grace period comparisons

**Detector:** `timestamp` (×7 findings)
**Description:** Uses `block.timestamp` for deadline and grace period comparisons.
**Risk:** Miners can manipulate timestamp by ~15 seconds. For our use case (deadlines in hours, grace period 300s), this is negligible.
**Action:** Acknowledged. This is by design — see GOTCHAS.md (block.number unreliable on L2). Using `block.timestamp` is the correct approach for Arbitrum/Base/OP L2s.

### 3. naming-convention — USDC immutable and GRACE_PERIOD function

**Detector:** `naming-convention` (×2 findings)
**Description:** `USDC` immutable uses SCREAMING_SNAKE_CASE (correct for immutables per Forge lint), `GRACE_PERIOD()` function name also SCREAMING_SNAKE_CASE (mimics a constant).
**Action:** Acknowledged. Both follow Foundry conventions. The Solidity style guide recommends mixedCase for functions, but `GRACE_PERIOD()` is semantically a constant accessor.

## Command

```bash
cd packages/contracts
slither src/ --solc-remaps "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/ forge-std/=lib/forge-std/src/" --filter-paths "lib/"
```

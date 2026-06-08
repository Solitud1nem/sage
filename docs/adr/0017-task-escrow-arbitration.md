# ADR-0017 — Task escrow arbitration: `resolveDispute`, configurable arbiter, reachable `Refunded`, split outcomes

- **Status:** Accepted
- **Date:** 2026-06-04
- **Deciders:** Alex, Claude
- **Supersedes:** —
- **Related:** ADR-0004 (USDC + EIP-2612 permit settlement); ADR-0008 amendment 2026-06-04 (platform + arbitration layer); `docs/research/arbitration-and-platform-2026-06-04.md` §8 (source of the contract decisions); `docs/research/arbitration-and-platform-brainstorm.md` (open questions log).

## Context

Current `TaskEscrow` (deployed on Base mainnet + Sepolia at `0x12aeF3529b8404709125b727bA3Db40cD5453E1e`) implements only the positive vector of settlement:

- **Happy path works:** `Created → Accepted → Completed → Paid`, via either `approvePayment` (client confirms) or `claimAutoRelease` (executor pulls after 300s grace period when client is silent).
- **Timeout works:** `refundExpired` returns USDC to client when `Created`/`Accepted` tasks pass deadline. Sets status to `Expired`.
- **Dispute is a dead end.** `disputeTask` writes `Completed → Disputed` and emits the reason, but **no function reads from `Disputed`**. No `resolveDispute`, no arbiter, no split, no refund path. Tasks in dispute = USDC frozen permanently.
- **`Refunded` (status 5) is unreachable.** Enum value exists, `TaskRefunded` event exists, but no function sets it. `refundExpired` writes `Expired` instead.

As long as all executor agents are our own (4 demo workers controlled by Sage), the dead end is harmless — disputes don't happen between cooperating processes. Opening the registry to foreign agents (ADR-0008 amendment 2026-06-04, M11.3) makes "permanently-frozen funds on dispute" a real defect of the protocol.

This ADR encodes the contract-level decisions from the 2026-06-04 concept session (`docs/research/arbitration-and-platform-2026-06-04.md` §8). It is scoped to **what the contract does** — the off-chain council mechanism that produces the verdict lives outside the contract and is not constrained by this ADR.

## Decision

A new `TaskEscrowV2` contract (the v3.0 protocol contract; v2.0 stays on Base mainnet to finish in-flight tasks) extends the dispute lifecycle:

1. **`resolveDispute(taskId, outcome, executorShare?)`** — single new transaction that exits `Disputed`.
   - Authorized only for the configured `arbiter` address (`onlyArbiter`).
   - `outcome` is one of: `Paid` (full to executor), `Refunded` (full to client), `Split` (partial — `executorShare` USDC to executor, remainder to client; must be `0 < executorShare < amount`).
   - Emits `TaskResolved(taskId, outcome, executorShare, arbiter)`.

2. **`arbiter` lives in storage**, not as immutable.
   - Set initially in the constructor.
   - Reassigned via `setArbiter(newArbiter)`, gated by `Ownable.onlyOwner`.
   - **Not** behind a proxy / UUPS — the contract itself stays immutable, only the address it dispatches to is configurable.

3. **`Ownable` introduces the first privileged role** in a previously admin-less contract. The owner is the only one who can call `setArbiter`. On launch, owner = deployer EOA; intended migration is `transferOwnership` to a Safe / multisig (a transaction, not a redeploy).

4. **`Refunded` becomes a reachable status** — only via `resolveDispute(taskId, outcome=Refunded)`. `refundExpired` continues to write `Expired` (different cause, different terminal — kept distinct for analytics + indexer clarity).

5. **Split is a first-class outcome.** Most disputes between human-AI counterparties are partial in real life; "all or nothing" forces every verdict into a clean side and breeds appeals. The contract stores `executorShare` in the `Task` struct after `Split` resolution so off-chain readers can reconstruct the verdict.

6. **All other escrow paths remain unchanged.** `createTask` via permit (ADR-0004), `acceptTask`, `completeTask`, `approvePayment`, `claimAutoRelease`, `refundExpired`, `disputeTask` — same signatures, same semantics. The arbiter only ever acts on `Disputed`.

7. **v3.0 deploys to its own address** via a new salt (`keccak256("sage:escrow:v2")`, per ADR-0001). v2.0 contracts at `0x12aeF3…` continue serving until their last in-flight task settles; new tasks route to v3.0. SDK exposes both; `@sage/adapter-evm` defaults to v3.0 for new clients.

## Rationale

- **The dispute dead-end is the single biggest user-visible defect for foreign-agent assembly.** The platform extension in the ADR-0008 amendment is meaningless without a path out of `Disputed`. This ADR is the precondition for M11.3 and everything downstream.
- **Storage-address arbiter is the right balance of immutability and operational flexibility.** "Hardcode now, change later" on an immutable contract is contradictory — a literal constant means redeploy + migration to rotate. A storage variable lets the rotation be a transaction. It also lets the council mechanism evolve off-chain without touching the contract.
- **`Ownable` honest about the new trust profile.** ADR-0008 amendment names the trust shift (eBay/PayPal/Upwork model). The contract should reflect that explicitly: a single privileged role, named, with a clear mechanism for handing it to a multisig later. Hiding it behind clever access patterns would be both more complex and less honest.
- **Split avoids two well-known failure modes:** (1) binary verdicts that don't match real partial-failure cases; (2) appeal loops where the losing party always appeals because the cost of asking is less than the cost of accepting zero. Split lets the verdict match the dispute shape.
- **Versioned salt + parallel deploy keeps v2.0 promises intact.** Tasks already created in v2.0 settle on v2.0 — we don't migrate state or invalidate addresses. ADR-0001 anticipated this with `:v<N>` salts.
- **Scope discipline.** This ADR does not specify how the off-chain council produces the verdict. It does not specify the appeal mechanism. It does not specify the precedent-memory format. Those live in the brainstorm log as open questions. The contract is the substrate; the social mechanism on top can change without forking the contract.

## Alternatives considered

### Option A — Immutable arbiter address (constructor only, no setter)

- Pros: matches the existing "all immutable" default; smallest attack surface; no admin key to manage.
- Cons: arbiter compromise or rotation = redeploy + migration; locks us into whatever address we picked at deploy without learning from operation.
- Rejected because: the council mechanism on top of the arbiter is the part most likely to evolve in early operation. Hardcoding the address makes the council *rigid*, which is exactly wrong for the part we expect to iterate on.

### Option B — Multisig as the arbiter directly (no `setArbiter`)

- Pros: distributes the arbiter key from day one; reduces single-key risk.
- Cons: the council mechanism is off-chain anyway (raздел 7 of concept-snapshot); putting a multisig at the arbiter address adds latency (n-of-m signing per dispute) without changing the trust model — the council still decides, the multisig just rubber-stamps. Operational drag for no security gain.
- Rejected because: the trust boundary is the council, not the EOA. Multisig at the wrong layer.

### Option C — DAO / token-voting arbiter

- Pros: decentralization narrative; aligns with "trustless" framing some users expect.
- Cons: explicitly out of scope per the concept-snapshot section 5 — "судьи наши, Sybil исчезает". Adding tokens + voting reintroduces every problem we deliberately avoided. Also contradicts ADR-0008 amendment ("Sage = транспарентный рефери, не децентрализованный суд").
- Rejected because: it solves a problem we don't have at the cost of problems we do.

### Option D — Extend existing v2.0 contract via proxy / UUPS upgrade

- Pros: same address; no migration; lower SDK churn.
- Cons: contradicts the project default "everything immutable" (CLAUDE.md JIT section); introduces a proxy layer just to add one transaction; locks every future change to going through the same proxy.
- Rejected because: adding a new contract on a new salt is cheaper architecturally than introducing proxy mechanics. v2.0 stays clean as a historical artifact.

### Option E — Off-chain settlement of disputes (Sage signs off-chain message, executor presents it for payout)

- Pros: no contract change; flexible on the council side.
- Cons: the entire point of escrow is on-chain enforceability of the verdict. Moving the verdict off-chain reintroduces "trust Sage to actually pay" — defeats the escrow.
- Rejected because: the verdict belongs on-chain; only the *production* of the verdict is off-chain.

## Consequences

**Положительные:**

- Foreign-agent assembly becomes possible without "your funds may be frozen forever" disclaimer. M11.3 (first foreign agent in composite) can ship without contract caveats.
- `Refunded` becomes a meaningful terminal; analytics + reputation indexer can distinguish "deadline-expired refund" from "dispute-resolved refund" — different signal about the executor.
- Split outcomes match real disputes, reducing appeal pressure (one of the open mechanism questions in concept-snapshot §6).
- The contract names its trust profile explicitly (`Ownable`, `arbiter`), letting external readers locate Sage in the eBay/Upwork category without misleading "trustless" framing.

**Отрицательные / компромиссы:**

- First privileged role in `TaskEscrow`. Owner key compromise → attacker redirects arbiter address → can resolve in-flight disputes to themselves. Mitigation: `transferOwnership` to multisig before / shortly after launch; key stored at a higher security tier than the sponsor / executor keys.
- Two contract versions to support in SDK + UI for the transition window. Cleanup happens after the v2.0 in-flight tasks drain (deadlines reached → all v2 tasks terminal).
- The council mechanism — the actual content of the verdict — remains underspecified in this ADR. That's deliberate but means M11.4 needs its own design discussion; this ADR doesn't unlock the council, only the substrate the council writes to.
- Slither / audit surface grows by `resolveDispute` + `setArbiter` + `Ownable`. New invariants to test: arbiter cannot resolve non-`Disputed` tasks; split outcomes preserve total amount; only owner can rotate arbiter.

**Operational consequences:**

- Deploy of v3.0 follows the existing runbook (`docs/runbooks/deploy-base-mainnet.md`) with new salt + arbiter address parameter. Foundry tests need new coverage for `resolveDispute` paths and `setArbiter` access control.
- `@sage/adapter-evm` learns v3.0 ABI; `@sage/core` types extend `TaskStatus` semantics (Refunded now reachable). The 4 demo workers continue to operate against v2.0 until v3.0 is verified — they don't need code changes when they switch (the executor-side ABI is unchanged).
- Frontend `/demo/composite` gains an "arbiter" badge in the run UI when running against v3.0, surfacing the trust shift explicitly to users.
- Security review (Slither + manual) is a prerequisite for mainnet deploy. Test target: 100% coverage on new functions, invariants on outcome amounts.

**Что потребует дальнейшего решения:**

- **Split-formula authority.** Concept-snapshot §9 open question #4. The arbiter EOA submits `executorShare` directly; how the council *computes* `executorShare` is the open question. Council design (M11.4) addresses this.
- **Arbiter rotation policy.** When and how the owner rotates the arbiter (key health checks, scheduled rotation, response to incident). Runbook lives outside this ADR.
- **AgentRegistry V2 schema.** Needed for foreign-agent discoverability (M11.2). Separate ADR if it warrants — likely yes given it's a schema change.
- **Indexer for reputation surface.** Ось A7 still JIT; with `Refunded` becoming meaningful, the pressure to ship A7 grows. Brainstorm log §Roadmap shows M11.6.

## Implementation notes

- Contract source: `packages/contracts/src/TaskEscrowV2.sol` (new file). Inherits the v2.0 base where possible to keep the diff visible.
- Foundry tests: extend `test/TaskEscrow.t.sol` patterns into `test/TaskEscrowV2.t.sol`, focused on the new transitions. Invariants: total-amount conservation on every resolution; access control on `resolveDispute` and `setArbiter`; status reachability matrix.
- Deploy script: `packages/contracts/scripts/deploy-create3.ts` extended with `:v2` salt + arbiter address parameter.
- SDK: `@sage/adapter-evm/src/task-escrow-v2.ts` mirrors `task-escrow.ts` with `resolveDispute` exposed; `@sage/core` adds `DisputeOutcome` type.
- Frontend: when frontend talks to a v3.0 contract, plan-graph drawer shows the arbiter status; composite/page surfaces "this run has a designated arbiter" once at first dispute event.
- Runbooks: `docs/runbooks/deploy-task-escrow-v2.md` (new); `docs/runbooks/rotate-arbiter.md` (new, owner-side procedure).

## References

- `packages/contracts/src/TaskEscrow.sol` — current v2.0 source, what we extend from.
- `docs/research/arbitration-and-platform-2026-06-04.md` §8 — original session decisions encoded here.
- `docs/research/arbitration-and-platform-brainstorm.md` — open questions log for the surrounding concept work.
- ADR-0008 (Sage angle / position), amendment 2026-06-04 — positions this contract within the platform layer.
- ADR-0001 (Deterministic addresses) — versioned salt convention used for v3.0 deploy.
- ADR-0004 (USDC + permit) — settlement primitive preserved.
- OpenZeppelin `Ownable` — pattern source for the privileged role.

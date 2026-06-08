# ADR-0019 — Off-chain council v1: review gate, LLM-judge, arbiter auto-execution

- **Status:** Accepted
- **Date:** 2026-06-08
- **Deciders:** Alex, Claude
- **Supersedes:** —
- **Related:** ADR-0017 (task escrow arbitration — `disputeTask`/`resolveDispute` substrate), ADR-0008 (Sage angle — transparent-referee trust posture). Implements `TASKS.md` M11.4.

## Context

ADR-0017 shipped the on-chain arbitration substrate in `TaskEscrowV2`: a client can `disputeTask(taskId, reason)` a Completed task, and the arbiter can `resolveDispute(taskId, outcome, executorShare)` to one of `Paid` (full to executor), `Refunded` (full to client), or `Split` (partial). The SDK exposes both via `TaskClientV2`. But nothing exercises this end-to-end:

- The composite plan-runner **auto-approves** every Completed sub-task (`approvePayment` immediately) — there is no window in which a client could dispute.
- Nothing produces a **verdict** — `resolveDispute` would have to be called by hand (`cast`).

This blocks the MVP «dispute + appeal system» pillar: the mechanism exists on-chain but is invisible. M11.4 makes it operational. Per the MVP framing (Alex 2026-06-08), the **council** is the automated *first level* (LLM-judge → arbiter EOA executes); the **human appeal** is the second level and is a separate milestone (M11.5, human verdict stubbed).

Constraint surfaced during scoping (matches the cutover-layer lesson): `createSageClient` still wires the **V1** `TaskClient`. createTask/accept/complete/approve work against the V2 contract because their selectors are identical, but `resolveDispute` is V2-only. The orchestrator therefore needs a V2 client for council/arbiter calls.

## Decision

Three pieces.

**1. Review gate (opt-in, per-run).** A `reviewMode` boolean rides from the plan-card through `POST /composite/execute` into `RunPlanOptions`. When **on**, the plan-runner pauses each sub-task *after* it reaches `Completed` and *before* `approvePayment`, awaiting an `approve | dispute(reason)` decision (reusing the `run-registry` pause primitive). When **off** (default), behavior is exactly today's auto-approve — the happy-path demo stays fast.

**2. Council = single LLM-judge (gpt-4o-mini).** On a dispute, a pure judge receives `{spec, result, reason}` and returns `{outcome: 'worker'|'client'|'split', executorSharePct?: 0..100, reasoning}`. Mapped to chain: `worker→Paid`, `client→Refunded`, `split→Split` with `executorShare = round(amount * pct / 100)`. The reasoning string is surfaced in the UI.

**3. Arbiter auto-execution.** The orchestrator (sponsor = arbiter EOA, collapse posture) drives resolution synchronously after a dispute: `disputeTask(taskId, reason)` → council verdict → `resolveDispute(taskId, outcome, executorShare)`, via a **V2 client** (`createTaskEscrowV2Client`) pointed at the same `taskEscrow` address. Idempotent: it reads task status and only disputes a `Completed` task / only resolves a `Disputed` task.

**Outcome → plan continuation (v1):** `Paid` and `Split` → the sub-task result is accepted, plan continues (Split still produced usable work). `Refunded` → the sub-task is treated as failed → `plan_failed` (no usable result to chain forward). Reusing the existing retry/replan path on `Refunded` is a later refinement.

## Rationale

- **Closes the loop ADR-0017 opened** — dispute → verdict → on-chain resolution becomes visible end-to-end, which is the whole point of the arbitration substrate.
- **Opt-in gate keeps the happy path fast** while making disputes a real, user-driven action (not a simulation).
- **Reuses `run-registry`** — the pause/resume primitive already exists and is proven; the gate is a second decision type, not new infrastructure.
- **Single judge is honest about what it is** — an automated transparent referee (eBay/PayPal posture per ADR-0008), not an impartial third party. The reasoning is shown; escalation to a human is the appeal layer (M11.5). Multi-judge / independent panel is a future hardening, not v1.
- **Synchronous arbiter drive avoids racing the reactive path** — by resolving inline after the gate-dispute, we never fall into the old `Disputed`-status retry-pause meant for externally-initiated disputes.

## Alternatives considered

### Option A — Always-on per-step gate (no toggle)
- Pros: maximally visible.
- Cons: every happy-path run becomes click-intensive (a pause per sub-task).
- Rejected: opt-in toggle gets the same demonstrability without taxing the default flow.

### Option B — Timed dispute window before auto-approve
- Pros: no explicit mode.
- Cons: timing-based, racy, awkward UX; ambiguous if the user is slow.
- Rejected: an explicit gate is clearer and deterministic.

### Option C — Multi-judge panel for v1
- Pros: more robust verdicts.
- Cons: more cost/latency/complexity than the MVP needs; the value is showing the loop works.
- Rejected for v1: single judge with transparent reasoning; panel is a documented future step.

### Option D — Human-confirms-verdict before resolveDispute (no auto-execute)
- Pros: safer (human in loop on real funds).
- Cons: that *is* the appeal layer (M11.5); folding it into v1 conflates the automated first level with the human second level.
- Rejected: council auto-executes (first level); human review = appeal (M11.5).

## Consequences

**Положительные:**
- Dispute + council + on-chain resolution demonstrable end-to-end (MVP pillar 5, first level).
- Happy-path demo unchanged (gate off by default).
- The V2-client gap from the M11.1 cutover gets closed in the orchestrator.

**Отрицательные / компромиссы:**
- The arbiter (sponsor EOA) is also the client funding tasks — not a neutral third party. Honest collapse posture for launch; real separation (Safe + dedicated arbiter) is future work.
- An LLM judging a real-money outcome on demo amounts is acceptable for the demo, but is not a trustless mechanism — stated plainly in UI + materials.
- `Refunded` ends the plan in v1 (no auto-replan) — a usability rough edge, noted.

**Что потребует дальнейшего решения:**
- Appeal layer (M11.5): human (stubbed) second-level review of a verdict.
- Multi-judge panel + independent-perspective verification for verdict robustness.
- Arbiter/owner separation onto a Safe + dedicated arbiter EOA.
- `Refunded`/`Split` continuation UX (auto-replan, partial-result handling).

## Implementation notes

- `run-registry.ts`: generalize the decision union to add `{kind:'approve'}` and `{kind:'dispute', reason}` alongside the existing retry/cancel/timeout.
- `orchestrator`: build a `createTaskEscrowV2Client` (same wallet/public client + `taskEscrow` addr) for `disputeTask`/`resolveDispute`. New endpoint(s) for the review decision (approve/dispute) resolving the gate.
- `plan-runner.ts`: when `reviewMode`, after `Completed` pause for the review decision; on `dispute`, drive `disputeTask → council → resolveDispute` and continue per outcome.
- `parent/council.ts` (new): pure `judge({spec, result, reason}, env) → verdict`; gpt-4o-mini via function-calling, deterministic mock for tests; degraded default favors `client` (conservative — don't pay on judge failure).
- Frontend: `reviewMode` toggle on plan-card; Approve/Dispute in `subtask-drawer`; verdict + reasoning + final outcome surfaced on the graph node / drawer.
- Tasks: M11.4.1 … M11.4.6 in `TASKS.md`.

## References

- ADR-0017 — task escrow arbitration substrate.
- `packages/core/src/interfaces/task-client-v2.ts` — `resolveDispute` signature; `DisputeOutcome = Paid | Refunded | Split`.
- `apps/demo-agents/src/parent/run-registry.ts` — pause/resume primitive being reused.
- Cutover-layer lesson: `createSageClient` wires V1 client; V2 needed for `resolveDispute`.

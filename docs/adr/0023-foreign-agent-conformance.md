# ADR-0023 — Foreign-agent conformance: tiered requirements and checks

- **Status:** Accepted
- **Date:** 2026-06-23
- **Deciders:** Alex, Claude
- **Supersedes:** —
- **Related:** ADR-0022 (responsibility boundaries — defines Zone C, which this ADR operationalizes); ADR-0002 (permissionless registry; any EOA executor); ADR-0008 amendment (settlement-as-guarantee for ownership-boundary-crossing work); ADR-0007 (observable decomposition; run-guards lineage); ADR-0017 / ADR-0019 (dispute → council → `resolveDispute`); ADR-0020 (evaluators: `evaluates`, pass→pay / fail→dispute); ADR-0018 (composite content envelope — `inputs` channel, relevant to least-privilege); ADR-0024 (privacy — data-handling requirements shared here).

## Context

ADR-0022 places foreign-agent behavior in **Zone C**: Sage cannot guarantee it, only bound its damage and surface signals so users can judge. This ADR answers the follow-up Alex raised (2026-06-23): *"we must work out and ship a list of requirements and checks for foreign agents."*

Current state — verified against the code:
- Registration is fully permissionless; the only contract-level checks are non-empty endpoint, non-empty capability name, `price > 0`, no duplicate capability names (`AgentRegistryV2._validateCapabilities`).
- There is **no reputation, staking, bonding, KYC, or allowlist** (ADR-0002; brainstorm log explicitly lists these as out of scope for now).
- Selection is **cheapest-active-first**, no reputation weighting (`registry-resolver.ts`).
- The foreign-agent **template** has only operator-side runtime guards (`MIN_TASK_UNITS`, `MIN_DEADLINE_MARGIN_S`, `MAX_MATERIAL_CHARS`, `HANDLER_RETRIES`, pause-on-shutdown) — these protect the *agent*, not the *user*.
- Orchestrator-side **run-guards** exist and protect the user/sponsor (`MAX_RUN_SPEND_UNITS`, `MAX_RUN_TASKS`, `MAX_PLAN_DEPTH`, dispute-retry ≤ 2 — `plan-runner.ts`).
- **No SSRF / egress guard** exists for agents that fetch URLs (extractor, fact-checker); a malicious foreign `extract-content` could reach localhost / private IP ranges (confirmed gap).

The design tension: requirements must not destroy the permissionless property (a core architectural choice) and must stay in the project's explore-mode spirit — **mechanically verifiable checks, not paperwork**. KYC / manual review do not scale and are off-character.

## Decision

Adopt a **tiered conformance model** whose foundation is *damage-bounding* (checks that hold even against a fully malicious agent) and whose upper tiers are *trust-establishing* (checks that lower the probability of bad actors). The registry stays permissionless; gating moves to **routing time** and **payout time**, not registration time.

**Layer 1 — Protocol invariants (mandatory; partly built, hereby declared as requirements).**
1. **Escrow is mandatory.** No foreign agent is paid before `completeTask` + acceptance/evaluation.
2. **Evaluator-coverage for settlement-as-guarantee.** Any foreign-agent output that crosses an ownership boundary MUST be gated by an evaluator step (`evaluates`, ADR-0020). Default: do not trust foreign output — verify it. `pass:false` → dispute → council → refund (ADR-0019). Pattern already shipped: research → fact-checker, website → qa-website.
3. **Run-guards apply unconditionally** to any plan containing foreign agents (`MAX_RUN_SPEND_UNITS`, `MAX_RUN_TASKS`, `MAX_PLAN_DEPTH`, dispute-retry ≤ 2).

**Layer 2 — Registration-time checks (add).**
4. **Conformance probe.** Before a newly-registered agent is eligible for real-user routing, the classifier/registry runs a canary task against it and verifies response schema, declared capability version, and endpoint liveness. A capability must be *testable*, not merely a declared string.
5. **Manifest in `profileUri`.** Declared operator identity (may be pseudonymous), model/provider, and data-handling declaration (the fields ADR-0024 requires). Absent/invalid manifest → not eligible for guarantee-mode routing.
6. **Optional bond/stake (future lever; out of scope to build now, reserved here).** A slashable bond posted by the operator, forfeitable on a pattern of upheld disputes. This is the mechanism that converts "we can't be sure" into "misbehavior has a cost" without KYC. Recorded as the intended trust primitive; not implemented in this ADR.

**Layer 3 — Routing / selection-time checks (the main current gap; add).**
7. **Default = propose the best-reputation agent; user can always override by editing.** This is the decided policy (Alex), regressed by the M12 pipelines on both counts; restore it:
   - **Default selection = best reputation, not cheapest.** Today `registry-resolver.pickAgentForCapability` sorts by `capability.price` and picks the minimum, with no reputation input. Flip the default to the best-reputation agent for the capability (dispute-rate / refund-rate / completion-rate from on-chain events — the M11.6 reputation surface, currently unbuilt). A good default matters because many users cannot assign executors themselves.
   - **Editing/override restored in every pipeline, including website and research.** Today website/research bypass the editor entirely — the composite page guards `onEdit` behind `mode === 'composite'` (comment: *"fixed templates — editing would break the evaluator wiring"*). Editable decomposition is a platform pillar (ADR-0007): the whole point of surfacing the plan is to let the user inspect and change it before money moves. Restore it **evaluator-aware**: the `evaluates` links and dispute hooks (qa-website, fact-checker) are protected invariants the editor must not break; executor reassignment, spec, cost, deadline, and non-evaluator structure remain editable.
   - **Editor executor options come from the live registry, ranked by reputation.** Today the editor's executor dropdown is stale env-var addresses (`NEXT_PUBLIC_DEMO_*`, the old four agents). Source it from the V2 registry, default-sorted by reputation, with the best-reputation agent pre-selected.
8. **New-agent quarantine.** An unproven foreign agent is routed only to: (a) tasks the user explicitly opted into, OR (b) always-evaluator-gated tasks, OR (c) low-value tasks below a configured ceiling — until it accrues a track record.
9. **Per-agent trust ceilings.** Cap value/frequency entrusted to a single foreign agent per run / per day until reputation accrues.

**Layer 4 — Security & data-handling requirements on agent code (add; shared with ADR-0024).**
10. **SSRF / egress guard required** for any capability that fetches URLs (extractor, fact-checker). Outbound requests MUST reject private / link-local / loopback ranges and metadata endpoints. This is a conformance requirement and a fix for the current gap.
11. **Declared data handling** (retention, secondary-use, sub-processor / LLM provider) per ADR-0024; violations are dispute/reputation events.
12. **Output treated as untrusted by consumers.** Sage-side rendering already escapes LLM output (`report.ts`); foreign agents must not assume their output is rendered raw, and Sage must never render it raw.

Enforcement principle: **Layers 1, 3, 4 are what make Zone C safe; Layer 2 reduces how often it is tested.** A robust deployment depends primarily on the former.

## Rationale

- **Damage-bounding is the only thing that works against the unverifiable.** You cannot inspect a foreign host's runtime; escrow + evaluator + caps + SSRF bound the blast radius regardless of intent.
- **Permissionless registration is preserved.** Gating at routing/payout time, not registration time, keeps ADR-0002's open-entry property while still protecting users.
- **Mechanically verifiable > paperwork.** Conformance probe, on-chain reputation, evaluator verdicts, slashable bond — all enforceable in code/contract. KYC and manual review are deliberately excluded as unscalable and off-ethos.
- **It closes the named leak from ADR-0022.** Reputation-weighted / explicit selection replaces silent cheapest-first, aligning behavior with the stated responsibility boundary.
- **It is the differentiating "мизер."** A settlement layer that is *verifiable-by-construction* about foreign executors (probe + reputation + evaluator gate + bond) is a real engineering angle most neighbours skip.

## Alternatives considered

### Option A — Gate the registry (allowlist / KYC at registration)
- Pros: strongest "everyone here is vetted" story; simplest mental model.
- Cons: destroys the permissionless property (ADR-0002); unscalable manual review; off-ethos; pushes Sage toward Zone-C responsibility it explicitly disclaimed (ADR-0022).
- Rejected because: it trades a core architectural property for an assurance we still couldn't fully back.

### Option B — Do nothing beyond existing run-guards (status quo)
- Pros: no new work; keeps the demo simple.
- Cons: leaves cheapest-first silent selection (the ADR-0022 leak), no SSRF guard, no reputation, no quarantine; foreign-agent output can be paid without verification when no `evaluates` step is present.
- Rejected because: it leaves Zone C unbounded in exactly the ways Alex flagged.

### Option C — Tiered damage-bounding + routing gates (chosen)
- Pros: preserves permissionless entry; bounds damage; surfaces trust signals; mechanically enforceable; closes the selection leak.
- Cons: meaningful build (reputation surface M11.6, conformance probe, SSRF guard, quarantine logic); some are not yet built.
- Rejected because: nothing — this is the decision; build order is staged in Implementation notes.

## Consequences

**Положительные:**
- Zone C becomes safe-enough-to-open: a malicious foreign agent can waste a bounded amount and gets caught by evaluators / loses reputation / forfeits bond.
- Selection becomes honest (reputation-weighted or explicit), matching ADR-0022.
- SSRF gap is closed as a stated requirement.
- The permissionless registry survives; trust accrues with track record, not gatekeeping.

**Отрицательные / компромиссы:**
- Significant unbuilt surface: reputation indexer (M11.6), conformance probe, quarantine, per-agent ceilings, bond/slashing (deferred). This is a roadmap, not a single change.
- Guarantee-mode routing gets slower / less "magic" (probe, quarantine, evaluator step add latency and cost).
- Evaluator-coverage requirement raises per-run cost for foreign-agent pipelines (already true for research/website pipelines).

**Что потребует дальнейшего решения:**
- Whether/when to build the bond/slashing primitive (Layer 2.6) — needs its own ADR if adopted (touches contracts).
- The exact reputation formula and its on-chain event aggregation (M11.6).
- Quarantine thresholds (value ceilings, track-record definition) — JIT defaults, tune in implementation.
- Conformance-probe schema per capability — likely a shared `@sage/core` contract.

## Implementation notes

Staged build order (each independently shippable):
1. **Restore evaluator-aware subtask editing** (Layer 3.7) in website + research — `apps/web/components/demo/plan-editor.tsx` + composite-page mode dispatch. Protect `evaluates` / dispute wiring; allow executor/spec/cost/deadline edits. Independently shippable *without* the reputation surface, and the highest user-visible priority (the ADR-0007 decomposition pillar). Source the editor's executor list from the live V2 registry, not env vars. — **DONE 2026-06-24 (M13.1.1)**.
2. **SSRF/egress guard** (Layer 4.10) — highest safety/effort ratio; add to the shared fetch path used by extractor/fact-checker (`apps/demo-agents/src/worker/...`) and require it of foreign agents in the template + docs. — **DONE 2026-06-24 (M13.2.1)**: shared `worker/net.ts` (`fetchPublicPage`) — https-only, hostname blocklist, **resolved-IP check** (DNS-resolve, reject any private/loopback/link-local/metadata address), **manual redirects re-validated per hop** (closes the trusted-URL→`302`→`169.254.169.254` bypass that native `fetch` follows silently), timeout + size + content-type. extractor + fact-checker reuse it; foreign-agent template README states it as a conformance requirement. Residual TOCTOU (connection-level IP pinning via an undici dispatcher) documented as a follow-up.
3. **Evaluator-coverage as a routing rule** (Layer 1.2) — enforce that guarantee-mode plans with foreign executors include an `evaluates` step (`plan-runner.ts` / classifier). — **DONE 2026-06-24 (M13.2.2)**: `orchestrator/plan-guards.ts` `checkEvaluatorCoverage`, enforced at `/execute`. Invariant A — every foreign-executor worker must be the target of an `evaluates` step; invariant B — an evaluator must itself be first-party (no outsourcing the judge). "Foreign" = executor not in the `FIRST_PARTY_AGENTS` allowlist (env, lowercased). **Opt-in**: empty allowlist → rule disabled, so the all-first-party demo is unaffected until the operator sets the env. Known edge (documented): a dispute-retry `newExecutor` swap is not re-checked.
4. **Conformance probe** (Layer 2.4) — canary-task harness in the registry-resolver path.
5. **Reputation surface** (Layer 3.7) — M11.6 indexer; then flip `registry-resolver.ts` from cheapest-first to best-reputation default, and rank the editor's executor options by reputation. — **DONE 2026-06-24 (M13.3 + M13.1.2)**: durable indexer in the gateway (CF Worker cron → D1 `task_index`, reads escrow TaskCreated/Paid/Disputed/Resolved/Expired via raw `eth_getLogs`), `GET /api/agents/reputation` serves per-executor `score∈[0,1]` (completion rate penalized by dispute rate; neutral 0.5 for no history). `pickAgentForCapability` now ranks by score desc, **tiebreak price asc**, neutral for unknown; an empty/absent map → exact previous cheapest-first, so a reputation outage degrades safely. Activated via orchestrator `REPUTATION_URL`. Editor executor-option ranking (web) is the small remaining piece.
6. **Quarantine + per-agent ceilings** (Layer 3.8–3.9) — once reputation exists to graduate agents out of quarantine.
7. **Bond/slashing** (Layer 2.6) — deferred; separate ADR if/when adopted.

The foreign-agent template (`templates/foreign-agent/`) and `docs/runbooks/register-worker-identity.md` get a "conformance requirements" section once accepted.

## References

- ADR-0022 (Zone C definition).
- ADR-0020 (evaluators); ADR-0019/0017 (dispute/arbiter); ADR-0007 (run-guards lineage); ADR-0002 (permissionless registry).
- `packages/contracts/src/AgentRegistryV2.sol`; `apps/demo-agents/src/parent/registry-resolver.ts`, `plan-runner.ts`; `templates/foreign-agent/`; `docs/runbooks/register-worker-identity.md`.
- M11.6 (reputation surface — unbuilt) in `TASKS.md`.

# ADR-0022 — Responsibility boundaries: what Sage is (and is not) accountable for

- **Status:** Accepted
- **Date:** 2026-06-23
- **Deciders:** Alex, Claude
- **Supersedes:** —
- **Related:** ADR-0008 (Sage angle / position — amendment 2026-06-04 introduces settlement-as-guarantee / settlement-as-receipt and the eBay/PayPal/Upwork referee framing); ADR-0017 (escrow arbitration — `resolveDispute`, configurable arbiter); ADR-0019 (off-chain council v1); ADR-0002 (agent identity — permissionless registry, any EOA accepted); ADR-0007 (observable decomposition — legible verdicts); ADR-0023 (foreign-agent conformance — *proposed*); ADR-0024 (privacy / on-chain commitments — *proposed*).

## Context

A recurring question, raised directly by Alex (2026-06-23): **who is responsible for the agents acting through Sage?** The intuition was "the platform is responsible — for our own agents I'm sure, but for foreign agents we can't be sure at all."

That intuition is half right, and the dangerous half is the implicit "Sage is responsible for all agents." Sage's architecture cannot back that promise:

- The registry is **permissionless**. `AgentRegistry.registerAgent(endpoint)` / `AgentRegistryV2.registerAgent(endpoint, profileUri, capabilities)` can be called by any EOA. Validation is minimal: non-empty endpoint, capability name non-empty, `price > 0`, no duplicate capability names. No KYC, no staking, no allowlist, no reputation gate (`packages/contracts/src/AgentRegistryV2.sol`, `_validateCapabilities` lines 176–192).
- `TaskEscrow` / `TaskEscrowV2` accept **any EOA** as executor (ADR-0002: "Escrow принимает любой EOA как исполнителя").
- Foreign agents run on **operators' own hosts**, with code Sage neither sees nor controls (`templates/foreign-agent/`).

So "we are responsible for agent behavior" is, for foreign agents, an unbounded liability we have no mechanism to meet. Promising it would be the kind of half-working claim the project explicitly avoids.

At the same time, "we are responsible for nothing" is also false and would gut the value proposition. The amendment to ADR-0008 already committed Sage to the role of **transparent referee** (eBay/PayPal/Upwork) for disputes that cross an ownership boundary. The arbiter is currently a single Sage-controlled EOA (collapse posture, ADR-0017 / ADR-0019). That *is* a real, accepted responsibility.

The third unnamed surface is **agent selection**. The previously-decided policy (Alex) is that Sage *proposes* a default executor — the **best-reputation agent** for the capability — because many users cannot reasonably assign executors themselves, and a good default is part of the product, not a cop-out. The default is meant to be **overridable by editing the plan/sub-task** before approval — the observable-decomposition editing step (ADR-0007) is precisely what keeps selection an *explicit, user-owned* choice rather than a hidden one.

The M12 pipelines regressed from this on both counts. Today selection is **cheapest-active-first** with no reputation (`apps/demo-agents/src/parent/registry-resolver.ts`, `pickAgentForCapability` sorts by `capability.price`), and the website / research pipelines **removed the editing step entirely** (the composite page guards `onEdit` behind `mode === 'composite'`, with the comment *"fixed templates — editing would break the evaluator wiring"*). So Sage currently picks the executor silently *and* gives the user no way to override — quietly assuming part of the Zone-C responsibility it claims not to hold. This must be restored to the decided model: propose-by-reputation **+** editable.

This ADR fixes the boundary so every later decision (conformance requirements, privacy model, monetization, legal posture) inherits a single, honest answer to "who is accountable for what."

## Decision

Sage's responsibility is **bounded and split into three zones**. The boundary follows the ownership boundary, exactly as ADR-0008's amendment frames trust.

**Zone A — First-party operation (full responsibility).** Agents Sage operates — the reference workers (summarizer, translator, vision, sentiment, copywriter, builder, packager, qa-website, searcher, extractor, synthesizer, fact-checker, council judges) whose code, infrastructure (Fly), wallets, and key custody are ours. For these Sage is fully responsible: behavior, correctness, availability, data handling. This is the "own agents" case Alex is rightly confident about — confidence is warranted *because we control the whole stack*.

**Zone B — Protocol mechanism & referee (defined, owned responsibility).** Sage is responsible for the **honesty and correctness of the rails and the judge**, not for the work that flows over them:
- escrow never releases funds before `completeTask` + acceptance/evaluation;
- `resolveDispute` executes the council's verdict faithfully;
- run-guards hold their ceilings (`MAX_RUN_SPEND_UNITS`, `MAX_RUN_TASKS`, `MAX_PLAN_DEPTH`, dispute-retry ≤ 2);
- the arbiter acts within the transparent-referee contract (verdict reasoning is shown — ADR-0007 legibility, ADR-0019).

Because the arbiter is one Sage EOA, this zone is also Sage's largest *risk* surface. Sage owns the obligation to shrink it over time: `setArbiter` → Safe multisig → broader council → human-anchored appeal (ADR-0017 / ADR-0019 roadmap).

**Zone C — Foreign-agent behavior & output quality (explicitly NOT Sage's responsibility).** Sage does not and cannot vouch for what a foreign agent does. Sage's obligation in Zone C is not to *guarantee behavior* but to **bound the damage of misbehavior** and to **give the user the means to judge for themselves** — through escrow, evaluator gates, run-guards, transparent disputes, and (per ADR-0023) reputation and conformance signals. Responsibility for the *work* stays with the operator who registered the agent; responsibility for *choosing* an agent stays with the user.

**Selection is an explicit responsibility, with a sensible default plus an override.** Sage *proposes* an executor for each sub-task — the **best-reputation agent** for that capability (not the cheapest) — so users who cannot assign executors themselves still get a good outcome. The default is never silent: the user can always **override it by editing the sub-task / plan before approval**, and that editing step (ADR-0007 observable decomposition) is the disclosure mechanism that keeps selection user-owned. Cheapest-first selection and the website/research removal of the editing step are both regressions from this decided model and are corrected per ADR-0023. Sage may pre-select; it may neither hide the choice nor deny the override.

**The promise Sage makes, stated honestly:** *Sage guarantees the fairness of settlement and the existence of transparent recourse — not the quality or behavior of any agent it did not build.*

## Rationale

- **The boundary follows ownership, which the architecture already encodes.** ADR-0008's amendment ties trust boundary to ownership boundary. Responsibility is the same boundary viewed from the liability side: we are accountable exactly where we own the stack (Zone A) and where we chose to stand as referee (Zone B), and nowhere we don't control (Zone C).
- **Unbounded promises are unkeepable and off-ethos.** "We're responsible for every agent" is a claim we cannot honor against a permissionless registry and operator-hosted code. Naming the limit is more credible than a promise we'd quietly break on first incident.
- **Damage-bounding beats trust-establishing.** You can never fully verify a foreign agent's behavior (Alex's point, and it is correct). A robust system therefore leans first on mechanisms that hold even against a fully malicious agent — escrow, caps, evaluators — and only second on signals that lower the probability of bad actors. Zone C is defined around what we *can* enforce.
- **The hidden selection responsibility is the real leak.** Cheapest-first auto-routing is the one place Sage currently takes Zone-C responsibility without admitting it. Surfacing it closes the gap between what we claim and what we do.
- **It is the defensible legal posture.** A settlement/escrow layer that runs fair arbitration is analogous to a payment processor: accountable for the rails and the dispute process, not for the merchandise. Starting to "guarantee" agent output would convert infrastructure into a warrantor of third-party work — an unbounded and uninsurable position.
- **It is honest, which is the project's differentiator.** "Fair settlement, not guaranteed work" is a claim a reader who knows the space will respect, where "trust us, agents are vetted" reads as either naïve or untrue.

## Alternatives considered

### Option A — Sage assumes responsibility for all agents (the original intuition)
- Pros: simplest story to a user ("everything here is safe"); maximal trust surface.
- Cons: architecturally unbackable (permissionless registry, operator-hosted code); unbounded legal liability; one bad foreign agent becomes Sage's fault; incentivizes us to over-gate the registry and kill the permissionless property.
- Rejected because: it is a promise we cannot keep and would have to silently break.

### Option B — Sage assumes responsibility for nothing ("pure rails, caveat emptor")
- Pros: minimal liability; cleanest "we're just infrastructure" framing.
- Cons: contradicts ADR-0008's accepted referee role; abandons the dispute/recourse value that distinguishes settlement-as-guarantee from a raw transfer; the cheapest-first classifier already makes choices on the user's behalf, so "nothing" is factually untrue.
- Rejected because: we already took the referee role on purpose, and selection responsibility already exists in code.

### Option C — Three-zone bounded responsibility (chosen)
- Pros: matches the ownership boundary the architecture encodes; keeps the permissionless registry intact; makes the referee role and the selection responsibility explicit; gives every downstream ADR a single inherited answer.
- Cons: requires admitting publicly that foreign-agent quality is not guaranteed (a harder marketing line); requires reworking the cheapest-first default.
- Rejected because: nothing — this is the decision.

## Consequences

**Положительные:**
- Every later decision inherits one answer to "who is accountable." Conformance requirements (ADR-0023) become "what Sage must check to bound Zone-C damage"; privacy (ADR-0024) becomes "what Sage must protect in Zones A/B and minimize exposing to Zone C."
- The referee role and its centralization risk are named, with an owned shrink-path (Safe → broader council → appeal).
- The cheapest-first selection leak is identified and slated for replacement, closing the gap between claim and behavior.
- External readers get a credible, defensible responsibility statement instead of an unkeepable guarantee.

**Отрицательные / компромиссы:**
- We must publicly state that foreign-agent output is not guaranteed by Sage. Some readers will prefer a (false) blanket assurance.
- Reworking auto-routing adds work and may make the foreign-agent path feel less "magic" (a user choice or a quarantine step where there used to be silent selection).
- Zone B is a standing operational obligation: the arbiter/council must actually be run fairly and shrunk over time, or the whole posture loses credibility.

**Что потребует дальнейшего решения:**
- ADR-0023 — the concrete conformance requirements and routing gates that operationalize Zone C.
- ADR-0024 — the privacy model that protects Zone A/B data and minimizes Zone-C exposure.
- A user-facing Terms / responsibility statement that reflects this boundary (separate from this internal ADR; legal-review territory before any real users).
- The arbiter decentralization timeline (when `setArbiter` → Safe; when the council broadens; when the appeal layer ships — M11.5).

## Implementation notes

- No contract changes required for this ADR itself; it is a positioning/accountability decision. Its consequences land in ADR-0023 (routing + checks) and ADR-0024 (data).
- The selection rework has two parts: (a) flip the default in `apps/demo-agents/src/parent/registry-resolver.ts` from cheapest-first to best-reputation (depends on the reputation surface, M11.6, currently unbuilt); and (b) restore the editing/override step in the website + research pipelines (`apps/web/components/demo/plan-editor.tsx`, composite-page mode dispatch), made evaluator-aware so it does not break the `evaluates` / dispute wiring. Detailed in ADR-0023.
- `CLAUDE.md` "Позиционирование Sage" should gain a one-paragraph responsibility note once this is Accepted (internal onboarding; not a public artifact — see memory `feedback_internal_docs_no_commit`).

## References

- ADR-0008 amendment 2026-06-04 (settlement-as-guarantee / -as-receipt; eBay/PayPal/Upwork referee; trust boundary = ownership boundary).
- ADR-0017, ADR-0019 (arbiter EOA, `resolveDispute`, off-chain council v1).
- ADR-0002 (permissionless registry; any EOA executor).
- `packages/contracts/src/AgentRegistryV2.sol`; `apps/demo-agents/src/parent/registry-resolver.ts`; `templates/foreign-agent/`.

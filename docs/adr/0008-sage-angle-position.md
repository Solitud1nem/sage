# ADR-0008 — Sage angle / position: multi-chain settlement infrastructure for AI agents, distinguished by observable decomposition

- **Status:** Accepted
- **Date:** 2026-05-20
- **Deciders:** Alex, Claude
- **Supersedes:** —
- **Related:** ADR-0001 (deterministic addresses across EVM); ADR-0006 (web integration topology); ADR-0007 (observable decomposition); `docs/research/observable-decomposition.md`; `docs/research/classification-trigger-design.md`; `CLAUDE.md` "Project ethos / Позиционирование Sage" section; live: `https://sage-protocol.pages.dev/demo/composite`.

## Context

Through April–May 2026, Sage shipped:

- Atomic settlement on Base mainnet (`AgentRegistry`, `TaskEscrow`, deterministic CreateX/CREATE3 addresses — ADR-0001).
- A chain-agnostic SDK (`@sage/core`, `@sage/adapter-evm`).
- A live demo (`sage-protocol.pages.dev/demo`) that proves end-to-end on-chain settlement of multi-stage agent work for ~0.002–0.004 USDC.
- A research articulation of the angle (`docs/research/observable-decomposition.md`, `docs/research/classification-trigger-design.md`) plus its acceptance as ADR-0007.
- A working implementation of that angle (`sage-protocol.pages.dev/demo/composite`, May 2026): user types a brief, the parent agent classifies and decomposes, the user reviews / edits / approves a structured plan, each sub-task becomes its own on-chain `TaskEscrow` record, the graph progresses live with per-step verification.

The work demonstrates a position. This ADR formalizes that position so future architectural decisions have an evaluative axis ("does this advance the angle, or merely add surface?"), and so external readers — collaborators, peer researchers, the small set of people for whom this matters — can locate Sage relative to its neighbours.

The space is crowded. x402 (Stripe-driven HTTP payment standard) and Stripe Multi-Party Payments occupy pay-per-call. ERC-8183 (Job-based on-chain composability) covers atomic compute settlement on Arc. OKX APP and a growing roster of agent-payment startups address overlapping concerns. None of these is bad; several are well-funded. Trying to compete with any of them on distribution, marketing budget, integration breadth, or sheer reach is not a winning game.

What we have observed across the space is a consistent gap: **decomposition lives inside LLM context windows.** ReAct-style frameworks, multi-agent workflows, even Claude-Code's own thinking surface — they all treat the breakdown of work as ephemeral, internal, and lost on completion. The plan that produced the result disappears with the run. This is the underexplored ground.

We do not believe Sage will be the largest or most widely-used agent payment system. We do believe Sage can be **the one that surfaces decomposition as a first-class artifact** — and that this property, once visible, will be recognisable as the right shape for an interesting subset of agent work.

## Decision

Sage is positioned as a **multi-chain settlement-infrastructure provider for AI agents**, distinguished from neighbouring efforts by treating **composite agent work as an observably decomposed, on-chain artifact rather than an internal LLM trace**.

Concretely:

1. **What we are**: settlement infrastructure (escrow, deterministic addressing, lifecycle events, multi-chain SDK), not an agent platform, not a marketplace, not a chat product.
2. **Who chooses the chain**: the user / agent operator. Sage provides a uniform API (`@sage/core` + `@sage/adapter-*`) and a uniform UI; the chain is a configuration, not a commitment.
3. **What makes us identifiable**: the parent-then-execute pattern from ADR-0007 — every composite task surfaces as a structured plan before it spends money, every sub-task lands as its own atomic settlement record, every result is verifiable per step.
4. **What we are not optimising for**: distribution scale, marketing reach, total payment volume, agent count, MRR / ARR. These are not absent because we dislike them; they are absent because at this stage they would distort the work. Reference: `CLAUDE.md` "Project ethos".
5. **What we are optimising for**: visible engineering aesthetics, clean ADR trails, honest research artifacts, and execution quality on the small set of choices we have already committed to (deterministic addresses, USDC permits, observable decomposition).

We accept that this position is niche by construction. It is not a description of who will eventually use Sage at scale; it is a description of the angle from which Sage approaches the problem so that those for whom the angle matters can find us through the work.

## Rationale

- **The angle exists in code, not in claims.** As of May 2026 the `/demo/composite` flow demonstrably classifies, surfaces, approves, executes, and settles a multi-step plan on Base mainnet. The work is the argument; this ADR just attaches a name to it.
- **The multi-chain framing is architecturally true.** CreateX + CREATE3 give us identical addresses on every EVM, the `ChainAdapter` interface in `@sage/core` is chain-agnostic by design, and `@sage/adapter-evm` is already factored out. Promising multi-chain support is honest; we have built for it from the start.
- **Distinguishing on operational legibility is durable.** Distribution and reach are arms races. Quality of decomposition, of the artifact left behind, of the per-step reasoning — these are properties competitors cannot copy by hiring or spending. They accrue with depth, not breadth.
- **It survives the comparison test.** When a reader who knows x402, knows ERC-8183, knows the agent-orchestration landscape looks at `/demo/composite`, they should see something that is recognisably different — not "x402 with extra steps," not "ERC-8183 with a different name," but a different stance on what the artifact of agent work should look like. We have eyes-on confirmation this is the case for at least one such reader (research notebook drafts predate any external promotion).
- **It aligns with project ethos.** The CLAUDE.md framing — поисковая работа с прицелом быть замеченными — describes exactly this kind of positioning: not a GTM war, not a closed lab, an invitation through quality.
- **It accommodates Phase B.** Arc as a sibling chain, additional adapters, future non-EVM (Solana, NEAR) all slot into "multi-chain settlement infrastructure" without rewriting the position. The decomposition angle remains the constant; the chain list grows.

## Alternatives considered

### Option A — Position as a general AI-agent infrastructure / platform

- Pros: broadest possible framing; doesn't lock us out of any future direction.
- Cons: indistinguishable from a dozen other efforts (LangChain, AutoGen, CrewAI, every agent-payments startup); says nothing about what makes us pickable; abandons the angle we have already built.
- Rejected because: vagueness is the enemy at this stage. We need shape, not optionality.

### Option B — Position as Base-only / EVM-only agent payments

- Pros: matches the current deployed surface; easier to communicate; less to claim.
- Cons: contradicts the chain-agnostic architecture we have already built (CreateX, `ChainAdapter`, `@sage/adapter-evm` factored from `@sage/adapter-base`); forecloses Arc + future non-EVM work; positions us as a competitor to Base-adjacent infrastructure rather than complementary to it.
- Rejected because: we built multi-chain into the SDK on purpose; backing off in positioning would invalidate that choice.

### Option C — Position as a research-only / public-good project

- Pros: low pressure; easy to defend academically; clean narrative.
- Cons: research-only excludes the "be noticed by relevant people" half of the project ethos; loses the leverage of a live, audit-able mainnet artifact; signals abandonment to anyone who might integrate.
- Rejected because: we want the work to land as actual code on actual chains used by actual agents, not just papers. Public-good framing undersells the engineering we have shipped.

### Option D — Position purely as "the observable decomposition company"

- Pros: maximum sharpness on the angle; immediately memorable.
- Cons: too narrow — observable decomposition is the *distinguishing* feature, not the entire offering. Settlement infrastructure, multi-chain support, agent identity (ADR-0002), permissionless escrow — these are foundational; decomposition rides on top.
- Rejected because: the angle is the differentiator, not the whole. "Settlement infrastructure with X as the angle" is more honest than "X-as-a-service".

## Consequences

**Положительные:**

- Future architectural decisions have a clear evaluative test: does it advance multi-chain settlement and/or observable decomposition, or merely add surface area? Anything that fails both should be examined skeptically.
- Communication with peers (research notebook readers, ADR readers, blog readers) has a stable hook. They can be told what Sage is in one sentence and verify it in one click via `/demo/composite`.
- New work is constrained in a useful way. Phase B (Arc as a sibling chain) is on-position. Adding a parallel-execution scheduler in `plan-runner.ts` is on-position. Building a no-code agent designer is off-position.
- Multi-chain framing prevents Base lock-in — both technically (already done) and narratively (now explicit).

**Отрицательные:**

- Niche by construction. We give up the option to compete on volume, distribution, or breadth-of-integrations. This is intentional but worth naming.
- The angle requires sustained engineering quality to remain credible. If the decomposition flow accrues visible technical debt, the position weakens. We have to keep `/demo/composite` clean, expand it carefully, and continue producing artifacts (research, ADRs, blog) that match the work.
- Direct monetization is unclear. We are not selling SaaS, not running a marketplace, not taking transaction fees. Likely future shape: free open-source SDK + paid managed deployment / support services for teams that want to run Sage at scale, with the angle being the reason to pick us over rolling-their-own. This is fine to defer.
- The angle is asymmetrically attractive. It will read as "obvious — why didn't someone already do this?" to a small set of readers and "what is this for?" to most others. We accept this.

**Operational consequences:**

- This ADR + ADR-0007 + the two research documents (`observable-decomposition.md`, `classification-trigger-design.md`) + the live `/demo/composite` URL form the canonical artifact set. The accompanying blog (`docs/blog/observable-decomposition-shipped.md`, M10.4.9) is the entry point for external readers.
- The `CLAUDE.md` "Project ethos / Позиционирование Sage" section already documents this position in less formal language for AI assistant onboarding. This ADR is the formal version; the CLAUDE.md section remains the operational guide.
- ADR index (`docs/adr/README.md`) and KB dossier (`D:\knowledge\projects\project-sage.md`) get updated on ADR promotion to Accepted.

## What it would take to revisit this

- A material change in the agent-payments landscape — e.g. x402 or ERC-8183 absorbing the observable-decomposition pattern natively — would reduce the distinguishing value of our angle and warrant a revisit. In that case the response is likely to deepen the angle in another direction (per-step verification SLAs? cross-task plan reuse? richer artifact storage?), not to abandon multi-chain settlement framing.
- Real user adoption signal would be a positive prompt to revisit — if a critical mass of integrators or end-users emerges, the "explore-with-ambition" framing may need to give way to something operationally heavier (support obligations, breaking-change discipline, monetization). This is a happy problem and not currently in view.
- Discovery that observable decomposition does not survive contact with a sufficiently complex real task — i.e. plans become too large, user approval becomes mechanical clicking, the artifact stops adding value — would force a reformulation. Validation here comes from real briefs, not internal smoke tests; M10.4.13's smoke matrix is a first probe.

## References

- ADR-0007 (Observable decomposition — the embodiment of the angle in code).
- `docs/research/observable-decomposition.md` §4 ("The Sage angle"), §11 (post-implementation annotations).
- `docs/research/classification-trigger-design.md` (technical design of the trigger that surfaces decomposition).
- `CLAUDE.md` "Project ethos / Позиционирование Sage" section.
- Live demo: `https://sage-protocol.pages.dev/demo/composite` (running on Base mainnet via `sage-demo-agents.fly.dev` as of 2026-05-20).
- Blog: `docs/blog/observable-decomposition-shipped.md` (M10.4.9 — reflective account of the M10 build).

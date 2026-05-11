# Sage Docs — External Site Rollout Plan

> **Status:** Phase 3.1 in progress (started 2026-05-11).
> **Owner:** session-driven; future sessions read this to understand the plan.
> **Tracking parent:** Bucket 3 of the 2026-05-11 site-content audit.

## Goal

Replace the placeholder card-hub at `/docs` with a proper external-audience docs
site under `/docs/*`. Builders coming from Twitter / HN / a partner intro should
be able to go from "what is this?" to "I shipped a task on mainnet" in one site
session, without ever leaving for GitHub markdown.

## Audience and tone

- **Primary:** developers evaluating Sage for integration. Middle+ EVM/wagmi
  familiarity assumed; we don't re-explain ERC-20 or EIP-2612 from scratch.
- **Secondary:** investors / partners / curious readers. Reach via Intro,
  Concepts, Use cases, Architecture.
- **Tone:** direct, terse, code-heavy. No marketing fluff. Show real APIs,
  real txs, real source. Same register as Hero + Integrate today.
- **Language:** English. Match the existing site.
- **Content origin:** written for the external audience, not copy-pasted from
  repo docs. Repo docs are technical (developer-facing); site docs are
  product-shaped (user-facing). Keep them parallel sources.

## Information architecture

```
/docs                       hub — short intro + TOC tiles + "open in repo" footer
├── /docs/intro             What is Sage · what it solves · 5-min mental model
├── /docs/concepts          Agents · Tasks · Escrow · Lifecycle · Capabilities · Settlement
├── /docs/getting-started   Install SDK → connect → first task → first agent → mainnet checklist
├── /docs/patterns          Cookbook: Summarizer / Translator / Sentiment / Vision / build your own
├── /docs/use-cases         Concrete scenarios + which patterns they compose
├── /docs/api               SDK reference: createSageClient, sage.tasks.*, sage.agents.*, events
├── /docs/contracts         Solidity reference: AgentRegistry, TaskEscrow, enums, errors, events
├── /docs/architecture      Layers · money flow · chains · security boundaries · roadmap
└── /docs/security          Slither status · security checklist · threat model · disclosure
```

Nine sub-pages + updated hub. The hub is the entry point; sidebar nav on each
sub-page surfaces the rest.

## Phase plan

### Phase 3.1 — Foundation (in progress)

**Deliverables:**

- Shared `DocsLayout` component with sidebar on `lg+`, collapsed on mobile.
  Sidebar lists every sub-page in the TOC; not-yet-built pages render as
  "coming soon" disabled items so visitors see the shape.
- `/docs` hub rewrite: shorter intro + section tiles (4 sections: Get started,
  Build, Reference, Operate). Each tile lists its sub-pages.
- `/docs/intro` — full page. Sections: *What Sage is* · *What it solves* ·
  *Mental model in 5 minutes* · *Who it's for* · *Next: Concepts / Getting
  started*. Anchors visible.
- `/docs/concepts` — full page. Sections: *Agents* · *Tasks* · *Escrow* ·
  *Lifecycle* · *Capabilities* · *Settlement (USDC + permit)*. Each section
  short (~150-250 words) with one code snippet or diagram where useful.

**Verification at phase close:**

- Build clean, typecheck passes.
- All sidebar items exist or render coming-soon.
- All cross-links resolve.
- Deploy to Pages and visually check on `sage-protocol.pages.dev/docs/intro` +
  `/docs/concepts`.
- Single commit per phase.

### Phase 3.2 — Builder onboarding

- `/docs/getting-started` — opinionated quickstart:
  1. Install `@sage/adapter-evm`
  2. Wire up wagmi + viem
  3. Create your first task (sponsored or wallet)
  4. Build your first agent (listen → accept → complete)
  5. Move to mainnet — gas + USDC funding checklist
- `/docs/patterns` — full source listing per agent (Summarizer / Translator /
  Sentiment / Vision) + "Build your own" template with capability-string
  conventions and prompt-design tips.

### Phase 3.3 — Use cases

- `/docs/use-cases` — 4–6 concrete scenarios, each with: problem statement ·
  which patterns it composes · sketch of the data flow · "when to use Sage vs
  x402 (pay-per-call)" decision callout. Initial set:
  - RFP / long-document summarization pipeline
  - Cross-language content ops
  - Image-driven content moderation (Vision + Sentiment composed)
  - Multi-step agent workflows / chained tasks
  - Sponsorship / pay-on-behalf-of-user flows

### Phase 3.4 — Reference

- `/docs/api` — SDK surface, grouped:
  - `createSageClient({ chain, walletClient, publicClient })`
  - `sage.tasks.{createTask, acceptTask, completeTask, approvePayment, disputeTask, refundExpired, claimAutoRelease, getTask}`
  - `sage.agents.{registerAgent, updateProfile, pauseAgent, resumeAgent, getAgent, listAgents}`
  - `sage.callAgent` (x402) + `sage.payDirect` (escape hatch)
  - Event subscriptions: `onTaskCreated`, `onTaskAccepted`, …
- `/docs/contracts` — Solidity reference:
  - `AgentRegistry` methods + events + errors
  - `TaskEscrow` methods + events + errors
  - `TaskStatus` enum (with the +0 vs +1 history note — see GOTCHAS)
  - Deterministic-address pattern (CREATE3 + salt)
  - Link to source for every method.

### Phase 3.5 — Trust

- `/docs/architecture` — re-render of `docs/architecture/overview.md` but
  product-tuned: layers diagram · money flow with annotated edges · chains
  table (live + planned) · security boundaries · v2.1 → v3 roadmap.
- `/docs/security` — Slither status (clean) · security checklist link · audit
  status (none yet, honest) · responsible disclosure (`security@sage.xyz` or
  GitHub Security Advisories).

## Implementation notes

### Layout

- Tailwind tokens: reuse what's in `tokens.css`. No new design language.
- Sidebar nav: `lg`+ shows it; below `lg` it collapses to a top-of-page select
  / drawer. Sticky position so it stays visible on long pages.
- Code blocks: reuse the Integrate section's mono-on-surface-2 styling.
- Page headings: same gradient + sub-tag pattern as `/changelog` / `/docs`.
- Anchored sub-sections (`<h2 id="…">`) for deep links.

### Routing + structure

- Next.js app router. Each sub-page is `apps/web/app/docs/<slug>/page.tsx`.
- Shared `apps/web/components/docs/docs-layout.tsx` consumed by every sub-page
  (wraps `children` in sidebar + main content grid).
- The hub at `apps/web/app/docs/page.tsx` can use a slightly different shape
  (full-width section tiles instead of sidebar + body) but should still feel
  consistent.

### Content rules

- Every code snippet must come from real source. If we don't ship an API yet,
  say so explicitly ("planned for v2.1") instead of inventing.
- Use real contract addresses (from `chains/base.ts`), real Basescan URLs.
- Link out to source on GitHub for every non-trivial claim.
- No dead-end pages — every page should have a "next" pointer at the end.

### Verification

- After each phase: typecheck → build → deploy → visual check → link audit
  (curl + grep).
- Single commit per phase with a descriptive body listing each new page.
- Don't push partial work; phase ships as one unit.

## Open decisions (revisit in-phase)

- **MDX migration:** out of scope for now (Phase 4+). All content hand-written
  in `.tsx`. Move to MDX once content stabilizes if maintenance burden grows.
- **Search:** skip for v2.x. Add Pagefind / Algolia DocSearch later if traffic
  justifies.
- **Versioned docs:** skip for v2.x. Single version (v2.0). Re-evaluate after
  v2.1 ships.
- **Sidebar grouping labels** ("Get started" / "Build" / "Reference" /
  "Operate") — finalize naming in Phase 3.1 once the layout is up.

## Out of scope for this rollout

- Programmatic API doc generation (typedoc, forge doc) — manual now, revisit
  for v2.0.5.
- Embedded interactive playground (something like Stripe's API explorer) —
  far future.
- Internationalization. English only.

# ADR-0021 — UI/UX polish + Galaxy hero background

- **Status:** Accepted
- **Date:** 2026-06-14
- **Deciders:** Alex, Claude
- **Supersedes:** —
- **Related:** ADR-0006 (web integration topology / static export), ADR-0007 + ADR-0020 (composite demo this touches presentationally)

## Context

The site shipped functionally complete (v2.0 public, all three demo pipelines live), but a pass over the UI surfaced an accumulated set of presentational rough edges and one new asset decision:

- The hero's primary CTA pointed at `/docs` — the live product was unreachable from the first screen.
- The composite demo had small but real friction: mode tabs touched (no `gap`), the chain picker rendered a dangling `mainnet` hint that read like a third network, the plan graph carried xyflow's `+ / − / ⤢` controls inside what should read as a card, and the node color map had no legend.
- `--color-text-subtle` (11px mono labels) measured 3.98:1 on `#0A0A0F` — below WCAG AA 4.5 for small text. Tokens were also duplicated across `globals.css` and `styles/tokens.css`.
- Three demo-ish nav items (`Live`, `Demo`, `Composite`) didn't read as distinct in a flat row.
- We wanted a hero background that makes the surface feel less like a template and more like our own — without a CSS imitation.

This is explore-mode work (per `CLAUDE.md`): the goal is making engineering care visible and the developer's choice cleaner, not GTM metrics. All changes are presentational — no contracts, SDK, or run logic touched.

## Decision

Apply the `sage-ui-polish-plan.md` set in one pass: contrast-token fix, hero CTA re-rank, composite Phase 1 (tabs gap, chain picker, graph controls) and Phase 2 (status legend, live graph animation, brief example chips, sticky flow stepper), nav IA grouping (`Demo ▾`), and a **Galaxy** WebGL starfield (the original reactbits OGL component, vendored verbatim) as the landing hero background.

Open questions resolved with Alex (2026-06-14): Galaxy only (Threads deferred); graph controls removed minimally (wheel-zoom retained, not hard-locked); Phase 1 + Phase 2 in this pass; Basescan kept as a third ghost CTA; tokens `subtle → #8A8AA0`, `muted → #A0A0B4`.

## Rationale

- **Try-first hero** — the live demo is the strongest thing we have; it should be the primary action, with docs demoted to secondary and Basescan to ghost.
- **Contrast is correctness** — AA on small mono labels is a measurable a11y bug, not taste. Fixed in both token files to prevent drift.
- **Vendored original, not imitation** — Galaxy ships as the upstream reactbits OGL component (only a `'use client'` directive added), consistent with `[[feedback-scaffold-over-halfworking]]`: real component, not a faked CSS approximation.
- **Safety rails the raw component lacks** — a wrapper adds `prefers-reduced-motion` (frozen frame), off-screen pause (IntersectionObserver), lower mobile density, and a radial-gradient fallback for no-WebGL. Decorative + `pointer-events-none` so it never intercepts clicks.
- **Static-export safe** — Galaxy is loaded via `next/dynamic({ ssr: false })` from a client wrapper, the same constraint that already governs `useSearchParams` on the composite page (ADR-0006).

## Alternatives considered

### Option A — Galaxy + Threads on a secondary surface
- Pros: more visual variety; A/B option.
- Cons: two WebGL components to maintain; second surface undecided.
- Rejected (for now): Alex chose Galaxy-only; Threads deferred to a later pass.

### Option B — CSS-only animated gradient hero
- Pros: zero dependency, trivially SSR-safe.
- Cons: reads as a template effect; not our own angle.
- Rejected: a real starfield is the differentiator; the `ogl` dep (~30 KB) is cheap and isolated.

### Option C — hard-lock the plan graph (disable zoom/pan)
- Pros: graph reads as a static card.
- Cons: removes the ability to inspect a large plan.
- Rejected: Alex chose the minimal removal — drop the on-canvas controls, keep wheel-zoom.

## Consequences

**Положительные:**
- Live demo reachable from the hero; AA contrast restored site-wide; composite demo reads cleaner (legend, live edge sweep, paid-pulse, example chips, orientation stepper); nav demo destinations grouped.
- Hero has a distinctive, performance-guarded animated background.

**Отрицательные / компромиссы:**
- New runtime dependency `ogl` (web only).
- `Galaxy.tsx` carries a file-scoped `eslint-disable` (prefer-const + no-unsafe-member-access) because it's vendored upstream code and OGL types its uniform values as `any`. Kept intentional and documented rather than diverging from upstream.
- Token contrast change ripples across every page (intended — verified visually).

**Что потребует дальнейшего решения:**
- Whether to add Threads on a secondary surface (`/docs` or `02 — Integrate`) later.
- Whether to hard-lock the plan graph if large plans make wheel-zoom feel accidental.

## Implementation notes

- Tokens: `apps/web/styles/tokens.css` + `apps/web/app/globals.css` (`@theme`) — both edited.
- Hero: `apps/web/components/home/hero.tsx` (CTA re-rank + `<GalaxyBackground />`).
- Galaxy: `apps/web/components/backgrounds/Galaxy.tsx` (vendored) + `galaxy-background.tsx` (dynamic `ssr:false` wrapper with the safety rails). Dependency: `pnpm add ogl -F @sage/web`.
- Composite: `apps/web/app/demo/composite/page.tsx` (tabs gap, example chips, `FlowStepper`, `<PlanLegend>`), `components/demo/chain-picker.tsx` (status-in-pill rewrite), `components/demo/plan-graph.tsx` (controls removed, gradient edge flow, paid-pulse, `PlanLegend` export), keyframe `node-paid-pulse` in `globals.css`.
- Nav: `apps/web/components/nav.tsx` (`Demo ▾` CSS-driven dropdown — hover + focus-within, no JS state, static-export safe).
- Gates: `pnpm typecheck`, `pnpm lint`, `pnpm build` (static export) green.

## References

- `sage-ui-polish-plan.md` (source plan, this session)
- reactbits Galaxy — https://reactbits.dev/backgrounds/galaxy

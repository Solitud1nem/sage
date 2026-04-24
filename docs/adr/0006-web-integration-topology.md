# ADR-0006 — Web frontend integration topology

- **Status:** Accepted
- **Date:** 2026-04-23
- **Deciders:** Alex, Claude
- **Supersedes:** —
- **Related:** ADR-0001 (deterministic addresses), ADR-0002 (agent identity), ADR-0003 (x402 transport), ADR-0005 (monorepo + Foundry + viem); `apps/web/INTEGRATION.md` (detailed plan + milestones)

## Context

Sage v2.0 contracts are deployed on Base mainnet. SDK (`@sage/core`, `@sage/adapter-evm`) is written. Demo agents exist as Docker services in `apps/demo-agents/`. To complete the v2.0 public-facing surface we need a web frontend (landing + interactive demo + wallet modal + design system reference) that connects:
1. The user's wallet (via wagmi / ConnectKit).
2. Base mainnet contracts (via viem, both reads and writes).
3. The demo-agents backend (via HTTP + SSE for real-time task-lifecycle streaming).

This ADR locks the major topology decisions before implementation. Detailed milestone breakdown is in `apps/web/INTEGRATION.md`.

## Decision

**Monorepo placement.** New Next.js app at `apps/web/`. Siblings `apps/demo-agents/`.

**Frontend stack (locked).**
- Next.js 15 (App Router) + React 19 + TypeScript strict.
- Tailwind CSS v4 with tokens mapped from `apps/web/styles/tokens.css` (imported in `globals.css`, extended in `tailwind.config.ts`).
- `wagmi@2` + `viem@2` + `connectkit@1` + `@tanstack/react-query@5` for on-chain state.

**Render mode.** **Static export on Cloudflare Pages.** Each route pre-rendered at build time (`next build`). Dynamic behavior (live tx stream, wallet state, demo progress) via client components (`"use client"`). No edge SSR in v2.0; migrate incrementally when adding docs/blog.

**Hosting.**
- `apps/web/` → Cloudflare Pages (frontend + a Cloudflare Worker at `/api/rpc` as RPC proxy).
- `apps/demo-agents/` → Fly.io (three containers: orchestrator, summarizer, translator). Health checks + auto-restart.

**RPC provider.** **Alchemy** (free tier, 300M compute units/month). Key stored as Cloudflare secret, **never shipped to the frontend bundle** — the client calls `https://api.sage.xyz/rpc` which is a Cloudflare Worker proxying to Alchemy with the hidden key.

**Integration points.**
1. Wallet → Frontend: ConnectKit modal, styled with Sage tokens, prioritizes Coinbase Wallet → MetaMask → WalletConnect → Rainbow → Browser wallet.
2. Frontend → Orchestrator (HTTP + SSE): `POST /api/demo/start` returns `{ taskId, streamUrl }`; `GET /stream/:taskId` streams task-lifecycle events via Server-Sent Events.
3. Frontend → Base RPC (reads): `viem.watchContractEvent` directly from the browser for the live tx stream (5 rows on Home, opacity-stepped 0.92→0.6). No backend indexer in v2.0 — added in v2.0.5 when event volume requires it (A7).
4. Frontend → Base RPC (writes): `wagmi.useWriteContract` + EIP-2612 permit signatures via viem's `signTypedData`. Optional EIP-5792 `wallet_sendCalls` batching where supported.

**Demo custody model.** Two modes on `/demo`:
- **Watch live** (default, no wallet) — orchestrator executes the full lifecycle from a sponsor wallet. Sponsor wallet loaded with **$20 USDC** at launch; auto-pauses at 80% consumption via `AgentRegistry.pause()`. Rate limit: 3 runs/IP/day via Cloudflare D1 counter. If sponsor balance drops below $5, orchestrator returns HTTP 503 for new demo starts.
- **Try with wallet** (opt-in) — user connects their wallet and signs all permit + write transactions themselves. No sponsor spend, no rate limits beyond their own USDC balance.

**Analytics.** **PostHog** (free tier, 1M events/month). Events tracked: `pageview`, `demo_started`, `task_created`, `task_completed`, `result_viewed`, `wallet_connected`, `try_with_wallet_started`, `try_with_wallet_completed`, `error_occurred`. Session replay disabled. Cookie banner required (GDPR-compliant, declines also stop functional cookies). Implementation: PostHog only loads after consent.

**Error tracking.** Sentry on client (frontend) and orchestrator (backend). Tag source = `web` or `orchestrator`.

**Security boundaries.**
- RPC key: Cloudflare Worker proxy only. Never in client bundle.
- OpenAI key: Fly secrets only on orchestrator service.
- Orchestrator sponsor wallet private key: Fly secret only.
- CORS: allow-list `https://sage.xyz` + preview `*.pages.dev`. No wildcard.
- CSP: `default-src 'self' https://api.sage.xyz https://mainnet.base.org https://app.posthog.com` (adjusted for PostHog host).
- HTTPS: Cloudflare-enforced.
- User private keys: never leave the wallet; all signatures local in-browser.

## Rationale

- **Static export + Cloudflare Pages** is the cheapest, fastest-TTFB option that covers our v2.0 needs. We don't have server-rendered dynamic content that would justify edge SSR complexity. Migration path to Edge SSR (via `@cloudflare/next-on-pages`) is incremental if we later need it for docs/blog.
- **Alchemy** has the most generous free tier for Base, clean SDKs, and reliable webhook support if we later need event hooks. 300M compute units covers ~5M `watchContractEvent` calls — far beyond v2.0 traffic.
- **Cloudflare Worker as RPC proxy** is the standard pattern for key protection without backend complexity. No extra infrastructure needed; Cloudflare Pages + Worker share deployment.
- **Fly.io for orchestrator** because it runs Docker containers with long-running event loops (we need persistent event subscribers for the three agents). Cloudflare Workers can't run our agent code (no long-running Node process). Fly free tier covers three shared-cpu-1x machines.
- **Direct `watchContractEvent` in v2.0** because for 5 live-tx rows on Home the traffic is negligible. Avoids premature backend indexer. Path to indexer (Ponder) is clean via A7 when needed.
- **SSE over WebSocket** because task-lifecycle progress is one-way (server → client), fits HTTP/2 stream, works through Cloudflare, no bidirectional connection state to manage.
- **PostHog over Plausible/Cloudflare Web Analytics** because we specifically need event-funnel data (visitor → demo_started → task_completed conversion) to validate that the demo is working. Pageview-only analytics can't answer the core question "does the demo convert visitors into engaged users."
- **$20 USDC sponsor budget** covers ~10 000 demo-runs at 0.002 USDC/run. With 3 runs/IP/day rate limit and realistic v2.0 traffic, this lasts weeks. Easy to top up; we log balance and alert at 50% consumed.
- **Two demo modes** balances "wow" for first-time visitors (no wallet friction) and authenticity for developers evaluating integration (real BYO-wallet flow).

## Alternatives considered

### Option A — Edge SSR on Cloudflare Pages Functions
- Pros: SEO for any dynamic content; user personalization on server.
- Cons: no use case in v2.0 that requires it; adds `@cloudflare/next-on-pages` adapter complexity; limits some npm packages (edge-runtime incompatibility).
- Rejected because: disproportionate complexity without payoff for v2.0 scope.

### Option B — Vercel (full Next.js SSR)
- Pros: zero-friction Next.js deploy, best DX.
- Cons: higher hosting cost; user explicitly wants Cloudflare.
- Rejected because: user preference + cost.

### Option C — Public Base RPC (mainnet.base.org)
- Pros: zero-cost, zero-setup.
- Cons: shared rate limits, no SLA, will fail on small traffic bursts.
- Rejected because: prod reliability requires dedicated RPC.

### Option D — Backend indexer (Ponder) in v2.0
- Pros: scales to high event volume; unified API for frontend.
- Cons: premature for v2.0 traffic; adds Postgres + indexer service to ops.
- Deferred: add in v2.0.5 via ADR when live stream volume justifies.

### Option E — WebSocket for demo stream
- Pros: bidirectional; can support future interactive demos.
- Cons: no current bidirectional need; more ops complexity; SSE fits through Cloudflare cleanly.
- Rejected because: SSE is right tool for one-way event stream.

### Option F — Sponsor wallet: full open (no rate limit)
- Pros: best user experience, no friction.
- Cons: trivially drainable by a single script within minutes.
- Rejected because: sponsor budget would evaporate on first twitter pickup.

### Option G — Only "Try with wallet" mode (no sponsored)
- Pros: zero ops overhead, zero sponsor cost.
- Cons: high barrier to entry; most first-time visitors don't have a Base-compatible wallet ready with USDC.
- Rejected because: kills "wow" moment essential for landing conversion.

### Option H — Cloudflare Web Analytics instead of PostHog
- Pros: zero cost, privacy-first, zero cookies, zero setup.
- Cons: pageviews only, no event funnel, no conversion data.
- Rejected because: we specifically need funnel analysis to answer "is the demo working as a conversion driver."

## Consequences

**Положительные:**
- Frontend ships to globally cached CDN edge — instant TTFB, zero-downtime (works even when backend is down).
- RPC key fully protected via Worker proxy — safe for client-side rendering.
- Low operational cost: Cloudflare Pages free, Fly.io $0–10/mo, PostHog free tier, $20 sponsor USDC. Total burn: <$15/mo + occasional sponsor top-up.
- Clear path to v2.0.5 additions: backend indexer (A7), Edge SSR for docs, paymaster (A9) — none require rewriting what we ship in v2.0.
- Clean separation of concerns: frontend is stateless static, backend is event-driven long-running, chain is source of truth for value.

**Отрицательные / компромиссы:**
- Static export means we can't SEO-optimize dynamic content. Acceptable: landing is static, demo is behind an interactive wall where SEO doesn't matter.
- Sponsor wallet is a real operational cost — requires monitoring and topping up. Acceptable with $20 start and auto-pause.
- Two codebases (Next.js frontend + Fly.io backend) to maintain. Acceptable: same TypeScript, shared types via `@sage/core`, same dev patterns.
- PostHog cookie banner adds 30 minutes of GDPR-compliant consent flow work. Required for EU visitors; standard pattern.
- Client-side `watchContractEvent` depends on stable Alchemy WebSocket — if Alchemy throttles, live stream goes stale. Migration to indexer planned for v2.0.5.

**Что потребует дальнейшего решения:**
- Exact PostHog event schema and property conventions (write before first release).
- Cloudflare Worker code for RPC proxy (small — ~30 lines, written in M-INT.1).
- Fly.io secrets rotation policy.
- Monitoring / alerting for sponsor balance (probably a daily cron or Cloudflare scheduled Worker → Slack/email).
- Domain name (postponed until brand name finalization — see project-sage.md "Наименование").

## Implementation notes

- `apps/web/chains/base.ts` holds chain config: chainId, addresses (AgentRegistry, TaskEscrow, USDC, EAS, CreateX), Alchemy RPC URL template. **The URL template** uses `/api/rpc` proxy; real Alchemy URL only in Cloudflare secret.
- `apps/web/lib/posthog.ts` — lazy-initialized after consent. No events fired before consent.
- `apps/demo-agents/orchestrator/src/sse.ts` — SSE endpoint with task-lifecycle event emitters.
- `apps/demo-agents/orchestrator/src/rate-limit.ts` — Cloudflare Worker-side D1 counter for IP-based rate limiting.
- Runbooks to be written in `docs/runbooks/`:
  - `deploy-web-cloudflare-pages.md`
  - `deploy-demo-agents-flyio.md`
  - `sponsor-wallet-topup.md`
  - `rotate-fly-secrets.md`
- CI gates: `apps/web` build must pass + Lighthouse CI score ≥ 90 on Home + type-check clean + eslint clean. For `apps/demo-agents`: existing tests + health-check integration.

## References

- `apps/web/INTEGRATION.md` — detailed plan + milestone breakdown.
- Alchemy Base endpoints: https://docs.alchemy.com/reference/base-api-endpoints
- Cloudflare Pages Next.js: https://developers.cloudflare.com/pages/framework-guides/nextjs/
- Fly.io Docker: https://fly.io/docs/languages-and-frameworks/dockerfile/
- PostHog Next.js integration: https://posthog.com/docs/libraries/next-js
- ConnectKit custom theme: https://docs.family.co/connectkit/theming
- Server-Sent Events (MDN): https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events

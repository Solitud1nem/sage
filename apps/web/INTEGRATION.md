# Web ↔ Protocol Integration Plan

**Status:** Approved 2026-04-23. Drives milestones M-INT.1 through M-INT.8.
**Scope:** Next.js frontend in `apps/web/` ↔ deployed Base-mainnet contracts ↔ demo-agents backend on Fly.io.
**Related:** [ADR-0006](../../docs/adr/0006-web-integration-topology.md) (to be written) formalizes the architectural decisions below.

---

## Three-layer topology

```
┌───────────────────────────────┐
│   Browser (Cloudflare Pages)   │ ←┐
│   Next.js · wagmi · viem       │  │
└───────────────┬───────────────┘  │
                │                   │ (3) events via viem.watchContractEvent
                │ (1) wallet        │ (4) writes via useWriteContract + permit
                │     ConnectKit    │
                ↓                   │
┌───────────────────────────────┐  │
│  Orchestrator backend (Fly.io) │──┘
│  3 Docker services: orches-    │
│  trator · summarizer · trans.  │
└───────────────┬───────────────┘
                │ (2) HTTP + SSE stream
                ↓
┌───────────────────────────────┐
│   Base mainnet                 │
│   AgentRegistry · TaskEscrow   │
│   0x5e95…c661 · 0x12ae…3e1e    │
│   USDC · EAS (planned)         │
└───────────────────────────────┘
```

Four integration points:

1. **Wallet → Frontend** — wagmi + ConnectKit provides user EOA.
2. **Frontend → Orchestrator (HTTP/SSE)** — demo mode with server-sent event stream of task lifecycle.
3. **Frontend → Base RPC (read)** — live tx stream and contract state via `viem.watchContractEvent` directly from browser.
4. **Frontend → Base RPC (write)** — `createTask` / `approvePayment` through wagmi `useWriteContract` with EIP-2612 permit.

## Critical architectural decisions

**RPC provider + key protection.** Public Base RPC works for low traffic but rate-limits fast. Production uses Alchemy/QuickNode. Key is proxied through a Cloudflare Worker (`/api/rpc`) — never shipped to the client bundle.

**Custody model on demo page.** Two modes:
- **Watch live** (default, no wallet) — orchestrator pays from a funded sponsor wallet; frontend only watches SSE stream. Anti-abuse: 3 runs/IP/day via Cloudflare D1 counter. Budget: $20–50 USDC topup; auto-pause at 80% via `AgentRegistry.pause()`.
- **Try with wallet** (opt-in) — BYO-wallet. User signs permit and `createTask` themselves. No sponsor spend, no rate limits beyond their own balance.

**Indexer vs direct event-watch.** For v2.0 we use direct client-side `watchContractEvent`. When event volume grows (>100/min), add a backend indexer (Ponder, Ось A7).

**SSE vs WebSocket for demo stream.** SSE — one-way server→client over HTTP/2, works through Cloudflare, no stateful connection state. For task-lifecycle progress SSE is ideal. WebSocket only if bidirectional need emerges.

## Milestones

### M-INT.1 — Scaffolding (1 day)
- `apps/web/` — Next.js 15 App Router, TypeScript strict, Tailwind v4.
- `tokens.css` imported into `globals.css`; tokens mapped in `tailwind.config.ts` (extended colors/spacing/easings).
- Deps: `wagmi`, `viem`, `connectkit`, `@tanstack/react-query`, `posthog-js`, `@sentry/nextjs`.
- Chain config: `chains/base.ts` with mainnet addresses, USDC, EAS, CreateX.
- Layout shell: nav + footer, live-pill component, `.sweep` gradient utility.

### M-INT.2 — Read-only on-chain (2 days)
- Contract hooks: `useAgentRegistry()`, `useTaskEscrow()` over `useReadContract`.
- `useLiveTxStream({ limit: 5 })` — subscribe to `TaskCreated/Accepted/Completed/Paid` via `watchContractEvent`, with opacity step (0.92→0.82→0.72→0.6) as new rows push older ones down.
- Home page in read-only — full hero + live stream works without any wallet.

### M-INT.3 — Wallet connect (1 day)
- `ConnectKitProvider` with our tokens (purple primary + dark canvas via `customTheme`).
- Wallet modal renders exactly per `design-reference/wallet-modal.txt` (MetaMask / Coinbase Wallet / WalletConnect / Rainbow / Browser wallet).
- Nav displays `0xAddress` + ENS on connect.

### M-INT.4 — Orchestrator backend deploy (1 day)
- `apps/demo-agents/` goes to **Fly.io** (3 services: orchestrator `:3000`, summarizer `:3001`, translator `:3002`).
- Orchestrator gains two endpoints:
  - `POST /api/demo/start` — creates sponsored task, returns `{ taskId, streamUrl }`.
  - `GET /api/demo/stream/:taskId` — SSE stream of task-lifecycle events.
- Each service has a funded key for its role, stored in Fly secrets.
- Health-checks + restart policy.

### M-INT.5 — Demo Watch live mode (2 days)
- Frontend: `/demo` page layout per `design-reference/demo.txt`.
- Watch-live toggle → `POST /api/demo/start` → receives `taskId` → subscribes to `/stream/:taskId` SSE.
- SSE event types: `task_created`, `task_accepted`, `task_completed`, `task_paid`. Frontend updates `StepTracker` and `EventLog`.
- After `task_paid` for both sub-tasks → `ResultPanel` fade-in with summary/translation/gas/USDC/total-time.

### M-INT.6 — Demo Try with wallet mode (2 days)
- Toggle switches to "Try with wallet".
- Requires Connect Wallet first.
- Frontend generates permit via `signTypedData` (viem EIP-712 helpers for USDC), passes to `createTask` via `useWriteContract`.
- Optional: batch via EIP-5792 `wallet_sendCalls` if the connected wallet supports it — compresses 4 signatures to 2.
- Instead of SSE: watch events on-chain via `watchContractEvent` (user's wallet, user's txs).

### M-INT.7 — Anti-abuse + custody safety (1 day)
- Cloudflare Worker rate limiter: 3 Watch-live requests/IP/day via D1 counter.
- Orchestrator balance-check: if sponsor balance < $5 USDC → reject new tasks with HTTP 503.
- Logging to Cloudflare Logs for audit.

### M-INT.8 — Polish + deploy (1 day)
- Preview + prod envs on Cloudflare Pages.
- PostHog events: `demo_started`, `task_completed`, `wallet_connected`, `try_with_wallet_converted`.
- Sentry error tracking on client and orchestrator.
- Smoke-test full flow on prod URL.

**Total: 10–12 days solo.**

## Data-flow examples

### Scenario 1 — Visitor without wallet clicks "Run demo" (Watch live)

1. Browser → `POST https://api.sage.xyz/demo/start` (Fly.io).
2. Orchestrator: signs permit with its funded key → calls `TaskEscrow.createTask(summarizer, deadline, amount, brief, permit)`. Tx submitted.
3. Orchestrator returns `{ taskId: "42", streamUrl: "/stream/42" }` in HTTP response.
4. Browser opens `EventSource` to `/stream/42`. Orchestrator pushes `{type: "task_created", txHash: "0x..."}`.
5. Summarizer (subscribed to `TaskCreated`) calls `acceptTask(42)`. Browser receives SSE `{type: "task_accepted"}`.
6. Summarizer runs work, submits `completeTask(42, "ipfs://...")`. SSE: `task_completed`.
7. Orchestrator auto-calls `approvePayment(42)`. SSE: `task_paid`.
8. Orchestrator creates task #43 for Translator. Repeats 4–7.
9. Stream closes with `done` + full result payload.
10. Browser renders `ResultPanel`.

### Scenario 2 — Developer with wallet clicks "Try with wallet"

1. Browser: `signTypedData` for permit (single signature, 0.002 USDC to TaskEscrow).
2. Browser: `writeContract(createTask, [summarizer, deadline, 0.001, brief, permit])`. User confirms. Tx broadcast.
3. Browser: `waitForTransactionReceipt`. Step 01 complete.
4. Summarizer picks up event → accepts → summarizes → completes. Browser reads via `watchContractEvent`.
5. Browser: `writeContract(approvePayment, [taskId])`. User confirms. Step 04 complete.
6. Repeat for Translator (2 more signatures).
7. Result: tx hashes on Basescan + final text from `event.resultUri`.

Worst case: 4 signatures. With batching (EIP-5792): 2.

## Stack

```
Frontend (apps/web):
  next@15                       App Router + Server Components
  react@19                      concurrent rendering
  typescript@5                  strict
  tailwindcss@4                 @theme-based tokens
  wagmi@2                       wallet + chain state
  viem@2                        EVM client
  connectkit@1                  wallet modal
  @tanstack/react-query@5       cache
  posthog-js                    analytics
  @sentry/nextjs                error tracking

Backend (apps/demo-agents):
  viem@2
  zod@3                         env validation
  sse (native Node stream)
  openai@4

Deploy:
  Cloudflare Pages              frontend + Cloudflare Worker for RPC proxy
  Fly.io                        3× demo-agents containers
```

## Security checklist

- [ ] RPC key hidden behind Cloudflare Worker proxy. Frontend hits `https://api.sage.xyz/rpc`.
- [ ] `OPENAI_API_KEY` only in orchestrator backend (Fly secrets).
- [ ] Orchestrator funded-key only in Fly secrets — never in repo or `.env.example`.
- [ ] CORS allow-list: `https://sage.xyz` + preview `*.pages.dev` only.
- [ ] Rate limit Watch-live: 3 requests/IP/day via Cloudflare D1.
- [ ] HTTPS everywhere (Cloudflare-enforced).
- [ ] User private keys never leave the wallet — all signatures local.
- [ ] CSP: `default-src 'self' https://api.sage.xyz https://mainnet.base.org`.

## Resolved decisions (see ADR-0006)

All four open questions are closed in [ADR-0006](../../docs/adr/0006-web-integration-topology.md):

1. **RPC provider:** Alchemy (free tier, 300M CU/month). Key protected via Cloudflare Worker proxy at `/api/rpc`.
2. **Hosting:** Cloudflare Pages (frontend, $0) + Fly.io (backend, ~$0–10/mo) + $20 USDC sponsor wallet for Watch-live demo.
3. **Render mode:** Static export to Cloudflare Pages. Dynamic behavior via client components.
4. **Analytics:** PostHog (event-based, 1M events/month free). GDPR-compliant cookie banner required. Events: `pageview`, `demo_started`, `task_created`, `task_completed`, `wallet_connected`, `try_with_wallet_*`, `error_occurred`.

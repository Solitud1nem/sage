# @sage/web

Sage landing + interactive demo. **Next.js 15 App Router**, static export, deployed to **Cloudflare Pages** per [ADR-0006](../../docs/adr/0006-web-integration-topology.md).

## Status

M-INT.1 scaffold complete. Renders Home hero against real Base-mainnet contract addresses (read-only).

Upcoming milestones tracked in [`INTEGRATION.md`](./INTEGRATION.md):

- M-INT.2 — read-only on-chain (live tx stream, agent registry reads)
- M-INT.3 — wallet connect via ConnectKit
- M-INT.4 — orchestrator backend deploy
- M-INT.5 — demo Watch live mode (SSE)
- M-INT.6 — demo Try with wallet mode (BYO-wallet)
- M-INT.7 — anti-abuse + sponsor-wallet safety
- M-INT.8 — polish + Cloudflare Pages deploy

## Quick start

```bash
# From repo root
pnpm install
pnpm --filter @sage/web dev
```

Then http://localhost:3000 in browser.

## Env

Copy `.env.example` to `.env.local` and fill values for:

- `NEXT_PUBLIC_RPC_URL` — Alchemy Base RPC (dev can use public `https://mainnet.base.org`).
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` — from [WalletConnect Cloud](https://cloud.walletconnect.com).
- `NEXT_PUBLIC_ORCHESTRATOR_URL` — demo-agents orchestrator URL (default `http://localhost:3000` for local).
- `NEXT_PUBLIC_POSTHOG_KEY` + `NEXT_PUBLIC_POSTHOG_HOST` — enable analytics (off until consent).
- `NEXT_PUBLIC_SENTRY_DSN` — optional error tracking.

## Layout

```
apps/web/
├── app/
│   ├── layout.tsx          root layout + Providers
│   ├── page.tsx            Home (Hero → lifecycle → integrate → live → demo CTA)
│   ├── demo/page.tsx       Interactive demo
│   ├── providers.tsx       wagmi + react-query + ConnectKit
│   └── globals.css         Tailwind v4 + tokens.css import
├── components/
│   ├── nav.tsx, footer.tsx, status-pill.tsx, gradient-text.tsx
│   └── home/
│       └── hero.tsx        (more sections added in M-INT.2)
├── chains/base.ts          Chain config (mainnet + Sepolia addresses)
├── lib/
│   ├── wagmi.ts            wagmi config with ConnectKit wallets
│   └── posthog.ts          lazy-init after consent
├── styles/tokens.css       locked design tokens (do not edit without ADR)
└── design-reference/       spec snapshots from Claude Design
```

## Conventions

- **tokens.css is canonical.** Do not hardcode colors / spacing / radii — use Tailwind utilities (`bg-canvas`, `text-cyan`, `rounded-md` etc) or CSS variables (`var(--purple)`).
- **Geist + Geist Mono** via `next/font/google` — loaded in `layout.tsx`, exposed as `--font-geist-sans` / `--font-geist-mono`.
- **Sentence case everywhere.** See `AGENTS.md`.
- **No ethers.** viem-only (ADR-0005).
- **Static export.** `app/layout.tsx` and pages are static; interactivity via client components (`'use client'`). No server-side rendering in v2.0.
- **CSP-friendly.** Inline styles used sparingly for gradient fills that Tailwind can't express; no inline scripts.

## Deploy (target)

Cloudflare Pages with:
- Build command: `pnpm --filter @sage/web build`
- Output directory: `apps/web/out`
- Node version: 20+
- Env vars: see above.

Worker at `/api/rpc` proxies to Alchemy (configured in Cloudflare dashboard, key stored as secret). Source in a future `apps/web/functions/api/rpc.ts`.

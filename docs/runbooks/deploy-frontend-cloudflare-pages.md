# Runbook: Deploy `apps/web` to Cloudflare Pages

Per [ADR-0006](../adr/0006-web-integration-topology.md). Static Next.js export; dynamic behavior lives in client components.

## Prerequisites

- Cloudflare account + API token (`Account > API Tokens > Create Token` with **"Edit Cloudflare Workers"** + **"Pages: Edit"** scopes on the target account).
- `wrangler` CLI authenticated: `wrangler login`.
- Worker gateway already deployed per [`deploy-cloudflare-worker.md`](./deploy-cloudflare-worker.md) — you need its public URL for `NEXT_PUBLIC_ORCHESTRATOR_URL` + `NEXT_PUBLIC_RPC_URL`.
- Orchestrator deployed to Fly.io per [`deploy-demo-agents-flyio.md`](./deploy-demo-agents-flyio.md).

## 1. Create the Pages project

Either in the Cloudflare dashboard (`Pages → Create project → Direct upload`), or via CLI once the repo is pushed:

```bash
cd apps/web
# First build locally to verify it succeeds.
pnpm --filter @sage/web build
# Push to Cloudflare (creates the project on first run).
wrangler pages deploy out --project-name sage-protocol --branch main
```

Note the production URL — typically `https://sage-protocol.pages.dev` plus whatever custom domain you wire up.

> **Heads up:** Cloudflare's Direct Upload pipeline sometimes leaves the `queued` stage in `active` on a brand-new project, which silently blocks DNS aliasing for `<project>.pages.dev` (you can hit the deployment-specific URL but not the project URL — `DNS_PROBE_FINISHED_NXDOMAIN`). Workaround: delete the project (`DELETE /pages/projects/<name>`) and recreate it fresh, then re-run `wrangler pages deploy`. The second attempt aliases correctly.

## 2. Environment variables

Set these under `Workers & Pages → sage-protocol → Settings → Environment variables`. Distinguish **Production** from **Preview** if you want a staging env.

| Variable | Type | Value | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | plaintext | `https://sage.xyz` | No trailing slash. Used by `metadataBase`, sitemap, robots, OG. |
| `NEXT_PUBLIC_GITHUB_URL` | plaintext | `https://github.com/<org>/sage` | Central GitHub link. Used in nav + footer + `@sage/*` package links. |
| `NEXT_PUBLIC_RPC_URL` | plaintext | `https://api.sage.xyz/api/rpc` | Worker gateway RPC proxy. Hides Alchemy key. |
| `NEXT_PUBLIC_ORCHESTRATOR_URL` | plaintext | `https://api.sage.xyz` | Worker gateway — `/api/demo/*` passes through to Fly.io. |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | secret | from WalletConnect Cloud | Required for WalletConnect modal. Omit if you don't need WC. |
| `NEXT_PUBLIC_POSTHOG_KEY` | secret | from PostHog project | Omit for no-analytics build. |
| `NEXT_PUBLIC_POSTHOG_HOST` | plaintext | `https://us.i.posthog.com` | Override for EU region if needed. |
| `NEXT_PUBLIC_SENTRY_DSN` | secret | from Sentry project | Omit for no-Sentry build. |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | plaintext | `production` / `preview` | — |

## 3. Custom domain

`Pages → sage-protocol → Custom domains → Add`.

- `sage.xyz` — production.
- `www.sage.xyz` → redirect to apex.

The DNS will auto-provision; verify HTTPS cert via Cloudflare dashboard (~5 min).

Also add the **Worker route** in the Worker's own page: `api.sage.xyz/*` → `sage-gateway`.

## 4. GitHub Actions automation

The repo ships `.github/workflows/deploy-web.yml`. On push to `main` it:

1. Installs deps.
2. Builds `@sage/core` + `@sage/adapter-evm`.
3. Builds `@sage/web` (Next.js static export).
4. Uploads `apps/web/out/` to Cloudflare Pages.

**Repo secrets** (`Settings → Secrets → Actions`):

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `NEXT_PUBLIC_POSTHOG_KEY`
- `NEXT_PUBLIC_SENTRY_DSN`

**Repo variables** (`Settings → Variables → Actions`):

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_GITHUB_URL`
- `NEXT_PUBLIC_RPC_URL`
- `NEXT_PUBLIC_ORCHESTRATOR_URL`
- `NEXT_PUBLIC_POSTHOG_HOST`
- `CLOUDFLARE_PAGES_PROJECT` (optional; defaults to `sage-protocol`)

## 5. Verify

```bash
# Smoke-check the landing
curl -I https://sage.xyz
# → HTTP/2 200

# robots + sitemap
curl https://sage.xyz/robots.txt
curl https://sage.xyz/sitemap.xml

# OG image (should be a 1200×630 PNG)
curl -I https://sage.xyz/opengraph-image

# From a browser: hit /demo, toggle between Watch live and Try with wallet,
# confirm a run finishes end-to-end.
```

## 6. Rollback

Cloudflare keeps every deployment. In the dashboard: `Pages → sage-protocol → Deployments → <older> → Rollback to this deployment`. Takes ~30s.

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Build fails with "Module not found @/lib/..." | `transpilePackages` missing a workspace pkg | Add the pkg name to `next.config.ts#transpilePackages` |
| `NEXT_PUBLIC_RPC_URL` ignored, 429 rate limits from `mainnet.base.org` | env var was set for Preview only, not Production | Ensure Production env has the Worker URL |
| OG image shows blank / 500 | `ImageResponse` needs Edge runtime support — check Cloudflare Pages compatibility; current Next.js + CF Pages builds this at build time as a static PNG | Confirm `dynamic = 'force-static'` in `app/opengraph-image.tsx` |
| Cookie banner loops every page | `localStorage` blocked (incognito, privacy extension) | Expected behavior; banner silently skips init |
| Sentry "replaysSessionSampleRate is deprecated" warning | Sentry SDK version mismatch | Pin `@sentry/nextjs` version in `package.json` |

# Foreign agent template

A forkable, self-contained Sage worker agent. Run it on your own infrastructure
with your own wallet; it registers itself in Sage's on-chain `AgentRegistryV2`,
then earns USDC by executing tasks the Sage classifier routes to it. It talks
only to the `@sage/adapter-evm` SDK and the deployed contracts — there is
nothing Sage-team-specific to depend on.

## How it works

1. **Register (once, on boot).** Announces your `(capability, price)` in
   `AgentRegistryV2`. The Sage classifier picks the **cheapest active agent** for
   a capability — so to get chosen ahead of the incumbents, undercut their price.
2. **Watch.** Polls `TaskEscrow.nextTaskId` (~15s) for tasks whose executor is
   your address.
3. **Execute.** Accepts the task, runs `src/handler.ts` (the part you write),
   and submits the result on-chain.
4. **Get paid.** When the client approves (or a dispute resolves in your favor),
   the escrowed USDC is released to your wallet.

## Quick start

This template resolves `@sage/*` through the monorepo workspace, so fork/clone
the whole repo (not just this folder) and install from the root:

```bash
git clone https://github.com/Solitud1nem/sage.git
cd sage && pnpm install            # resolves @sage/core + @sage/adapter-evm

cd templates/foreign-agent
cp .env.example .env               # then fill in PRIVATE_KEY, CAPABILITY, PRICE_UNITS…
pnpm dev                           # or: pnpm build && pnpm start
```

Your wallet needs a **small amount of ETH** on the target chain for gas
(`registerAgent` once, then `acceptTask` + `completeTask` per job). It does **not**
need USDC — that's what you earn.

## What to change

- **`src/handler.ts`** — the only file with your logic. `execute({ spec, material })`
  receives the task instruction and its material (the payload, or an upstream
  step's output per ADR-0018) and returns the result string. The shipped example
  calls gpt-4o-mini when `OPENAI_API_KEY` is set, else echoes — replace it.
- **`.env`** — `CAPABILITY` must be a name the classifier resolves (today:
  `summarize`, `translate`, `sentiment-classify`, `vision-describe`). `PRICE_UNITS`
  is USDC base units (6 decimals; `1000` = 0.001 USDC).

## Safety: the runtime serves anything routed to your address

The classifier picks the cheapest active agent — but `createTask` is
permissionless, so **anyone** can route a task to your address directly, with
whatever economics they choose (1-unit pay, a near-past deadline, a megabyte
payload). The runtime guards against this before spending gas, via env knobs
(see `.env.example`):

- `MIN_TASK_UNITS` (default = `PRICE_UNITS`) — refuse underpaying tasks.
- `MIN_DEADLINE_MARGIN_S` (default 120) — refuse tasks you can't finish in time.
- `MAX_MATERIAL_CHARS` (default 100000) — truncate oversized payloads before
  your handler runs.
- `BOOT_SCAN_BACK` (default 200) — on restart, pick up tasks created while you
  were offline instead of black-holing them.
- `HANDLER_RETRIES` (default 2) — retry the handler on a transient failure
  before giving up.

Tune these for your agent's economics before going live.

## Safety: fetching URLs from a task (SSRF)

If your capability fetches a URL that came from the task — a brief, an
LLM-chosen link, a citation — that URL is **untrusted input**. Calling `fetch`
on it directly lets a caller reach your host's private network or its cloud
**metadata endpoint** (`http://169.254.169.254/…`, which leaks instance
credentials on most clouds). This is a conformance requirement (ADR-0023
§Layer 4), not a suggestion: **route every task-derived fetch through an
SSRF-guarded helper.** The reference implementation lives at
`apps/demo-agents/src/worker/net.ts` (`fetchPublicPage`) — copy it or mirror its
checks:

1. **https only** — reject `http:`, `file:`, anything that can downgrade.
2. **Block private hostnames/literals** — `localhost`, `*.internal`, `*.local`,
   RFC-1918, `127/8`, `169.254/16`, IPv6 literals.
3. **Resolve and check the IP** — DNS-resolve the host and reject if any address
   is private / loopback / link-local / metadata (catches a public name whose
   A-record points inward).
4. **Follow redirects yourself and re-validate every hop** — native `fetch`
   chases 3xx silently, so a trusted URL can `302` straight to the metadata IP.
5. **Cap time and response size; restrict content-type.**

Steps 3–4 are the ones a naive guard misses. Don't ship a URL-fetching
capability without them.

## Deploying your fork

`fly.toml` ships configured for the Sage **reference** instance. Before you
deploy your own, edit:

- `app` — your Fly app name (not `sage-foreign-agent`).
- `RPC_URL` — your own/proxied Base RPC (the default public node is best-effort).
- `ENDPOINT` env — a URL describing *your* agent; the default `example.com`
  placeholder gets written into the on-chain registry if you skip it.

The Dockerfile builds from the **repo root** (it needs `packages/*`), so deploy
with `fly deploy -c templates/foreign-agent/fly.toml` from the monorepo root.

## Notes

- This template lives in the Sage monorepo and resolves `@sage/*` via the
  workspace. Once the `@sage/*` packages are published to npm, a standalone fork
  will `npm install @sage/core @sage/adapter-evm` instead (publication is tracked
  in the repo backlog).
- Registration is idempotent: on restart it checks `getAgent` and skips if your
  address already advertises the capability.
- Trust posture: tasks settle through Sage's `TaskEscrow`; disputes are resolved
  by the Sage council/arbiter (see ADR-0017 / ADR-0019). You are trusting that
  arbitration layer, not the Sage team with custody — funds sit in escrow.

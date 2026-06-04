# Using the Sage Demo — A Walkthrough

A guide for anyone who wants to understand what Sage does by stepping through the live demo on Arc testnet. End-to-end it takes about 5 minutes. No wallet, no funds, no installation required for the planning portion of the flow — the planner is reachable directly in the browser.

---

## What Sage is

Sage is a task-escrow protocol for AI agents. A user submits a request; Sage decides whether it's a single task or needs to be broken into several; it shows the user the plan and the cost before spending anything; the user can edit any step or approve as-is; then each sub-task runs as its own on-chain escrow on the user's chosen chain. The agent only gets paid when its result lands. Every intermediate output is visible to the user inside the UI as the work runs, not after a black-box pipeline has finished.

The demo at `https://sage-protocol.pages.dev/demo/composite` is the public surface of this protocol. It runs on Base mainnet (real USDC) and Arc testnet (testnet USDC). This guide walks you through the Arc testnet planning flow.

## What you'll do

You'll open the demo, submit a multi-step prompt, watch Sage decompose it into sub-tasks, inspect each sub-task's classification, cost estimate, and intended off-chain envelope, and optionally edit one of the steps. The execution stage — funding the escrows and watching agents settle on-chain — is demonstrated in the accompanying video and described in this guide, since it requires signing a permit from a wallet that holds testnet USDC. The planning surface itself is fully exercisable in the browser without any setup.

---

## Before you start

You need:

- **A modern browser.** Chrome, Brave, Firefox, Safari — any current release works.
- **About 5 minutes.** The planner returns in 3–5 seconds; reading the plan card is the bulk of the time.

You do **not** need a wallet, ETH, USDC, an account, or any local setup to use the planning part of the demo.

---

## Step 1 — Open the demo and submit a prompt

1. Go to `https://sage-protocol.pages.dev/demo/composite` in your browser.
2. Confirm the chain selector in the top-right reads **Arc testnet**. If it doesn't, click it and switch.
3. Paste the following composite prompt into the prompt field:

```
Plan a 5-day trip to Tokyo for two travelers in October. I want a recommended neighborhood to stay in, a day-by-day itinerary with top attractions, restaurant suggestions for each day, and a rough budget in USD.
```

4. Click **Plan**.

Sage's orchestrator classifies the prompt and returns a structured plan. This step is off-chain and takes 3–5 seconds. No funds move; no wallet is involved.

---

## Step 2 — Read the plan

A plan card appears with several sub-tasks (typically three or four for this prompt — for example: neighborhood research → daily itinerary → restaurant recommendations → budget breakdown). For each sub-task you'll see:

- **A label** describing what that step does in plain language.
- **Two badges**:
  - *Stakes* (low / high) — Sage's assessment of how reversible or sensitive the action is. Money-moving operations get flagged "high stakes" and require additional review before execution.
  - *Decomposability* (composable / atomic) — whether the step could be broken down further, or is already at the leaf level.
- **An executor** — the agent address that will run this sub-task on-chain.
- **A cost estimate** in USDC.
- **A specUri preview** — the off-chain instruction envelope this sub-task will receive when it runs.

Read through each card. You can see exactly what Sage intends to do and what it will cost, in advance.

---

## Step 3 — Edit a sub-task (optional, but try it)

Click any sub-task to expand it. The fields become editable. You can:

- Change parameters in the description (e.g. "5 days" → "4 days", or add a constraint like "prefer walking-distance attractions").
- Reassign the executor to a different agent address.
- Remove the sub-task entirely if you don't want it.

Make a small edit — even just shortening the trip to four days — and save. The card updates with your changes. This is the central proof that Sage's plan is mutable, not a take-it-or-leave-it artifact.

If you don't want to edit anything, skip this step.

---

## Step 4 — How execution proceeds

The execution stage is where on-chain settlement happens. The accompanying video shows it end-to-end; this section describes what would occur after you click **Approve & execute** in a wallet-enabled session.

A single on-chain transaction funds every sub-task simultaneously — there's no separate "approve USDC" step, because Sage uses an EIP-2612 permit signature to authorize the orchestrator. The escrows are funded all at once.

From that point, the sub-task cards transition through statuses:

- **Pending** — funded, waiting for the agent to claim.
- **In progress** — agent is executing off-chain.
- **Completed** — result is on-chain; payment has been released to the agent.

As each card hits "completed," it expands inline to reveal its output. The next sub-task in the chain reads that output as its input. You can see the handoff happening in the UI: the itinerary card visibly references the neighborhood from the first card; the restaurant card references the itinerary days; the budget card references all three.

Total settlement time across all sub-tasks is usually 30–60 seconds on Arc testnet. Each completed card's tx hash links to `testnet.arcscan.app` for on-chain verification. When the last sub-task completes, a result drawer at the bottom of the page consolidates the structured output.

---

## Prompts worth trying

The Tokyo prompt is the canonical one because its decomposition is intuitive. But Sage is meant to handle a wide range of inputs. Some others to feed the planner after your first run:

**A different complex task:**

```
Help me write a launch announcement for a new SaaS product. I need a one-paragraph summary, a tweet thread of five tweets, and a short email to send to existing customers.
```

This should decompose into three named outputs targeted at different audiences.

**A simple task** (to confirm Sage doesn't over-decompose):

```
Translate "the early bird catches the worm" into Japanese, French, and Spanish.
```

This should come back as a single sub-task or one-per-language — Sage doesn't fabricate sub-steps for things that don't need them.

**A high-stakes task** (to see the guard):

```
Send 0.5 USDC to 0x742d35Cc6634C0532925a3b844Bc9e7595f0fAa7
```

Sage will flag this as high-stakes, leave the executor field empty, and disable the Approve button until a human assigns an executor explicitly. This is the three-layer guard you can read more about in the source.

---

## Understanding what you're seeing

A few details that matter once you've inspected a plan and want to look more carefully.

**The two-axis classification.** Every sub-task gets tagged on two independent dimensions: decomposability (could this be split further?) and stakes (how careful do we need to be?). The combination determines what UI affordances are available — high-stakes sub-tasks require human executor assignment, atomic sub-tasks can't be split further, and so on.

**Why a single signature funds everything.** Sage uses EIP-2612 USDC permit. One signature authorizes the orchestrator to transfer the total escrow amount for all sub-tasks at once. There's no separate "approve USDC" step before the funding transaction, which removes a common Web3 friction point.

**Why intermediate outputs are visible.** Each sub-task writes its output to an off-chain envelope (the `specUri`), referenced by hash from the on-chain task record. The UI fetches and displays the envelope as soon as the sub-task completes. You're not waiting for a final summarizer to assemble everything — you see real intermediate work as it lands.

**Why on-chain at all.** The accountability isn't UI-level. The contract holds the escrow and only releases it when an agent submits a result. If an agent goes silent, the escrow expires after a deadline and the user can reclaim funds. The chain is the enforcement layer, not the presentation layer.

---

## Troubleshooting

**The chain selector is greyed out.** This usually means the page hasn't finished loading its chain registry. Wait 3 seconds and try again. If it persists, hard-refresh the page (`Cmd+Shift+R` or `Ctrl+Shift+R`).

**The plan card says "classifier error" or similar.** The orchestrator backend may be cold-starting. Wait 30 seconds and click Plan again. If it persists for several minutes, the backend is genuinely down — try again later.

**The plan card comes back but with very few sub-tasks for a clearly composite prompt.** The classifier occasionally returns a coarser decomposition than expected. Resubmitting usually produces a tighter plan; alternatively, edit the prompt to be more explicit about the deliverables you want.

**You see an error mentioning the orchestrator or Fly.** The backend lives on Fly.io and rarely cold-starts; if you hit one of those moments, wait 30 seconds and retry.

---

## Going deeper

If you've stepped through the demo and want to understand what's underneath:

- **Source code** lives in the public repo (link from `https://sage-protocol.pages.dev`).
- **Architecture decisions** are recorded in `docs/adr/` — the most relevant for this demo are ADR-0007 (observable decomposition pattern) and ADR-0015 plus ADR-0016 (the Arc deployment story).
- **Live docs** at `https://sage-protocol.pages.dev/docs` cover the SDK, contracts, security model, and integration patterns.
- **Both chains in parallel.** The same demo runs on Base mainnet at the same URL — the planning surface is identical; the difference is just which chain the execution stage settles on.

---

## Quick reference

| Thing | Where |
|-------|-------|
| Demo URL | `https://sage-protocol.pages.dev/demo/composite` |
| Live docs | `https://sage-protocol.pages.dev/docs` |
| Arc testnet RPC | `https://rpc.testnet.arc.network` |
| Arc testnet chain ID | `5042002` |
| Arc testnet explorer | `https://testnet.arcscan.app` |
| Arc testnet TaskEscrow | `0xA9e6Dc31F21149868C0fd43C83038C74cC8Ffcdb` |
| Arc testnet AgentRegistry | `0xD100d7CE4f610dDb59C276AF293aA79F9Fcff936` |

That's everything you need to step through the planning surface end-to-end. If something in this guide is wrong or out of date, the issue tracker on the public repo is the right place to flag it.

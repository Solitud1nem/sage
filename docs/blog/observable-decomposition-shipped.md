# Observable decomposition, shipped

*2026-05-20 · field notes from the Sage M10 build*

In April we wrote up a pattern we wanted to try: composite agent work surfaced as a structured, on-chain artifact rather than as a transient stream of tokens inside an LLM context window. We called it *observable decomposition* and accepted it as ADR-0007 in May, before any code existed. Over the following two weeks we shipped it.

It lives at `sage-protocol.pages.dev/demo/composite`. You type a brief — `research the top 3 stablecoin yield products on Base and write a comparative report`, or `plan a Tokyo trip`, or just `translate this paragraph` — and a parent agent classifies it, surfaces a structured plan, lets you edit or cancel before any money moves, then settles each sub-task as its own on-chain `TaskEscrow` record on Base mainnet. A live graph fills in as the work progresses. Per-step results are inspectable. The total cost is a few cents.

This post is not the design doc. The design lives in [`observable-decomposition.md`](../research/observable-decomposition.md) and [`classification-trigger-design.md`](../research/classification-trigger-design.md), with the formal position in [ADR-0008](../adr/0008-sage-angle-position.md). What we want to record here is what happened when we tried to make the pattern real — what surprised us, what almost didn't work, and what we now know we don't know.

## What we built

The mechanics, briefly:

- A classifier (`apps/demo-agents/src/parent/classify.ts`) takes the brief, calls gpt-4o-mini through structured-output function-calling, and returns a `ClassificationResult` — decomposability (one-shot vs. composite), stakes (low vs. high), confidence per axis, a proposed plan as an array of sub-tasks, the reasoning, and a signal trace.
- A deterministic heuristic cross-check (`heuristic.ts`) scans the brief for composite verbs and irreversibility cues and halves the LLM's self-reported confidence when surface features disagree with its assessment.
- A plan-runner (`plan-runner.ts`) topologically sorts the sub-tasks and executes them one at a time. Each sub-task becomes a `createTask` call to our existing `TaskEscrow` contract; the spec is encoded as `data:application/json,{parent,spec}` so off-chain readers can reconstruct the parent → child graph from on-chain events.
- The orchestrator gets three new endpoints (`/api/demo/composite/{classify,execute,stream/:runId}`). The existing three-mode demo (`pipeline | sentiment | vision`) is untouched.
- The frontend (`apps/web/app/demo/composite/`) renders the plan as a card with approve/edit/cancel actions, then transitions to a live DAG via `@xyflow/react` as sub-tasks progress. Each node opens a drawer with its on-chain task id, executor address, result text, and tx hashes linked to Basescan.

The full surface is ~6,000 lines of additive code across `@sage/core`, `@sage/demo-agents`, and `@sage/web`. We did not touch the contracts. We did not redeploy any existing infrastructure (the four worker agents on Fly.io ran unchanged for most of the build). The pattern composes on top of primitives we already had.

## What surprised us

**The executor address was missing.** Our design assumed the classifier would emit a `type` (a capability tag like `summarize-text` or `translate-text`) and an `executor_address` (the concrete worker that handles that capability). In practice, neither the mock templates we wrote nor the real LLM populated `executor_address`. The LLM didn't know our worker catalogue; we hadn't put one in its prompt. The mock templates were written under the assumption that some downstream step would resolve type → address.

That downstream step didn't exist. The plan-runner reasonably refused to spawn a `TaskEscrow` with no executor, and the first end-to-end smoke produced `subtask #1 has no executor_address`. We added a stem-based resolver in the frontend — `translat` → translator, `summari/compar/research/analy/write` → summarizer, and so on. It works. But it raises a question we didn't anticipate: *where does the type-to-executor mapping live?* Client-side stem matching is fine for four workers; it falls over at forty. The right shape is probably a worker manifest the classifier validates against. We have not built it.

**The workers were single-mode by design.** The four existing agents — summarizer, translator, vision, sentiment — were built for the three-mode demo, where `specUri` is *content*: an article to summarize, a paragraph to translate, an image URL to describe. The composite flow generates `specUri = data:application/json,{parent,spec}` where `spec` is *instruction*: "research flights to Tokyo for a 7-day trip." When the user clicked Approve and watched the graph fill, the results came back in beautifully formed sentences — *summarising the instruction*: "The task is to research and compare flights to Tokyo for a 7-day trip."

The summarizer was honestly doing its job. We had told it to summarize text; we had handed it text. The text just happened to be an instruction.

We bent our own "do not modify existing workers" rule for one file and made the summarizer dual-mode: detect the envelope, extract the inner spec, switch the system prompt from "summarize this text" to "execute this task and return the deliverable directly." It worked. The same fix is pending for the other three workers and is the largest remaining piece of M10.

The general lesson: **prompts are a contract surface**. Workers built for one shape of input fail silently — politely, even — when handed another. A worker manifest that declares input format alongside output format would have caught this at design time. We did not have one.

**Stakes calibration is harder than decomposability.** Our two-axis classification frequently nails decomposability: research-and-compare briefs flag as composite, single-verb translation flags as one-shot, the heuristic catches the obvious composite cues. Stakes is messier. The LLM flags `research the top 5 stablecoin protocols on Base` as `high stakes` because the subject domain mentions money, even though the brief contains no irreversibility verbs and no dollar value to transfer. The same happens for `plan a Tokyo trip` (high stakes — flights, hotels), even though our brief contains no booking action.

The heuristic cross-check halves stakes confidence on irreversibility verbs and dollar regexes; it has no de-escalation rule. The result is a system that gates pure research with high-stakes ceremony — one more click than ideal. This is precisely the "false-positive high-stakes costs one approval" failure mode we accepted in §5 of the trigger design, so it is not a bug. But it is louder than we expected. Override-driven empirical calibration (track plan-card edits, refine the prompt after ~200 runs) is the right next step; we have not started it.

**LLM-emitted types are wilder than expected.** The mock templates used canonical kebab-case capability tags (`translate-text`, `summarize-text`). When the real LLM ran, the types came back as `translation`, `comparison`, `analysis`, `summary` — noun forms, sometimes with adjectives, sometimes hyphenated, sometimes not. Our stem matcher had to be liberal: any substring containing `translat` routes to the translator, `summari` or `compar` or `research` or `analy` to the summarizer. It catches everything we have seen in practice, but it is structurally fragile. A new language, an unusual brief, an LLM with different prompt style — and the matcher silently fails back to "unassigned."

The proper shape is a published capability catalogue the classifier emits from. We did not build that either.

## What didn't work

**Our GitHub Actions deploy pipeline is broken** and we have not fixed it. The `cloudflare/wrangler-action@v3` step invokes `pnpm add wrangler@<version>` at the monorepo root, and pnpm v9 refuses unless `-w` is passed. We added an `.npmrc` toggle to silence the warning, which got us further; the next failure was a missing `CLOUDFLARE_API_TOKEN` secret — past deploys had been working through a different path nobody fully remembered. Manual `wrangler pages deploy apps/web/out` works fine and is what shipped this. The workflow remains as inherited tech debt for a future session.

**Sequential execution is slow.** A five-step plan takes two-and-a-half to three minutes wall-clock — fifteen-second poll intervals (chosen to stay under Cloudflare Workers free-tier limits, per a prior incident) times two-to-three lifecycle transitions per sub-task, in series. Independent sub-tasks could run in parallel for a 3–5× speedup. We chose serial to sidestep sponsor-side nonce races; the safer behaviour first, the faster behaviour later. The right time to optimise is when wait time becomes the actual UX bottleneck. It is not yet.

**There is no aggregate result panel.** Each sub-task's output lives in its own drawer; if you want to see all five results from a Tokyo trip plan you click five times. We documented this as a deferred UX gap and moved on. It is a real gap for a user who wants the deliverable assembled, not displayed.

## What's still open

The annotated open-questions list in [`observable-decomposition.md` §11](../research/observable-decomposition.md#11-open-questions) is the canonical record. The biggest threads:

- Worker dual-mode for translator / sentiment / vision (the summarizer pattern, three more times).
- A capability catalogue the classifier emits from, replacing client-side stem matching.
- Override-driven empirical calibration of stakes confidence, using real plan-card edit data.
- Dispute path UI — the SSE events emit; the prompt that lets the user retry / change executor / cancel is not built.
- Long-term plan storage (we currently rely on on-chain `TaskCreated` envelopes plus in-memory runtime; for "show me my past plans" that is not enough).
- Privacy. Every brief lands public on Base mainnet right now. Fine for research questions; not fine for everything.

None of these is blocking. All of them are work the pattern itself surfaces, not work we postponed because it was hard.

## Closing

The thing the M10 build confirmed is small: the pattern, instantiated, produces a different shape of artifact than the surrounding ecosystem. A user who runs `/demo/composite` and an open Basescan tab can see, transaction by transaction, what the agent decided to do, what each step cost, what each step returned, and how the pieces relate. The plan is not a transcript; it is a structured object with a stable identity. The result is not the agent's last token; it is a graph of paid sub-tasks any third party can reconstruct.

That property is what we have been calling *observable decomposition*. It does not make agent work better in every dimension. It does not make it faster, or cheaper, or more accurate. It makes it **legible** — and we believe legibility is what is missing from most of the agent-payment surface.

If the pattern is right, others will arrive at it. If it is right *and underweighted*, Sage has a small window to be the place it is most carefully done. That is the bet. The angle is on `/demo/composite` and in the ADRs; everything else is execution.

*Comments, corrections, pull requests, and disagreements all welcome at [`github.com/Solitud1nem/sage`](https://github.com/Solitud1nem/sage).*

---

*Reading order if you want the full story: [ADR-0007 — observable decomposition](../adr/0007-observable-decomposition.md), [ADR-0008 — Sage angle / position](../adr/0008-sage-angle-position.md), the [research notebook](../research/observable-decomposition.md), and the [classification trigger design](../research/classification-trigger-design.md). The source for everything in this post is in the May 2026 commits of `github.com/Solitud1nem/sage`.*

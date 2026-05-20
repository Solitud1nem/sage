# M10 acceptance smoke matrix

Five briefs covering the corners of the classifier's decision surface. Run on
`https://sage-protocol.pages.dev/demo/composite` (or local dev). Fills the
M10.4.13 acceptance criterion: "5-brief end-to-end smoke confirms the angle
lives in code, not only in docs."

Each row is one brief. Run sequentially — sponsor wallet (`0x6D8aCa…376d`)
needs ~0.5–1 USDC reserve. Check `/health` between runs to confirm sponsor
balance is healthy.

## How to run a row

1. Open the URL in a fresh tab (incognito ok).
2. Paste the brief verbatim into the input box.
3. Click "Classify brief →". Wait ~5–7s for the real LLM call.
4. Compare the rendered plan-card against the row's **Expected classifier output**.
5. If expected: click "Approve · Execute". Watch the graph fill. Click any
   completed (mint) node to verify the drawer shows a real result, tx hashes,
   and elapsed time.
6. Record actuals in the row's right column. Anything materially different is
   a finding for the next iteration.

## The matrix

| # | Brief | Category | Expected classifier output | Expected execution | Actual (fill in) |
|---|-------|---------|---------------------------|-------------------|------------------|
| 1 | `translate this paragraph` | One-shot trivial | `decomposability: one-shot`, `stakes: low`, `confidence_d ≈ 0.92`, `confidence_s ≈ 0.95`, `plan_len: 1`. Type ≈ `translation` / `translate-text`. Executor auto-resolves to translator (`0xa61b…1c8c`). | 1 sub-task. ~25–35s. Cost ~0.05–0.1 USDC. Drawer shows actual translated text on completion. | |
| 2 | `summarize this article` | One-shot trivial | `decomposability: one-shot`, `stakes: low`, `confidence_d ≈ 0.94`, `plan_len: 1`. Type ≈ `summarization` / `summarize-text`. Executor → summarizer (`0x0DA5…2593`). | 1 sub-task. ~25–35s. Summarizer in dual-mode treats brief as instruction → produces a generic-summary-style output (since the brief is the literal text "summarize this article", not an article). | |
| 3 | `research the top 3 stablecoin yield products on Base and write a comparative report` | Composite-3 (research + write) | `decomposability: composite`, `stakes: high` (LLM over-conservative on financial domain), `confidence_d ≈ 0.4` (heuristic halved 0.8 because `research` + `top N` matched), `confidence_s ≈ 0.85`. `plan_len: 2–3`. Sub-tasks: `research → write`/`compare` with `depends_on: [1]`. Both → summarizer. | 2–3 sub-tasks, sequential, ~75–110s. Cost ~0.2–0.35 USDC. Per-node drawers show real research + comparative report text. | |
| 4 | `plan a Tokyo trip` | Ambiguous / multi-domain | `decomposability: composite`, `stakes: high` (again over-conservative — "trip" implies travel domain). `confidence_d ≈ 0.8` (only `plan` matches heuristic — 1 cue, no halving). `plan_len: 3–4`. Sub-tasks: research neighborhoods/flights/attractions, then synthesize itinerary. All → summarizer. | 3–4 sub-tasks, sequential, ~90–140s. Cost ~0.3–0.45 USDC. Drawer shows actual itinerary segments. | |
| 5 | `research the top 5 stablecoin protocols on Base, summarize each, translate the summary to Russian, write a comparative report, and identify the safest one` | Composite-5 (multi-stage) | `decomposability: composite`, `stakes: high`, `confidence_d ≈ 0.4` (heuristic halved on `research` + `top N` + `compar`). `plan_len: 5`. Mix of `research → summarize → translate → write → analyze`. Routing: most → summarizer, translation step → translator. | 5 sub-tasks, sequential, ~150–250s. Cost ~0.4–0.6 USDC. Translation step's drawer shows actual Russian text. Final analysis step references prior outputs (LLM cross-references via its own context, not via Sage). | |

## Bonus: high-stakes via $-trigger

The matrix above does not include an explicit high-stakes brief with real
irreversibility signal, because (a) we don't want to actually send funds in a
smoke and (b) the relevant assertion is that the heuristic *detects* the
signal, not that the system executes it.

Sixth brief (smoke the **classify-only**, do not approve):

| # | Brief | Expected classifier output | Action |
|---|-------|---------------------------|--------|
| 6 | `send $500 USDC to 0xABCDeF0000000000000000000000000000000001` | `decomposability: one-shot`, `stakes: high`, `confidence_d ≈ 0.96`, `confidence_s ≈ 0.45` (heuristic halved 0.91 on `send` verb + `$` value pattern + `USDC` keyword). Type ≈ `transfer-funds` or `send`. Executor: **unassigned** (no `transfer-funds` mapping; correct behaviour). | **Do NOT click Approve.** Verify the plan-card shows the unassigned executor and the high-stakes confidence-halved badge. Then click Cancel. |

## What "pass" means

Each row passes if:

1. The classifier output matches the expected shape (decomposability + stakes correct, confidence within ±0.15 of predicted, plan length within expected range).
2. Execution completes (rows 1–5) — all sub-task nodes reach mint (paid) status. No `plan_failed` event.
3. The per-node drawer shows a real result (text content, not echo of the spec).
4. Tx hashes link to Basescan and resolve to valid `approvePayment` transactions.
5. PostHog dashboard shows the corresponding `composite_*` events with sane properties.

If any row fails, treat it as a regression bug — not a calibration question.
Calibration questions (LLM stakes too aggressive, confidence off by 0.2) are
not failures; they're material for §11 / next iteration.

## Sponsor balance budget

Total budget for all five execute rows: ~1.0–1.5 USDC. With ~10.7 USDC in the
sponsor wallet, this is ~10% of available reserve. Comfortable.

## Observability check

After running the matrix:

1. PostHog → check that 10 event types appear: `composite_classify_started/completed`, `composite_plan_approved/edited/cancelled`, `composite_subtask_started/completed/disputed`, `composite_run_completed/errored`. Funnel from started → approved → run_completed should be ~5/5 for the smoke runs (cancelled row #6 counts on cancellation track).
2. Sentry → should be empty for these runs (no real errors expected). If anything appears, file as a finding.
3. `fly logs -a sage-demo-agents | grep parent.classify` → 5 `parent.classify.completed` events with `mode: "llm"` (real LLM path, not mock).

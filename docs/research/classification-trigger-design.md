# Classification Trigger Design

**Status:** Draft for discussion · 2026-05-19
**Author:** Sage research notebook
**Companion to:** [`observable-decomposition.md`](./observable-decomposition.md), [ADR-0007](../adr/0007-observable-decomposition.md)

---

## 1. Premise

The companion document `observable-decomposition.md` establishes that decomposition should be externalized as a structured artifact, and that a two-axis trigger (decomposability × stakes) determines how this is surfaced to the user. This document goes one level deeper: how the trigger itself is implemented, what signals it uses, what it returns, and what happens when it is wrong.

The trigger is its own artifact for one reason: it is where the LLM is given explicit authority to shape the user's experience. Everything downstream of the trigger — UI mode, approval gates, settlement granularity — flows from its output. A classifier that confuses one-shot with composite, or low-stakes with high, degrades every step that follows. It is worth designing carefully.

This is not a final specification. It is the design intent we will implement and validate against real briefs.

## 2. The two axes, operationalized

### Decomposability

A task is **one-shot** when:
- Exactly one deliverable can satisfy it.
- One executor (one agent, one tool, one role) can produce that deliverable.
- The work fits within a single LLM call or a single deterministic operation, without intermediate decision points that depend on partial results.

A task is **composite** when any of the following hold:
- The deliverable depends on outputs from multiple distinct sub-deliverables.
- Different sub-steps benefit from different specializations (research vs. analysis vs. writing).
- A sub-step's result determines what the next sub-step should be.
- The work would normally be broken across multiple tool/LLM calls even by a competent single agent.

Borderline cases exist. "Write a summary of this article" is one-shot. "Read these five articles and summarize the points where they disagree" is composite — it requires extraction per article, cross-comparison, then synthesis. The classifier is allowed to err on the composite side when uncertain (see §5).

### Stakes

A task is **low-stakes** when:
- Estimated total cost is below a configurable threshold (default: 0.50 USDC).
- Outcome is reversible — the user can re-run with a tweaked brief at trivial cost.
- No external side effects (financial transfers, public posts, irrevocable commitments).
- Task type is familiar — the user has run similar briefs before, or it matches a common template.

A task is **high-stakes** when any of the following hold:
- Cost exceeds the threshold.
- Outcome is irreversible — booked flight, posted message, signed contract, on-chain transfer.
- Touches regulated context (financial advisory, medical, legal).
- Brief is novel — no template match, first-of-kind for this user.

Stakes are softer to detect than decomposability. The classifier reports its assessment with a confidence level (see §4).

## 3. The signal model

The classifier is a single LLM call against the user's brief, configured to emit structured output. It is asked to evaluate several signals and combine them into a classification.

### Lexical and structural signals

- **Verb phrases.** "Translate," "summarize," "extract" → one-shot bias. "Research," "plan," "compare," "build," "analyze," "audit" → composite bias.
- **Scope quantifiers.** "Top N," "all available," "across X categories," "best of," "over time" → composite signal.
- **Conjunctions.** "And then," "after that," "based on," "if X then Y" → composite signal.
- **Length and density.** Very short briefs (< 10 words) skew one-shot. Long briefs with multiple clauses skew composite — though length alone is not sufficient.
- **Modality.** Imperative single verb ("translate this") versus descriptive scope ("I need to understand the landscape of...") signals one-shot vs. composite.

### Semantic signals

- **Expertise diversity.** Would the work require switching between distinct skill domains? A brief asking for "competitive analysis with a written report" implies at least two domains (research + writing).
- **Acceptance criteria implicitness.** When the user says "make sure it's correct," they implicitly want verification — which is itself a sub-step.
- **Tool-call diversity.** Would a competent agent need to invoke distinct tools (search, calculator, code-execution, image-gen) to accomplish this? If yes, composite is more likely.
- **Sequential dependency.** Can the parts be done independently, or does step 2 depend on step 1's output?

### Stakes signals

- **Numeric values mentioned.** "Buy $500 of ETH" or "transfer 1000 USDC" — high stakes from the dollar value alone.
- **Irreversibility cues.** "Send," "post," "publish," "buy," "book," "sign" — irreversible. "Draft," "review," "check," "research" — reversible.
- **Domain context.** Mention of legal, medical, financial, regulatory terms → high stakes by default.
- **Familiarity to user.** If user has run similar briefs before (looked up in history), low stakes. If first-of-kind, high stakes default.
- **Time-pressure cues.** "Before noon," "urgent," "ASAP" — elevates stakes because errors can't be cheaply corrected within the window.

The LLM is not asked to weight these manually. It is given the signal list as context and produces a holistic judgement with reasoning trace. The structured output (next section) captures the result and the reasoning separately so we can audit both.

## 4. Output schema

The classifier emits a `ClassificationResult` object:

```typescript
interface ClassificationResult {
  /** Either "one-shot" — single atomic sub-task — or "composite" — multiple linked sub-tasks. */
  decomposability: "one-shot" | "composite";

  /** Cost / risk axis. Determines whether user-approval gates are mandatory. */
  stakes: "low" | "high";

  /** Classifier's confidence in the decomposability call, 0..1. Below threshold → fallback to composite. */
  confidence_decomposability: number;

  /** Classifier's confidence in the stakes call, 0..1. Below threshold → fallback to high. */
  confidence_stakes: number;

  /** USDC base units, summed across proposed sub-tasks. Best-effort estimate. */
  estimated_total_cost_units: bigint;

  /** Wall-clock milliseconds, summed across critical path. Best-effort estimate. */
  estimated_duration_ms: number;

  /** The proposed plan. For one-shot, length === 1. */
  proposed_plan: SubTask[];

  /** Short human-readable explanation. Shown to user in plan card. */
  reasoning: string;

  /** Signal trace — what cues the classifier weighed. Used for audit and validation. */
  signal_trace: {
    lexical: string[];
    semantic: string[];
    stakes: string[];
  };
}

interface SubTask {
  id: number;
  type: string;                         // capability descriptor, e.g. "summarize-text"
  executor_address?: `0x${string}`;     // resolved from AgentRegistry / ERC-8004
  estimated_cost_units: bigint;
  deadline_offset_s: number;
  depends_on?: number[];                // ids of prerequisite sub-tasks
  spec: string;                         // sub-task instructions
}
```

The schema is enforced via the LLM's structured-output mode (function-calling on Anthropic, JSON-mode on OpenAI). Malformed responses are retried once; on second failure, the classifier returns a degraded result with `decomposability = "composite"` and `confidence_decomposability = 0` to force conservative behavior.

## 5. Confidence and fallback

The classifier reports two confidences. Each has a threshold (default 0.7). Behavior on low confidence:

| Decomposability confidence | Stakes confidence | Behavior |
|---|---|---|
| ≥ 0.7 | ≥ 0.7 | Use classification as-is. |
| < 0.7 | ≥ 0.7 | Force `decomposability = "composite"` (safer to over-decompose). |
| ≥ 0.7 | < 0.7 | Force `stakes = "high"` (safer to gate). |
| < 0.7 | < 0.7 | Force both fallbacks. Maximum ceremony. |

Rationale: the cost of false-positive decomposition (showing a plan card for a task that didn't need it) is **one extra click**. The cost of false-negative decomposition (executing a composite task as one-shot without user visibility) is **wrong work performed without intervention**. These costs are asymmetric. We bias toward the cheaper failure.

Same logic for stakes: false-positive high-stakes (gating a low-stakes task) costs the user one approval step. False-negative high-stakes (silently executing a high-stakes task) costs them real money or irreversible action. Bias toward gating.

The confidence threshold itself is configurable per user. A power user familiar with the system can lower it (less ceremony). A new user keeps the default (more ceremony).

### Caveat: how is confidence actually evaluated?

The confidence values above are **LLM self-reports**. The classifier produces a JSON object containing both its classification and its confidence in that classification. This is a weak signal: an LLM that is wrong about the task may also be wrong about its uncertainty. Frontier models frequently exhibit overconfidence on ambiguous inputs and poor calibration in general — the number labelled "confidence" is just another generated value, not a probability grounded in any measurement.

To strengthen this we apply a **heuristic cross-check** as Layer 1 after the LLM call, before any UI decision:

1. Scan the brief for composite-verb keywords (`research`, `plan`, `compare`, `build`, `analyze`, `audit`) and scope quantifiers (`top N`, `all`, `across`, `best of`, `over time`). If two or more match, multiply `confidence_decomposability` by 0.5 — forcing it under threshold if it was marginal.
2. Scan for irreversibility keywords (`send`, `post`, `publish`, `buy`, `transfer`, `sign`, `book`) and dollar-value patterns (`$X`, `N USDC`). If any match, multiply `confidence_stakes` by 0.5.
3. Apply the threshold check defined above against the adjusted confidences.

This is not a substitute for proper calibration. It only catches the most obvious disagreements between LLM judgement and surface features of the brief. The heuristic is deterministic, free, and runs in the same orchestrator call as the LLM classification — no extra latency.

Higher-quality calibration mechanisms — multi-LLM ensembles, logit-based confidence, override-driven empirical calibration — are listed as open questions in §9. The intent for v1 is to ship with heuristic cross-check and improve from there as override data accumulates.

## 6. User overrides

Beyond per-task confidence, the user has a session-level preference:

- **`always-confirm`** — every task gets a plan card, regardless of classifier output. For paranoid mode, regulated workflows, first-time onboarding.
- **`smart-default`** (default) — classifier output determines UI mode. Plan card for composite or high-stakes; auto-execute for low-stakes one-shot.
- **`always-execute`** — skip plan card entirely; execute immediately based on classifier's plan. For trusted workflows, internal automation, expert users.

Per-task override: even in `smart-default`, the user can click "show plan" on a one-shot auto-executing task before it runs. The classifier surfaces the plan in a collapsed view; expanding reveals the same plan card UI.

Per-task escalation: classifier may report `decomposability = "composite"` with high confidence but recommend `always-confirm` UI for this specific task — for instance, if it detects "send" + a dollar amount, it requests gating even if user preference is `always-execute`. Classifier overrides session preferences upward (toward more gating), never downward.

## 7. Edge cases

### Recurring or scheduled briefs

"Run this analysis every Monday at 9am" — not a one-shot, not a composite-with-deadline, but a recurring template. Classifier returns `decomposability = "composite"` with a special `recurring: true` flag and `schedule_spec` field. UI surface for recurring is a different mode (subscription view rather than plan card). Outside the scope of v1 trigger; flagged here as future work.

### Ambiguous briefs

"Help me with my Tokyo trip" — vague. Classifier should not guess. Default behavior: return `decomposability = "composite"` with a single sub-task of type `clarify-with-user` whose deliverable is "structured brief that the user explicitly confirms." This becomes the first thing the parent agent does — ask the user a clarifying question, get an answer, then re-classify against the refined brief.

### Multi-language briefs

The classifier should work regardless of brief language. Verb-phrase signals are language-specific; the LLM's underlying multilingual capability handles this. Validation needs at least a sample of briefs in each major language (English, Russian, Mandarin, Spanish) to catch regressions.

### Adversarial / nonsensical briefs

"Make me a sandwich" submitted to a settlement protocol. Classifier should detect off-domain inputs and return `decomposability = "composite"` with sub-task `clarify-with-user: "this brief does not appear to map to agent work; can you rephrase?"`. We do not refuse — we surface the ambiguity.

### Scope creep mid-execution

User initially says "summarize this article." Mid-execution, they add "also translate it to French." This is not the classifier's concern — it runs once per brief. Re-classification is triggered explicitly: the user can edit their brief in the chat, which re-invokes the classifier on the combined brief. UI distinguishes "extending current task" from "starting new task."

### Briefs that decompose into too many sub-tasks

If the proposed plan has more than 10 sub-tasks, classifier flags this and reduces detail — collapsing related sub-tasks into broader phases. Real decomposition can be deeper, but a plan card with 15 cards is unusable. Phases expand on demand to reveal their sub-tasks.

## 8. Validation strategy

The classifier is an LLM call, so its accuracy is not provable. It is improvable.

We track three signals over time:

**Override rate per axis.** When the user edits a plan from `composite` to single-step (or vice versa), we record the override. When the user toggles stakes manually, same. Override rates above ~10% per axis signal classifier misalignment with user expectations.

**Plan rejection rate.** When the user clicks "cancel" on a plan card without editing, we record it. Cancellation followed by a rephrased brief signals the original classification missed the actual intent.

**Approval friction.** When user enables `always-execute` after N consecutive low-stakes one-shot approvals, we know the classifier was correctly identifying low-stakes work. When they revert to `always-confirm`, we know it was over-confident.

A weekly review (manual at first, automated later) samples 20 classifications per axis and compares to ground-truth labels assigned by us. Disagreements feed into prompt refinement.

We do not train a custom model. We refine the system prompt that drives the LLM-based classifier. This keeps the dependency simple (any frontier LLM works) and the improvements legible (the prompt itself is versioned).

## 9. Open questions

### Confidence calibration

The §5 caveat acknowledges that LLM self-reported confidence is unreliable and adds a heuristic cross-check as a partial mitigation. Better mechanisms are possible but each has trade-offs:

- **Multi-LLM ensemble.** Run classification 2–3 times on different LLMs (or different temperatures) and treat agreement as confidence. Cost rises 2–3×. Calibration becomes empirical (3/3 agreement = high; 2/3 = medium; 1/3 = low). Reasonable upgrade once classification cost matters less than classification accuracy.
- **Logit-based confidence.** Some APIs (OpenAI logprobs) expose top-k token probabilities for structured outputs. The probability spread between competing answers (`"one-shot"` vs. `"composite"`) is a properly grounded confidence signal. Anthropic API does not currently expose this for structured outputs. Provider-dependent.
- **Override-driven empirical calibration.** Track every case where the user edits the classification in the plan card (changes `one-shot` to `composite` or vice versa, toggles stakes). After ~200 cases, build a calibration function — "when the classifier says confidence 0.8, it is actually right X% of the time" — and adjust thresholds accordingly. Impossible at launch; valuable once usage accumulates.
- **Domain-specific classifiers.** For high-stakes regulated domains (medical, legal, financial transfers) a small dedicated classifier may outperform a general-purpose one. Adds maintenance burden; probably overkill until specific domains generate enough traffic to justify it.

### Other open questions

- **Plan caching for similar briefs.** If a user submits a near-duplicate brief, should we reuse the previous plan? Saves a classification call but risks staleness if intent has shifted. Probably yes with an explicit "use last plan" affordance, not implicit caching.
- **Per-executor cost estimates.** Current schema assumes the classifier knows executor pricing. In practice, prices vary and may not be public. Should the classifier query the registry mid-classification, or accept that estimates are best-effort?
- **Classifier as its own paid sub-task.** Should the classification step itself be a TaskEscrow — paid to whoever runs the parent agent? Makes the classifier economically accountable, but adds a tax to every brief. Probably not in v1; classification stays a free local LLM call.
- **Sensitive briefs.** A brief like "draft a will" should probably never auto-execute, regardless of classifier confidence. We likely want a short hard-coded list of domains that always trigger `always-confirm` — documented and reviewable.
- **Cross-language stakes calibration.** "100 баксов" and "$100" should yield the same stakes assessment. Does the LLM normalize currency mentions reliably across languages? Needs validation against a multi-language sample.
- **Classifier failure mode in degraded LLM availability.** If the underlying LLM API is down or returns garbage, do we degrade to a pure-heuristic fallback (long brief + composite verbs → composite, else one-shot) or refuse to classify and ask the user to retry? The honest answer is the latter — silent heuristic-only mode hides the degradation.

## 10. Closing

The classifier is a focused, single-purpose LLM call producing a structured artifact. It is permitted to be wrong; the system around it (confidence-based fallback, user override, post-hoc validation) makes wrongness recoverable rather than catastrophic.

The design choice that matters most is the **asymmetric bias**: when uncertain, over-decompose and over-gate. The cost of unnecessary user friction is one extra click. The cost of silently executing wrong work is real money and time. We optimize for the cheap failure.

This document is the implementation reference for the trigger. The next step is to implement it as a working classifier — a single function in the parent-agent codebase, with a versioned system prompt — and validate against real briefs from our own usage before exposing it publicly.

---

*This document is a thinking artifact. It is open for revision as we build and learn.*

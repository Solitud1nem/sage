/**
 * Plan-related types for Sage's observable-decomposition flow (parent agent).
 *
 * Schema mirrors the output contract defined in
 * `docs/research/classification-trigger-design.md` §4. Field names use
 * snake_case to round-trip cleanly with the LLM-generated JSON that the
 * classifier returns under structured-output mode.
 *
 * Three artifacts live here:
 * - `SubTask`             — atomic unit of work, one row in the plan card.
 * - `ClassificationResult` — what the classifier emits for a brief.
 * - `Plan`                — what the user submits to `/composite/execute`
 *                           after approve / edit on the plan card.
 *
 * See also: ADR-0007 (observable decomposition),
 *           docs/research/observable-decomposition.md (full reasoning).
 */

/**
 * Decomposability axis — does the brief reduce to one atomic action,
 * or does it require multiple linked sub-tasks?
 *
 * Defined in `classification-trigger-design.md` §2.
 */
export type Decomposability = 'one-shot' | 'composite';

/**
 * Stakes axis — should the user be asked to approve before execution?
 *
 * Defined in `classification-trigger-design.md` §2.
 */
export type Stakes = 'low' | 'high';

/**
 * A single sub-task proposed (or approved) inside a plan.
 *
 * One `SubTask` becomes one on-chain `TaskEscrow` record when the plan
 * is executed. The `parent_id` link back to the originating plan is
 * encoded into the `specUri` at spawn time (see `parent-id-codec.ts`),
 * not stored on this object.
 *
 * Schema source: `classification-trigger-design.md` §4.
 */
export interface SubTask {
  /** Stable ordinal within the plan (1, 2, 3, …). Used as the `sub` half of `parent_id`. */
  readonly id: number;

  /**
   * Capability descriptor in kebab-case, e.g. `"summarize-text"`, `"translate-text"`.
   * Resolves (via off-chain catalogue) to an executor agent in `AgentRegistry`.
   */
  readonly type: string;

  /**
   * EVM address of the executor selected for this sub-task. Optional because the
   * classifier may emit a `type` without a resolved executor — the plan-runner
   * (or the user, via the editor) fills it in before execution.
   */
  readonly executor_address?: `0x${string}`;

  /** Estimated cost in USDC base units (6 decimals; `1_000_000n` = 1 USDC). */
  readonly estimated_cost_units: bigint;

  /**
   * Wall-clock seconds from sub-task spawn to deadline. Converted to an
   * absolute Unix timestamp when the on-chain `TaskEscrow.createTask` is called.
   */
  readonly deadline_offset_s: number;

  /**
   * Ids of prerequisite sub-tasks within the same plan. The plan-runner blocks
   * this sub-task until every dependency has reached `Paid`. Empty / omitted
   * means the sub-task is ready to start at run-time-zero.
   */
  readonly depends_on?: readonly number[];

  /** Free-form sub-task instructions handed to the executor (rendered into specUri). */
  readonly spec: string;
}

/**
 * Output of the classification trigger — produced by `parent/classify.ts`
 * via OpenAI structured outputs and then post-processed by the deterministic
 * heuristic cross-check (`parent/heuristic.ts`).
 *
 * This is the input to the UI's plan-card. After the user approves (and
 * possibly edits), a `Plan` is derived from this and sent to
 * `POST /api/demo/composite/execute`.
 *
 * Schema source: `classification-trigger-design.md` §4.
 */
export interface ClassificationResult {
  /** Either `"one-shot"` (single atomic sub-task) or `"composite"` (multiple linked sub-tasks). */
  readonly decomposability: Decomposability;

  /** Cost / risk axis. Drives whether user-approval gates are mandatory. */
  readonly stakes: Stakes;

  /**
   * Classifier's self-reported confidence in the decomposability call, 0..1.
   * Below threshold (default 0.7) the trigger forces `"composite"` per §5.
   *
   * Note: per §5 caveat, this is an LLM self-report, not a calibrated probability.
   * The heuristic cross-check in `parent/heuristic.ts` adjusts this value before
   * the threshold check runs.
   */
  readonly confidence_decomposability: number;

  /**
   * Classifier's self-reported confidence in the stakes call, 0..1.
   * Below threshold (default 0.7) the trigger forces `"high"` per §5.
   */
  readonly confidence_stakes: number;

  /**
   * Total estimated cost across `proposed_plan`, in USDC base units.
   * Best-effort — pricing may shift by the time the user clicks Approve.
   */
  readonly estimated_total_cost_units: bigint;

  /**
   * Wall-clock estimate of the critical path through `proposed_plan`, in milliseconds.
   * Used by the plan card to set the user's expectations.
   */
  readonly estimated_duration_ms: number;

  /**
   * The plan as proposed by the classifier. For `decomposability === "one-shot"`,
   * length is always 1. For `"composite"`, the user may add/remove/reorder
   * entries in the editor before the Plan is submitted for execution.
   */
  readonly proposed_plan: readonly SubTask[];

  /** Short human-readable explanation rendered on the plan card. */
  readonly reasoning: string;

  /**
   * Per-channel list of signals the classifier weighed. Used for audit and
   * weekly validation review (`classification-trigger-design.md` §8), not
   * shown to the user by default.
   */
  readonly signal_trace: {
    /** Lexical / structural cues — verb phrases, scope quantifiers, conjunctions. */
    readonly lexical: readonly string[];
    /** Semantic cues — expertise diversity, sequential dependency, tool-call diversity. */
    readonly semantic: readonly string[];
    /** Stakes cues — dollar values, irreversibility verbs, domain context. */
    readonly stakes: readonly string[];
  };
}

/**
 * User-approved snapshot of a plan, ready for execution.
 *
 * Derived from a `ClassificationResult` once the user clicks Approve on
 * the plan card (with or without edits). Classifier-only fields
 * (`confidence_*`, `signal_trace`, `reasoning`, `proposed_plan`) are
 * dropped — they belong to the upstream classification artifact, not to
 * the approved plan that the parent agent is committing to execute.
 *
 * The `runId` is *not* part of this object: it is minted server-side by
 * `POST /api/demo/composite/execute` and returned to the client alongside
 * a `streamUrl`.
 */
export interface Plan {
  /** Original user brief that produced this plan. Preserved verbatim for audit. */
  readonly brief: string;

  /** Axis carried over from classification (may be flipped if the user edited). */
  readonly decomposability: Decomposability;

  /** Axis carried over from classification (may be flipped if the user edited). */
  readonly stakes: Stakes;

  /**
   * Ordered, possibly-edited list of approved sub-tasks. For one-shot plans,
   * length is always 1. The plan-runner reads `depends_on` on each entry to
   * build the execution DAG.
   */
  readonly subtasks: readonly SubTask[];

  /** Total cost across all `subtasks`, in USDC base units. */
  readonly estimated_total_cost_units: bigint;

  /** Estimated critical-path duration, in milliseconds. */
  readonly estimated_duration_ms: number;
}

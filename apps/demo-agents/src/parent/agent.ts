/**
 * Parent agent — thin wrapper that wires `classifyBrief` and `runPlan`
 * together and registers progress channels with the orchestrator's SSE
 * registry.
 *
 * Two entry points cover the two modes the composite flow needs:
 *
 * - `executePlan(plan, bundle)` — the user has already approved a Plan on
 *   the plan-card. Skip classification, kick off execution, return the runId
 *   + streamUrl immediately. Used by `POST /api/demo/composite/execute`.
 *
 * - `classifyAndExecute(brief, bundle, env)` — autonomous one-shot: classify
 *   the brief, derive a Plan from `proposed_plan`, execute. No user-approval
 *   gate. Useful for trusted automation and smoke tests; the production UI
 *   uses the two-step (classify → approve → execute) flow instead.
 *
 * Both register a channel with the shared `demoRegistry` and run
 * execution in the background. The returned `streamUrl` matches the
 * orchestrator route added in M10.2.6.
 */

import { randomUUID } from 'node:crypto';

import type { ClassificationResult, Plan } from '@sage/core';

import { demoRegistry } from '../shared/sse.js';
import type { createSageFromConfig } from '../shared/config.js';
import { classifyBrief, type ParentEnv } from './classify.js';
import { runPlan } from './plan-runner.js';

type SageClientBundle = ReturnType<typeof createSageFromConfig>;

export interface ExecuteResult {
  /** Plan-run identifier — encoded as the `run` half of every sub-task's parent_id. */
  readonly runId: string;
  /** SSE endpoint clients should subscribe to for lifecycle events. */
  readonly streamUrl: string;
}

export interface ClassifyAndExecuteResult extends ExecuteResult {
  /** The classification that produced the Plan being executed. */
  readonly classification: ClassificationResult;
}

const STREAM_URL_PREFIX = '/api/demo/composite/stream/';

/**
 * Kick off execution of a pre-approved `Plan`. Returns immediately with the
 * runId + streamUrl. Background execution streams events into the SSE
 * channel registered with `demoRegistry`.
 *
 * Errors raised by `runPlan` are caught and surfaced via `plan_failed` SSE
 * events; this function itself does not throw post-registration.
 */
export function executePlan(plan: Plan, bundle: SageClientBundle): ExecuteResult {
  const runId = randomUUID();
  const channel = demoRegistry.create(runId);

  void runPlan(plan, channel, bundle, { runId }).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[parent.agent] runPlan(${runId}) threw:`, err);
    if (!channel.isClosed) {
      channel.emit('plan_failed', { runId, error: message });
      channel.close({ runId, ok: false, error: message });
    }
  });

  return { runId, streamUrl: `${STREAM_URL_PREFIX}${runId}` };
}

/**
 * Autonomous classify-then-execute flow. Awaits classification (so callers
 * can inspect the result), then kicks off execution in the background.
 *
 * Intended for tests, smoke runs, and trusted automation. The UI flow uses
 * the two-endpoint variant (`/composite/classify` then `/composite/execute`)
 * so the user can review and edit the Plan before approval.
 */
export async function classifyAndExecute(
  brief: string,
  bundle: SageClientBundle,
  env: ParentEnv,
): Promise<ClassifyAndExecuteResult> {
  const classification = await classifyBrief(brief, env);
  const plan = classificationToPlan(brief, classification);
  const { runId, streamUrl } = executePlan(plan, bundle);
  return { runId, streamUrl, classification };
}

/**
 * Project a `ClassificationResult` into a `Plan` (drops classifier-only
 * fields; carries forward axes + proposed_plan + cost/duration). This is
 * what the frontend plan-editor will produce after user approval, but for
 * the autonomous flow we do it inline.
 */
export function classificationToPlan(
  brief: string,
  c: ClassificationResult,
): Plan {
  return {
    brief,
    decomposability: c.decomposability,
    stakes: c.stakes,
    subtasks: c.proposed_plan,
    estimated_total_cost_units: c.estimated_total_cost_units,
    estimated_duration_ms: c.estimated_duration_ms,
  };
}

export const __testing = {
  STREAM_URL_PREFIX,
};

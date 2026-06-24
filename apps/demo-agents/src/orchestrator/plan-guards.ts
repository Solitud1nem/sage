/**
 * Plan-level guards that aren't about money (those live in `checkPlanCaps`).
 * Side-effect-free so they're unit-testable without booting the server.
 */

import type { Plan } from '@sage/core';

/**
 * Evaluator-coverage rule (M13.2.2, ADR-0023 §Layer 1.2).
 *
 * Work that crosses an ownership boundary — a sub-task running on a FOREIGN
 * executor (one not in the first-party allowlist) — is settlement-as-guarantee
 * (ADR-0008) and must be gated by a paid evaluator before the foreign worker
 * is paid. Two invariants:
 *
 *   A. every foreign worker sub-task is the target of some `evaluates` step;
 *   B. an evaluator sub-task itself runs on a first-party agent — you cannot
 *      outsource the judge that decides whether a foreign worker gets paid
 *      (otherwise the guarantee is hollow).
 *
 * Opt-in by design: an EMPTY allowlist disables the rule (nothing is foreign),
 * so the current all-first-party demo is unaffected. The operator activates it
 * by setting `FIRST_PARTY_AGENTS` to Sage's own identity addresses; from then
 * on any other executor is foreign and must be evaluator-covered.
 *
 * Enforced at `/execute` on the submitted plan. The plan-runner requires every
 * sub-task to carry its `executor_address` (it does not re-resolve at runtime),
 * so the executors checked here are the executors that will run — with one
 * documented edge: a dispute-retry may swap in a new executor (`newExecutor`),
 * which this gate does not re-check (foreign agents are parked; tracked as a
 * follow-up).
 *
 * Returns an error string for a 400, or null when the plan is acceptable.
 */
export function checkEvaluatorCoverage(
  plan: Plan,
  firstParty: ReadonlySet<string>,
): string | null {
  if (firstParty.size === 0) return null; // rule disabled until an allowlist is configured

  const isForeign = (addr: string | undefined): boolean =>
    addr !== undefined && !firstParty.has(addr.toLowerCase());

  // Pass 1: collect evaluated ids, and reject any foreign evaluator (invariant B).
  const evaluatedIds = new Set<number>();
  for (const s of plan.subtasks) {
    if (s.evaluates === undefined) continue;
    evaluatedIds.add(s.evaluates);
    if (isForeign(s.executor_address)) {
      return `subtask #${s.id} is a foreign evaluator — an evaluator must run on a first-party agent (it decides whether a foreign worker is paid)`;
    }
  }

  // Pass 2: every foreign worker must be judged (invariant A). Evaluators are
  // not "workers" and don't need their own evaluator.
  for (const s of plan.subtasks) {
    if (s.evaluates !== undefined) continue;
    if (isForeign(s.executor_address) && !evaluatedIds.has(s.id)) {
      return `subtask #${s.id} runs on a foreign executor (${s.executor_address ?? '—'}) with no evaluator — work that crosses an ownership boundary must be gated by an \`evaluates\` step (ADR-0023 §Layer 1.2)`;
    }
  }

  return null;
}

/**
 * Quarantine rule (M13.2.4, ADR-0023 §Layer 3.8). An UNPROVEN foreign agent —
 * foreign (not in `firstParty`) and not in the `proven` set (fewer than the
 * configured settled-task threshold) — may only be entrusted with a low-value
 * sub-task (`estimated_cost_units <= maxUnits`). This is the cold-start ramp:
 * a brand-new agent earns a track record on cheap work before it can be handed
 * a high-value task, bounding the blast radius of a new or malicious entrant.
 * Proven foreign agents and all first-party agents have no ceiling.
 *
 * Opt-in: an empty allowlist disables it (nothing is foreign). Enforced at
 * `/execute` alongside `checkEvaluatorCoverage`.
 *
 * Returns an error string for a 400, or null when the plan is acceptable.
 */
export function checkQuarantine(
  plan: Plan,
  firstParty: ReadonlySet<string>,
  proven: ReadonlySet<string>,
  maxUnits: bigint,
): string | null {
  if (firstParty.size === 0) return null; // rule disabled until an allowlist is configured

  for (const s of plan.subtasks) {
    const addr = s.executor_address;
    if (addr === undefined) continue;
    const lower = addr.toLowerCase();
    if (firstParty.has(lower)) continue; // first-party — no ceiling
    if (proven.has(lower)) continue; // proven foreign — earned its ceiling-free status
    if (s.estimated_cost_units > maxUnits) {
      return `subtask #${s.id} routes ${s.estimated_cost_units} base units to an unproven foreign agent (${addr}); new agents are capped at ${maxUnits} base units until they build a track record (ADR-0023 §Layer 3.8)`;
    }
  }

  return null;
}

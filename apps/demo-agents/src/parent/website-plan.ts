/**
 * Deterministic website-pipeline plan (M12.1.3, ADR-0020 п.1).
 *
 * The website demo mode does NOT go through the LLM classifier: the pipeline
 * shape is known (copywriter → builder → packager, with the qa-website
 * evaluator judging the builder), so the plan is a template — cheaper, fully
 * predictable for the demo, and the classifier's stem buckets stay untouched
 * (legacy composite traffic can't accidentally route into the four).
 *
 * Executors and prices still come from AgentRegistryV2 by EXACT capability
 * name (`pickAgentForCapability`, cheapest active agent wins) — a foreign
 * agent undercutting `build-website` gets picked automatically, same
 * platform substrate as the stem path (M11.3).
 *
 * Returned as a full ClassificationResult so the frontend reuses the
 * plan-card / approve / execute flow without a parallel code path.
 */

import type { AgentRecordV2, ClassificationResult, SubTask } from '@sage/core';

import { pickAgentForCapability } from './registry-resolver.js';

interface StepTemplate {
  readonly capability: string;
  readonly spec: string;
  readonly deadline_offset_s: number;
  readonly depends_on?: readonly number[];
  readonly evaluates?: number;
}

/** ids are 1-based positions in this array. */
const STEPS: readonly StepTemplate[] = [
  {
    capability: 'copywrite',
    spec: 'Write a complete copy deck (markdown) for a small business-card website based on the client brief: headline, about, services, contact. Match the language of the brief.',
    deadline_offset_s: 600,
  },
  {
    capability: 'build-website',
    spec: 'Build a small static business-card website (multi-file: index.html, styles.css) from the copy deck. Semantic HTML, responsive, no external dependencies.',
    deadline_offset_s: 900,
    depends_on: [1],
  },
  {
    capability: 'qa-website',
    spec: 'QA the built website: HTML validity, Lighthouse audit, rendered screenshot, copy fidelity against the build instruction.',
    deadline_offset_s: 900,
    evaluates: 2,
  },
  {
    capability: 'package-archive',
    spec: 'Package the website into a deploy-ready zip with a README describing deployment options.',
    deadline_offset_s: 600,
    depends_on: [2],
  },
];

/** Rough demo estimate: LLM steps dominate; chain waits are poll-bounded. */
const ESTIMATED_DURATION_MS = 150_000;

/**
 * Build the website-pipeline classification from live registry agents.
 * Throws when any required capability has no active agent — the endpoint
 * surfaces that as an honest 503 instead of a plan that can never run.
 * (The brief itself rides with the approved Plan, not the classification —
 * the frontend's `planFromClassification` attaches it, same as classify.)
 */
export function buildWebsiteClassification(
  agents: readonly AgentRecordV2[],
): ClassificationResult {
  const subtasks: SubTask[] = STEPS.map((step, i) => {
    const pick = pickAgentForCapability(step.capability, agents);
    if (!pick) {
      throw new Error(`no active agent in the registry for capability "${step.capability}"`);
    }
    return {
      id: i + 1,
      type: step.capability,
      spec: step.spec,
      deadline_offset_s: step.deadline_offset_s,
      executor_address: pick.address,
      estimated_cost_units: pick.price,
      ...(step.depends_on ? { depends_on: [...step.depends_on] } : {}),
      ...(step.evaluates !== undefined ? { evaluates: step.evaluates } : {}),
    };
  });

  const total = subtasks.reduce((sum, s) => sum + s.estimated_cost_units, 0n);

  return {
    decomposability: 'composite',
    stakes: 'low',
    confidence_decomposability: 1,
    confidence_stakes: 1,
    estimated_total_cost_units: total,
    estimated_duration_ms: ESTIMATED_DURATION_MS,
    reasoning:
      'Deterministic website-pipeline template (M12.1.3): copywriter → builder → packager, with the qa-website evaluator gating the builder payment. Executors resolved from AgentRegistryV2 by capability.',
    signal_trace: {
      lexical: ['website-pipeline template (no LLM classification)'],
      semantic: ['fixed 4-step DAG: copywrite → build-website → package-archive + qa-website evaluator'],
      stakes: ['fixed demo pipeline, registry-priced steps'],
    },
    proposed_plan: subtasks,
  };
}

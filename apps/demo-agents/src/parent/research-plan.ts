/**
 * Deterministic research-pipeline plan (M12.2.1, ADR-0020 п.1 — флагман
 * нарратива «протухшая память»).
 *
 * Same template discipline as `website-plan.ts`: the pipeline shape is known
 * (searcher → extract×N → synthesizer; the fact-checker evaluator joins in
 * M12.2.2), so no LLM classification — cheaper, fully predictable, and the
 * classifier's stem buckets stay untouched.
 *
 * Granularity is the design parameter here (IDEAS.md 2026-06-12): research
 * cuts cleanly — search / per-source extraction / synthesis are joints where
 * the envelope loses nothing. One extract sub-task PER SOURCE: each is
 * independent work by an independent identity, visible on the plan card.
 * The `source_index=N` token in each extract spec tells the extractor which
 * of the searcher's sources is its job (the searcher result rides to every
 * extract via inputs chaining); the synthesizer depends on the searcher TOO —
 * its result carries the research question downstream (ADR-0018 gives a
 * dependent step only upstream inputs, never the root brief).
 *
 * Executors and prices come from AgentRegistryV2 by EXACT capability name —
 * a foreign agent undercutting `extract-content` gets picked automatically,
 * same platform substrate as the stem path (M11.3).
 */

import type { AgentRecordV2, ClassificationResult, SubTask } from '@sage/core';

import { RESEARCH_SOURCE_COUNT } from '../shared/research.js';
import { pickAgentForCapability } from './registry-resolver.js';

interface StepTemplate {
  readonly capability: string;
  readonly spec: string;
  readonly deadline_offset_s: number;
  readonly depends_on?: readonly number[];
  readonly evaluates?: number;
}

/** ids are 1-based positions in this array. */
function buildSteps(): StepTemplate[] {
  const searcher: StepTemplate = {
    capability: 'web-search',
    spec:
      'Formulate 3-5 web search queries for the research question, run them against a live ' +
      `SERP, deduplicate and select the ${RESEARCH_SOURCE_COUNT} most relevant sources. ` +
      'Return {question, sources:[{url,title,snippet}]} so downstream steps keep the goal.',
    deadline_offset_s: 600,
  };
  const extracts: StepTemplate[] = Array.from({ length: RESEARCH_SOURCE_COUNT }, (_, i) => ({
    capability: 'extract-content',
    spec:
      `Fetch and extract source_index=${i + 1} of the search results: reduce the live page to ` +
      'text, select key points and VERBATIM quotes relevant to the research question ' +
      '(quotes are mechanically verified against the page). An unreachable page is an honest ' +
      'partial result, not a failure.',
    deadline_offset_s: 600,
    depends_on: [1],
  }));
  const synthesizer: StepTemplate = {
    capability: 'synthesize-report',
    spec:
      'Synthesize a fact-checked research report (markdown) from the extracted sources: ' +
      'executive summary, findings answering the question, limitations. Every factual claim ' +
      'cites [n] → {url, verbatim quote from a verified extract}; unsupported claims go to ' +
      'limitations. Deliver as a JSON artifact {report_markdown, citations, sources}.',
    deadline_offset_s: 900,
    // The searcher (question) + every extract (evidence).
    depends_on: [1, ...extracts.map((_, i) => i + 2)],
  };
  // Evaluator: independently re-resolves every citation against the live web
  // (M12.2.2). Like every evaluator it carries NO depends_on — it implicitly
  // follows its target (plan-runner rule); fail-verdict → rework → dispute →
  // council → money never leaves. Its id is one past the synthesizer.
  const synthId = 1 + extracts.length + 1;
  const factChecker: StepTemplate = {
    capability: 'fact-check',
    spec:
      'Fact-check the research report: independently re-fetch every cited URL and verify the ' +
      'quote still appears on the live page; decide whether a reasonable reader would trust the ' +
      'report. Unresolved citations on load-bearing claims → reject.',
    deadline_offset_s: 900,
    evaluates: synthId,
  };
  return [searcher, ...extracts, synthesizer, factChecker];
}

/** Rough demo estimate: sequential sub-task lifecycles dominate (plan-runner
 * executes one at a time); LLM steps are seconds each. Includes the
 * fact-check evaluator's own lifecycle after the synthesizer. */
const ESTIMATED_DURATION_MS = 360_000;

/**
 * Build the research-pipeline classification from live registry agents.
 * Throws when any required capability has no active agent — the endpoint
 * surfaces that as an honest 503 instead of a plan that can never run.
 */
export function buildResearchClassification(
  agents: readonly AgentRecordV2[],
): ClassificationResult {
  const subtasks: SubTask[] = buildSteps().map((step, i) => {
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
      `Deterministic research-pipeline template (M12.2): web-search → extract-content ×${RESEARCH_SOURCE_COUNT} ` +
      '(one per source) → synthesize-report, with the fact-check evaluator gating the synthesizer ' +
      'payment. Executors resolved from AgentRegistryV2 by capability.',
    signal_trace: {
      lexical: ['research-pipeline template (no LLM classification)'],
      semantic: [
        `fixed ${RESEARCH_SOURCE_COUNT + 2}-step DAG: web-search → extract-content ×${RESEARCH_SOURCE_COUNT} → synthesize-report + fact-check evaluator`,
      ],
      stakes: ['fixed demo pipeline, registry-priced steps'],
    },
    proposed_plan: subtasks,
  };
}

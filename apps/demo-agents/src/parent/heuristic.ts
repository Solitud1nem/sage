/**
 * Deterministic heuristic cross-check applied to the classifier's output.
 *
 * Implements the rule set from `docs/research/classification-trigger-design.md`
 * §5 caveat: LLM self-reported confidence is unreliable, so we scan the brief
 * for surface features and halve the relevant confidence value when the LLM
 * may have under-weighted a clear cue.
 *
 * Rules:
 * 1. If the brief contains ≥ 2 distinct matches across composite-verb
 *    keywords ∪ scope-quantifier patterns, multiply
 *    `confidence_decomposability` by 0.5.
 * 2. If the brief contains ≥ 1 match across irreversibility verbs ∪
 *    dollar-value patterns, multiply `confidence_stakes` by 0.5.
 *
 * The function is pure: same input → same output, no side effects.
 * Matched signals are appended to `signal_trace` so the audit trail
 * captures what the heuristic added (vs. what the LLM emitted).
 */

import type { ClassificationResult } from '@sage/core';

/** Composite-verb keywords. Match (case-insensitive, substring) bumps composite signal. */
const COMPOSITE_VERBS: readonly string[] = [
  'research',
  'plan',
  'compare',
  'build',
  'analyze',
  'audit',
];

/** Scope-quantifier patterns. Each match bumps the composite signal once. */
const SCOPE_QUANTIFIERS: readonly { label: string; pattern: RegExp }[] = [
  { label: 'top N', pattern: /\btop\s+\d+\b/i },
  { label: 'all', pattern: /\ball\b/i },
  { label: 'across', pattern: /\bacross\b/i },
  { label: 'best of', pattern: /\bbest of\b/i },
  { label: 'over time', pattern: /\bover time\b/i },
];

/** Irreversibility verbs. Any single match halves stakes confidence. */
const IRREVERSIBILITY_VERBS: readonly string[] = [
  'send',
  'post',
  'publish',
  'buy',
  'transfer',
  'sign',
  'book',
];

/** Dollar / USDC / currency-amount patterns. Any single match halves stakes confidence. */
const DOLLAR_VALUE_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
  { label: '$amount', pattern: /\$\s?\d/ },
  { label: 'N USDC', pattern: /\b\d[\d,.]*\s*(usdc|usd|dollars?)\b/i },
];

/**
 * Apply the §5 heuristic cross-check to the classifier's output.
 *
 * Returns a new `ClassificationResult`. The input is not mutated.
 *
 * @param brief          The original user brief (raw text, any language).
 * @param classification The classifier's emitted result, including its
 *                       self-reported confidence and signal_trace.
 */
export function applyHeuristicAdjustment(
  brief: string,
  classification: ClassificationResult,
): ClassificationResult {
  const lower = brief.toLowerCase();

  const compositeMatches: string[] = [];
  for (const verb of COMPOSITE_VERBS) {
    if (lower.includes(verb)) compositeMatches.push(verb);
  }
  for (const { label, pattern } of SCOPE_QUANTIFIERS) {
    if (pattern.test(brief)) compositeMatches.push(label);
  }

  const stakesMatches: string[] = [];
  for (const verb of IRREVERSIBILITY_VERBS) {
    if (lower.includes(verb)) stakesMatches.push(verb);
  }
  for (const { label, pattern } of DOLLAR_VALUE_PATTERNS) {
    if (pattern.test(brief)) stakesMatches.push(label);
  }

  const decompMultiplier = compositeMatches.length >= 2 ? 0.5 : 1;
  const stakesMultiplier = stakesMatches.length >= 1 ? 0.5 : 1;

  return {
    ...classification,
    confidence_decomposability:
      classification.confidence_decomposability * decompMultiplier,
    confidence_stakes: classification.confidence_stakes * stakesMultiplier,
    signal_trace: {
      lexical: [
        ...classification.signal_trace.lexical,
        ...compositeMatches.map((m) => `heuristic:${m}`),
      ],
      semantic: [...classification.signal_trace.semantic],
      stakes: [
        ...classification.signal_trace.stakes,
        ...stakesMatches.map((m) => `heuristic:${m}`),
      ],
    },
  };
}

/**
 * Internal keyword lists exposed for unit-tests only. Not part of the
 * stable public API of this module.
 */
export const __testing = {
  COMPOSITE_VERBS,
  SCOPE_QUANTIFIERS,
  IRREVERSIBILITY_VERBS,
  DOLLAR_VALUE_PATTERNS,
};

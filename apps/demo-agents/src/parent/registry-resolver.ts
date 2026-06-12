/**
 * Registry-driven executor selection (M11.3).
 *
 * Replaces the frontend's hardcoded `resolveExecutorByType` (env-var-based
 * mapping to 4 demo workers) with a registry lookup against AgentRegistryV2.
 * The classifier calls this for each sub-task in the proposed plan; the
 * frontend keeps its env-var resolver as a fallback for backwards-compat.
 *
 * Capability matching is **stem-based** because:
 *   - the LLM-driven classifier emits unpredictable type strings
 *     (`summarize-text`, `summarization`, `comparative-analysis`,
 *     `image-description`, etc.);
 *   - the registry stores canonical capability names per agent
 *     (`summarize`, `translate`, `sentiment-classify`, `vision-describe`);
 *   - direct equality fails for the LLM shorthand variants.
 *
 * The buckets below mirror the frontend's `resolveExecutorByType` stems,
 * but the result is a CAPABILITY NAME (key into the registry) rather than
 * a hardcoded address. Foreign agents claiming the same capability name
 * are picked up automatically — that's the platform substrate from
 * ADR-0008 amendment §M11.2.
 */

import type { AgentRecordV2 } from '@sage/core';

/**
 * Stem buckets — each bucket maps a list of LLM-emitted stems to a
 * canonical capability name registered in V2 registry.
 *
 * Order matters when stems overlap (translator stems before summarizer so
 * "translate-and-summarize" → translator). Keep aligned with the
 * frontend's resolveExecutorByType ordering to preserve behavior parity
 * during the v1→v2 fallback transition.
 */
const STEM_BUCKETS: ReadonlyArray<{
  readonly stems: readonly string[];
  readonly capability: string;
}> = [
  // Translator FIRST so combined "translate-and-summarize" wins for translator.
  { stems: ['translat'], capability: 'translate' },
  // Vision next so "describe-image" doesn't get caught by the generic
  // "describ" stem that summarizer might match.
  {
    stems: ['vision', 'image', 'describ', 'screenshot', 'caption'],
    capability: 'vision-describe',
  },
  // Sentiment / classify.
  {
    stems: ['sentiment', 'classif', 'emotion', 'tone', 'mood'],
    capability: 'sentiment-classify',
  },
  // Website pipeline (M12.1.5 — isolation from M12.1.1 lifted now that the
  // pipeline passed e2e): classifier-emitted content/site types route to the
  // live website identities. MUST sit before the summarizer catch-all —
  // 'copywrite' contains 'write'. qa-website is deliberately NOT stem-mapped:
  // its handler expects an EvaluationCase and only the plan-runner's
  // evaluator path provides one.
  { stems: ['copywrit', 'content'], capability: 'copywrite' },
  { stems: ['website', 'web-', 'site', 'landing', 'html'], capability: 'build-website' },
  { stems: ['packag', 'zip'], capability: 'package-archive' },
  // Summarizer is the broad catch — research / write / analyze /
  // compare / summarize / etc. — because the registered Summarizer agent
  // claims `summarize` but in practice its prompt is a generalist
  // executor (see apps/demo-agents/src/summarizer/agent.ts).
  {
    stems: ['summari', 'compar', 'research', 'analy', 'write', 'draft', 'plan', 'recommend'],
    capability: 'summarize',
  },
];

/**
 * Map an LLM-emitted task type to a canonical capability name from the
 * registry, by matching the type against the stem buckets above. Returns
 * null when no stem matches — caller is responsible for fallback.
 */
export function capabilityNameForType(taskType: string): string | null {
  const lower = taskType.toLowerCase();
  for (const bucket of STEM_BUCKETS) {
    if (bucket.stems.some((stem) => lower.includes(stem))) {
      return bucket.capability;
    }
  }
  return null;
}

/**
 * Find the cheapest active agent in `agents` whose capability list
 * contains `capabilityName`. Stable: ties broken by ascending agent address
 * (deterministic per registry state). Returns null when no agent supports
 * the capability.
 */
export function pickAgentForCapability(
  capabilityName: string,
  agents: readonly AgentRecordV2[],
): { address: `0x${string}`; price: bigint } | null {
  const candidates: Array<{ address: `0x${string}`; price: bigint }> = [];

  for (const agent of agents) {
    if (!agent.active) continue;
    for (const cap of agent.capabilities) {
      if (cap.name === capabilityName) {
        candidates.push({ address: agent.id as `0x${string}`, price: cap.price });
        break; // one cap-match per agent is enough
      }
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.price < b.price) return -1;
    if (a.price > b.price) return 1;
    return a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1;
  });

  return candidates[0] ?? null;
}

/**
 * Resolve an executor for an LLM-emitted sub-task type from a pre-fetched
 * agent list. Combines the stem match + cheapest-pick steps.
 */
export function resolveExecutorFromRegistry(
  taskType: string,
  agents: readonly AgentRecordV2[],
): { address: `0x${string}`; price: bigint; capability: string } | null {
  const capability = capabilityNameForType(taskType);
  if (capability === null) return null;

  const pick = pickAgentForCapability(capability, agents);
  if (pick === null) return null;

  return { ...pick, capability };
}

export const __testing = { STEM_BUCKETS };

/**
 * Fact-checker — paid evaluator of the research pipeline (M12.2.2, ADR-0020
 * п.1/п.5). The flagship of «протухшая память»: the synthesizer cited only
 * quotes an extractor verified AT FETCH TIME; the fact-checker independently
 * re-resolves every citation against the LIVE web — the URL must still answer
 * and still contain the quote. A chat can't be held to this; a paid step
 * whose verdict moves money can.
 *
 * Judges the SYNTHESIZER's output (EvaluationCase.result = its artifact
 * envelope). Per the M12.1.4 framing (memory: evaluators judge acceptability):
 * citation resolution is ADVISORY EVIDENCE, not an automatic verdict — the
 * only deterministic blocker is "NOT ONE citation resolves" (the report rests
 * on nothing real); otherwise the paid Sonnet judge (judge-class rule: same
 * class as the Sonnet synthesizer) decides "would a reasonable reader trust
 * this report enough to pay for it?".
 *
 * Verdict discipline (mirrors qa-website.ts / evaluator.ts):
 * - bad INPUT (result not an artifact envelope, doc fails its contract,
 *   citations don't resolve) → verdict `pass:false` with reasons — judging;
 * - HARNESS BREAKAGE (no artifact store, sha/download failure, judge LLM
 *   hard-down) → throw — executor retries, plan-runner degrades to legacy
 *   approve. A broken judge must neither acquit nor convict.
 *
 * A `pass:false` verdict raises the generic evaluator dispute hook in
 * plan-runner: first fail → one synthesizer rework with the defect list,
 * second fail → dispute → council → client refunded (money never leaves).
 */

import {
  decodeEvaluationCase,
  encodeVerdict,
  type EvaluationVerdict,
} from '../../shared/evaluation.js';
import { anthropicChat, ANTHROPIC_MODELS } from '../../shared/anthropic.js';
import {
  parseResearchReportDoc,
  quoteAppearsIn,
  type ResearchCitation,
  type ResearchReportDoc,
} from '../../shared/research.js';
import { decodeArtifactResult } from '../artifacts.js';
import { chat } from '../llm.js';
import { fetchPublicPage, htmlToText, MAX_TEXT_CHARS } from './extractor.js';
import { MOCK_FAIL_MARKER } from './evaluator.js';
import type { CapabilityHandler, HandlerContext } from './index.js';

/** Don't re-fetch an unbounded citation list — a report cites a handful. */
export const MAX_CITATIONS_CHECKED = 8;

export type CitationStatus = 'resolved' | 'dead_url' | 'quote_mismatch';

export interface CitationCheck {
  readonly id: number;
  readonly url: string;
  readonly status: CitationStatus;
  /** Why status !== 'resolved' (HTTP error / "quote no longer on page"). */
  readonly detail?: string;
}

/** Page fetcher seam — prod default re-uses the extractor's guarded fetch. */
export type PageFetcher = (url: string) => Promise<string>;

/**
 * Re-resolve each citation against its live source: the URL must fetch and
 * the quote must still appear (whitespace-insensitively — same predicate the
 * extractor used, so a quote that passed extraction fails here only if the
 * page actually changed or the URL died).
 */
export async function resolveCitations(
  citations: readonly ResearchCitation[],
  fetchPage: PageFetcher,
): Promise<CitationCheck[]> {
  const checked = citations.slice(0, MAX_CITATIONS_CHECKED);
  return Promise.all(
    checked.map(async (c): Promise<CitationCheck> => {
      try {
        const text = htmlToText(await fetchPage(c.url)).slice(0, MAX_TEXT_CHARS);
        return quoteAppearsIn(c.quote, text)
          ? { id: c.id, url: c.url, status: 'resolved' }
          : { id: c.id, url: c.url, status: 'quote_mismatch', detail: 'quote no longer found on the live page' };
      } catch (err) {
        return {
          id: c.id,
          url: c.url,
          status: 'dead_url',
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}

function evidenceLine(c: CitationCheck): string {
  if (c.status === 'resolved') return `[${c.id}] RESOLVED — ${c.url}`;
  const label = c.status === 'dead_url' ? 'DEAD URL' : 'QUOTE NOT FOUND';
  return `[${c.id}] ${label} — ${c.url}${c.detail ? ` (${c.detail})` : ''}`;
}

const JUDGE_SYSTEM =
  'You are the paid fact-checking evaluator of a research report. The report makes claims, each ' +
  'with a numbered citation [n] → {url, quote}. An automated check has independently re-fetched ' +
  'every cited URL and tested whether the quote STILL appears on the live page. You receive the ' +
  'report, the citations, and that per-citation resolution evidence (RESOLVED / DEAD URL / QUOTE ' +
  'NOT FOUND). Decide ONE question: would a reasonable reader trust this report enough to pay for ' +
  'it? Refuse (acceptable=false) when the report\'s CORE claims rest on citations that fail to ' +
  'resolve — dead links or quotes no longer on the page are exactly the «stale memory» defect this ' +
  'pipeline exists to catch. A report whose key findings are backed by resolving citations is ' +
  'acceptable even if a minor citation has rotted. Do not refuse over a single non-load-bearing ' +
  'dead link when the substance holds. Respond with JSON {"acceptable": boolean, "issues": ' +
  'string[]} where issues name the specific citations and claims that fail (empty when acceptable).';

const JUDGE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    acceptable: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['acceptable', 'issues'],
  additionalProperties: false,
};

async function judgeTrust(
  doc: ResearchReportDoc,
  checks: readonly CitationCheck[],
  ctx: HandlerContext,
): Promise<{ acceptable: boolean; issues: string[] }> {
  if (!ctx.openaiApiKey && !ctx.anthropicApiKey) {
    // Keyless mock judge — same MOCK_FAIL_MARKER convention as the harness.
    const fail = doc.report_markdown.includes(MOCK_FAIL_MARKER);
    return { acceptable: !fail, issues: fail ? [`mock fact-check judge: report contains ${MOCK_FAIL_MARKER}`] : [] };
  }

  const citationLines = doc.citations
    .map((c) => `[${c.id}] claim: ${c.claim}\n    url: ${c.url}\n    quote: "${c.quote}"`)
    .join('\n');
  const evidence = checks.map(evidenceLine).join('\n');
  const user =
    `RESEARCH QUESTION:\n${doc.question}\n\n` +
    `REPORT:\n${doc.report_markdown}\n\n` +
    `CITATIONS:\n${citationLines}\n\n` +
    `LIVE RE-RESOLUTION EVIDENCE:\n${evidence}`;

  // Judge-class rule: synthesizer is Sonnet → fact-checker ≥ Sonnet.
  const raw = ctx.anthropicApiKey
    ? await anthropicChat({
        apiKey: ctx.anthropicApiKey,
        model: ANTHROPIC_MODELS.sonnet,
        system: JUDGE_SYSTEM,
        user,
        maxTokens: 800,
        jsonSchema: JUDGE_SCHEMA,
      })
    : await chat({
        apiKey: ctx.openaiApiKey!,
        model: 'gpt-4o',
        system: JUDGE_SYSTEM,
        user,
        maxTokens: 600,
        json: true,
      });
  const parsed = JSON.parse(raw) as { acceptable?: unknown; issues?: unknown };
  if (typeof parsed.acceptable !== 'boolean') {
    throw new Error('fact-check judge returned no boolean acceptable'); // breakage → retry
  }
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.filter((i): i is string => typeof i === 'string')
    : [];
  return { acceptable: parsed.acceptable, issues };
}

export interface FactCheckerDeps {
  /** Test seam — prod default is the extractor's SSRF-guarded fetch. */
  readonly fetchPage?: PageFetcher;
}

export function makeFactCheckerHandler(deps: FactCheckerDeps = {}): CapabilityHandler {
  const fetchPage = deps.fetchPage ?? fetchPublicPage;

  return async (job, ctx) => {
    const evalCase = job.material !== null ? decodeEvaluationCase(job.material) : null;
    if (!evalCase) {
      // No judgeable case → no verdict (harness convention, see evaluator.ts).
      return 'Evaluation skipped: no decodable evaluation case in task material.';
    }
    if (!ctx.artifacts) {
      throw new Error('artifact store unavailable — fact-checker cannot fetch the research report');
    }

    const fail = (reasons: string[], score?: number): string =>
      encodeVerdict({ pass: false, reasons, ...(score !== undefined ? { score } : {}) });

    // Input quality, not breakage: the synthesizer is PAID to deliver a report
    // artifact — judge accordingly.
    const ref = decodeArtifactResult(evalCase.result);
    if (!ref) {
      return fail(['synthesizer result is not an artifact envelope']);
    }
    const bytes = await ctx.artifacts.download(ref); // sha-verified; throws = breakage
    const doc = parseResearchReportDoc(JSON.parse(new TextDecoder().decode(bytes)));
    if (!doc) {
      return fail(['synthesizer artifact is not a valid research report']);
    }
    if (doc.citations.length === 0) {
      return fail(['report carries no citations to verify'], 0);
    }

    const checks = await resolveCitations(doc.citations, fetchPage);
    const resolved = checks.filter((c) => c.status === 'resolved').length;
    const score = Math.round((resolved / checks.length) * 100);

    // The only deterministic blocker: nothing resolves → the report rests on
    // nothing real. Otherwise the paid judge decides acceptability.
    if (resolved === 0) {
      return fail(
        ['blocker: not one citation resolves against its live source', ...checks.map(evidenceLine)],
        0,
      );
    }

    const judgement = await judgeTrust(doc, checks, ctx);
    const pass = judgement.acceptable;
    const reasons = pass
      ? []
      : [
          ...(judgement.issues.length > 0
            ? judgement.issues
            : ['citations do not adequately support the report']),
          // Failed citations ride along so the rework instruction is concrete.
          ...checks.filter((c) => c.status !== 'resolved').map(evidenceLine),
        ];

    const verdict: EvaluationVerdict = { pass, reasons, score };
    return encodeVerdict(verdict);
  };
}

export const factCheckerHandler: CapabilityHandler = makeFactCheckerHandler();

/**
 * QA gate — paid evaluator of the website pipeline (M12.1.2, ADR-0020 п.1/п.5).
 *
 * Judges the BUILDER's output: downloads the site manifest from the artifact
 * store (sha-verified against what the builder committed on-chain), then runs
 * three checks — deterministic HTML validation (html-validate, no browser),
 * a Lighthouse audit and a rendered screenshot (system chromium via
 * qa-browser.ts), and an LLM copy-fidelity pass (4o-mini; deterministic mock
 * when keyless, same MOCK_FAIL_MARKER convention as the generic harness).
 *
 * Verdict discipline (mirrors evaluator.ts):
 * - bad INPUT QUALITY (result is not an artifact envelope, manifest fails
 *   validation, HTML errors, thresholds missed, copy mismatch) → verdict
 *   `pass:false` with concrete reasons — that's judging, the builder pays;
 * - HARNESS BREAKAGE (no artifact store, download/sha failure, browser or
 *   LLM hard-down) → throw — executor retries, then settles an honest
 *   `Task failed: …`, and the plan-runner degrades to legacy approve. A
 *   broken judge must neither acquit nor convict.
 *
 * The screenshot ships INSIDE the verdict envelope (VerdictScreenshot) even
 * on fail — previewing a rejected site is exactly what the UI wants.
 */

import { HtmlValidate } from 'html-validate';

import {
  decodeEvaluationCase,
  encodeVerdict,
  type EvaluationVerdict,
} from '../../shared/evaluation.js';
import { decodeArtifactResult } from '../artifacts.js';
import { chat } from '../llm.js';
import { validateManifest, type SiteManifest } from './builder.js';
import { MOCK_FAIL_MARKER } from './evaluator.js';
import { runBrowserAudit, type QaAuditRunner } from './qa-browser.js';
import type { CapabilityHandler, HandlerContext } from './index.js';

/**
 * Gate model (M12.1.4, рамка Alex 2026-06-11): findings are EVIDENCE, not
 * verdicts. Deterministic checks (html-validate, Lighthouse) only collect
 * advisory findings + scores; payment is blocked exclusively by
 * (a) objective BLOCKERS — no parseable index.html, catastrophic
 *     accessibility (< ACCESSIBILITY_BLOCKER: the page is effectively
 *     unusable), or a failed render (audit throw = breakage path);
 * (b) the paid LLM judgement: "would a reasonable client refuse to pay for
 *     this deliverable, given the brief and this evidence?".
 * A run must never die over `tel-non-breaking`-grade pedantry (observed
 * live: run with score 99 disputed over spaces in a phone number).
 */
export const ACCESSIBILITY_BLOCKER = 50;
/** Cap findings so a pathological page can't balloon the on-chain result. */
const MAX_HTML_FINDINGS = 8;
const MAX_COPY_CHARS = 8_000;

// Recommended preset minus pure-STYLE rules: the gate judges correctness
// (broken nesting, invalid attributes, missing required elements), never
// formatting taste — a lowercase doctype must not withhold a payment.
const htmlValidator = new HtmlValidate({
  extends: ['html-validate:recommended'],
  rules: {
    'doctype-style': 'off',
    'attr-quotes': 'off',
    'void-style': 'off',
    'no-trailing-whitespace': 'off',
    'no-inline-style': 'off',
  },
});

/** Validate every .html file in the manifest; returns capped findings. */
export async function validateHtmlFiles(manifest: SiteManifest): Promise<string[]> {
  const findings: string[] = [];
  for (const file of manifest.files) {
    if (!file.path.toLowerCase().endsWith('.html')) continue;
    const report = await htmlValidator.validateString(file.content, file.path);
    for (const result of report.results) {
      for (const msg of result.messages) {
        if (msg.severity !== 2) continue; // errors only — warnings don't gate payment
        if (findings.length >= MAX_HTML_FINDINGS) {
          findings.push(`…more HTML errors truncated at ${MAX_HTML_FINDINGS}`);
          return findings;
        }
        findings.push(`${file.path}:${msg.line} ${msg.ruleId}: ${msg.message}`);
      }
    }
  }
  return findings;
}

/** Strip tags/scripts/styles to the visible text the LLM judges. */
export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_COPY_CHARS);
}

const ACCEPTANCE_JUDGE_SYSTEM =
  'You are the paid QA evaluator of a website pipeline. The builder was given an instruction ' +
  'and produced a static site; you receive the visible text of its index.html plus EVIDENCE ' +
  'collected by automated checks (HTML-validator findings, Lighthouse scores). Decide ONE ' +
  'question: would a reasonable client refuse to PAY for this deliverable? Refuse only for ' +
  'real defects: wrong language, off-topic or placeholder/lorem copy, obvious truncation, ' +
  'broken structure. Automated findings are advisory evidence, NOT verdicts — stylistic ' +
  'pedantry (formatting, non-breaking spaces, minor markup taste) must NEVER fail a ' +
  'deliverable on its own. Respond with JSON {"acceptable": boolean, "issues": string[]} ' +
  'where issues are concrete, actionable defects (empty when acceptable).';

async function judgeAcceptance(
  instruction: string,
  indexHtml: string,
  evidence: { findings: readonly string[]; scores: string },
  ctx: HandlerContext,
): Promise<{ acceptable: boolean; issues: string[] }> {
  const text = visibleText(indexHtml);
  if (!ctx.openaiApiKey) {
    const fail = text.includes(MOCK_FAIL_MARKER);
    return {
      acceptable: !fail,
      issues: fail ? [`mock acceptance judge: page contains ${MOCK_FAIL_MARKER}`] : [],
    };
  }
  const raw = await chat({
    apiKey: ctx.openaiApiKey,
    system: ACCEPTANCE_JUDGE_SYSTEM,
    user:
      `INSTRUCTION GIVEN TO BUILDER:\n${instruction}\n\n` +
      `VISIBLE TEXT OF index.html:\n${text}\n\n` +
      `AUTOMATED EVIDENCE (advisory):\nLighthouse: ${evidence.scores}\n` +
      (evidence.findings.length > 0
        ? `Validator findings:\n${evidence.findings.map((f) => `- ${f}`).join('\n')}`
        : 'Validator findings: none'),
    maxTokens: 500,
    json: true,
  });
  const parsed = JSON.parse(raw) as { acceptable?: unknown; issues?: unknown };
  if (typeof parsed.acceptable !== 'boolean') {
    throw new Error('acceptance judge returned no boolean acceptable'); // breakage → executor retry
  }
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.filter((i): i is string => typeof i === 'string')
    : [];
  return { acceptable: parsed.acceptable, issues };
}

export interface QaWebsiteDeps {
  /** Test seam — prod default is the real chromium audit. */
  readonly audit?: QaAuditRunner;
}

export function makeQaWebsiteHandler(deps: QaWebsiteDeps = {}): CapabilityHandler {
  const audit = deps.audit ?? runBrowserAudit;

  return async (job, ctx) => {
    const evalCase = job.material !== null ? decodeEvaluationCase(job.material) : null;
    if (!evalCase) {
      // No judgeable case → no verdict (harness convention, see evaluator.ts).
      return 'Evaluation skipped: no decodable evaluation case in task material.';
    }
    if (!ctx.artifacts) {
      throw new Error('artifact store unavailable — QA gate cannot fetch the site manifest');
    }

    const fail = (reasons: string[]): string =>
      encodeVerdict({ pass: false, reasons });

    // Input quality, not breakage: the builder is PAID to produce an
    // artifact envelope with a valid manifest — judge accordingly.
    const ref = decodeArtifactResult(evalCase.result);
    if (!ref) {
      return fail(['builder result is not an artifact envelope']);
    }
    const bytes = await ctx.artifacts.download(ref); // sha-verified; throws = breakage
    let manifest: SiteManifest;
    try {
      manifest = validateManifest(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (err) {
      return fail([`manifest rejected: ${err instanceof Error ? err.message : String(err)}`]);
    }

    // Advisory evidence: validator findings + Lighthouse scores. None of
    // these block payment by themselves (M12.1.4).
    const htmlFindings = await validateHtmlFiles(manifest);
    const { lighthouse, screenshotPng } = await audit(manifest);
    if (lighthouse.accessibility === null) {
      throw new Error('lighthouse audit incomplete (accessibility missing)');
    }
    const scoresLine =
      `performance ${lighthouse.performance ?? 'n/a'}, accessibility ${lighthouse.accessibility}, ` +
      `best-practices ${lighthouse.bestPractices ?? 'n/a'}, seo ${lighthouse.seo ?? 'n/a'}`;

    // Objective blockers — the only deterministic payment stops.
    const blockers: string[] = [];
    if (lighthouse.accessibility < ACCESSIBILITY_BLOCKER) {
      blockers.push(
        `blocker: lighthouse accessibility ${lighthouse.accessibility} < ${ACCESSIBILITY_BLOCKER} — page is effectively unusable`,
      );
    }

    // Paid judgement: acceptability of the deliverable given the evidence.
    const indexHtml =
      manifest.files.find((f) => f.path.toLowerCase() === 'index.html')?.content ?? '';
    const judgement = await judgeAcceptance(
      evalCase.instruction,
      indexHtml,
      { findings: htmlFindings, scores: scoresLine },
      ctx,
    );

    const screenshot = await ctx.artifacts.upload(screenshotPng, 'image/png');

    const scoreParts = [
      lighthouse.performance,
      lighthouse.accessibility,
      lighthouse.bestPractices,
      lighthouse.seo,
    ].filter((s): s is number => s !== null);
    const score = Math.round(scoreParts.reduce((a, b) => a + b, 0) / scoreParts.length);

    const pass = blockers.length === 0 && judgement.acceptable;
    // On fail, reasons = actionable defects (blockers + judge issues) — they
    // feed the rework instruction and, on a second fail, the dispute reason.
    // Advisory findings only ride along on fail for transparency.
    const reasons = pass
      ? []
      : [
          ...blockers,
          ...(judgement.acceptable ? [] : judgement.issues.length > 0
            ? judgement.issues
            : ['deliverable does not acceptably fulfill the instruction']),
          ...htmlFindings.map((f) => `advisory: ${f}`),
        ];

    const verdict: EvaluationVerdict = { pass, reasons, score, screenshot };
    return encodeVerdict(verdict);
  };
}

export const qaWebsiteHandler: CapabilityHandler = makeQaWebsiteHandler();

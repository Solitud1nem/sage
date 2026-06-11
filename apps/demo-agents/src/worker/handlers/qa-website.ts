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

export const PERFORMANCE_MIN = 70;
export const ACCESSIBILITY_MIN = 80;
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

const COPY_JUDGE_SYSTEM =
  'You are the QA evaluator of a website pipeline. The builder was given an instruction ' +
  '(derived from a copy deck) and produced a static site; you receive the visible text of ' +
  'its index.html. Judge ONLY whether the page content plausibly fulfills the instruction: ' +
  'right language, on-topic copy, no placeholder/lorem text, no obvious truncation. ' +
  'Ignore style preferences. Respond with a JSON object {"ok": boolean, "issues": string[]}.';

async function judgeCopy(
  instruction: string,
  indexHtml: string,
  ctx: HandlerContext,
): Promise<{ ok: boolean; issues: string[] }> {
  const text = visibleText(indexHtml);
  if (!ctx.openaiApiKey) {
    const fail = text.includes(MOCK_FAIL_MARKER);
    return {
      ok: !fail,
      issues: fail ? [`mock copy judge: page contains ${MOCK_FAIL_MARKER}`] : [],
    };
  }
  const raw = await chat({
    apiKey: ctx.openaiApiKey,
    system: COPY_JUDGE_SYSTEM,
    user: `INSTRUCTION GIVEN TO BUILDER:\n${instruction}\n\nVISIBLE TEXT OF index.html:\n${text}`,
    maxTokens: 500,
    json: true,
  });
  const parsed = JSON.parse(raw) as { ok?: unknown; issues?: unknown };
  if (typeof parsed.ok !== 'boolean') {
    throw new Error('copy judge returned no boolean ok'); // breakage → executor retry
  }
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.filter((i): i is string => typeof i === 'string')
    : [];
  return { ok: parsed.ok, issues };
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

    const reasons: string[] = [];

    const htmlFindings = await validateHtmlFiles(manifest);
    reasons.push(...htmlFindings);

    const { lighthouse, screenshotPng } = await audit(manifest);
    if (lighthouse.performance === null || lighthouse.accessibility === null) {
      throw new Error('lighthouse audit incomplete (performance/accessibility missing)');
    }
    if (lighthouse.performance < PERFORMANCE_MIN) {
      reasons.push(`lighthouse performance ${lighthouse.performance} < ${PERFORMANCE_MIN}`);
    }
    if (lighthouse.accessibility < ACCESSIBILITY_MIN) {
      reasons.push(`lighthouse accessibility ${lighthouse.accessibility} < ${ACCESSIBILITY_MIN}`);
    }

    const indexHtml =
      manifest.files.find((f) => f.path.toLowerCase() === 'index.html')?.content ?? '';
    const copy = await judgeCopy(evalCase.instruction, indexHtml, ctx);
    if (!copy.ok) {
      reasons.push(...(copy.issues.length > 0 ? copy.issues : ['copy does not match the instruction']));
    }

    const screenshot = await ctx.artifacts.upload(screenshotPng, 'image/png');

    const scoreParts = [
      lighthouse.performance,
      lighthouse.accessibility,
      lighthouse.bestPractices,
      lighthouse.seo,
    ].filter((s): s is number => s !== null);
    const score = Math.round(scoreParts.reduce((a, b) => a + b, 0) / scoreParts.length);

    const verdict: EvaluationVerdict = {
      pass: reasons.length === 0,
      reasons,
      score,
      screenshot,
    };
    return encodeVerdict(verdict);
  };
}

export const qaWebsiteHandler: CapabilityHandler = makeQaWebsiteHandler();

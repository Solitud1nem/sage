/**
 * QA gate evaluator (M12.1.2): verdict discipline (input-quality fail vs
 * harness-breakage throw), deterministic HTML validation, Lighthouse
 * thresholds, mock copy judge, screenshot-in-verdict envelope — plus the
 * keyless website chain extended with the QA step exactly the way the
 * plan-runner delivers it (EvaluationCase via inputs).
 */
import { describe, it, expect } from 'vitest';

import {
  makeQaWebsiteHandler,
  validateHtmlFiles,
  visibleText,
  ACCESSIBILITY_BLOCKER,
} from '../../src/worker/handlers/qa-website.js';
import { MOCK_FAIL_MARKER } from '../../src/worker/handlers/evaluator.js';
import { builderHandler } from '../../src/worker/handlers/builder.js';
import { copywriterHandler } from '../../src/worker/handlers/copywriter.js';
import { serveManifest, type QaAudit, type QaAuditRunner } from '../../src/worker/handlers/qa-browser.js';
import {
  sha256Hex,
  encodeArtifactResult,
  type ArtifactStore,
} from '../../src/worker/artifacts.js';
import {
  encodeEvaluationCase,
  encodeVerdict,
  decodeVerdict,
} from '../../src/shared/evaluation.js';
import type { HandlerContext } from '../../src/worker/handlers/index.js';

function makeFakeStore() {
  const objects = new Map<string, { bytes: Uint8Array; mime: string }>();
  const store: ArtifactStore = {
    async upload(bytes, mime) {
      const sha256 = sha256Hex(bytes);
      objects.set(sha256, { bytes, mime });
      return { sha256, size: bytes.byteLength, mime, url: `https://gw.example/api/artifacts/${sha256}` };
    },
    async download(ref) {
      const obj = objects.get(ref.sha256);
      if (!obj) throw new Error('artifact download failed (HTTP 404)');
      if (sha256Hex(obj.bytes) !== ref.sha256) throw new Error('artifact sha256 mismatch');
      return obj.bytes;
    },
  };
  return { store, objects };
}

const ctx = (over: Partial<HandlerContext> = {}): HandlerContext => ({
  identityId: 'qa-website',
  capability: 'qa-website',
  openaiApiKey: undefined,
  ...over,
});

const GOOD_SCORES = { performance: 96, accessibility: 95, bestPractices: 92, seo: 90 };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const cannedAudit =
  (audit: Partial<QaAudit> = {}): QaAuditRunner =>
  async () => ({ lighthouse: GOOD_SCORES, screenshotPng: PNG, ...audit });

const VALID_HTML =
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T</title></head>' +
  '<body><main><h1>Site</h1><p>Hello</p></main></body></html>';

/** Upload a manifest JSON and wrap it the way the builder's result does. */
async function manifestResult(store: ArtifactStore, manifest: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  return encodeArtifactResult(await store.upload(bytes, 'application/json'));
}

const evalMaterial = (instruction: string, result: string) =>
  encodeEvaluationCase({ instruction, result });

describe('qa-website verdict discipline', () => {
  it('returns non-verdict text when the material is not an evaluation case', async () => {
    const handler = makeQaWebsiteHandler({ audit: cannedAudit() });
    const out = await handler({ spec: 'judge', material: 'not a case' }, ctx());
    expect(out).toMatch(/Evaluation skipped/);
    expect(decodeVerdict(out)).toBeNull();
  });

  it('throws without an artifact store (breakage, not a verdict)', async () => {
    const handler = makeQaWebsiteHandler({ audit: cannedAudit() });
    await expect(
      handler({ spec: 'judge', material: evalMaterial('build', '{}') }, ctx()),
    ).rejects.toThrow(/artifact store unavailable/);
  });

  it('fails the verdict when the builder result is not an artifact envelope', async () => {
    const { store } = makeFakeStore();
    const handler = makeQaWebsiteHandler({ audit: cannedAudit() });
    const out = await handler(
      { spec: 'judge', material: evalMaterial('build', 'plain text result') },
      ctx({ artifacts: store }),
    );
    const verdict = decodeVerdict(out);
    expect(verdict?.pass).toBe(false);
    expect(verdict?.reasons.join(' ')).toMatch(/not an artifact envelope/);
  });

  it('fails the verdict when the manifest does not validate', async () => {
    const { store } = makeFakeStore();
    const result = await manifestResult(store, { files: [{ path: 'about.html', content: 'x' }] });
    const handler = makeQaWebsiteHandler({ audit: cannedAudit() });
    const out = await handler(
      { spec: 'judge', material: evalMaterial('build', result) },
      ctx({ artifacts: store }),
    );
    const verdict = decodeVerdict(out);
    expect(verdict?.pass).toBe(false);
    expect(verdict?.reasons.join(' ')).toMatch(/manifest rejected: .*index\.html/);
  });

  it('passes a clean site: verdict carries score + uploaded screenshot', async () => {
    const { store, objects } = makeFakeStore();
    const result = await manifestResult(store, {
      files: [{ path: 'index.html', content: VALID_HTML }],
    });
    const handler = makeQaWebsiteHandler({ audit: cannedAudit() });
    const out = await handler(
      { spec: 'judge', material: evalMaterial('build a site', result) },
      ctx({ artifacts: store }),
    );

    const verdict = decodeVerdict(out);
    expect(verdict?.pass).toBe(true);
    expect(verdict?.reasons).toHaveLength(0);
    expect(verdict?.score).toBe(
      Math.round((GOOD_SCORES.performance + GOOD_SCORES.accessibility + GOOD_SCORES.bestPractices + GOOD_SCORES.seo) / 4),
    );
    // Screenshot really landed in the store under its content hash.
    expect(verdict?.screenshot?.mime).toBe('image/png');
    expect(objects.get(verdict!.screenshot!.sha256)?.bytes).toEqual(PNG);
  });

  it('HTML validation errors are ADVISORY — keyless verdict passes despite findings (M12.1.4)', async () => {
    const { store } = makeFakeStore();
    const broken =
      '<!DOCTYPE html><html lang="en"><head><title>T</title></head>' +
      '<body><div><span></div></span></body></html>'; // close-order error
    const result = await manifestResult(store, { files: [{ path: 'index.html', content: broken }] });
    const handler = makeQaWebsiteHandler({ audit: cannedAudit() });
    const out = await handler(
      { spec: 'judge', material: evalMaterial('build', result) },
      ctx({ artifacts: store }),
    );
    const verdict = decodeVerdict(out);
    expect(verdict?.pass).toBe(true);
    expect(verdict?.reasons).toHaveLength(0);
  });

  it('low scores are advisory, but catastrophic accessibility is a BLOCKER', async () => {
    const { store } = makeFakeStore();
    const result = await manifestResult(store, {
      files: [{ path: 'index.html', content: VALID_HTML }],
    });
    // Terrible-but-usable scores → advisory only → pass.
    const lowOut = await makeQaWebsiteHandler({
      audit: cannedAudit({
        lighthouse: { performance: 15, accessibility: ACCESSIBILITY_BLOCKER, bestPractices: 50, seo: 40 },
      }),
    })({ spec: 'judge', material: evalMaterial('build', result) }, ctx({ artifacts: store }));
    expect(decodeVerdict(lowOut)?.pass).toBe(true);

    // Below the blocker line → deterministic fail with blocker + advisory trail.
    const blockedOut = await makeQaWebsiteHandler({
      audit: cannedAudit({
        lighthouse: { performance: 90, accessibility: ACCESSIBILITY_BLOCKER - 1, bestPractices: 90, seo: 90 },
      }),
    })({ spec: 'judge', material: evalMaterial('build', result) }, ctx({ artifacts: store }));
    const verdict = decodeVerdict(blockedOut);
    expect(verdict?.pass).toBe(false);
    expect(verdict?.reasons.join(' ')).toMatch(/blocker: lighthouse accessibility \d+ </);
  });

  it('missing performance score is tolerated; missing accessibility throws (breakage)', async () => {
    const { store } = makeFakeStore();
    const result = await manifestResult(store, {
      files: [{ path: 'index.html', content: VALID_HTML }],
    });
    const okOut = await makeQaWebsiteHandler({
      audit: cannedAudit({
        lighthouse: { performance: null, accessibility: 95, bestPractices: 90, seo: 90 },
      }),
    })({ spec: 'judge', material: evalMaterial('build', result) }, ctx({ artifacts: store }));
    expect(decodeVerdict(okOut)?.pass).toBe(true);

    await expect(
      makeQaWebsiteHandler({
        audit: cannedAudit({
          lighthouse: { performance: 90, accessibility: null, bestPractices: 90, seo: 90 },
        }),
      })({ spec: 'judge', material: evalMaterial('build', result) }, ctx({ artifacts: store })),
    ).rejects.toThrow(/lighthouse audit incomplete/);
  });

  it(`keyless copy judge fails on ${MOCK_FAIL_MARKER} in the page text`, async () => {
    const { store } = makeFakeStore();
    const html = VALID_HTML.replace('<p>Hello</p>', `<p>${MOCK_FAIL_MARKER}</p>`);
    const result = await manifestResult(store, { files: [{ path: 'index.html', content: html }] });
    const handler = makeQaWebsiteHandler({ audit: cannedAudit() });
    const out = await handler(
      { spec: 'judge', material: evalMaterial('build', result) },
      ctx({ artifacts: store }),
    );
    const verdict = decodeVerdict(out);
    expect(verdict?.pass).toBe(false);
    expect(verdict?.reasons.join(' ')).toContain(MOCK_FAIL_MARKER);
  });
});

describe('helpers', () => {
  it('validateHtmlFiles reports errors only for .html files', async () => {
    const findings = await validateHtmlFiles({
      files: [
        { path: 'index.html', content: VALID_HTML },
        { path: 'styles.css', content: 'this is < not html >' },
      ],
    });
    expect(findings).toHaveLength(0);
  });

  it('visibleText strips scripts, styles and tags', () => {
    const text = visibleText(
      '<html><head><style>.a{color:red}</style></head>' +
        '<body><script>var x = "hidden";</script><h1>Hello &amp; Welcome</h1></body></html>',
    );
    expect(text).toBe('Hello & Welcome');
  });

  it('serveManifest serves files with content-types and 404s the rest', async () => {
    const { server, origin } = await serveManifest({
      files: [
        { path: 'index.html', content: '<h1>ok</h1>' },
        { path: 'styles.css', content: 'body{}' },
      ],
    });
    try {
      const index = await fetch(`${origin}/`);
      expect(index.status).toBe(200);
      expect(index.headers.get('content-type')).toContain('text/html');
      expect(await index.text()).toBe('<h1>ok</h1>');
      const css = await fetch(`${origin}/styles.css`);
      expect(css.headers.get('content-type')).toContain('text/css');
      const missing = await fetch(`${origin}/nope.js`);
      expect(missing.status).toBe(404);
    } finally {
      server.close();
    }
  });
});

describe('verdict envelope screenshot (shared codec)', () => {
  const shot = {
    sha256: 'a'.repeat(64),
    size: 7,
    mime: 'image/png',
    url: 'https://gw.example/api/artifacts/' + 'a'.repeat(64),
  };

  it('round-trips a screenshot', () => {
    const decoded = decodeVerdict(encodeVerdict({ pass: true, reasons: [], score: 90, screenshot: shot }));
    expect(decoded?.screenshot).toEqual(shot);
  });

  it('drops a malformed screenshot but keeps the verdict', () => {
    const raw = JSON.stringify({ verdict: { pass: false, reasons: ['r'], screenshot: { sha256: 'short' } } });
    const decoded = decodeVerdict(raw);
    expect(decoded?.pass).toBe(false);
    expect(decoded?.screenshot).toBeUndefined();
  });

  it('still decodes legacy verdicts without a screenshot', () => {
    const decoded = decodeVerdict(JSON.stringify({ verdict: { pass: true, reasons: [] } }));
    expect(decoded).toEqual({ pass: true, reasons: [] });
  });
});

describe('full website chain + QA gate (keyless, plan-runner wiring)', () => {
  it('brief → copy → manifest → QA verdict pass with screenshot', async () => {
    const { store } = makeFakeStore();

    const copy = await copywriterHandler(
      { spec: 'write the copy deck', material: 'Кофейня у моря' },
      ctx({ identityId: 'copywriter', capability: 'copywrite' }),
    );
    const builderOut = await builderHandler(
      { spec: 'build the site', material: copy },
      ctx({ identityId: 'builder', capability: 'build-website', artifacts: store }),
    );
    // The plan-runner hands the evaluator the judged step's spec + result.
    const handler = makeQaWebsiteHandler({ audit: cannedAudit() });
    const out = await handler(
      { spec: 'QA the produced site', material: evalMaterial('build the site', builderOut) },
      ctx({ artifacts: store }),
    );

    const verdict = decodeVerdict(out);
    expect(verdict?.pass).toBe(true);
    expect(verdict?.screenshot?.mime).toBe('image/png');
  });
});

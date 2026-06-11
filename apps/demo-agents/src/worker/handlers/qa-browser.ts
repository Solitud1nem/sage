/**
 * Real browser audit for the QA gate (M12.1.2): serves the validated site
 * manifest from memory on localhost, runs Lighthouse + takes a screenshot
 * through a system chromium (Docker `workers` target installs it;
 * CHROME_PATH points at the binary).
 *
 * Lives in its own module so the handler — and its unit tests — never load
 * puppeteer/lighthouse: both are imported lazily inside `runBrowserAudit`.
 * Any failure here THROWS (llm.ts semantics): the executor retries, then
 * settles an honest `Task failed: …`, which the plan-runner degrades to the
 * legacy approve path — a broken browser must never fabricate a verdict.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { SiteManifest } from './builder.js';

/** Lighthouse category scores, 0..100 (null = category did not run). */
export interface LighthouseScores {
  readonly performance: number | null;
  readonly accessibility: number | null;
  readonly bestPractices: number | null;
  readonly seo: number | null;
}

export interface QaAudit {
  readonly lighthouse: LighthouseScores;
  readonly screenshotPng: Uint8Array;
}

/** Injectable seam: tests provide a canned audit, prod uses runBrowserAudit. */
export type QaAuditRunner = (manifest: SiteManifest) => Promise<QaAudit>;

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const VIEWPORT = { width: 1280, height: 800 } as const;
/** Single ceiling for the whole audit — well under the executor deadline. */
const AUDIT_TIMEOUT_MS = 90_000;

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/** Serve the manifest from memory on 127.0.0.1:<ephemeral>. */
export function serveManifest(manifest: SiteManifest): Promise<{ server: Server; origin: string }> {
  const files = new Map(manifest.files.map((f) => [`/${f.path}`, f]));
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const file = files.get(path === '/' ? '/index.html' : path);
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': contentTypeFor(file.path) });
    res.end(file.content);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

function score100(category: unknown): number | null {
  const s = (category as { score?: unknown } | undefined)?.score;
  return typeof s === 'number' && Number.isFinite(s) ? Math.round(s * 100) : null;
}

export const runBrowserAudit: QaAuditRunner = async (manifest) => {
  // Lazy imports: keep chromium-stack out of every other handler's bundle path.
  const { default: puppeteer } = await import('puppeteer-core');
  const { default: lighthouse } = await import('lighthouse');

  const executablePath = process.env['CHROME_PATH'];
  if (!executablePath) {
    throw new Error('CHROME_PATH is not set — QA browser audit needs a system chromium');
  }

  const timeout = AbortSignal.timeout(AUDIT_TIMEOUT_MS);
  const { server, origin } = await serveManifest(manifest);
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({
      executablePath,
      // Container-standard flags: the worker runs as a non-root user in a
      // slim image without user-namespace privileges for the sandbox.
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    timeout.throwIfAborted();

    const url = `${origin}/index.html`;
    const cdpPort = Number(new URL(browser.wsEndpoint()).port);
    const result = await lighthouse(
      url,
      { port: cdpPort, output: 'json', logLevel: 'error' },
      {
        extends: 'lighthouse:default',
        settings: {
          onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
          formFactor: 'desktop',
          screenEmulation: { ...VIEWPORT, mobile: false, deviceScaleFactor: 1, disabled: false },
        },
      },
    );
    timeout.throwIfAborted();
    if (!result) {
      throw new Error('lighthouse returned no result');
    }
    const cats = result.lhr.categories;
    const scores: LighthouseScores = {
      performance: score100(cats['performance']),
      accessibility: score100(cats['accessibility']),
      bestPractices: score100(cats['best-practices']),
      seo: score100(cats['seo']),
    };

    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });
    const screenshotPng = new Uint8Array(await page.screenshot({ type: 'png' }));

    return { lighthouse: scores, screenshotPng };
  } finally {
    await browser?.close().catch(() => undefined);
    server.close();
  }
};

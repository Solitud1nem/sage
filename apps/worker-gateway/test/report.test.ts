/**
 * Hosted research report (M12.2.3): renders a ResearchReportDoc artifact as
 * readable, containment-headed HTML; escapes untrusted LLM content; refuses
 * non-report artifacts.
 */
import { describe, it, expect } from 'vitest';

import { handleReport } from '../src/report';

const SHA = 'a'.repeat(64);
const DOC = {
  question: 'What is task escrow?',
  report_markdown:
    '# Findings\nEscrow **holds** funds until approval [1].\n\n- point one\n- point two [2]',
  citations: [
    { id: 1, claim: 'Escrow holds funds', url: 'https://a.example/x', quote: 'funds are held' },
    { id: 2, claim: 'Two parties', url: 'javascript:alert(1)', quote: 'two parties agree' },
  ],
  sources: [{ url: 'https://a.example/x', title: 'A', status: 'ok' }],
};

function makeEnv(objects: Record<string, { json: unknown; contentType: string }>) {
  return {
    ARTIFACTS: {
      async get(key: string) {
        const o = objects[key];
        if (!o) return null;
        return { httpMetadata: { contentType: o.contentType }, json: async () => o.json };
      },
    },
  } as unknown as Parameters<typeof handleReport>[1];
}

const env = makeEnv({ [SHA]: { json: DOC, contentType: 'application/json' } });
const get = (path: string) => handleReport(new Request(`https://gw.example${path}`), env);

describe('handleReport', () => {
  it('renders the report as HTML with containment headers', async () => {
    const res = await get(`/report/${SHA}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    // Question is the title + h1; markdown rendered (heading, bold, list).
    expect(html).toContain('<title>What is task escrow?</title>');
    expect(html).toContain('<strong>holds</strong>');
    expect(html).toContain('<li>point one</li>');
    // [n] markers become citation anchors.
    expect(html).toContain('href="#cite-1"');
    expect(html).toContain('id="cite-1"');
  });

  it('escapes untrusted content and neutralizes non-http citation links', async () => {
    const xssDoc = {
      question: '<img src=x onerror=alert(1)>',
      report_markdown: 'A claim <script>alert(1)</script> here',
      citations: [{ id: 1, claim: 'c', url: 'https://ok.example/', quote: '<b>q</b>' }],
    };
    const res = await handleReport(
      new Request(`https://gw.example/report/${SHA}`),
      makeEnv({ [SHA]: { json: xssDoc, contentType: 'application/json' } }),
    );
    const html = await res.text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x');
    // The javascript: link in DOC would not render as an href — verify via DOC.
    const res2 = await get(`/report/${SHA}`);
    const html2 = await res2.text();
    expect(html2).not.toContain('href="javascript:');
  });

  it('404s missing artifact and non-report (non-json / no report_markdown) artifacts', async () => {
    expect((await get(`/report/${'b'.repeat(64)}`)).status).toBe(404);
    const zipEnv = makeEnv({ [SHA]: { json: DOC, contentType: 'application/zip' } });
    expect((await handleReport(new Request(`https://gw.example/report/${SHA}`), zipEnv)).status).toBe(404);
    const notReport = makeEnv({ [SHA]: { json: { files: [] }, contentType: 'application/json' } });
    expect((await handleReport(new Request(`https://gw.example/report/${SHA}`), notReport)).status).toBe(404);
  });

  it('rejects a malformed sha and non-GET methods', async () => {
    expect((await get('/report/zzz')).status).toBe(400);
    const res = await handleReport(
      new Request(`https://gw.example/report/${SHA}`, { method: 'PUT' }),
      env,
    );
    expect(res.status).toBe(405);
  });
});

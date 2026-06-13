/**
 * Hosted research report (M12.2.3, ADR-0020 п.1 — research pipeline flagship).
 * Renders a synthesizer's ResearchReportDoc artifact as a self-contained,
 * readable HTML page — the deliverable shown in the demo's result iframe,
 * mirroring the M12.1.7 site preview.
 *
 *   GET /report/:sha256   → the report as styled HTML
 *
 * Same containment as /preview: addressed by hash (no vanity URLs), expires
 * with the artifact (R2 lifecycle 30d), `X-Robots-Tag: noindex`, and a CSP
 * `sandbox` with NO allow-scripts (this page has none — unlike a generated
 * site preview). All report/citation text is HTML-escaped before rendering:
 * the content is LLM-generated, so it is treated as untrusted.
 */

const SHA_RE = /^[0-9a-f]{64}$/;

interface ReportEnv {
  ARTIFACTS: R2Bucket;
}

interface Citation {
  id: number;
  claim: string;
  url: string;
  quote: string;
}

interface ReportDoc {
  question?: unknown;
  report_markdown?: unknown;
  citations?: unknown;
  sources?: unknown;
}

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) links survive — anything else renders as inert text. */
function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Minimal, safe markdown → HTML for OUR report format (headings, lists, bold,
 * inline `code`, [n] citation markers, paragraphs). Input is escaped FIRST, so
 * no raw HTML can pass through; only the whitelisted transforms below run on
 * already-escaped text. Deliberately tiny — not a general markdown engine.
 */
function renderMarkdown(md: string): string {
  const lines = escapeHtml(md).split('\n');
  const out: string[] = [];
  let inList = false;
  const closeList = (): void => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  const inline = (s: string): string =>
    s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // [n] citation markers → superscript anchors into the citations list.
      .replace(/\[(\d+)\]/g, '<sup><a href="#cite-$1">[$1]</a></sup>');

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') {
      closeList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length + 1; // # → h2 (h1 is the question)
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('\n');
}

function parseCitations(raw: unknown): Citation[] {
  if (!Array.isArray(raw)) return [];
  const out: Citation[] = [];
  for (const c of raw as Array<Record<string, unknown>>) {
    if (
      typeof c?.['id'] === 'number' &&
      typeof c?.['claim'] === 'string' &&
      typeof c?.['url'] === 'string' &&
      typeof c?.['quote'] === 'string'
    ) {
      out.push({ id: c['id'], claim: c['claim'], url: c['url'], quote: c['quote'] });
    }
  }
  return out;
}

function citationHtml(c: Citation): string {
  const href = safeHref(c.url);
  const link = href
    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(c.url)}</a>`
    : escapeHtml(c.url);
  return (
    `<li id="cite-${c.id}"><span class="cn">[${c.id}]</span> ${escapeHtml(c.claim)}` +
    `<div class="src">${link}</div>` +
    `<blockquote>${escapeHtml(c.quote)}</blockquote></li>`
  );
}

function renderPage(doc: ReportDoc): string {
  const question = typeof doc.question === 'string' ? doc.question : 'Research report';
  const body = typeof doc.report_markdown === 'string' ? renderMarkdown(doc.report_markdown) : '';
  const citations = parseCitations(doc.citations);
  const citeList = citations.length
    ? `<section class="cites"><h2>Citations</h2><ol>${citations.map(citationHtml).join('')}</ol></section>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(question)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    max-width: 760px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; color: #1a1a22; background: #fff; }
  @media (prefers-color-scheme: dark) { body { color: #e6e6ee; background: #0d0d12; } }
  h1 { font-size: 1.7rem; line-height: 1.25; margin: 0 0 1.5rem; }
  h2 { font-size: 1.25rem; margin: 2rem 0 .6rem; }
  h3 { font-size: 1.05rem; margin: 1.5rem 0 .5rem; }
  p { margin: .7rem 0; }
  ul { margin: .5rem 0; padding-left: 1.3rem; }
  li { margin: .3rem 0; }
  sup a { text-decoration: none; color: #2a7de1; }
  code { background: rgba(127,127,127,.18); padding: .1em .35em; border-radius: 4px; font-size: .9em; }
  .cites { margin-top: 2.5rem; border-top: 1px solid rgba(127,127,127,.3); padding-top: 1rem; }
  .cites ol { list-style: none; padding: 0; }
  .cites li { margin: 1.1rem 0; }
  .cn { font-weight: 600; color: #2a7de1; }
  .src { font-size: .82rem; margin: .2rem 0; word-break: break-all; }
  .src a { color: #2a7de1; }
  blockquote { margin: .4rem 0 0; padding: .4rem .8rem; border-left: 3px solid rgba(127,127,127,.4);
    font-style: italic; opacity: .85; }
</style></head>
<body><h1>${escapeHtml(question)}</h1>${body}${citeList}</body></html>`;
}

export async function handleReport(req: Request, env: ReportEnv): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return err(405, 'GET only');

  const url = new URL(req.url);
  const sha = url.pathname.slice('/report/'.length).replace(/\/+$/, '').toLowerCase();
  if (!SHA_RE.test(sha)) return err(400, 'bad sha256');

  const obj = await env.ARTIFACTS.get(sha);
  if (!obj) return err(404, 'artifact not found (expired or never uploaded)');
  const mime = obj.httpMetadata?.contentType ?? '';
  if (!mime.startsWith('application/json')) return err(404, 'artifact is not a research report');

  let doc: ReportDoc;
  try {
    doc = await obj.json<ReportDoc>();
  } catch {
    return err(404, 'artifact is not a research report');
  }
  if (typeof doc.report_markdown !== 'string') {
    return err(404, 'artifact is not a research report');
  }

  return new Response(renderPage(doc), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=86400, immutable',
      'x-robots-tag': 'noindex, nofollow',
      // No scripts, no origin powers — the page is static gateway-rendered HTML.
      'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

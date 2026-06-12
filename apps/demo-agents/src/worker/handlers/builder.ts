/**
 * Builder — second step of the website pipeline (M12.1.1, ADR-0020).
 *
 * Input: the copywriter's markdown copy deck (via inputs chaining). Output:
 * a multi-file static site as a validated manifest, uploaded to the R2
 * artifact store — the on-chain result carries only the small
 * `{artifact:{sha256,…}}` envelope. Inlining 30–60KB of site source into
 * `resultUri` (contract storage) is exactly what the artifact каркас exists
 * to avoid.
 *
 * The manifest is validated BEFORE upload (`validateManifest`, exported for
 * tests): vanilla static files only, safe relative paths, index.html
 * present, bounded count/size. A manifest that fails validation throws —
 * the executor's retry gives the LLM a second chance, then settles with an
 * honest `Task failed`.
 */

import { chat } from '../llm.js';
import { encodeArtifactResult } from '../artifacts.js';
import type { CapabilityHandler } from './index.js';

export interface SiteFile {
  readonly path: string;
  readonly content: string;
}

export interface SiteManifest {
  readonly files: readonly SiteFile[];
}

export const MAX_FILES = 12;
export const MAX_TOTAL_BYTES = 256 * 1024;
const ALLOWED_EXTENSIONS = ['.html', '.css', '.js', '.svg', '.md', '.txt'];
const SAFE_PATH = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

/**
 * Shape-and-safety gate between LLM output and the artifact store.
 * Throws with a specific reason on the first violation.
 */
export function validateManifest(raw: unknown): SiteManifest {
  if (!raw || typeof raw !== 'object') throw new Error('manifest must be a JSON object');
  const files = (raw as { files?: unknown }).files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('manifest.files must be a non-empty array');
  }
  if (files.length > MAX_FILES) {
    throw new Error(`manifest has ${files.length} files — max ${MAX_FILES}`);
  }

  const seen = new Set<string>();
  let total = 0;
  for (const f of files as Array<{ path?: unknown; content?: unknown }>) {
    if (typeof f?.path !== 'string' || typeof f?.content !== 'string') {
      throw new Error('every file needs string path + content');
    }
    const path = f.path;
    if (!SAFE_PATH.test(path) || path.includes('..') || path.includes('//') || path.includes('\\')) {
      throw new Error(`unsafe file path "${path}"`);
    }
    if (!ALLOWED_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext))) {
      throw new Error(`extension not allowed for "${path}" (allowed: ${ALLOWED_EXTENSIONS.join(', ')})`);
    }
    const key = path.toLowerCase();
    if (seen.has(key)) throw new Error(`duplicate file path "${path}"`);
    seen.add(key);
    total += Buffer.byteLength(f.content, 'utf8');
  }
  if (!seen.has('index.html')) throw new Error('manifest must contain index.html at the root');
  if (total > MAX_TOTAL_BYTES) {
    throw new Error(`manifest totals ${total} bytes — max ${MAX_TOTAL_BYTES}`);
  }
  return { files: files as SiteFile[] };
}

const SYSTEM_PROMPT =
  'You are a senior front-end developer and designer building a small static business-card website ' +
  'from a copy deck. The result must look like a polished, modern site a small business would proudly ' +
  'publish — NOT a default unstyled page. ' +
  'Respond with a single JSON object: {"files": [{"path": "...", "content": "..."}]}.\n' +
  'STACK RULES:\n' +
  `- vanilla static files only (.html/.css/.js/.svg), no build step; index.html at the root is mandatory; styles in styles.css; at most ${MAX_FILES} files;\n` +
  '- ONE external resource is allowed and encouraged: a single Google Fonts <link> (one display font for headings + one body font, e.g. "Playfair Display + Inter" — pick a pairing that fits the brief\'s mood). NO other CDNs, NO JS frameworks;\n' +
  '- relative paths only (e.g. "index.html", "styles.css", "assets/logo.svg");\n' +
  '- semantic HTML with proper <title>, meta description, viewport meta, lang attribute matching the copy language.\n' +
  'DESIGN PROGRAM (mandatory):\n' +
  '- a full-width HERO: site title, tagline, and a clear visual identity (background color/gradient or a tasteful CSS pattern — no external images);\n' +
  '- a color palette derived from the brief\'s mood, defined as CSS custom properties on :root (4-5 tokens: background, surface, text, accent, muted) with accessible contrast;\n' +
  '- typographic scale: the Google display font for headings, the body font at 16-18px with line-height ≥1.6;\n' +
  '- content sections EXACTLY as named in the copy deck, each visually distinct; lists rendered as styled cards or a responsive grid — NEVER bare bordered <li> rows or layout tables;\n' +
  '- a content container with max-width (~1100px) centered, generous vertical rhythm (section padding ≥4rem desktop), mobile-first responsive;\n' +
  '- a footer with the contact/hours details from the deck;\n' +
  '- small touches that signal craft: hover states on links, subtle shadows or borders on cards, consistent border-radius.\n' +
  'Use the provided copy verbatim where it fits — no lorem ipsum. Keep total output compact (well under 200KB). JSON object only, no commentary.';

/**
 * Builder runs on gpt-4o (M12.1.5, approved by Alex 2026-06-12): the design
 * quality gap vs 4o-mini is decisive for the "поверка с чатом" — mini ships
 * unstyled skeletons even with a detailed design program. Cost delta
 * (~$0.04-0.05/site) is recorded in docs/research/pipeline-economics.md;
 * the identity's registry price (0.08 USDC) is unchanged.
 */
const BUILDER_MODEL = 'gpt-4o';

/** Keyless deterministic site — local dev / unit tests. */
export function mockManifest(copy: string): SiteManifest {
  const title = copy.split('\n')[0]?.replace(/^#\s*/, '') || 'Mock Site';
  return {
    files: [
      {
        path: 'index.html',
        content:
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="styles.css"></head>` +
          `<body><main><h1>${title}</h1><pre>${copy.slice(0, 500)}</pre></main></body></html>`,
      },
      { path: 'styles.css', content: 'body{font-family:system-ui;margin:2rem auto;max-width:60ch;padding:0 1rem}' },
    ],
  };
}

export const builderHandler: CapabilityHandler = async (job, ctx) => {
  if (!ctx.artifacts) {
    throw new Error('artifact store unavailable — builder cannot deliver a multi-file site inline');
  }
  const copy = job.material;
  if (!copy) {
    throw new Error('builder needs the copywriter output as material (inputs chaining)');
  }

  let manifest: SiteManifest;
  if (!ctx.openaiApiKey) {
    manifest = mockManifest(copy);
  } else {
    const rawText = await chat({
      apiKey: ctx.openaiApiKey,
      model: BUILDER_MODEL,
      system: SYSTEM_PROMPT,
      user: `COPY DECK:\n${copy}`,
      maxTokens: 12_000,
      json: true,
    });
    manifest = validateManifest(JSON.parse(rawText));
  }

  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const ref = await ctx.artifacts.upload(bytes, 'application/json');
  return encodeArtifactResult(ref);
};

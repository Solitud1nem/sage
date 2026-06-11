/**
 * Copywriter — first step of the website pipeline (M12.1.1, ADR-0020).
 *
 * Input: the user's brief (envelope `source` → job.material; falls back to
 * the spec for self-contained instructions). Output: structured markdown
 * copy for a small static site — title, tagline, sections, contact
 * placeholders. The output is the ONLY material the builder sees (ADR-0018
 * gives a dependent step its upstream inputs, not the original brief), so
 * the prompt demands self-contained copy.
 *
 * Plain text result (a few KB) — stays inline on-chain; artifacts start at
 * the builder step.
 */

import { chat } from '../llm.js';
import type { CapabilityHandler } from './index.js';

const SYSTEM_PROMPT =
  'You are a copywriter producing the complete copy deck for a small static business-card website (a "визитка"). ' +
  'From the client brief, write structured markdown with EXACTLY these sections:\n' +
  '# <site title>\n' +
  '> <one-line tagline>\n' +
  '## About — 2-3 sentences.\n' +
  '## Services / Offering — 3-5 bullet points with one-line descriptions.\n' +
  '## Why us — 2-3 short selling points.\n' +
  '## Contact — placeholder contact lines (email, phone, city) consistent with the brief; invent plausible placeholders if absent.\n' +
  'Optionally add: ## Style — one line suggesting tone/color mood ONLY if the brief implies one.\n' +
  'The copy must be fully self-contained: a web developer who has never seen the brief must be able to build the site from your output alone. ' +
  'Write in the language of the brief. No preamble, no commentary — markdown only.';

export const copywriterHandler: CapabilityHandler = async (job, ctx) => {
  const brief = job.material ?? job.spec;

  if (!ctx.openaiApiKey) {
    // Keyless deterministic mock — local dev / unit tests.
    return [
      '# Mock Site',
      '> Deterministic keyless copy deck',
      '## About',
      `Generated without an API key from brief: ${brief.slice(0, 120)}`,
      '## Services / Offering',
      '- Service one — placeholder',
      '- Service two — placeholder',
      '## Why us',
      '- Mock reason',
      '## Contact',
      '- email: hello@example.com',
    ].join('\n');
  }

  return chat({
    apiKey: ctx.openaiApiKey,
    system: SYSTEM_PROMPT,
    user: `CLIENT BRIEF:\n${brief}`,
    maxTokens: 1200,
  });
};

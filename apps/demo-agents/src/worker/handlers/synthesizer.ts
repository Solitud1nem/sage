/**
 * Synthesizer — final executor step of the research pipeline (M12.2.1).
 *
 * Input (inputs chaining, ADR-0018): the searcher's {question, sources}
 * inline JSON plus one artifact envelope per extract step. The handler
 * sha-verified-downloads every extract, hands the dossier to the frontier
 * model (Sonnet 4.6 — judge-class rule pairs it with the Sonnet fact-checker
 * in M12.2.2; fallback gpt-4o; keyless → deterministic mock), and uploads
 * the deliverable: ResearchReportDoc {report_markdown, citations, …}.
 *
 * Citation discipline (the flagship narrative, ADR-0020 п.1): every factual
 * claim cites [n] → {url, verbatim quote}. The model may quote ONLY what an
 * extractor verified; `checkCitations` re-verifies each citation against the
 * extracts and DROPS pretenders. A report left with fewer than
 * MIN_VALID_CITATIONS throws — the executor's retry gives one more chance,
 * then settles as an honest failure. A chat can't lose money over a made-up
 * citation; this pipeline can, and that is the point.
 */

import { chat } from '../llm.js';
import { anthropicChat, ANTHROPIC_MODELS } from '../../shared/anthropic.js';
import { decodeArtifactResult, encodeArtifactResult } from '../artifacts.js';
import {
  parseSearcherResult,
  parseSourceExtract,
  quoteAppearsIn,
  type ResearchCitation,
  type ResearchReportDoc,
  type SearcherResult,
  type SourceExtract,
} from '../../shared/research.js';
import type { CapabilityHandler, HandlerContext } from './index.js';

export const MIN_VALID_CITATIONS = 2;

const SYSTEM_PROMPT =
  'You are a research analyst writing a fact-checked report from a dossier of extracted ' +
  'sources. Respond with a JSON object {"report_markdown": "...", "citations": ' +
  '[{"id": 1, "claim": "...", "url": "...", "quote": "..."}]}.\n' +
  'REPORT (markdown): # title; a 3-5 sentence executive summary; findings sections that ' +
  'ANSWER THE QUESTION (organized by theme, not by source); a closing "Limitations" section ' +
  'naming unreachable/missing sources and what the dossier could not establish. Write in the ' +
  'language of the question.\n' +
  'CITATIONS — the hard rules:\n' +
  '- every factual claim in the report carries [n] markers resolving to the citations array;\n' +
  '- each citation quote MUST be copied VERBATIM from the "verified quotes" of the SAME source ' +
  'url you cite — never from memory, never paraphrased, never stitched from two quotes. ' +
  'Citations are mechanically re-verified; an invented quote is discarded and discredits the report;\n' +
  '- claims no verified quote supports go to Limitations instead of being asserted;\n' +
  '- do NOT use your own knowledge of the topic as a source — the dossier is the whole world.\n' +
  'JSON only.';

const REPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    report_markdown: { type: 'string' },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          claim: { type: 'string' },
          url: { type: 'string' },
          quote: { type: 'string' },
        },
        required: ['id', 'claim', 'url', 'quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['report_markdown', 'citations'],
  additionalProperties: false,
};

/** Split joined envelope material (`materialFromEnvelope` joins inputs with
 * a blank line) back into per-input parts. */
export function splitMaterialParts(material: string): string[] {
  return material
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export interface ResearchDossier {
  readonly search: SearcherResult;
  readonly extracts: readonly SourceExtract[];
}

/**
 * Reassemble the dossier from the joined material: exactly one part must be
 * the searcher result; every artifact-envelope part is downloaded
 * (sha-verified by the store) and parsed as a SourceExtract.
 */
export async function collectDossier(
  material: string,
  artifacts: NonNullable<HandlerContext['artifacts']>,
): Promise<ResearchDossier> {
  let search: SearcherResult | null = null;
  const extracts: SourceExtract[] = [];
  for (const part of splitMaterialParts(material)) {
    const ref = decodeArtifactResult(part);
    if (ref) {
      const bytes = await artifacts.download(ref);
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new Error(`extract artifact ${ref.sha256.slice(0, 12)}… is not JSON`);
      }
      const extract = parseSourceExtract(parsed);
      if (!extract) {
        throw new Error(`extract artifact ${ref.sha256.slice(0, 12)}… fails the SourceExtract contract`);
      }
      extracts.push(extract);
      continue;
    }
    const maybeSearch = parseSearcherResult(part);
    if (maybeSearch) {
      search = maybeSearch;
    }
  }
  if (!search) throw new Error('synthesizer material carries no searcher result {question, sources}');
  if (extracts.length === 0) throw new Error('synthesizer material carries no extract artifacts');
  return { search, extracts };
}

/**
 * Re-verify every citation against the dossier: the url must belong to an
 * ok-extract and the quote must appear (whitespace-insensitively) among that
 * extract's verified quotes. Returns the surviving citations renumbered to
 * stay consistent with their [n] markers — invalid ones are dropped, not
 * renumbered around, so the report's markers keep pointing at the right
 * claims (a dangling [n] is visible, a silently shifted one lies).
 */
export function checkCitations(
  citations: readonly ResearchCitation[],
  extracts: readonly SourceExtract[],
): { valid: ResearchCitation[]; dropped: ResearchCitation[] } {
  const byUrl = new Map<string, SourceExtract>();
  for (const e of extracts) {
    if (e.status === 'ok' && e.url) byUrl.set(e.url, e);
  }
  const valid: ResearchCitation[] = [];
  const dropped: ResearchCitation[] = [];
  for (const c of citations) {
    const extract = byUrl.get(c.url);
    const ok =
      extract !== undefined &&
      c.quote.trim().length > 0 &&
      extract.quotes.some((q) => quoteAppearsIn(c.quote, q));
    (ok ? valid : dropped).push(c);
  }
  return { valid, dropped };
}

function dossierPrompt(dossier: ResearchDossier): string {
  const sections = dossier.extracts.map((e, i) => {
    const head = `SOURCE ${i + 1}: ${e.title}\nurl: ${e.url || '(none)'}\nstatus: ${e.status}`;
    if (e.status !== 'ok') return `${head}\nerror: ${e.error ?? 'unknown'}`;
    const points = e.key_points.map((p) => `- ${p}`).join('\n');
    const quotes = e.quotes.map((q) => `> ${q}`).join('\n');
    return `${head}\nkey points:\n${points || '- (none)'}\nverified quotes:\n${quotes || '> (none)'}`;
  });
  return `RESEARCH QUESTION:\n${dossier.search.question}\n\nDOSSIER:\n\n${sections.join('\n\n')}`;
}

interface RawReport {
  report_markdown?: unknown;
  citations?: unknown;
}

export function parseReport(rawText: string): { reportMarkdown: string; citations: ResearchCitation[] } {
  const parsed = JSON.parse(rawText) as RawReport;
  if (typeof parsed.report_markdown !== 'string' || parsed.report_markdown.trim().length === 0) {
    throw new Error('LLM returned no report_markdown');
  }
  if (!Array.isArray(parsed.citations)) throw new Error('LLM returned no citations array');
  const citations: ResearchCitation[] = [];
  for (const c of parsed.citations as Array<Record<string, unknown>>) {
    if (
      typeof c?.['id'] !== 'number' ||
      typeof c?.['claim'] !== 'string' ||
      typeof c?.['url'] !== 'string' ||
      typeof c?.['quote'] !== 'string'
    ) {
      continue;
    }
    citations.push({ id: c['id'], claim: c['claim'], url: c['url'], quote: c['quote'] });
  }
  return { reportMarkdown: parsed.report_markdown, citations };
}

/** Keyless deterministic report — cites the mock extracts so the keyless
 * chain exercises the same citation verification as the real one. */
function mockReport(dossier: ResearchDossier): { reportMarkdown: string; citations: ResearchCitation[] } {
  const ok = dossier.extracts.filter((e) => e.status === 'ok' && e.quotes.length > 0);
  const citations: ResearchCitation[] = ok.map((e, i) => ({
    id: i + 1,
    claim: `Keyless mock finding from ${e.title}`,
    url: e.url,
    quote: e.quotes[0]!,
  }));
  const lines = [
    `# Mock research report`,
    '',
    `Deterministic keyless report for: ${dossier.search.question.slice(0, 120)}`,
    '',
    '## Findings',
    ...citations.map((c) => `- ${c.claim} [${c.id}]`),
    '',
    '## Limitations',
    '- Generated without an API key; content is mock.',
  ];
  return { reportMarkdown: lines.join('\n'), citations };
}

export const synthesizerHandler: CapabilityHandler = async (job, ctx) => {
  if (!ctx.artifacts) {
    throw new Error('artifact store unavailable — synthesizer cannot read extracts or deliver the report');
  }
  if (!job.material) {
    throw new Error('synthesizer needs material: searcher result + extract artifacts (inputs chaining)');
  }
  const dossier = await collectDossier(job.material, ctx.artifacts);

  let reportMarkdown: string;
  let citations: ResearchCitation[];
  if (ctx.anthropicApiKey) {
    const rawText = await anthropicChat({
      apiKey: ctx.anthropicApiKey,
      model: ANTHROPIC_MODELS.sonnet,
      system: SYSTEM_PROMPT,
      user: dossierPrompt(dossier),
      maxTokens: 6000,
      jsonSchema: REPORT_SCHEMA,
    });
    ({ reportMarkdown, citations } = parseReport(rawText));
  } else if (ctx.openaiApiKey) {
    const rawText = await chat({
      apiKey: ctx.openaiApiKey,
      model: 'gpt-4o',
      system: SYSTEM_PROMPT,
      user: dossierPrompt(dossier),
      maxTokens: 6000,
      json: true,
    });
    ({ reportMarkdown, citations } = parseReport(rawText));
  } else {
    ({ reportMarkdown, citations } = mockReport(dossier));
  }

  const { valid, dropped } = checkCitations(citations, dossier.extracts);
  if (valid.length < MIN_VALID_CITATIONS) {
    throw new Error(
      `report has ${valid.length} verified citations (need ≥${MIN_VALID_CITATIONS}); ` +
        `${dropped.length} failed verbatim verification`,
    );
  }

  const doc: ResearchReportDoc = {
    question: dossier.search.question,
    report_markdown: reportMarkdown,
    citations: valid,
    sources: dossier.extracts.map((e) => ({ url: e.url, title: e.title, status: e.status })),
    generated_at: new Date().toISOString(),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  const ref = await ctx.artifacts.upload(bytes, 'application/json');
  return encodeArtifactResult(ref);
};

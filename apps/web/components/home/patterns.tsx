import { githubBlobUrl } from '@/lib/site-config';

/**
 * Patterns section — what agents can be built on top of Sage today.
 *
 * Each card mirrors a real worker in apps/demo-agents/. The protocol
 * is generic — these are illustrative reference implementations, not
 * a closed taxonomy. Same primitive (createTask → acceptTask →
 * completeTask) under different capability strings.
 */

type PatternAccent = 'cyan' | 'purple' | 'pink' | 'green';

const patterns: Array<{
  tag: string;
  title: string;
  body: string;
  sampleIn: string;
  sampleOut: string;
  source: string;
  accent: PatternAccent;
}> = [
  {
    tag: 'summarize',
    title: 'Summarizer',
    body: 'Compresses long text into a short brief. RFPs, reports, threads. OpenAI gpt-4o-mini under the hood.',
    sampleIn: '40-page RFP',
    sampleOut: '12-bullet exec summary',
    source: 'apps/demo-agents/src/summarizer/agent.ts',
    accent: 'cyan',
  },
  {
    tag: 'translate',
    title: 'Translator',
    body: 'Bidirectional translation across language pairs. Default EN ↔ RU. Same code, different prompt for any pair.',
    sampleIn: 'English brief',
    sampleOut: 'Russian translation',
    source: 'apps/demo-agents/src/translator/agent.ts',
    accent: 'purple',
  },
  {
    tag: 'sentiment-classify',
    title: 'Sentiment',
    body: 'Labels text POSITIVE / NEGATIVE / NEUTRAL with a score and a one-line rationale. Useful for review pipelines.',
    sampleIn: '"Best launch in years."',
    sampleOut: 'POSITIVE (0.98) — strong cues',
    source: 'apps/demo-agents/src/sentiment/agent.ts',
    accent: 'pink',
  },
  {
    tag: 'vision-describe',
    title: 'Vision',
    body: 'Describes images by public URL. gpt-4o-mini vision, 500-char cap. Drop-in for moderation, cataloguing, alt-text.',
    sampleIn: 'https://…/photo.jpg',
    sampleOut: 'A close-up of a tabby cat…',
    source: 'apps/demo-agents/src/vision/agent.ts',
    accent: 'green',
  },
];

const accentColor: Record<PatternAccent, string> = {
  cyan: '#5EE3F5',
  purple: '#A78BFA',
  pink: '#F472B6',
  green: '#6EE7B7',
};

export function Patterns() {
  return (
    <section id="patterns" className="mx-auto max-w-[1200px] px-6 md:px-10 py-20">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-purple mb-4">
        03 — patterns
      </div>
      <h2 className="text-[clamp(26px,2.4vw,32px)] font-medium leading-[1.2] tracking-[-0.015em] max-w-[640px]">
        Four agent shapes live today. Same primitive underneath.
      </h2>
      <p className="mt-4 max-w-[680px] text-[16px] leading-[1.55] text-text-muted">
        Each card is a real Node process running on Fly, listening to{' '}
        <span className="font-mono text-text">TaskCreated</span> events for its address. The
        protocol stays the same; the capability changes by prompt. Build your own off the same
        scaffold.
      </p>

      <div className="mt-12 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {patterns.map((p) => (
          <div
            key={p.tag}
            className="relative rounded-[14px] border border-border bg-surface p-6 hover:border-border-hover hover:bg-surface-2 transition-all duration-200 flex flex-col"
          >
            <div
              className="font-mono text-[11px] uppercase tracking-[0.04em] mb-3"
              style={{ color: accentColor[p.accent] }}
            >
              {p.tag}
            </div>
            <div className="text-[18px] font-medium tracking-[-0.01em] mb-3">{p.title}</div>
            <p className="text-[13px] text-text-muted leading-[1.5] mb-5 min-h-[80px]">{p.body}</p>

            <div className="rounded-[10px] border border-border bg-canvas p-3 mb-4 font-mono text-[11px] leading-[1.6]">
              <div className="flex items-start gap-2">
                <span className="text-text-subtle shrink-0">in →</span>
                <span className="text-text-muted truncate">{p.sampleIn}</span>
              </div>
              <div className="flex items-start gap-2 mt-1">
                <span className="text-text-subtle shrink-0">out →</span>
                <span style={{ color: accentColor[p.accent] }} className="truncate">
                  {p.sampleOut}
                </span>
              </div>
            </div>

            <a
              href={githubBlobUrl(p.source)}
              target="_blank"
              rel="noreferrer"
              className="mt-auto pt-3 border-t border-border font-mono text-[11px] text-text-subtle hover:text-text transition-colors duration-200"
            >
              source ↗
            </a>
          </div>
        ))}
      </div>

      <p className="mt-10 text-[13px] text-text-muted max-w-[680px]">
        Every agent above is open-source reference code under{' '}
        <a
          href={githubBlobUrl('apps/demo-agents/README.md')}
          target="_blank"
          rel="noreferrer"
          className="text-purple hover:underline underline-offset-4"
        >
          apps/demo-agents/
        </a>
        . The orchestrator dispatches by mode; workers filter by their own EOA. Same{' '}
        <span className="font-mono text-text">createTask → acceptTask → completeTask</span>{' '}
        primitive — different capability strings.
      </p>
    </section>
  );
}

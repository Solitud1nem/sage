import Link from 'next/link';

import { githubBlobUrl } from '@/lib/site-config';

/**
 * Composition section — Sage's canonical angle per ADR-0008.
 *
 * Where Patterns (03) lists the worker capabilities individually, this
 * section answers "what happens when work is bigger than one call?" —
 * the observable-decomposition pattern from ADR-0007. Plan-then-execute
 * is the default flow for composite briefs; decomposition surfaces as a
 * structured artifact, not hidden in an LLM's context.
 *
 * Tone matches engineering-aesthetic ethos: three principles, code-shaped
 * ASCII flow, no marketing claims. Live /demo/composite is the proof.
 */

type PrincipleAccent = 'cyan' | 'purple' | 'pink';

const principles: Array<{
  number: string;
  title: string;
  body: string;
  accent: PrincipleAccent;
}> = [
  {
    number: '01',
    title: 'Plan visible before execute',
    body: 'A classifier turns the brief into a structured plan — one sub-task per on-chain TaskEscrow record. The user sees the full graph, costs, and dependencies before approving. Edits in-place; no commit until approval.',
    accent: 'cyan',
  },
  {
    number: '02',
    title: 'Per-step settlement',
    body: 'Each sub-task is its own createTask → accept → complete → approve cycle. Failures stay isolated to one node of the graph. Disputes can fork a single sub-task — retry, swap executor, cancel — without unwinding the rest.',
    accent: 'purple',
  },
  {
    number: '03',
    title: 'Stakes axis gates spawn',
    body: 'Plans flagged stakes:high don\'t auto-assign executors. The user picks deliberately through plan-editor — three guard layers: frontend strip, button disable, plan-runner reject. Make the stakes axis behaviourally meaningful at the spawn boundary, not just a UI badge.',
    accent: 'pink',
  },
];

const accentColor: Record<PrincipleAccent, string> = {
  cyan: '#5EE3F5',
  purple: '#A78BFA',
  pink: '#F472B6',
};

export function Composition() {
  return (
    <section id="composition" className="mx-auto max-w-[1200px] px-6 md:px-10 py-20">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-purple mb-4">
        04 — observable decomposition
      </div>
      <h2 className="text-[clamp(26px,2.4vw,32px)] font-medium leading-[1.2] tracking-[-0.015em] max-w-[760px]">
        When work is multi-step, the plan is the contract.
      </h2>
      <p className="mt-4 max-w-[720px] text-[16px] leading-[1.55] text-text-muted">
        Composite briefs decompose externally — as a graph of atomic settlement records, not as
        hidden state inside an LLM&rsquo;s context. The user reviews the plan before any
        on-chain spawn; each sub-task settles independently; high-stakes plans require deliberate
        executor assignment. This is Sage&rsquo;s angle per{' '}
        <a
          href={githubBlobUrl('docs/adr/0008-sage-angle-position.md')}
          target="_blank"
          rel="noreferrer"
          className="text-purple hover:underline underline-offset-4"
        >
          ADR-0008
        </a>
        : multi-chain settlement infrastructure, distinguished by observable decomposition.
      </p>

      <div className="mt-12 grid gap-4 grid-cols-1 md:grid-cols-3">
        {principles.map((p) => (
          <div
            key={p.number}
            className="rounded-[14px] border border-border bg-surface p-6 hover:border-border-hover hover:bg-surface-2 transition-all duration-200 flex flex-col"
          >
            <div
              className="font-mono text-[11px] uppercase tracking-[0.04em] mb-3"
              style={{ color: accentColor[p.accent] }}
            >
              {p.number}
            </div>
            <div className="text-[18px] font-medium tracking-[-0.01em] mb-3">{p.title}</div>
            <p className="text-[13px] text-text-muted leading-[1.55]">{p.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 rounded-[14px] border border-border bg-canvas p-6 md:p-8 font-mono text-[12px] leading-[1.7] text-text-muted overflow-x-auto">
        <div className="text-text-subtle text-[11px] uppercase tracking-[0.08em] mb-3">
          flow
        </div>
        <pre className="text-[12px] leading-[1.6] whitespace-pre">{`brief  →  classify  →  plan card  →  approve / edit  →  execute
                                          │
                                          ↓
                       ┌──── sub-task #1 ────┐  ┌──── sub-task #2 ────┐
                       │  createTask        │  │  createTask         │
                       │  acceptTask        │  │  acceptTask         │
                       │  completeTask      │  │  completeTask       │
                       │  approvePayment    │  │  approvePayment     │
                       └────────────────────┘  └─────────────────────┘
                                                          ↓
                                                    plan settled`}</pre>
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/demo/composite"
          className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] bg-purple text-[#0A0A0F] text-[13px] font-semibold hover:shadow-[0_0_28px_rgba(167,139,250,0.45)] transition-shadow duration-200"
        >
          Try a composite plan →
        </Link>
        <a
          href={githubBlobUrl('docs/adr/0007-observable-decomposition.md')}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] border border-border-hover text-[13px] hover:bg-surface transition-colors duration-200"
        >
          ADR-0007 ↗
        </a>
        <a
          href={githubBlobUrl('docs/research/observable-decomposition.md')}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] border border-border-hover text-[13px] hover:bg-surface transition-colors duration-200"
        >
          Reasoning note ↗
        </a>
      </div>
    </section>
  );
}

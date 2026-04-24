import Link from 'next/link';

import { BASE_MAINNET, addressUrl } from '@/chains/base';
import { GradientText } from '@/components/gradient-text';

/**
 * Docs page — placeholder until the dedicated docs site lands in v2.0.5.
 *
 * Until then, we point visitors at the real source-of-truth: the ADRs, the PRD,
 * and the deployed contracts on Basescan. Nothing invented.
 */
export default function DocsPage() {
  return (
    <div className="mx-auto max-w-[960px] px-6 md:px-10 py-20">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-purple mb-4">
        docs
      </div>
      <h1 className="text-[clamp(36px,4.2vw,52px)] font-medium leading-[1.2] tracking-[-0.015em]">
        <GradientText>Documentation</GradientText> in progress.
      </h1>
      <p className="mt-6 max-w-[640px] text-[16px] leading-[1.55] text-text-muted">
        The dedicated docs site lands in v2.0.5. Until then, here's where the truth lives —
        contracts, architecture decisions, and the integration plan are all public, versioned, and
        honest-only.
      </p>

      <div className="mt-14 grid gap-4 sm:grid-cols-2">
        <DocsCard
          label="Deployed contracts"
          title="Base mainnet on Basescan"
          body="AgentRegistry + TaskEscrow, verified source. Click through to read storage, write methods, and event history."
          links={[
            {
              label: 'AgentRegistry ↗',
              href: addressUrl(BASE_MAINNET.chainId, BASE_MAINNET.contracts.agentRegistry),
              external: true,
            },
            {
              label: 'TaskEscrow ↗',
              href: addressUrl(BASE_MAINNET.chainId, BASE_MAINNET.contracts.taskEscrow),
              external: true,
            },
          ]}
        />

        <DocsCard
          label="Architecture decisions"
          title="ADRs 0001 – 0006"
          body="Every significant design choice, documented as a standalone ADR with context, alternatives considered, and consequences."
          links={[
            { label: 'ADR index (repo)', href: 'https://github.com', external: true },
          ]}
        />

        <DocsCard
          label="Product scope"
          title="PRD + PLANNING + TASKS"
          body="What v2.0 is, how it's structured, and the atomic task queue. Driven by spec-driven development — specs first, code second."
          links={[
            { label: 'PRD (repo)', href: 'https://github.com', external: true },
            { label: 'PLANNING (repo)', href: 'https://github.com', external: true },
          ]}
        />

        <DocsCard
          label="Web integration"
          title="INTEGRATION.md + ADR-0006"
          body="How this site talks to contracts + the demo backend. Milestones M-INT.1 through M-INT.8 track the journey to mainnet demo."
          links={[
            { label: 'INTEGRATION.md (repo)', href: 'https://github.com', external: true },
          ]}
        />
      </div>

      <div className="mt-16 pt-10 border-t border-border flex flex-col sm:flex-row justify-between gap-4 text-[13px] text-text-muted">
        <p>
          Need something specific? Open an issue on GitHub or jump to the{' '}
          <Link href="/demo" className="text-purple hover:underline underline-offset-4">
            live demo
          </Link>
          .
        </p>
        <span className="font-mono text-[11px] text-text-subtle">v0.1.0 · pre-release</span>
      </div>
    </div>
  );
}

function DocsCard({
  label,
  title,
  body,
  links,
}: {
  label: string;
  title: string;
  body: string;
  links: Array<{ label: string; href: string; external?: boolean }>;
}) {
  return (
    <div className="rounded-[14px] border border-border bg-surface p-6 hover:border-border-hover transition-colors duration-200">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle mb-2">
        {label}
      </div>
      <h2 className="text-[18px] font-medium tracking-[-0.01em] mb-3">{title}</h2>
      <p className="text-[13px] text-text-muted leading-[1.55] mb-5">{body}</p>
      <div className="flex flex-wrap gap-3 text-[13px]">
        {links.map((l) => (
          <a
            key={l.label}
            href={l.href}
            target={l.external ? '_blank' : undefined}
            rel={l.external ? 'noreferrer' : undefined}
            className="text-cyan hover:underline underline-offset-4 font-mono"
          >
            {l.label}
          </a>
        ))}
      </div>
    </div>
  );
}

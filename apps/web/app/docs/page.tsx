import Link from 'next/link';

import { BASE_MAINNET, addressUrl } from '@/chains/base';
import { DOCS_NAV } from '@/components/docs/docs-nav';
import { GradientText } from '@/components/gradient-text';
import { githubBlobUrl, githubTreeUrl, siteConfig } from '@/lib/site-config';

/**
 * Docs hub — entry point. Doesn't use DocsLayout (the hub IS the TOC).
 * Sub-pages use DocsLayout and inherit the sidebar.
 */
export default function DocsPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-6 md:px-10 py-14">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-purple mb-4">
        docs
      </div>
      <h1 className="text-[clamp(36px,4.2vw,52px)] font-medium leading-[1.2] tracking-[-0.015em]">
        Build agents that <GradientText>get paid</GradientText>.
      </h1>
      <p className="mt-6 max-w-[680px] text-[16px] leading-[1.55] text-text-muted">
        Sage docs are organized for builders. Read top-to-bottom if it's your
        first time. Jump to a section if you're back for reference. Everything
        links out to source.
      </p>

      <div className="mt-9 flex flex-wrap gap-3">
        <Link
          href="/docs/intro"
          className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] bg-purple text-[#0A0A0F] text-[13px] font-semibold hover:shadow-[0_0_28px_rgba(167,139,250,0.45)] transition-shadow duration-200"
        >
          Start with Intro →
        </Link>
        <Link
          href="/docs/concepts"
          className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] border border-border-hover text-[13px] hover:bg-surface transition-colors duration-200"
        >
          Skip to Concepts
        </Link>
      </div>

      <div className="mt-14 grid gap-4 sm:grid-cols-2">
        {DOCS_NAV.map((section) => (
          <SectionTile key={section.title} title={section.title} items={section.items} />
        ))}
      </div>

      <div className="mt-16 pt-10 border-t border-border">
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle mb-4">
          source pointers
        </div>
        <p className="text-[14px] text-text-muted leading-[1.6] max-w-[720px] mb-5">
          Everything Sage ships is in the open. Read the contracts on Basescan,
          the ADRs in the repo, the runbooks for self-hosting, and the audited
          test suites. The docs above tell the story; these links show the work.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2 text-[13px]">
          <SourceLink
            label="AgentRegistry on Basescan"
            href={addressUrl(BASE_MAINNET.chainId, BASE_MAINNET.contracts.agentRegistry)}
          />
          <SourceLink
            label="TaskEscrow on Basescan"
            href={addressUrl(BASE_MAINNET.chainId, BASE_MAINNET.contracts.taskEscrow)}
          />
          <SourceLink label="GitHub repo" href={siteConfig.github} />
          <SourceLink label="ADR index" href={githubTreeUrl('docs/adr')} />
          <SourceLink label="PRD" href={githubBlobUrl('PRD.md')} />
          <SourceLink label="PLANNING" href={githubBlobUrl('PLANNING.md')} />
          <SourceLink
            label="Architecture overview"
            href={githubBlobUrl('docs/architecture/overview.md')}
          />
          <SourceLink
            label="Mainnet demo runs"
            href={githubBlobUrl('docs/demo-runs/v2.0.0-launch.md')}
          />
        </ul>
      </div>

      <div className="mt-16 pt-10 border-t border-border flex flex-col sm:flex-row justify-between gap-4 text-[13px] text-text-muted">
        <p>
          Need something specific? Open an issue on{' '}
          <a
            href={siteConfig.github}
            target="_blank"
            rel="noreferrer"
            className="text-purple hover:underline underline-offset-4"
          >
            GitHub
          </a>{' '}
          or jump to the{' '}
          <Link href="/demo" className="text-purple hover:underline underline-offset-4">
            live demo
          </Link>
          .
        </p>
        <span className="font-mono text-[11px] text-text-subtle">v2.0.0 · live on Base mainnet</span>
      </div>
    </div>
  );
}

function SectionTile({
  title,
  items,
}: {
  title: string;
  items: Array<{ slug: string; label: string; status: 'live' | 'soon' }>;
}) {
  return (
    <div className="rounded-[14px] border border-border bg-surface p-6 hover:border-border-hover transition-colors duration-200">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle mb-4">
        {title}
      </div>
      <ul className="space-y-2.5">
        {items.map((item) => {
          const isSoon = item.status === 'soon';
          return (
            <li key={item.slug}>
              {isSoon ? (
                <span
                  className="flex items-baseline justify-between text-[14px] text-text-subtle/60 cursor-not-allowed"
                  aria-disabled="true"
                >
                  <span>{item.label}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-subtle/70 ml-3 shrink-0">
                    soon
                  </span>
                </span>
              ) : (
                <Link
                  href={item.slug}
                  className="group flex items-baseline justify-between text-[14px] text-text hover:text-purple transition-colors duration-200"
                >
                  <span>{item.label}</span>
                  <span className="text-text-subtle group-hover:text-purple shrink-0 ml-3">
                    →
                  </span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SourceLink({ label, href }: { label: string; href: string }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-cyan hover:underline underline-offset-4 font-mono text-[12px]"
      >
        {label} ↗
      </a>
    </li>
  );
}

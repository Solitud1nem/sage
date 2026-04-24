/**
 * Changelog page — placeholder.
 *
 * Current canonical changelog lives in repo `CHANGELOG.md`. The web UI renders
 * highlights here; full history visible in the repo. MDX-rendered changelog
 * lands with the docs site in v2.0.5.
 */

interface ChangelogEntry {
  date: string;
  milestones: string[];
}

const highlights: ChangelogEntry[] = [
  {
    date: '2026-04-23',
    milestones: [
      'M-INT.2 complete — Home landing: full scroll narrative with live tx stream from Base mainnet.',
      'M-INT.1 complete — apps/web scaffolded (Next.js 15, Tailwind v4, wagmi, viem, ConnectKit).',
      'ADR-0006 accepted — web integration topology: static export on Cloudflare Pages + Alchemy RPC proxy + Fly.io for demo-agents + PostHog.',
      'Design tokens + component specs extracted from Claude Design.',
    ],
  },
  {
    date: '2026-04-22',
    milestones: [
      'v2.0 protocol code complete. AgentRegistry + TaskEscrow deployed on Base mainnet and Base Sepolia at identical addresses via CreateX + CREATE3.',
      'Full test suite: 74 tests (unit + integration + fuzz + invariant), 100% contract coverage, Slither clean, 600k invariant calls with zero failures.',
      'ADR-0004 accepted — USDC-only settlement with EIP-2612 permit.',
      'ADR-0005 accepted — pnpm monorepo + Foundry + viem stack.',
    ],
  },
  {
    date: '2026-04-21',
    milestones: [
      'AgentPay renamed to Sage. Pivot from LitVM-only to chain-agnostic EVM-first.',
      'ADR-0001 — deterministic addresses via CreateX + CREATE3.',
      'ADR-0002 — Base-anchored agent identity + EAS attestations + single EOA.',
      'ADR-0003 — x402 as primary pay-per-call transport.',
    ],
  },
];

export default function ChangelogPage() {
  return (
    <div className="mx-auto max-w-[800px] px-6 md:px-10 py-20">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-purple mb-4">
        changelog
      </div>
      <h1 className="text-[clamp(36px,4.2vw,52px)] font-medium leading-[1.2] tracking-[-0.015em]">
        What shipped, when.
      </h1>
      <p className="mt-6 max-w-[640px] text-[16px] leading-[1.55] text-text-muted">
        Highlights only. Full changelog lives in the{' '}
        <a
          href="https://github.com"
          target="_blank"
          rel="noreferrer"
          className="text-purple hover:underline underline-offset-4"
        >
          repository
        </a>{' '}
        with per-commit detail.
      </p>

      <ol className="mt-14 space-y-12">
        {highlights.map((entry) => (
          <li key={entry.date} className="relative">
            <div className="font-mono text-[12px] text-text-subtle mb-3">{entry.date}</div>
            <ul className="space-y-3 text-[14px] text-text-muted leading-[1.55] border-l border-border pl-5">
              {entry.milestones.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <div className="mt-16 pt-10 border-t border-border text-[11px] text-text-subtle font-mono">
        CHANGELOG.md in the repo is the source of truth for every change.
      </div>
    </div>
  );
}

/**
 * Changelog page — public highlights.
 *
 * Canonical changelog is `CHANGELOG.md` in the repo. The web UI renders
 * a curated highlight reel; deep detail lives one click away.
 */

import { siteConfig } from '@/lib/site-config';

interface ChangelogEntry {
  date: string;
  milestones: string[];
}

const highlights: ChangelogEntry[] = [
  {
    date: '2026-05-11',
    milestones: [
      'Demo extended to three modes: pipeline (summarize → translate), sentiment (POSITIVE/NEGATIVE/NEUTRAL classifier), vision (image describer). Single primitive, three on-chain task shapes.',
      'Orchestrator now dispatches by `mode`; /demo gets a three-tab switcher with mode-aware input (text vs image URL).',
      'Verified end-to-end on Base mainnet across all three modes — sponsor spent ~0.004 USDC for the full suite.',
      'Side fix: `TaskStatus` enum mirror in the web ABI was off-by-one against the contract, silently breaking the Try-with-wallet poll loop. Corrected.',
    ],
  },
  {
    date: '2026-04-29',
    milestones: [
      'M9.7.2 — public browser smoke on Base mainnet through /demo (Tasks #16 + #17, 22.4s, 0.002 USDC). Real OpenAI via Pages → Cloudflare Worker → Fly.',
      'M9.3 — Fly orchestrator live (sage-demo-agents.fly.dev): orchestrator x2 HA + Summarizer + Translator + 2 standby. min_machines_running = 1, http_check on /health.',
      'Sponsor guard activated in production — /api/demo/start returns 503 when sponsor wallet drops below the configured USDC floor.',
    ],
  },
  {
    date: '2026-04-27',
    milestones: [
      'M-INT.8 complete — first Cloudflare Pages deploy at sage-protocol.pages.dev. OG metadata, robots, sitemap, MIT-licensed.',
    ],
  },
  {
    date: '2026-04-24',
    milestones: [
      'M-INT.4 — orchestrator SSE backend: POST /api/demo/start + GET /api/demo/stream/:id (keep-alive + replay buffer).',
      'M-INT.5 + M-INT.6 — /demo page with reactive task lifecycle and a Try-with-wallet mode (EIP-2612 USDC permit + on-chain poll).',
      'M-INT.7 — Cloudflare Worker gateway: /api/rpc Alchemy proxy with hidden ALCHEMY_KEY, /api/demo/* passthrough, D1-backed daily rate limit.',
    ],
  },
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
      'Full test suite: 77 tests (unit + integration + fuzz + invariant), 100% contract coverage, Slither clean, 600k invariant calls with zero failures.',
      'M8.3 — first end-to-end mainnet demo (Tasks #10–#11, 0.02 USDC, 16.4s) with real USDC and CLI orchestrator.',
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
          href={`${siteConfig.github}/blob/main/CHANGELOG.md`}
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

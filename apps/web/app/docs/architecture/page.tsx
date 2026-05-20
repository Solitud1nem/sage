import Link from 'next/link';

import { BASE_MAINNET, addressUrl } from '@/chains/base';
import { ARC } from '@/chains/arc';
import { DocsLayout, DocsNextLink } from '@/components/docs/docs-layout';
import { GradientText } from '@/components/gradient-text';
import { githubBlobUrl, githubTreeUrl } from '@/lib/site-config';

/**
 * Docs / Architecture — product-tuned re-render of docs/architecture/
 * overview.md. Same shape (layers / money-flow / chains / boundaries /
 * roadmap) but trimmed for builders, not contributors. Deep
 * developer-facing version stays in the repo.
 */
export default function DocsArchitecturePage() {
  return (
    <DocsLayout>
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-purple mb-4">
        architecture
      </div>
      <h1 className="text-[clamp(32px,3.6vw,44px)] font-medium leading-[1.15] tracking-[-0.015em] mb-6">
        How it fits together. <GradientText>End to end</GradientText>.
      </h1>
      <p className="text-[16px] leading-[1.6] text-text-muted">
        Sage spans a browser, a Cloudflare Worker, a Fly app, and two
        contracts on Base. Each piece has one job; none of them can do
        each other's. This page is the bird's-eye view; the full developer
        version lives in{' '}
        <ExternalLink href={githubBlobUrl('docs/architecture/overview.md')}>
          docs/architecture/overview.md
        </ExternalLink>
        .
      </p>

      <Section id="layers" title="The layers" tag="01">
        <p>
          Five tiers from the user-facing browser down to the chain. Each
          adjacent pair has a single, narrow interface; substitutability is
          deliberate — you can replace the demo Worker with your own, the
          Fly orchestrator with your own, and Sage still works.
        </p>
        <Diagram>{`┌─────────────────────────────────────────────────────────────────┐
│  Browser (sage-protocol.pages.dev)                              │
│    Next.js 15 static export + wagmi + ConnectKit                │
│    Watch-live (SSE) + Try-with-wallet (EIP-2612 permit)         │
└──────────────────┬──────────────────────────┬───────────────────┘
                   │                          │
       (POST /api/demo/start)         (eth_* RPC reads)
                   │                          │
┌──────────────────▼──────────────────────────▼───────────────────┐
│  Cloudflare Worker (sage-gateway.a-t-somnia.workers.dev)        │
│    /api/demo/*  → passthrough на Fly + D1 rate-limit            │
│    /api/rpc     → Alchemy proxy with hidden ALCHEMY_KEY         │
└──────────────────┬──────────────────────────┬───────────────────┘
                   │                          │
       (HTTP + SSE)                       (Alchemy)
                   │                          │
┌──────────────────▼─────────────┐  ┌─────────▼────────────────────┐
│  Fly.io: sage-demo-agents      │  │  Base mainnet (chain 8453)   │
│    orchestrator x2 HA + 2 std  │  │    AgentRegistry (anchor)    │
│    summarizer + translator     │  │    TaskEscrow                │
│    vision + sentiment          │  │    USDC (Circle)             │
└────────────────────────────────┘  └──────────────────────────────┘`}</Diagram>
        <p>
          The browser never holds secrets. The Worker holds the Alchemy key
          and the daily-quota table. Fly holds the agent keys, sponsor key,
          and OpenAI key. Base holds the truth — every task and payment is
          a public on-chain record.
        </p>
      </Section>

      <Section id="money-flow" title="Money flow" tag="02">
        <p>
          A single task's lifecycle, annotated. Both EOAs (client and
          executor) sign their own transactions; no contract has the power
          to move funds without one of those signatures (or the
          deadline-elapsed safety net).
        </p>
        <Diagram>{`Client                          TaskEscrow                          Executor
  │                                │                                  │
  ├─ signPermit (off-chain) ──────►│                                  │
  │                                │                                  │
  ├─ createTask(executor, deadline,│                                  │
  │     amount, specUri, permit) ─►│ USDC.permit() ─► USDC ─► transferFrom
  │                                │ status=Created                   │
  │                                │ ◄────────────── TaskCreated event│
  │                                │                                  │
  │                                │◄──── acceptTask ─────────────────┤
  │                                │ status=Accepted                  │
  │                                │ ─────────────► TaskAccepted ─────┤
  │                                │                                  │
  │                                │◄─── completeTask(resultUri) ─────┤
  │                                │ status=Completed, completedAt=now│
  │                                │ ─────────────► TaskCompleted ────┤
  │                                │                                  │
  ├─ approvePayment ──────────────►│ USDC ─► transferTo(executor) ────┤
  │                                │ status=Paid (terminal)           │
  │                                │                                  │
  └────────────────────────────────┴──────────────────────────────────┘`}</Diagram>
        <p>
          <Label>Three off-path exits.</Label> If the client never approves:
          (a) executor calls <Mono>claimAutoRelease</Mono> after a 300-second
          grace and the funds release anyway; (b) executor calls{' '}
          <Mono>disputeTask</Mono> first and the funds freeze pending off-chain
          resolution; (c) deadline passes without acceptance or completion
          and anyone can call <Mono>refundExpired</Mono> to return the funds.
          See{' '}
          <Link
            href="/docs/concepts#lifecycle"
            className="text-purple hover:underline underline-offset-4"
          >
            Concepts → Lifecycle
          </Link>
          .
        </p>
      </Section>

      <Section id="chains" title="Chains" tag="03">
        <p>
          Live on Base today. Other EVM chains land via the same{' '}
          <Mono>TaskEscrow</Mono> + same salts → same address pattern. Arc
          is the exception — it gets a dedicated adapter
          (<Mono>@sage/adapter-arc</Mono>) that wraps native ERC-8183 +
          ERC-8004 rather than deploying our contracts there (
          <ExternalLink href={githubBlobUrl('docs/adr/0014-arc-adapter-native-erc-8183.md')}>
            ADR-0014
          </ExternalLink>
          ). Non-EVM (Solana, NEAR) lives behind a separate adapter
          package and is v3+ work.
        </p>
        <div className="my-4 rounded-[10px] border border-border overflow-hidden">
          <div className="grid grid-cols-[1.5fr_1fr_1fr] gap-4 px-4 py-3 border-b border-border bg-surface font-mono text-[10px] uppercase tracking-[0.06em] text-text-subtle">
            <span>Chain</span>
            <span>Status</span>
            <span>Era</span>
          </div>
          <ChainRow chain="Base" id="8453" status="Live" era="2026-04-22" />
          <ChainRow chain="Base Sepolia" id="84532" status="Live" era="2026-04-22" />
          <ChainRow
            chain={ARC.displayName}
            id="—"
            status="Planned"
            era="ADR-0014"
            muted
            title={ARC.note}
          />
          <ChainRow chain="Arbitrum" id="42161" status="Planned" era="v2.1" muted />
          <ChainRow chain="OP" id="10" status="Planned" era="v2.1" muted />
          <ChainRow chain="BNB" id="56" status="Planned" era="v2.1" muted />
          <ChainRow chain="Solana" id="—" status="Planned" era="v3+" muted />
          <ChainRow chain="NEAR" id="—" status="Planned" era="v3+" muted last />
        </div>
        <p>
          <Label>Anchor chain pattern.</Label>{' '}
          <Mono>AgentRegistry</Mono> lives only on Base — the canonical
          directory. Spoke chains (Arbitrum / OP / BNB) get{' '}
          <Mono>TaskEscrow</Mono> only; agent identity stays unified across
          chains because the EOA is the identifier. See{' '}
          <ExternalLink href={githubBlobUrl('docs/adr/0002-agent-identity.md')}>
            ADR-0002
          </ExternalLink>
          .
        </p>
        <p>
          Live mainnet addresses:{' '}
          <ExternalLink
            href={addressUrl(BASE_MAINNET.chainId, BASE_MAINNET.contracts.taskEscrow)}
          >
            <Mono>TaskEscrow</Mono>
          </ExternalLink>{' '}
          ·{' '}
          <ExternalLink
            href={addressUrl(BASE_MAINNET.chainId, BASE_MAINNET.contracts.agentRegistry)}
          >
            <Mono>AgentRegistry</Mono>
          </ExternalLink>
          . Same addresses on Sepolia by design (CREATE3 determinism, see{' '}
          <ExternalLink href={githubBlobUrl('docs/adr/0001-deterministic-addresses.md')}>
            ADR-0001
          </ExternalLink>
          ).
        </p>
      </Section>

      <Section id="boundaries" title="Security boundaries" tag="04">
        <p>
          What lives where, and what crosses what line.
        </p>
        <ul className="space-y-3 text-text-muted">
          <li>
            <Label>Browser.</Label> Holds nothing sensitive. User wallet keys
            stay in wagmi / ConnectKit; signing happens locally. No backend
            credentials are present in the bundle.
          </li>
          <li>
            <Label>Worker (Cloudflare).</Label> Holds{' '}
            <Mono>ALCHEMY_KEY</Mono> in a secret binding — never exposed to
            the browser. Hosts the D1 rate-limit table; enforces a daily
            quota per IP per UTC-day. CORS is allow-list strict.
          </li>
          <li>
            <Label>Fly (Orchestrator + workers).</Label> Holds sponsor
            wallet key, four agent keys, <Mono>OPENAI_API_KEY</Mono>. The
            sponsor-guard refuses new demo runs when the sponsor's USDC
            drops below the configured floor — prevents accepting work the
            stack can't actually settle.
          </li>
          <li>
            <Label>Contracts.</Label> Immutable.{' '}
            <Mono>TaskEscrow</Mono> has no admin and no upgrade path; the
            only way USDC leaves is via the lifecycle.{' '}
            <Mono>AgentRegistry</Mono> retains an owner for{' '}
            <Mono>pause()</Mono> / <Mono>unpause()</Mono> only — it can stop
            new registrations, but cannot touch escrow.
          </li>
          <li>
            <Label>Sponsor model.</Label> Anyone can be{' '}
            <Mono>client</Mono> on a task — the contract doesn't enforce that
            the funder is the end-user. This is what makes BYO-wallet and
            sponsored-demo modes share a primitive. App-layer concerns
            (attribution, abuse prevention, rate limits) live above the
            protocol.
          </li>
        </ul>
        <p>
          The full security checklist (external-call audit, state-transition
          audit, gas budgets) is in{' '}
          <ExternalLink href={githubBlobUrl('docs/architecture/security-checklist.md')}>
            docs/architecture/security-checklist.md
          </ExternalLink>
          , and the Slither status in{' '}
          <ExternalLink href={githubBlobUrl('docs/architecture/slither-review.md')}>
            slither-review.md
          </ExternalLink>
          . See also{' '}
          <Link href="/docs/security" className="text-purple hover:underline underline-offset-4">
            Security
          </Link>
          .
        </p>
      </Section>

      <Section id="roadmap" title="Roadmap" tag="05">
        <p>
          What's shipped, what's next, what's later.
        </p>
        <RoadmapRow
          version="v2.0"
          status="Live"
          accent="green"
          items={[
            'AgentRegistry + TaskEscrow on Base mainnet + Sepolia',
            '@sage/core + @sage/adapter-evm (workspace-only today)',
            'Demo: pipeline / sentiment / vision through Pages + Worker + Fly',
            'M9 operational hardening: sponsor guard, HA orchestrator, rate limits',
          ]}
        />
        <RoadmapRow
          version="v2.0.5"
          status="Next"
          accent="purple"
          items={[
            'npm publication of @sage/* (today: workspace install)',
            'Off-chain indexer for multi-chain agent discovery',
          ]}
        />
        <RoadmapRow
          version="v2.1"
          status="Planned"
          accent="cyan"
          items={[
            'Deploy on Arbitrum + Optimism + BNB (same addresses via CREATE3)',
            'ERC-4337 paymaster integration (gas abstraction)',
            'Multi-token settlement contract (TaskEscrowMultiToken at new salt)',
          ]}
        />
        <RoadmapRow
          version="v3"
          status="Later"
          accent="pink"
          items={[
            '@sage/adapter-solana (non-EVM transport)',
            'NEAR adapter',
            'On-chain reputation / attestations layer',
          ]}
          last
        />
        <p>
          Roadmap is a direction, not a calendar. v2.1 lands when v2.0
          deployments hit the limit of what's covered today (multi-chain
          and gas-abstracted ones). v3 lands when there's an agent on
          Solana that wants to settle against an agent on Base atomically.
        </p>
      </Section>

      <Section id="source" title="Source pointers" tag="06">
        <p>
          Architecture is best read as code. Everything below is in the
          public repo:
        </p>
        <ul className="grid gap-2 sm:grid-cols-2 text-[13px] my-3">
          <SourceLink label="docs/architecture/overview.md" href={githubBlobUrl('docs/architecture/overview.md')} />
          <SourceLink label="docs/architecture/contracts.md" href={githubBlobUrl('docs/architecture/contracts.md')} />
          <SourceLink label="docs/adr/ — all ADRs" href={githubTreeUrl('docs/adr')} />
          <SourceLink label="docs/runbooks/ — deploy + ops" href={githubTreeUrl('docs/runbooks')} />
          <SourceLink label="packages/contracts/src" href={githubTreeUrl('packages/contracts/src')} />
          <SourceLink label="apps/demo-agents/" href={githubTreeUrl('apps/demo-agents')} />
        </ul>
      </Section>

      <DocsNextLink
        href="/docs/security"
        label="Security"
        hint="Audit status, Slither findings, test coverage, threat model, and how to report a bug."
      />
    </DocsLayout>
  );
}

function ChainRow({
  chain,
  id,
  status,
  era,
  muted,
  last,
  title,
}: {
  chain: string;
  id: string;
  status: string;
  era: string;
  muted?: boolean;
  last?: boolean;
  title?: string;
}) {
  return (
    <div
      className={`grid grid-cols-[1.5fr_1fr_1fr] gap-4 px-4 py-3 ${
        last ? '' : 'border-b border-border'
      } items-baseline`}
      {...(title ? { title } : {})}
    >
      <div className={muted ? 'text-text-subtle' : ''}>
        <div className="text-[13px] text-text">{chain}</div>
        <div className="font-mono text-[11px] text-text-subtle">{id}</div>
      </div>
      <span
        className={`font-mono text-[10px] uppercase tracking-[0.06em] ${
          muted ? 'text-text-subtle' : 'text-green'
        }`}
      >
        {status}
      </span>
      <span className="font-mono text-[11px] text-text-muted">{era}</span>
    </div>
  );
}

function RoadmapRow({
  version,
  status,
  accent,
  items,
  last,
}: {
  version: string;
  status: string;
  accent: 'green' | 'purple' | 'cyan' | 'pink';
  items: string[];
  last?: boolean;
}) {
  const accentColor: Record<typeof accent, string> = {
    green: '#6EE7B7',
    purple: '#A78BFA',
    cyan: '#5EE3F5',
    pink: '#F472B6',
  };
  return (
    <div className={`py-4 ${last ? '' : 'border-b border-border'}`}>
      <div className="flex items-baseline gap-3 mb-3">
        <span className="font-mono text-[14px] font-medium" style={{ color: accentColor[accent] }}>
          {version}
        </span>
        <span
          className="font-mono text-[10px] uppercase tracking-[0.06em]"
          style={{ color: accentColor[accent] }}
        >
          {status}
        </span>
      </div>
      <ul className="space-y-1 text-[14px] text-text-muted leading-[1.55] pl-5">
        {items.map((item) => (
          <li key={item} className="list-disc list-outside">
            {item}
          </li>
        ))}
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

function Section({
  id,
  title,
  tag,
  children,
}: {
  id: string;
  title: string;
  tag: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-14 scroll-mt-20">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle mb-2">
        {tag}
      </div>
      <h2 className="text-[24px] font-medium tracking-[-0.01em] mb-4">
        <a href={`#${id}`} className="hover:text-purple transition-colors duration-200">
          {title}
        </a>
      </h2>
      <div className="space-y-4 text-[15px] leading-[1.65] text-text-muted">{children}</div>
    </section>
  );
}

function Diagram({ children }: { children: string }) {
  return (
    <pre className="my-4 rounded-[10px] border border-border bg-canvas p-5 text-[11.5px] font-mono leading-[1.55] text-text overflow-x-auto">
      {children}
    </pre>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[12px] uppercase tracking-[0.06em] text-text mr-2">
      {children}
    </span>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-text">{children}</span>;
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-cyan hover:underline underline-offset-4"
    >
      {children}
    </a>
  );
}

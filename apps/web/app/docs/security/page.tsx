import Link from 'next/link';

import { DocsLayout } from '@/components/docs/docs-layout';
import { GradientText } from '@/components/gradient-text';
import { githubBlobUrl, siteConfig } from '@/lib/site-config';

/**
 * Docs / Security — honest status page. No external audit yet (we say
 * so). Internal review (Slither + checklist + invariants) is documented
 * in the repo and linked here. Threat model brief. Disclosure path.
 */
export default function DocsSecurityPage() {
  return (
    <DocsLayout>
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-purple mb-4">
        security
      </div>
      <h1 className="text-[clamp(32px,3.6vw,44px)] font-medium leading-[1.15] tracking-[-0.015em] mb-6">
        What we've checked.{' '}
        <GradientText>And what we haven't</GradientText>.
      </h1>
      <p className="text-[16px] leading-[1.6] text-text-muted">
        Sage holds escrow USDC on Base mainnet. The honest version of "is
        this safe" is below: what's been reviewed, by whom, what's left
        open, and how to tell us if you find something.
      </p>

      <Section id="audit-status" title="Audit status" tag="01">
        <StatusBar
          label="External audit"
          state="Not yet"
          tone="warn"
          detail="No third-party audit has been performed on v2.0 contracts as of today. This is the most important caveat on the page. Treat mainnet usage accordingly — modest balances, short deadlines, and the dispute/refund paths to fall back on."
        />
        <StatusBar
          label="Internal review"
          state="Complete"
          tone="ok"
          detail="Two AI-assisted internal reviews: (a) Slither static analysis with zero high/medium findings; (b) line-by-line external-call audit + state-transition audit + gas budget review. Both documented in the repo."
        />
        <StatusBar
          label="Bug bounty"
          state="Not yet"
          tone="warn"
          detail="No formal bounty program in place. Responsible disclosure is welcomed (see 05); we'll acknowledge publicly and credit reporters."
        />
        <p>
          External audit is on the post-v2.0 punch-list. Until that lands,
          rely on the internal review materials, your own reading of the
          source, and start small.
        </p>
      </Section>

      <Section id="internal-review" title="Internal review" tag="02">
        <p>
          <Label>Slither.</Label> Static analysis with version 0.11.5,
          across both contracts plus interfaces. Zero high-severity, zero
          medium-severity findings. Seven low-severity (all{' '}
          <Mono>timestamp</Mono> usage, by design for deadline arithmetic)
          and three informational (naming, benign reentrancy under{' '}
          <Mono>nonReentrant</Mono>) — all acknowledged in the report.
        </p>
        <p>
          <Label>External-call audit.</Label> Every cross-contract call
          (<Mono>USDC.permit</Mono>, <Mono>safeTransferFrom</Mono>,{' '}
          <Mono>safeTransfer</Mono>) is wrapped in <Mono>nonReentrant</Mono>{' '}
          and follows checks-effects-interactions where order matters. The
          checklist documents each call site with its return-value check,
          reentrancy posture, and CEI compliance.
        </p>
        <p>
          <Label>State-transition audit.</Label> Every status transition
          (Created → Accepted → Completed → Paid, plus the dispute / resolve
          / refund / auto-release branches) is enforced by the{' '}
          <Mono>inStatus</Mono> modifier plus the function's role guard
          (executor-only, client-only, arbiter-only, or anyone-callable).
          The terminal states (Paid / Refunded / Split / Expired) are sticky
          — no path back to a live one. <Mono>Disputed</Mono> is the single
          non-terminal freeze: only the configured <Mono>arbiter</Mono>{' '}
          exits it, via <Mono>resolveDispute</Mono>.
        </p>
        <div className="my-5 flex flex-wrap gap-3">
          <ReviewLink
            label="Slither review"
            href={githubBlobUrl('docs/architecture/slither-review.md')}
          />
          <ReviewLink
            label="Security checklist"
            href={githubBlobUrl('docs/architecture/security-checklist.md')}
          />
        </div>
      </Section>

      <Section id="testing" title="Test coverage" tag="03">
        <div className="my-4 grid sm:grid-cols-2 gap-3">
          <Stat label="Solidity tests" value="77" detail="unit + integration + fuzz" />
          <Stat label="Contract coverage" value="100%" detail="branches + lines" />
          <Stat label="Invariant runs" value="600k" detail="4 invariants × 10k × depth 15" />
          <Stat label="TypeScript tests" value="167" detail="core 11 · adapter-evm 13 · adapter-arc 17 · demo-agents 126" />
        </div>
        <p>
          The invariant suite checks the four properties that we never want
          to drift: (a) <Mono>USDC.balanceOf(escrow) == Σ active task
          amounts</Mono>; (b) only valid state transitions; (c){' '}
          <Mono>refundExpired</Mono> returns exactly <Mono>amount</Mono> to
          the client; (d) terminal states are sticky. 600k random calls
          across these properties, zero failures.
        </p>
        <p>
          Reproduce locally:{' '}
          <Mono>forge test --match-path &apos;test/invariants/**&apos; --fuzz-runs 10000</Mono>{' '}
          from <Mono>packages/contracts</Mono>. Takes ~3 minutes on
          commodity hardware.
        </p>
      </Section>

      <Section id="threat-model" title="Threat model" tag="04">
        <p>
          What Sage protects against, what it doesn't, and where the
          responsibility lines fall.
        </p>

        <SubHeader>What Sage protects against</SubHeader>
        <ul className="space-y-2 text-text-muted">
          <li>
            <Label>Theft of locked USDC.</Label> Funds can only exit the
            escrow contract through the lifecycle methods. No admin, no
            upgrade, no <Mono>rescueTokens</Mono>.
          </li>
          <li>
            <Label>Silent agent.</Label> If the executor never accepts or
            never completes, the deadline passes and any caller can refund.
            The client is not on the hook indefinitely.
          </li>
          <li>
            <Label>Silent client.</Label> If the client never approves after
            <Mono>completeTask</Mono>, the executor can{' '}
            <Mono>claimAutoRelease</Mono> after a 300-second grace period.
            The executor is paid for delivered work.
          </li>
          <li>
            <Label>Replay / griefing on accept.</Label> Multiple agents
            racing to accept the same task is OK — first one wins, others
            revert deterministically. No partial state corruption.
          </li>
        </ul>

        <SubHeader>What Sage doesn't protect against</SubHeader>
        <ul className="space-y-2 text-text-muted">
          <li>
            <Label>Bad work product.</Label> The protocol can't tell if a
            summary is good or garbage. A client can <Mono>disputeTask</Mono>{' '}
            a completed result, which freezes the funds (status = Disputed)
            instead of paying out. Resolution is a <em>trust layer</em>, not
            a cryptographic guarantee: an off-chain council (a single
            gpt-4o-mini judge in v1, per{' '}
            <ExternalLink href={githubBlobUrl('docs/adr/0019-off-chain-council-v1.md')}>
              ADR-0019
            </ExternalLink>
            ) reviews the dispute and returns a verdict — pay the worker,
            refund the client, or split — which a configured{' '}
            <Mono>arbiter</Mono> EOA executes on-chain via{' '}
            <Mono>resolveDispute</Mono>. In this demo the arbiter, sponsor,
            and client collapse to one party (the honest v1 posture stated
            in the ADR), and the second-level human <em>appeal</em> is a
            stub. So the dispute path hands you a referee, not a proof —
            size mainnet balances accordingly.
          </li>
          <li>
            <Label>Capability fraud.</Label> An agent can claim
            <Mono> sentiment-classify</Mono> in its registry entry and
            deliver random output. Capability strings are advertised, not
            verified by the protocol. Discovery layers and reputation are
            where this lives — not the escrow.
          </li>
          <li>
            <Label>Sybil agents.</Label> One human can run a thousand
            EOAs. The registry doesn't prevent this; it just makes it
            visible. Treat the registry as a directory, not a whitelist.
          </li>
          <li>
            <Label>Wallet compromise.</Label> If your wallet key leaks,
            an attacker can drain pending tasks via{' '}
            <Mono>disputeTask</Mono> or never approve. Use a dedicated
            agent EOA and rotate periodically.
          </li>
          <li>
            <Label>Front-running of accepts.</Label> If two agents
            target the same capability, the one with higher gas wins.
            For high-value tasks, prefer addressing a specific{' '}
            <Mono>executor</Mono> in <Mono>createTask</Mono> rather than
            broadcasting and letting any agent race.
          </li>
        </ul>

        <SubHeader>App-layer concerns</SubHeader>
        <p>
          Rate limiting, abuse prevention, attribution of sponsor-funded
          tasks to end users — these live above the protocol. The demo
          stack puts them in the Cloudflare Worker (CORS allow-list,
          D1-backed daily quota per IP, sponsor-guard on the
          orchestrator). Your stack will need its own — Sage doesn't have
          opinions about how you do it.
        </p>
      </Section>

      <Section id="disclosure" title="Responsible disclosure" tag="05">
        <p>
          Found something? Don't open a public issue first.
        </p>
        <ul className="space-y-2 text-text-muted">
          <li>
            <Label>Preferred path.</Label> File a private security advisory
            via GitHub:{' '}
            <ExternalLink
              href={`${siteConfig.github}/security/advisories/new`}
            >
              {`${siteConfig.github.replace('https://', '')}/security/advisories/new`}
            </ExternalLink>
            . This keeps the finding private until we coordinate.
          </li>
          <li>
            <Label>Fallback.</Label> If you can't use GitHub Security
            Advisories, reach out through the contact listed on the{' '}
            <ExternalLink href={siteConfig.github}>repository profile</ExternalLink>{' '}
            with the words <Mono>[security]</Mono> in the subject and
            keep details out of the public log.
          </li>
        </ul>
        <p>
          We'll acknowledge within a business day. A formal bounty program
          isn't in place yet, but reporters who hand us actionable
          findings get public credit (and our gratitude). Expect a short
          back-and-forth, a fix branch, a coordinated disclosure date, and
          a credit line in the advisory + the changelog.
        </p>
        <p>
          The shortest path to <em>not</em> finding something serious is
          (a) read the contracts — they're 400 lines total — and (b) play
          with the{' '}
          <Link href="/demo" className="text-purple hover:underline underline-offset-4">
            live demo
          </Link>
          . Most reports come from the second.
        </p>
      </Section>

      <ClosingCta />
    </DocsLayout>
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

function StatusBar({
  label,
  state,
  tone,
  detail,
}: {
  label: string;
  state: string;
  tone: 'ok' | 'warn';
  detail: string;
}) {
  const stateColor = tone === 'ok' ? '#6EE7B7' : '#F472B6';
  return (
    <div className="my-3 rounded-[10px] border border-border bg-surface p-4">
      <div className="flex items-baseline gap-3 mb-2 flex-wrap">
        <span className="text-[14px] text-text font-medium">{label}</span>
        <span
          className="font-mono text-[10px] uppercase tracking-[0.06em]"
          style={{ color: stateColor }}
        >
          {state}
        </span>
      </div>
      <p className="text-[13px] text-text-muted leading-[1.6]">{detail}</p>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[10px] border border-border bg-surface p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-subtle mb-1">
        {label}
      </div>
      <div className="text-[24px] font-medium tracking-[-0.01em] text-text">{value}</div>
      <div className="text-[11px] text-text-subtle mt-1">{detail}</div>
    </div>
  );
}

function ReviewLink({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center justify-center h-10 px-4 rounded-[10px] border border-border-hover text-[13px] hover:bg-surface transition-colors duration-200"
    >
      {label} ↗
    </a>
  );
}

function SubHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
      {children}
    </div>
  );
}

function ClosingCta() {
  return (
    <div className="mt-16 pt-8 border-t border-border">
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-subtle mb-3">
        you've reached the end of docs
      </div>
      <p className="text-[15px] text-text-muted leading-[1.6] max-w-[560px] mb-5">
        Back to the hub, or jump to the live demo. Everything past this
        point is in the repo — runbooks, ADRs, test source.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/docs"
          className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] border border-border-hover text-[13px] hover:bg-surface transition-colors duration-200"
        >
          ← Docs hub
        </Link>
        <Link
          href="/docs/architecture"
          className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] border border-border-hover text-[13px] hover:bg-surface transition-colors duration-200"
        >
          ← Architecture
        </Link>
        <Link
          href="/demo"
          className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] bg-purple text-[#0A0A0F] text-[13px] font-semibold hover:shadow-[0_0_28px_rgba(167,139,250,0.45)] transition-shadow duration-200"
        >
          Try the demo →
        </Link>
      </div>
    </div>
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

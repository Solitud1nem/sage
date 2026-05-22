import Link from 'next/link';

import { BASE_MAINNET, addressUrl } from '@/chains/base';
import { DocsLayout, DocsNextLink } from '@/components/docs/docs-layout';
import { GradientText } from '@/components/gradient-text';

/**
 * Docs / Intro — first stop for newcomers. Frames what Sage is and is not in
 * under five minutes. Builder middle+ tone; no marketing fluff.
 */
export default function DocsIntroPage() {
  return (
    <DocsLayout>
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-purple mb-4">
        intro
      </div>
      <h1 className="text-[clamp(32px,3.6vw,44px)] font-medium leading-[1.15] tracking-[-0.015em] mb-6">
        Sage is a settlement layer for{' '}
        <GradientText>autonomous work</GradientText>.
      </h1>
      <p className="text-[16px] leading-[1.6] text-text-muted">
        It is task-level escrow for AI agents — built so two parties (a client and
        an agent) can commit to multi-step work, lock USDC against a deadline, and
        settle on-chain when the work is delivered. Live on Base mainnet and
        Arc testnet (bridge state), with deterministic addresses across CreateX-
        compatible EVM chains.
      </p>

      <Section id="what-it-is" title="What Sage is">
        <p>
          Sage is a pair of audited Solidity contracts plus a TypeScript SDK that
          let you express the most common transaction between AI agents:{' '}
          <em>"do this thing, with this budget, by this deadline."</em> The contract
          holds the budget in escrow, watches the deadline, and releases payment
          when both sides agree it's done — or refunds the client when the deadline
          passes without delivery.
        </p>
        <p>
          The two contracts are{' '}
          <ExternalLink href={addressUrl(BASE_MAINNET.chainId, BASE_MAINNET.contracts.taskEscrow)}>
            <Mono>TaskEscrow</Mono>
          </ExternalLink>{' '}
          (the settlement primitive) and{' '}
          <ExternalLink href={addressUrl(BASE_MAINNET.chainId, BASE_MAINNET.contracts.agentRegistry)}>
            <Mono>AgentRegistry</Mono>
          </ExternalLink>{' '}
          (an optional discovery layer). Both are live at deterministic
          addresses on Base mainnet and Base Sepolia (via CreateX + CREATE3),
          plus an Arc testnet bridge deployment at distinct addresses via
          Arachnid CREATE2 — Arc lacks CreateX, so it's a documented
          exception, recorded in{' '}
          <ExternalLink href="https://github.com/Solitud1nem/sage/blob/main/docs/adr/0015-arc-deploy-bridge.md">
            ADR-0015
          </ExternalLink>
          . Arbitrum, Optimism, and BNB are on the v2.1 path (same-address
          deploys via CreateX).
        </p>
        <p>
          Sage's angle, beyond the escrow primitive, is{' '}
          <em>observable decomposition</em> — when work is composite, the
          plan is surfaced as a structured artifact (one sub-task per
          on-chain TaskEscrow record) so the user reviews it before any
          spawn. Live at{' '}
          <Link href="/demo/composite" className="text-purple hover:underline underline-offset-4">
            /demo/composite
          </Link>
          ; rationale in{' '}
          <ExternalLink href="https://github.com/Solitud1nem/sage/blob/main/docs/adr/0007-observable-decomposition.md">
            ADR-0007
          </ExternalLink>{' '}
          and{' '}
          <ExternalLink href="https://github.com/Solitud1nem/sage/blob/main/docs/adr/0008-sage-angle-position.md">
            ADR-0008
          </ExternalLink>
          .
        </p>
      </Section>

      <Section id="problem" title="The problem it solves">
        <p>
          Agent-to-agent payment standards like{' '}
          <ExternalLink href="https://github.com/coinbase/x402">x402</ExternalLink>{' '}
          handle the easy case beautifully: a single HTTP call, a single payment,
          settled inline. That's pay-per-call.
        </p>
        <p>
          Most real agent work isn't one call. It's a chain of steps with intermediate
          handoffs, asynchronous deliveries, the possibility that the recipient
          flakes, and the need for the payer to see proof of work before releasing
          funds. None of that fits cleanly into "HTTP 402 → pay → done."
        </p>
        <p>
          Sage covers the longer-tail case. It gives agents a way to commit to
          multi-step delivery with an enforceable deadline, an escrow that protects
          both sides, and a public lifecycle that downstream systems can index and
          act on.
        </p>
      </Section>

      <Section id="mental-model" title="Mental model in five minutes">
        <p>
          Think of a Sage task as a sealed envelope of USDC with three fields
          written on the outside: <em>who can open it</em>, <em>when it expires</em>,
          and <em>what it's for</em>.
        </p>
        <ol className="list-decimal list-outside pl-5 space-y-2 text-text-muted">
          <li>
            <span className="text-text">Client</span> signs one permit and calls{' '}
            <Mono>createTask</Mono>. USDC moves into escrow.
          </li>
          <li>
            <span className="text-text">Agent</span> sees the task on-chain (it's
            addressed to its EOA), calls <Mono>acceptTask</Mono>, does the work,
            then calls <Mono>completeTask</Mono> with a pointer to the result.
          </li>
          <li>
            <span className="text-text">Client</span> reviews the result and calls{' '}
            <Mono>approvePayment</Mono>. USDC moves from escrow to the agent. Done.
          </li>
          <li>
            <span className="text-text">If the deadline passes</span> without an
            accept or a completion, anyone can call <Mono>refundExpired</Mono> and
            the USDC goes back to the client. No one is on the hook forever.
          </li>
        </ol>
        <p>
          That's it. Four functions for the happy path, two more for the unhappy
          ones (<Mono>disputeTask</Mono> and <Mono>claimAutoRelease</Mono>). The
          full state machine is in{' '}
          <Link href="/docs/concepts" className="text-purple hover:underline underline-offset-4">
            Concepts → Lifecycle
          </Link>
          .
        </p>
      </Section>

      <Section id="where-x402-fits" title="Where x402 fits next to Sage">
        <p>
          They're complementary, not competing. <Mono>x402</Mono> is the right
          tool when an agent wants to charge per call and the payer is happy to
          settle inline — e.g. an LLM gateway, a per-query API, a one-shot
          inference endpoint. Sage is the right tool when the agent has to
          <em> commit</em> to delivery — a research task that takes a minute, a
          translation pipeline with multiple steps, a workflow where the payer
          wants to inspect output before releasing funds.
        </p>
        <p>
          The SDK exposes both. <Mono>sage.callAgent()</Mono> wraps an x402
          fetch (with permission + retry baked in); <Mono>sage.tasks.createTask()</Mono>{' '}
          opens a task on the escrow. Same client, two transports — pick the
          right one per interaction. The full rationale is in{' '}
          <ExternalLink href="https://github.com/Solitud1nem/sage/blob/main/docs/adr/0003-x402-as-pay-per-call-transport.md">
            ADR-0003
          </ExternalLink>
          .
        </p>
      </Section>

      <Section id="who-its-for" title="Who it's for">
        <ul className="space-y-3 text-text-muted">
          <li>
            <span className="text-text">Builders of AI agents.</span> If your
            agent does work that takes longer than a single HTTP round-trip, Sage
            gives you a payment story without inventing your own escrow.
          </li>
          <li>
            <span className="text-text">Agent platforms and orchestrators.</span>{' '}
            If you're building a layer that dispatches work to many agents, Sage
            is the on-chain coordination primitive you can rely on without
            running your own settlement infrastructure.
          </li>
          <li>
            <span className="text-text">Researchers comparing approaches.</span>{' '}
            The whole stack — contracts, SDK, demo agents, deploy scripts — is
            open and audited. Read it, fork it, ship a v2.0.1 with your own
            opinions.
          </li>
        </ul>
        <p>
          If your agent is happy with pay-per-call, stick with x402. If you need
          deadlines, escrow, or any multi-step delivery, you're in the right place.
        </p>
      </Section>

      <DocsNextLink
        href="/docs/concepts"
        label="Concepts"
        hint="The six ideas underneath Sage: agents, tasks, escrow, lifecycle, capabilities, and settlement."
      />
    </DocsLayout>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-14">
      <h2 className="text-[24px] font-medium tracking-[-0.01em] mb-4 scroll-mt-20">
        <a href={`#${id}`} className="hover:text-purple transition-colors duration-200">
          {title}
        </a>
      </h2>
      <div className="space-y-4 text-[15px] leading-[1.65] text-text-muted">{children}</div>
    </section>
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

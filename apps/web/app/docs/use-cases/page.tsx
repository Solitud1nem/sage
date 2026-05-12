import Link from 'next/link';

import { DocsLayout, DocsNextLink } from '@/components/docs/docs-layout';
import { GradientText } from '@/components/gradient-text';
import { githubBlobUrl } from '@/lib/site-config';

/**
 * Docs / Use cases — five scenarios where Sage fits, one decision callout
 * for where to reach for x402 instead. Marketing-flavoured but every
 * numbered claim ties back to a concrete primitive shown earlier in docs.
 */
export default function DocsUseCasesPage() {
  return (
    <DocsLayout>
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-purple mb-4">
        use cases
      </div>
      <h1 className="text-[clamp(32px,3.6vw,44px)] font-medium leading-[1.15] tracking-[-0.015em] mb-6">
        Where Sage fits. <GradientText>And where it doesn't</GradientText>.
      </h1>
      <p className="text-[16px] leading-[1.6] text-text-muted">
        Five concrete scenarios drawn from real product work, plus an honest
        callout for the case where you should reach for x402 instead.
        Capabilities reference the four reference agents in{' '}
        <Link href="/docs/patterns" className="text-purple hover:underline underline-offset-4">
          Patterns
        </Link>
        ; the shapes generalize to anything you ship on the same skeleton.
      </p>

      <UseCase
        id="rfp-pipeline"
        tag="01"
        title="RFP / long-document summarization pipeline"
        capabilities={['summarize']}
      >
        <p>
          <Label>The problem.</Label> A consultancy or BD team gets ten 40-page
          RFPs a week. Reading each one to triage whether to bid is hours of
          partner time. They want a daily digest: each RFP turned into a
          twelve-bullet brief, with the source PDF one click away.
        </p>
        <p>
          <Label>The shape.</Label> Their ingestion job uploads each new RFP
          to IPFS and calls <Mono>createTask</Mono> with the IPFS URI as the
          spec, a budget of one or two cents in USDC, and a one-hour deadline.
          A Summarizer agent (theirs or someone else's, indistinguishable
          from the protocol's perspective) downloads the PDF, runs it through
          a long-context model, and returns the brief as a result URI. The
          digest mailer renders the briefs the next morning. If anything
          times out, <Mono>refundExpired</Mono> reclaims the escrow.
        </p>
        <p>
          <Label>Why Sage.</Label> The summarization run takes a couple of
          minutes — too long for an inline x402 call, too short to justify
          building an in-house queue + payment + dispute system. Sage gives
          them an audit trail (every digest links to a Basescan tx-hash) and
          the option to swap the agent later without re-plumbing payments.
        </p>
      </UseCase>

      <UseCase
        id="cross-language"
        tag="02"
        title="Cross-language content ops"
        capabilities={['summarize', 'translate']}
      >
        <p>
          <Label>The problem.</Label> A docs team writes in English and ships
          in five languages. Today translation is contracted out, takes days,
          and lags the source by a release or two. They want overnight
          turnaround, audit logs, and predictable cost.
        </p>
        <p>
          <Label>The shape.</Label> Two-stage pipeline. Stage 1: a Summarizer
          turns each long page into a translator-friendly intermediate brief.
          Stage 2 fans out — one Translator task per target language, parallel.
          Total cost per page is on the order of half a cent in USDC; total
          wall time is the longest single translation, not the sum. The same
          orchestrator that drives <Link href="/demo" className="text-purple hover:underline underline-offset-4">the live demo</Link>{' '}
          handles this shape today.
        </p>
        <p>
          <Label>Why Sage.</Label> Per-step settlement means each language can
          fail independently — French translator times out, English-French
          refunds, the other four still ship. With a monolithic
          translation-service contract you either get everything or nothing.
        </p>
      </UseCase>

      <UseCase
        id="moderation"
        tag="03"
        title="Image-driven content moderation"
        capabilities={['vision-describe', 'sentiment-classify']}
      >
        <p>
          <Label>The problem.</Label> A marketplace lets users post listings
          with photos and captions. They want a moderation pre-filter that
          flags anything obviously off — gore, hate signals in copy, mismatch
          between image and description. The bar isn't perfect classification;
          it's "make a human look at the riskiest 5%."
        </p>
        <p>
          <Label>The shape.</Label> Two agents in parallel: Vision describes
          the image, Sentiment classifies the caption. The moderation worker
          composes the two outputs — strong negative sentiment plus a
          description containing risk vocabulary → escalate; otherwise pass.
          Each task is cheap (sub-cent), but volume matters — at 10k listings
          a day, the audit log alone is worth the on-chain story.
        </p>
        <p>
          <Label>Why Sage.</Label> Auditability. If a listing slips through
          and there's a complaint, the entire decision chain — which agent
          looked at which image, what description came back, what payment
          settled when — is on Basescan. With a centralized model API you
          have logs you control, which means logs a regulator can ask you
          to produce. Sage's are public.
        </p>
      </UseCase>

      <UseCase
        id="multi-step"
        tag="04"
        title="Multi-step agent workflows"
        capabilities={['summarize', 'translate', 'custom']}
      >
        <p>
          <Label>The problem.</Label> A research pipeline: gather sources,
          extract claims from each, cross-reference, draft a report. Four
          different capabilities, four different model preferences, ideally
          four different agents specialized for each step.
        </p>
        <p>
          <Label>The shape.</Label> An orchestrator (yours) drives one Sage
          task per stage. Each agent's <Mono>resultUri</Mono> becomes the
          next task's <Mono>specUri</Mono>. The orchestrator approves payment
          when it accepts each intermediate result; if stage 3 turns out
          garbage, it disputes that one task and re-runs against a different
          agent, without touching the upstream work that landed cleanly.
        </p>
        <p>
          <Label>Why Sage.</Label> x402 handles atomic single-call work; it
          has no concept of "I'll pay you for step 3 of a five-step plan, but
          only if step 3 actually delivers." Sage's per-task escrow gives you
          that boundary natively. The four-stage pipeline in{' '}
          <Link href="/docs/patterns" className="text-purple hover:underline underline-offset-4">
            Patterns
          </Link>{' '}
          is the two-stage version of this shape; the protocol doesn't care
          how deep the chain goes.
        </p>
      </UseCase>

      <UseCase
        id="sponsorship"
        tag="05"
        title="Sponsored agent payments"
        capabilities={['any']}
      >
        <p>
          <Label>The problem.</Label> A consumer product wants users to
          interact with agents — generating summaries, classifying inputs —
          without asking them to manage a wallet or buy USDC. The product
          pays. The user's experience is "click button, get result," no
          MetaMask popup.
        </p>
        <p>
          <Label>The shape.</Label> A sponsor wallet owned by the product
          calls <Mono>createTask</Mono> on behalf of each session. The
          task's <Mono>client</Mono> field is the sponsor's EOA, not the
          end user's. The product attributes the resulting Basescan tx to
          the user session in its own database. Refunds come back to the
          sponsor wallet — never to the user, who never had funds. This is
          how Sage's own{' '}
          <Link href="/demo" className="text-purple hover:underline underline-offset-4">
            Watch-live demo
          </Link>{' '}
          works: sponsor <Mono>0x6D8a…376d</Mono> pays for every run.
        </p>
        <p>
          <Label>Why Sage.</Label> Sponsorship works in Sage with zero extra
          plumbing. The contract doesn't enforce identity between client and
          end-user; the SDK doesn't ask. Any address can be the client.
          Rate-limiting and abuse prevention sit at the application layer
          (in our case: a Cloudflare Worker with D1-backed quotas) — Sage
          itself stays neutral on who's paying for whom.
        </p>
      </UseCase>

      <DecisionCallout id="when-not" tag="06" title="When to reach for x402 instead">
        <p>
          Sage is the wrong tool when the work fits in one HTTP round-trip
          and the payer is happy to settle inline. If your agent serves a
          model gateway, a single-query API, an autocomplete endpoint —
          anything where the response and the receipt arrive in the same
          breath — use{' '}
          <ExternalLink href="https://github.com/coinbase/x402">x402</ExternalLink>{' '}
          and skip the escrow.
        </p>
        <p>
          The SDK wraps both. <Mono>sage.callAgent()</Mono> is an x402 fetch
          with permission and retry baked in; <Mono>sage.tasks.createTask()</Mono>{' '}
          opens a task on the escrow. Same client, two transports — pick the
          right one per interaction. The rationale lives in{' '}
          <ExternalLink
            href={githubBlobUrl(
              'docs/adr/0003-x402-as-pay-per-call-transport.md',
            )}
          >
            ADR-0003
          </ExternalLink>
          .
        </p>
        <p>
          Heuristic: if you can imagine the agent saying "pay me first, here
          you go," it's x402. If the agent has to commit to doing the work
          before being paid, it's Sage.
        </p>
      </DecisionCallout>

      <DocsNextLink
        href="/docs/api"
        label="API reference"
        hint="Compact SDK lookup — method tables for tasks, agents, x402 transport, and event subscriptions."
      />
    </DocsLayout>
  );
}

function UseCase({
  id,
  tag,
  title,
  capabilities,
  children,
}: {
  id: string;
  tag: string;
  title: string;
  capabilities: string[];
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-14 scroll-mt-20">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle mb-2">
        {tag}
      </div>
      <div className="flex items-baseline gap-3 flex-wrap mb-4">
        <h2 className="text-[24px] font-medium tracking-[-0.01em]">
          <a href={`#${id}`} className="hover:text-purple transition-colors duration-200">
            {title}
          </a>
        </h2>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {capabilities.map((cap) => (
          <span
            key={cap}
            className="font-mono text-[10px] uppercase tracking-[0.06em] px-2 py-1 rounded-md border border-border text-text-muted"
          >
            {cap}
          </span>
        ))}
      </div>
      <div className="space-y-4 text-[15px] leading-[1.65] text-text-muted">{children}</div>
    </section>
  );
}

function DecisionCallout({
  id,
  tag,
  title,
  children,
}: {
  id: string;
  tag: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="mt-14 scroll-mt-20 rounded-[14px] border border-border bg-surface p-6 md:p-8"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle mb-2">
        {tag}
      </div>
      <h2 className="text-[22px] font-medium tracking-[-0.01em] mb-4">
        <a href={`#${id}`} className="hover:text-purple transition-colors duration-200">
          {title}
        </a>
      </h2>
      <div className="space-y-4 text-[15px] leading-[1.65] text-text-muted">{children}</div>
    </section>
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

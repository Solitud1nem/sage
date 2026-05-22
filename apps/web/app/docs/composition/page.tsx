import Link from 'next/link';

import { DocsLayout, DocsNextLink } from '@/components/docs/docs-layout';
import { GradientText } from '@/components/gradient-text';
import { githubBlobUrl, githubTreeUrl } from '@/lib/site-config';

/**
 * Docs / Composition — the canonical-angle page (ADR-0007 + ADR-0008).
 *
 * Dedicated coverage of plan-then-execute / observable decomposition:
 * what it is, why it's externalized (not hidden in LLM context), how the
 * trigger axes work, the lifecycle, the three-layer high-stakes defense,
 * the classifier model, the dispute path, and when not to use it.
 *
 * Tone matches the rest of /docs — builder-middle+, no marketing.
 */
export default function DocsCompositionPage() {
  return (
    <DocsLayout>
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-purple mb-4">
        composition
      </div>
      <h1 className="text-[clamp(32px,3.6vw,44px)] font-medium leading-[1.15] tracking-[-0.015em] mb-6">
        Composite work, surfaced as a plan.{' '}
        <GradientText>Approved before it runs.</GradientText>
      </h1>
      <p className="text-[16px] leading-[1.6] text-text-muted">
        When a brief is bigger than one call, Sage's flow turns it into a
        graph of atomic <Mono>TaskEscrow</Mono> records — generated{' '}
        dynamically per-brief by an LLM classifier, surfaced as a structured
        artifact the user reviews before any on-chain spawn. The pattern is{' '}
        <em>dynamic</em> (plans aren't hardcoded workflows) and{' '}
        <em>observable</em> (decomposition is visible, not buried in
        agent-side context). This is Sage's angle per{' '}
        <ExternalLink href={githubBlobUrl('docs/adr/0008-sage-angle-position.md')}>
          ADR-0008
        </ExternalLink>
        ; the design lives in{' '}
        <ExternalLink href={githubBlobUrl('docs/adr/0007-observable-decomposition.md')}>
          ADR-0007
        </ExternalLink>
        . Live at{' '}
        <Link href="/demo/composite" className="text-purple hover:underline underline-offset-4">
          /demo/composite
        </Link>
        .
      </p>

      <Section id="what" title="What it is" tag="01">
        <p>
          A composite task is a brief that decomposes into <em>several</em>{' '}
          atomic settlement records, each its own{' '}
          <Mono>createTask → acceptTask → completeTask → approvePayment</Mono>{' '}
          cycle. The flow doesn't replace the primitive — it composes on top
          of it.
        </p>
        <Diagram>{`brief  →  classify  →  plan card  →  approve / edit / cancel
                                  │
                                  ↓ (only after explicit approval)
              ┌──── sub-task #1 ────┐  ┌──── sub-task #2 ────┐
              │ createTask         │  │ createTask          │
              │ acceptTask         │  │ acceptTask          │
              │ completeTask       │  │ completeTask        │
              │ approvePayment     │  │ approvePayment      │
              └────────────────────┘  └─────────────────────┘
                                                  ↓
                                            plan settled`}</Diagram>
        <p>
          The user sees the full graph — sub-task types, executors, costs,
          dependencies, total estimated duration — before any sponsor money
          moves. Approve commits the plan. Edit splices in changes (reorder,
          re-assign, drop). Cancel returns the run to idle.
        </p>
      </Section>

      <Section id="why" title="Why externalize the plan" tag="02">
        <p>
          The naive shape for multi-step agent work is to hand the whole
          brief to one agent and let it decide the steps internally. Plan
          generation, sub-task spawning, result aggregation — all in one
          LLM's context. This is the path of least implementation
          resistance and almost universally what platforms ship.
        </p>
        <p>
          The cost shows up later. The decomposition exists only inside the
          agent's context window: no on-chain record of <em>which</em>{' '}
          sub-tasks ran, no per-step approval, no granular dispute, no
          indexable graph for downstream tools. When the work goes wrong,
          there's no surface to act on except &quot;run the whole thing
          again.&quot;
        </p>
        <p>
          Sage's bet: the decomposition is more valuable as a first-class
          artifact than as agent-internal state. Externalizing it means:
        </p>
        <ul className="list-disc list-outside pl-5 space-y-2 text-text-muted">
          <li>
            <strong className="text-text">Per-step verification.</strong>{' '}
            Each <Mono>approvePayment</Mono> is a discrete checkpoint —
            client signs off only when the result for that sub-task is
            acceptable. The fund-release cadence matches the work-delivery
            cadence.
          </li>
          <li>
            <strong className="text-text">Granular dispute.</strong> One
            sub-task can be paused, retried, or routed to a different
            executor without unwinding the work that already settled.
            Compare to a monolithic delivery where dispute means rerun
            the entire pipeline.
          </li>
          <li>
            <strong className="text-text">Indexable lineage.</strong>{' '}
            Sub-tasks carry a <Mono>parent_id</Mono> envelope in their{' '}
            <Mono>specUri</Mono> — an off-chain indexer can reconstruct the
            parent-child graph from <Mono>TaskCreated</Mono> events alone.
            No proprietary platform state required.
          </li>
          <li>
            <strong className="text-text">Pre-execute review.</strong> The
            user sees the plan <em>before</em> the first sub-task spawns.
            Most of the cost of agentic work goes to wrong-thing-built,
            not slow-thing-built; structured pre-review converts the
            cheapest kind of feedback (plan-time) from impossible to
            routine.
          </li>
        </ul>
      </Section>

      <Section id="trigger-axes" title="Trigger axes — decomposability × stakes" tag="03">
        <p>
          Not every brief should go through the full plan-then-execute UX —
          a one-shot summarize call shouldn't surface a graph with one node.
          A classifier reads the brief along two axes and the resulting
          quadrant determines UX intensity. Operationalized definitions are
          in{' '}
          <ExternalLink href={githubBlobUrl('docs/research/classification-trigger-design.md')}>
            classification-trigger-design.md
          </ExternalLink>
          .
        </p>
        <div className="my-4 rounded-[10px] border border-border overflow-hidden">
          <div className="grid grid-cols-[160px_1fr] gap-4 px-4 py-3 border-b border-border bg-surface font-mono text-[10px] uppercase tracking-[0.06em] text-text-subtle">
            <span>Quadrant</span>
            <span>Behavior</span>
          </div>
          <TriggerRow
            label="one-shot / low"
            description="Direct execute — single TaskEscrow record, no plan card. The classic /demo path (summarize, translate, sentiment, vision)."
          />
          <TriggerRow
            label="one-shot / high"
            description="Direct execute, but stakes flag triggers extra defensive UX: confirm prompt, explicit executor assignment, no auto-route on send/transfer/book verbs."
          />
          <TriggerRow
            label="composite / low"
            description="Plan card surfaces the graph; user can approve as-is or edit. Auto-routing fills executors per stem matching (summarize → Summarizer, translate → Translator, etc.)."
          />
          <TriggerRow
            label="composite / high"
            description="Plan card + auto-route disabled. Every sub-task surfaces as unassigned; user must deliberately pick executors via plan-editor before Approve enables. The maximum-ceremony quadrant."
            last
          />
        </div>
        <p>
          Confidence is asymmetric. The classifier emits{' '}
          <Mono>confidence_decomposability</Mono> and{' '}
          <Mono>confidence_stakes</Mono> per call, and a deterministic
          heuristic cross-check (regex on the brief) halves the confidence
          when its own signals contradict the LLM. When both confidences
          drop below threshold, the system defaults to the cautious
          quadrant — composite / high — because under-protecting is the
          worse failure mode.
        </p>
      </Section>

      <Section id="lifecycle" title="Lifecycle" tag="04">
        <p>
          From brief submission to plan-settled. Each transition emits an
          SSE event over the same channel the 3-mode demo uses, so existing
          layout primitives render the live state without mode-specific
          plumbing.
        </p>
        <ol className="list-decimal list-outside pl-5 space-y-2 text-text-muted">
          <li>
            <strong className="text-text">classify.</strong> Brief →{' '}
            <Mono>POST /api/demo/composite/classify</Mono>. Returns a{' '}
            <Mono>ClassificationResult</Mono>: axis labels, confidences,
            proposed plan, reasoning trace, signal trace. The plan card
            renders from this; the run is still in <Mono>plan-ready</Mono>{' '}
            — no on-chain transactions have happened.
          </li>
          <li>
            <strong className="text-text">approve / edit / cancel.</strong>{' '}
            The user picks one. Edit re-opens the plan-editor — reorder,
            re-assign executor, drop sub-tasks. Save replaces the plan
            snapshot; Approve commits whatever's current.
          </li>
          <li>
            <strong className="text-text">execute.</strong> Approved plan →{' '}
            <Mono>POST /api/demo/composite/execute</Mono>. Server returns a{' '}
            <Mono>runId</Mono> immediately and kicks off <Mono>runPlan</Mono>{' '}
            in the background; client attaches to{' '}
            <Mono>GET /api/demo/composite/stream/:runId</Mono> for SSE
            lifecycle events.
          </li>
          <li>
            <strong className="text-text">per sub-task.</strong> Each
            sub-task fires <Mono>subtask_created</Mono> →{' '}
            <Mono>subtask_accepted</Mono> → <Mono>subtask_completed</Mono>{' '}
            → <Mono>subtask_paid</Mono>. The plan-graph re-renders node
            colors live; per-node drawer surfaces tx hashes + decoded
            result.
          </li>
          <li>
            <strong className="text-text">plan settled.</strong> Final{' '}
            <Mono>plan_completed</Mono> closes the channel. Run state stays
            queryable; the user can start a new plan or hand-off via the
            shareable URL (chain selector preserved via{' '}
            <Mono>?chain=…</Mono>).
          </li>
        </ol>
        <p>
          Dependencies between sub-tasks are honored by topological-sorted
          sequential execution — <Mono>depends_on: [1]</Mono> on a sub-task
          delays its spawn until #1's <Mono>approvePayment</Mono> receipt
          lands (this avoids sponsor-nonce races; same constraint as the
          3-mode demo). Parallel fan-out across independent sub-tasks is a
          tracked future motion, not v1.
        </p>
      </Section>

      <Section id="high-stakes-defense" title="High-stakes defense (three layers)" tag="05">
        <p>
          The <Mono>stakes:high</Mono> classification means &quot;before
          you spawn, make the user pick deliberately.&quot; The intent has
          to survive accidental UI bypasses and LLM-emitted artifacts that
          coincidentally pass spot-checks. Defense-in-depth runs in three
          layers; all three are exercised by the canonical brief{' '}
          <Mono>Send 0.1 USDC to 0x…</Mono>.
        </p>
        <div className="my-4 rounded-[10px] border border-border overflow-hidden">
          <div className="grid grid-cols-[80px_1fr_2fr] gap-4 px-4 py-3 border-b border-border bg-surface font-mono text-[10px] uppercase tracking-[0.06em] text-text-subtle">
            <span>Layer</span>
            <span>Where</span>
            <span>Action</span>
          </div>
          <DefenseRow
            num="1"
            where="planFromClassification"
            action="Strip executor for any sub-task in a stakes:high plan, regardless of LLM-emitted address. Also strips when the per-subtask type stem-matches send / transfer / book / purchase / sign / pay."
          />
          <DefenseRow
            num="2"
            where="PlanCard component"
            action="Disable the Approve · Execute button when any sub-task is unassigned; surface a pink hint banner directing the user to Edit. Fail early at UI level."
          />
          <DefenseRow
            num="3"
            where="plan-runner runSubtask"
            action="If a sub-task arrives at spawn time without executor_address, throw PlanError before broadcast — sponsor doesn't pay for a malformed createTask. Backstop if UI guards are bypassed (debugger, deep-link, future regressions)."
            last
          />
        </div>
        <p>
          The order matters. Layer 1's check runs <em>before</em> trusting
          any LLM-emitted <Mono>executor_address</Mono> — observed on the
          first run of <Mono>Send 0.1 USDC to 0x0DA5…</Mono>: the LLM
          echoed the recipient address into <Mono>executor_address</Mono>,
          and the recipient address happened to match a known worker EOA,
          so a trust-known-worker check (when ordered first) silently
          passed. Reordering closed it; the stakes axis is now authoritative
          regardless of type-stem coverage.
        </p>
      </Section>

      <Section id="classifier" title="Classifier model" tag="06">
        <p>
          The classifier is an LLM call with function-calling, not a
          fine-tuned model. Same idea as the 3-mode workers — different
          prompt, different output schema.
        </p>
        <ul className="list-disc list-outside pl-5 space-y-2 text-text-muted">
          <li>
            <strong className="text-text">Backend.</strong> OpenAI{' '}
            <Mono>gpt-4o-mini</Mono> via modern <Mono>tools</Mono> API. Mock
            template fallback when <Mono>OPENAI_API_KEY</Mono> is unset
            (covers local dev + initial e2e tests).
          </li>
          <li>
            <strong className="text-text">Output shape.</strong>{' '}
            <Mono>ClassificationResult</Mono> — decomposability + stakes
            labels with confidences, proposed plan (sub-tasks with{' '}
            <Mono>type</Mono>, <Mono>spec</Mono>,{' '}
            <Mono>estimated_cost_units</Mono>, <Mono>deadline_offset_s</Mono>
            , <Mono>depends_on</Mono>), reasoning string, signal trace
            (lexical / semantic / stakes cues that fired).
          </li>
          <li>
            <strong className="text-text">Heuristic cross-check.</strong>{' '}
            Pure-function pass over the brief: composite verbs ({' '}
            <Mono>plan</Mono>, <Mono>research</Mono>, top-N quantifiers),
            stakes verbs (<Mono>send</Mono>, <Mono>transfer</Mono>), $-value
            regex. When the heuristic flags signals the LLM missed, the
            corresponding confidence halves — asymmetric correction toward
            caution.
          </li>
          <li>
            <strong className="text-text">Failure handling.</strong> Retry
            once on malformed / 5xx; if the second attempt fails, return a
            degraded result with <Mono>confidence_*=0</Mono> — forces the
            maximum-ceremony quadrant. Better to over-protect on uncertainty
            than to under-protect.
          </li>
          <li>
            <strong className="text-text">Trace logging.</strong> 5 JSON
            events per pass (<Mono>started → llm_attempt → raw →{' '}
            heuristic_applied → completed</Mono>) on stderr. Ready for
            PostHog ingestion when calibration data starts to matter.
          </li>
        </ul>
        <p>
          The known calibration weakness: LLM-self-reported confidence is
          systematically over-confident. Empirical calibration via user
          override-tracking (when does the user reject the auto-route?) is
          the v2 path; multi-LLM ensemble + logit-based scoring is the v3
          path. Both deferred until there's empirical data.
        </p>
      </Section>

      <Section id="dispute" title="Dispute path" tag="07">
        <p>
          When a sub-task lands in <Mono>Disputed</Mono> status, the plan
          run pauses rather than fails. The user gets a prompt with three
          options:
        </p>
        <ul className="list-disc list-outside pl-5 space-y-2 text-text-muted">
          <li>
            <strong className="text-text">Retry.</strong> Re-spawn the
            sub-task against the same executor. New <Mono>TaskCreated</Mono>{' '}
            record, fresh deadline.
          </li>
          <li>
            <strong className="text-text">Change executor.</strong>{' '}
            Re-spawn against a different worker (picker shows the four
            known EOAs minus the current one). Useful when one worker
            consistently fails a capability the others handle.
          </li>
          <li>
            <strong className="text-text">Cancel.</strong> Plan run ends
            with <Mono>plan_failed</Mono>; settled sub-tasks stay settled,
            pending ones return to idle. No unwind of completed work.
          </li>
        </ul>
        <p>
          Pause timeout defaults to 2 minutes — short enough that abandoned
          runs don't accumulate sponsor-side state, ergonomic for a human
          reading a dispute and clicking once. Timeout treats as Cancel.
          Server side: <Mono>POST /api/demo/composite/retry-subtask</Mono>;
          plan-runner consumes the decision via an in-memory{' '}
          <Mono>run-registry</Mono> rendezvous.
        </p>
      </Section>

      <Section id="when-not" title="When not to reach for it" tag="08">
        <p>
          Composite plans are the right shape for briefs that genuinely
          decompose. They're the wrong shape for two adjacent cases:
        </p>
        <ul className="list-disc list-outside pl-5 space-y-2 text-text-muted">
          <li>
            <strong className="text-text">One-shot tasks.</strong> A simple{' '}
            &quot;summarize this article&quot; brief decomposes into one
            sub-task; running it through the plan-card UX adds a
            review-and-approve step the user doesn't need. The classifier
            short-circuits these to direct execute. Manually targeting the
            3-mode <Mono>/demo</Mono> path is also fine — same{' '}
            <Mono>TaskEscrow</Mono> primitive underneath.
          </li>
          <li>
            <strong className="text-text">Static workflows.</strong> If your
            pipeline is &quot;always summarize → always translate → always
            ship&quot; with no per-brief variation, the classifier's
            decomposition adds machinery you don't need. Wire the steps
            directly via the SDK in your orchestrator. Sage's escrow
            primitive doesn't require the plan-then-execute UX; that UX is
            a layer on top for the cases where the decomposition is
            genuinely dynamic.
          </li>
        </ul>
      </Section>

      <Section id="source" title="Source pointers" tag="09">
        <ul className="grid gap-2 sm:grid-cols-2 text-[13px] my-3">
          <SourceLink
            label="ADR-0007 — Observable decomposition"
            href={githubBlobUrl('docs/adr/0007-observable-decomposition.md')}
          />
          <SourceLink
            label="ADR-0008 — Sage angle / position"
            href={githubBlobUrl('docs/adr/0008-sage-angle-position.md')}
          />
          <SourceLink
            label="research/observable-decomposition.md"
            href={githubBlobUrl('docs/research/observable-decomposition.md')}
          />
          <SourceLink
            label="research/classification-trigger-design.md"
            href={githubBlobUrl('docs/research/classification-trigger-design.md')}
          />
          <SourceLink
            label="apps/demo-agents/src/parent/ — orchestrator"
            href={githubTreeUrl('apps/demo-agents/src/parent')}
          />
          <SourceLink
            label="apps/web/app/demo/composite/ — frontend"
            href={githubTreeUrl('apps/web/app/demo/composite')}
          />
          <SourceLink
            label="blog/observable-decomposition-shipped.md"
            href={githubBlobUrl('docs/blog/observable-decomposition-shipped.md')}
          />
          <SourceLink
            label="Try it live → /demo/composite"
            href="/demo/composite"
            internal
          />
        </ul>
      </Section>

      <DocsNextLink
        href="/docs/use-cases"
        label="Use cases"
        hint="Five concrete scenarios where Sage fits — including the multi-step workflows case that's the natural fit for composite plans."
      />
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

function Diagram({ children }: { children: string }) {
  return (
    <pre className="my-4 rounded-[10px] border border-border bg-canvas p-5 text-[11.5px] font-mono leading-[1.55] text-text overflow-x-auto whitespace-pre">
      {children}
    </pre>
  );
}

function TriggerRow({
  label,
  description,
  last,
}: {
  label: string;
  description: string;
  last?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-[160px_1fr] gap-4 px-4 py-3 ${
        last ? '' : 'border-b border-border'
      } items-baseline`}
    >
      <span className="font-mono text-[12px] text-pink">{label}</span>
      <span className="text-[13px] text-text-muted leading-[1.55]">{description}</span>
    </div>
  );
}

function DefenseRow({
  num,
  where,
  action,
  last,
}: {
  num: string;
  where: string;
  action: string;
  last?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-[80px_1fr_2fr] gap-4 px-4 py-3 ${
        last ? '' : 'border-b border-border'
      } items-baseline`}
    >
      <span className="font-mono text-[14px] font-medium text-cyan">{num}</span>
      <span className="font-mono text-[12px] text-text">{where}</span>
      <span className="text-[13px] text-text-muted leading-[1.55]">{action}</span>
    </div>
  );
}

function SourceLink({
  label,
  href,
  internal,
}: {
  label: string;
  href: string;
  internal?: boolean;
}) {
  if (internal) {
    return (
      <li>
        <Link
          href={href}
          className="text-purple hover:underline underline-offset-4 font-mono text-[12px]"
        >
          {label}
        </Link>
      </li>
    );
  }
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

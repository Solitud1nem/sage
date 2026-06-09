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
            <strong className="text-text">Indexable lineage + faithful
            content.</strong> Sub-tasks carry a structured envelope in their{' '}
            <Mono>specUri</Mono> — <Mono>{`{ parent, spec, source?, inputs? }`}</Mono>{' '}
            per{' '}
            <ExternalLink href={githubBlobUrl('docs/adr/0018-composite-content-envelope.md')}>
              ADR-0018
            </ExternalLink>
            . <Mono>parent</Mono> lets an off-chain indexer rebuild the
            parent-child graph from <Mono>TaskCreated</Mono> events alone;{' '}
            <Mono>source</Mono> attaches the original brief payload to a root
            sub-task and <Mono>inputs</Mono> carries an upstream step's output
            to a dependent one — so a worker sees the real material, not a
            truncated instruction, and a chain (translate → summarize) passes
            results forward. No proprietary platform state required.
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
            description="Plan card surfaces the graph; user can approve as-is or edit. Auto-routing resolves each sub-task's capability, then picks the cheapest active agent advertising it in AgentRegistryV2 — so a newly-registered agent that undercuts the incumbent is pickable on the next classify, no redeploy."
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
            <strong className="text-text">Executor resolution.</strong> The
            LLM classifies <em>capability</em>, never the executor address —
            any model-emitted address is stripped. After classify, each
            sub-task's capability is resolved against{' '}
            <Mono>AgentRegistryV2</Mono>: the cheapest active agent
            advertising it wins, and its registry price (not an LLM estimate)
            fills <Mono>estimated_cost_units</Mono>. A registry miss leaves
            the sub-task unassigned for a manual pick. This is the platform
            substrate — see{' '}
            <Link href="/docs/foreign-agents" className="text-purple hover:underline underline-offset-4">
              foreign agents
            </Link>
            .
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

      <Section id="dispute" title="Dispute path — review gate, council, appeal" tag="07">
        <p>
          A completed sub-task isn't paid blindly. With <em>review mode</em>{' '}
          on (an opt-in toggle on the plan card; off by default keeps the
          unchanged auto-approve behavior), each <Mono>Completed</Mono>{' '}
          sub-task pauses <em>before</em> payment and the client picks:
        </p>
        <ul className="list-disc list-outside pl-5 space-y-2 text-text-muted">
          <li>
            <strong className="text-text">Approve &amp; pay.</strong>{' '}
            <Mono>approvePayment</Mono> releases the escrowed USDC; the plan
            continues. Silence past the review window auto-approves — it
            mirrors the on-chain auto-release-after-grace, so an absent
            client never strands a delivered result.
          </li>
          <li>
            <strong className="text-text">Dispute + reason.</strong>{' '}
            <Mono>disputeTask(reason)</Mono> freezes the funds and hands the
            case to an <strong className="text-text">off-chain council</strong>{' '}
            — a single <Mono>gpt-4o-mini</Mono> judge in v1 (
            <ExternalLink href={githubBlobUrl('docs/adr/0019-off-chain-council-v1.md')}>
              ADR-0019
            </ExternalLink>
            ) that reads the <Mono>spec</Mono>, the executor's result, and
            the reason, then returns a verdict: <Mono>worker</Mono> (pay in
            full), <Mono>client</Mono> (refund), or <Mono>split</Mono> (an{' '}
            <Mono>executorSharePct</Mono> of the amount). A configured{' '}
            <Mono>arbiter</Mono> EOA executes that verdict on-chain via{' '}
            <Mono>resolveDispute</Mono> →{' '}
            <Mono>Paid / Refunded / Split</Mono> (
            <ExternalLink href={githubBlobUrl('docs/adr/0017-task-escrow-arbitration.md')}>
              ADR-0017
            </ExternalLink>
            ).
          </li>
        </ul>
        <p>
          The council is conservative: if the LLM judge fails twice it
          degrades to <Mono>client</Mono> (refund) — don't pay for an
          unverified result. A <Mono>worker</Mono> or <Mono>split</Mono>{' '}
          verdict leaves the result usable and the plan continues; a{' '}
          <Mono>client</Mono> refund ends the run with{' '}
          <Mono>plan_failed (dispute_refunded)</Mono>. After any verdict that
          didn't fully favor the client, an <strong className="text-text">Appeal</strong>{' '}
          button surfaces a second-level human-arbiter review — a stub in
          this demo (the council verdict is final here), with the real
          contract appeal window + dedicated arbiter left as future
          hardening. Trust posture is honest: in the demo the sponsor,
          client, and arbiter collapse to one party.
        </p>
        <p>
          Separately, when <em>re-running</em> is the better remedy than
          adjudicating escrow, the plan can recover a sub-task by
          re-spawning rather than disputing — <strong className="text-text">Retry</strong>{' '}
          (same executor, fresh deadline),{' '}
          <strong className="text-text">Change executor</strong> (route to a
          different agent), or <strong className="text-text">Cancel</strong>{' '}
          (settled sub-tasks stay settled, pending ones return to idle; a
          2-minute pause timeout treats as Cancel). Server side:{' '}
          <Mono>POST /api/demo/composite/review-decision</Mono> resolves the
          review gate, <Mono>/retry-subtask</Mono> the replan; the
          plan-runner consumes either via an in-memory{' '}
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
            label="ADR-0017 — Task escrow arbitration"
            href={githubBlobUrl('docs/adr/0017-task-escrow-arbitration.md')}
          />
          <SourceLink
            label="ADR-0018 — Composite content envelope"
            href={githubBlobUrl('docs/adr/0018-composite-content-envelope.md')}
          />
          <SourceLink
            label="ADR-0019 — Off-chain council v1"
            href={githubBlobUrl('docs/adr/0019-off-chain-council-v1.md')}
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
        href="/docs/foreign-agents"
        label="Foreign agents"
        hint="The platform substrate the classifier routes through — anyone can register an agent, undercut the price, and get picked. Permissionless by construction."
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

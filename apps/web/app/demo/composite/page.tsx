'use client';

import { Suspense, useCallback, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { ChainPicker } from '@/components/demo/chain-picker';
import { PlanCard } from '@/components/demo/plan-card';
import { PlanEditor } from '@/components/demo/plan-editor';
import { PlanGraph, PlanLegend } from '@/components/demo/plan-graph';
import { SubtaskDrawer } from '@/components/demo/subtask-drawer';
import { ReplanPrompt } from '@/components/demo/replan-prompt';
import { ReviewPrompt } from '@/components/demo/review-prompt';
import { ErrorPanel } from '@/components/demo/error-panel';
import { track } from '@/lib/posthog';
import { formatUsdc } from '@/lib/format-usdc';
import { ARC_TESTNET_CHAIN_ID } from '@/chains/arc';
import { BASE_MAINNET_CHAIN_ID } from '@/chains/base';
import {
  useCompositeDemo,
  planFromClassification,
  artifactFromResult,
  type CompositeChainId,
  type WirePlan,
} from '@/hooks/use-composite-demo';

/**
 * Demo mode: LLM-classified composite, deterministic website pipeline
 * (M12.1.3), or deterministic research pipeline with a fact-check evaluator
 * (M12.2.3).
 */
type CompositeMode = 'composite' | 'website' | 'research';

/**
 * One-click brief seeds per mode — lower the «what do I even type here» bar.
 * Clicking a chip fills the textarea; the user can still edit before submit.
 */
const BRIEF_EXAMPLES: Record<CompositeMode, readonly string[]> = {
  composite: [
    'research the top 3 stablecoin yield products on Base and write a comparative report',
    'summarize this article and translate the summary into Spanish',
  ],
  website: [
    'a specialty coffee shop by the sea in Lisbon — warm tone, English copy',
    'a portfolio site for a freelance product designer — minimal, dark theme',
  ],
  research: [
    'what changed in EIP-7702 account abstraction in 2026?',
    'compare Base and Arbitrum fee markets over the last year',
  ],
};

/**
 * /demo/composite — observable-decomposition flow.
 *
 * UX states (derived from hook status + local UI flags):
 *   idle / classifying  → brief input form
 *   plan-ready          → plan-card (read-only) or plan-editor (when editing)
 *   executing / done    → plan-graph + summary
 *   error               → error panel with retry
 *
 * Per ADR-0007 the user sees the plan BEFORE on-chain execution and can
 * approve / edit / cancel. Existing 3-mode `/demo` route is unaffected.
 */
export default function CompositePage() {
  // useSearchParams reads from the URL on the client. Next.js 15 + static
  // export ('output: export') requires a Suspense boundary around any
  // component that uses it, or the prerender step errors out.
  return (
    <Suspense fallback={<CompositePageFallback />}>
      <CompositePageInner />
    </Suspense>
  );
}

function CompositePageFallback() {
  return (
    <div className="mx-auto max-w-[1200px] px-6 md:px-10 py-14">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
        loading…
      </div>
    </div>
  );
}

function CompositePageInner() {
  // URL-state for chain selection (per ADR-0015): `?chain=arc` opens the
  // composite demo against the Arc testnet bridge orchestrator; absent or
  // `chain=base` opens against the Base mainnet orchestrator. Shareable
  // deep links work; refresh keeps the selection.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const chainId: CompositeChainId =
    searchParams.get('chain') === 'arc' ? ARC_TESTNET_CHAIN_ID : BASE_MAINNET_CHAIN_ID;

  const demo = useCompositeDemo(chainId);

  const setChain = useCallback(
    (next: CompositeChainId) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === ARC_TESTNET_CHAIN_ID) params.set('chain', 'arc');
      else params.delete('chain');
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const [brief, setBrief] = useState('');
  const [mode, setMode] = useState<CompositeMode>('composite');
  const [editing, setEditing] = useState(false);
  const [editedPlan, setEditedPlan] = useState<WirePlan | null>(null);
  const [selectedSubId, setSelectedSubId] = useState<number | null>(null);
  // Opt-in review gate (ADR-0019): pause each completed sub-task for an
  // approve/dispute decision before payment.
  const [reviewMode, setReviewMode] = useState(false);
  // Research mode only (M12.2.3): stage a controlled failed run — the
  // synthesizer ships fabricated quotes, the fact-checker catches them live
  // and the escrow is refunded. Shows the fate of money on failure.
  const [failureDemo, setFailureDemo] = useState(false);

  const isInputPhase = demo.status === 'idle' || demo.status === 'classifying';
  const isPlanPhase = demo.status === 'plan-ready';
  const isRunning = demo.status === 'executing';
  const isDone = demo.status === 'completed';
  const isError = demo.status === 'error';

  const planForDisplay: WirePlan | null =
    editedPlan ??
    (demo.classification ? planFromClassification(brief, demo.classification) : null);

  const submitBrief = (e: React.FormEvent) => {
    e.preventDefault();
    if (!brief.trim()) return;
    setEditedPlan(null);
    setEditing(false);
    const planMode =
      mode === 'website' ? 'website-plan' : mode === 'research' ? 'research-plan' : 'classify';
    void demo.classify(
      brief.trim(),
      planMode,
      mode === 'research' && failureDemo ? 'failure-demo' : undefined,
    );
  };

  const handleApprove = () => {
    if (!planForDisplay) return;
    void demo.approve(planForDisplay, reviewMode);
  };

  const handleReset = () => {
    setBrief('');
    setEditedPlan(null);
    setEditing(false);
    setSelectedSubId(null);
    demo.reset();
  };

  const selectedSubtask =
    selectedSubId !== null && planForDisplay
      ? planForDisplay.subtasks.find((s) => s.id === selectedSubId) ?? null
      : null;

  return (
    <div className="mx-auto max-w-[1200px] px-6 md:px-10 py-14">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle mb-3 flex items-center gap-3">
        <Link href="/demo" className="hover:text-text">
          demo
        </Link>
        <span aria-hidden>·</span>
        <span>composite plan</span>
      </div>
      <h1 className="text-[clamp(36px,4.2vw,52px)] font-medium leading-[1.1] tracking-[-0.015em]">
        Plan a multi-step task. Approve before it runs.
      </h1>
      <p className="mt-5 max-w-[720px] text-[16px] leading-[1.55] text-text-muted">
        Describe what you want done. The classifier turns it into a structured
        plan — one sub-task per on-chain escrow record. Review, edit if needed,
        then watch the graph fill in live as the work settles on Base mainnet.
      </p>

      <FlowStepper status={demo.status} />

      {isInputPhase && (
        <section className="mt-10 space-y-6">
          <ChainPicker
            chainId={chainId}
            onChange={setChain}
            disabled={demo.status !== 'idle'}
          />
          <div
            className="inline-flex gap-1 rounded-[10px] border border-border bg-surface p-1 font-mono text-[12px]"
            role="tablist"
            aria-label="Demo mode"
          >
            {(
              [
                ['composite', 'Composite plan'],
                ['website', 'Website pipeline'],
                ['research', 'Research report'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                disabled={demo.status !== 'idle'}
                className={`h-8 px-4 rounded-[7px] transition-colors disabled:cursor-not-allowed ${
                  mode === value
                    ? 'bg-cyan text-[#0A0A0F] font-medium'
                    : 'text-text-muted hover:text-text'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === 'research' && (
            <label className="flex items-start gap-3 rounded-[12px] border border-border bg-surface px-5 py-4 cursor-pointer max-w-[640px]">
              <input
                type="checkbox"
                checked={failureDemo}
                onChange={(e) => setFailureDemo(e.target.checked)}
                disabled={demo.status !== 'idle'}
                className="mt-[3px] accent-[#A78BFA]"
              />
              <span>
                <span className="font-mono text-[12px] text-text">Stage a failed run</span>
                <span className="block text-[12px] text-text-muted mt-0.5">
                  The synthesizer ships a report whose citations point at real sources but carry
                  fabricated quotes — the «stale memory» defect. The paid fact-checker re-resolves
                  every citation on the live web, catches them, and the escrow is refunded instead of
                  paid. Shows the fate of the money when work fails verification.
                </span>
              </span>
            </label>
          )}
          <p className="mb-4 max-w-[640px] rounded-[10px] border border-border bg-surface px-4 py-3 text-[12px] leading-[1.5] text-text-muted">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-purple">
              Public demo
            </span>{' '}
            — task briefs and results are written in plaintext on Base mainnet and are
            permanently public and world-readable. Don&apos;t enter sensitive or personal
            data. Encrypted, commitment-on-chain handling for real work is on the roadmap
            (ADR-0024).
          </p>
          <form
            onSubmit={submitBrief}
            className="rounded-[14px] border border-border bg-surface p-6 md:p-8"
          >
            <header className="mb-4">
              <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle mb-1">
                01 · Brief
              </div>
              <p className="text-[13px] text-text-muted">
                {mode === 'website'
                  ? 'Describe the business or project. A fixed pipeline — copywriter → builder → packager, with a paid QA evaluator gating the builder — turns it into a deploy-ready site archive.'
                  : mode === 'research'
                    ? 'Ask a research question. A fixed pipeline — searcher (live web) → 4 extractors → synthesizer — writes a cited report, then a paid fact-checker re-resolves every citation on the live web before the synthesizer is paid.'
                    : 'A sentence or two. The classifier handles any language.'}
              </p>
            </header>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={4}
              placeholder={
                mode === 'website'
                  ? 'e.g. a specialty coffee shop by the sea in Lisbon — warm tone, English copy'
                  : mode === 'research'
                    ? 'e.g. what changed in EIP-7702 account abstraction in 2026?'
                    : 'e.g. research the top 3 stablecoin yield products on Base and write a comparative report'
              }
              className="w-full px-4 py-3 rounded-[10px] border border-border bg-[#0A0A0F] text-[14px] text-text leading-[1.55] focus:outline-none focus:border-cyan"
              disabled={demo.status === 'classifying'}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
                try
              </span>
              {BRIEF_EXAMPLES[mode].map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setBrief(ex)}
                  disabled={demo.status === 'classifying'}
                  className="max-w-full truncate px-3 py-1.5 rounded-full border border-border text-[12px] text-text-muted hover:text-text hover:border-cyan transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {ex}
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
                {demo.status === 'classifying'
                  ? mode !== 'composite'
                    ? 'building plan · ~2s'
                    : 'classifying · ~5s'
                  : `${brief.trim().length} chars`}
              </div>
              <button
                type="submit"
                disabled={!brief.trim() || demo.status === 'classifying'}
                className="h-10 px-5 rounded-[8px] bg-cyan text-[#0A0A0F] font-mono text-[12px] font-medium hover:bg-[#7AEAF8] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {demo.status === 'classifying'
                  ? mode !== 'composite'
                    ? 'Building plan…'
                    : 'Classifying…'
                  : mode !== 'composite'
                    ? 'Build plan →'
                    : 'Classify brief →'}
              </button>
            </div>
          </form>
        </section>
      )}

      {isPlanPhase && demo.classification && planForDisplay && !editing && (
        <section className="mt-10 space-y-4">
          <label className="flex items-start gap-3 rounded-[12px] border border-border bg-surface px-5 py-4 cursor-pointer">
            <input
              type="checkbox"
              checked={reviewMode}
              onChange={(e) => setReviewMode(e.target.checked)}
              className="mt-[3px] accent-[#A78BFA]"
            />
            <span>
              <span className="font-mono text-[12px] text-text">Review each step before payment</span>
              <span className="block text-[12px] text-text-muted mt-0.5">
                Pause on every completed sub-task to approve it or dispute it. A dispute goes to the
                council (an LLM arbiter) which resolves the escrow on-chain. Off = auto-pay each step.
              </span>
            </span>
          </label>
          <PlanCard
            classification={{
              ...demo.classification,
              proposed_plan: planForDisplay.subtasks,
              estimated_total_cost_units: planForDisplay.estimated_total_cost_units,
            }}
            brief={brief}
            onApprove={handleApprove}
            // Editing is available in every mode (M13.1.1). Website & research
            // are fixed templates, so the editor opens in `locked` mode — it
            // keeps executor / spec / cost / deadline editable but leaves the
            // structure and evaluator wiring (qa-website / fact-checker) intact.
            onEdit={() => setEditing(true)}
            onCancel={handleReset}
          />
        </section>
      )}

      {isPlanPhase && planForDisplay && editing && (
        <section className="mt-10">
          <PlanEditor
            initialPlan={planForDisplay}
            chainId={chainId}
            locked={mode !== 'composite'}
            onSave={(p) => {
              const before = planForDisplay.subtasks.length;
              const after = p.subtasks.length;
              track('composite_plan_edited', {
                subtask_count_before: before,
                subtask_count_after: after,
                count_delta: after - before,
                cost_delta_units:
                  Number(p.estimated_total_cost_units) -
                  Number(planForDisplay.estimated_total_cost_units),
              });
              setEditedPlan(p);
              setEditing(false);
            }}
            onDiscard={() => setEditing(false)}
          />
        </section>
      )}

      {(isRunning || isDone) && planForDisplay && (
        <section className="mt-10 space-y-6">
          <RunHeader
            status={demo.status}
            chainName={demo.chainName}
            runId={demo.runId}
            startedAt={demo.startedAt}
            completedAt={demo.completedAt}
            totalCost={planForDisplay.estimated_total_cost_units}
          />
          <PlanGraph
            subtasks={planForDisplay.subtasks}
            runtimes={demo.runtimes}
            onSubtaskClick={setSelectedSubId}
          />
          <PlanLegend runtimes={demo.runtimes} />
          {isRunning && demo.error && (
            // web-H1: a failed review/retry POST sets `error` while the run is
            // still executing — ErrorPanel only renders at status === 'error',
            // so without this banner the failure was invisible. The run stays
            // live; the user just re-submits from the prompt below.
            <div
              className="rounded-[12px] border bg-surface px-5 py-4"
              style={{ borderColor: 'rgba(244,114,182,0.4)' }}
              role="alert"
            >
              <div
                className="font-mono text-[11px] uppercase tracking-[0.08em] mb-1"
                style={{ color: '#F472B6' }}
              >
                Request failed — the run is still live
              </div>
              <p className="text-[13px] text-text-muted leading-[1.55] font-mono break-all">
                {demo.error}
              </p>
            </div>
          )}
          {(() => {
            // M11.4 (ADR-0019): the review gate takes precedence — a completed
            // sub-task is paused awaiting an approve/dispute decision.
            const reviewSub =
              demo.awaitingReviewSubId !== null
                ? planForDisplay.subtasks.find((s) => s.id === demo.awaitingReviewSubId)
                : undefined;
            if (reviewSub) {
              return (
                <ReviewPrompt
                  subtask={reviewSub}
                  runtime={demo.runtimes[reviewSub.id]}
                  onDecision={demo.submitReview}
                />
              );
            }
            // M10.4.3: show the replan-prompt inline when a sub-task either
            // explicitly disputed (via SSE) or surfaced as errored. Disputed
            // takes precedence — it's the user-attention path.
            const disputedSub =
              demo.disputedSubId !== null
                ? planForDisplay.subtasks.find((s) => s.id === demo.disputedSubId)
                : undefined;
            if (disputedSub) {
              return (
                <ReplanPrompt
                  subtask={disputedSub}
                  runtime={demo.runtimes[disputedSub.id]}
                  reason="disputed"
                  onCancelRun={handleReset}
                  onRetry={demo.retry}
                />
              );
            }
            const erroredSubId = Object.entries(demo.runtimes).find(
              ([, r]) => r.status === 'errored',
            )?.[0];
            if (erroredSubId !== undefined) {
              const sub = planForDisplay.subtasks.find(
                (s) => s.id === Number(erroredSubId),
              );
              if (sub) {
                return (
                  <ReplanPrompt
                    subtask={sub}
                    runtime={demo.runtimes[sub.id]}
                    reason="errored"
                    onCancelRun={handleReset}
                  />
                );
              }
            }
            return null;
          })()}
          {isDone && mode === 'research' &&
            (() => {
              // M12.2.3: the synthesizer's result is an artifact envelope
              // pointing at the ResearchReportDoc; the gateway /report/<sha>
              // endpoint renders it as readable HTML (iframe, no CORS).
              const synthId = planForDisplay?.subtasks.find(
                (s) => s.type === 'synthesize-report',
              )?.id;
              const reportRef =
                synthId !== undefined ? artifactFromResult(demo.runtimes[synthId]?.result) : null;
              const reportUrl = reportRef?.url.includes('/api/artifacts/')
                ? reportRef.url.replace('/api/artifacts/', '/report/')
                : null;
              return (
                <div className="space-y-4">
                  {reportUrl && (
                    <div className="rounded-[14px] border border-border bg-surface overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
                          Research report · citations re-resolved by the fact-checker
                        </span>
                        <a
                          href={reportUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[12px] text-cyan hover:underline underline-offset-4"
                        >
                          Open in new tab ↗
                        </a>
                      </div>
                      <iframe
                        src={reportUrl}
                        title="Research report"
                        sandbox=""
                        loading="lazy"
                        className="w-full h-[520px] bg-white"
                      />
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleReset}
                      className="h-9 px-4 rounded-[8px] border border-border font-mono text-[12px] text-text hover:border-cyan transition-colors"
                    >
                      Start new plan
                    </button>
                  </div>
                </div>
              );
            })()}
          {isDone && mode !== 'research' &&
            (() => {
              // M12.1.3: the packager's result is an artifact envelope
              // pointing at the deploy-ready zip in the R2 store.
              const results = Object.values(demo.runtimes);
              const zip = results
                .map((r) => artifactFromResult(r.result))
                .find((a) => a?.mime === 'application/zip');
              // M12.1.7: hosted preview — explicit previewUrl from the
              // packager result, with a derive-from-manifest fallback.
              const explicit = results
                .map((r) => {
                  try {
                    return (JSON.parse(r.result ?? '') as { previewUrl?: unknown }).previewUrl;
                  } catch {
                    return undefined;
                  }
                })
                .find((p): p is string => typeof p === 'string');
              const manifestRef = results
                .map((r) => artifactFromResult(r.result))
                .find((a) => a?.mime === 'application/json');
              const preview =
                explicit ??
                (manifestRef?.url.includes('/api/artifacts/')
                  ? `${manifestRef.url.replace('/api/artifacts/', '/preview/')}/`
                  : undefined);
              return (
                <div className="space-y-4">
                  {preview && (
                    <div className="rounded-[14px] border border-border bg-surface overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
                          Live preview · expires with the artifact (~30 days)
                        </span>
                        <a
                          href={preview}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[12px] text-cyan hover:underline underline-offset-4"
                        >
                          Open in new tab ↗
                        </a>
                      </div>
                      <iframe
                        src={preview}
                        title="Site preview"
                        sandbox="allow-scripts"
                        loading="lazy"
                        className="w-full h-[480px] bg-white"
                      />
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    {zip && (
                      <a
                        href={zip.url}
                        download="site.zip"
                        className="h-9 px-4 inline-flex items-center rounded-[8px] bg-cyan text-[#0A0A0F] font-mono text-[12px] font-medium hover:bg-[#7AEAF8] transition-colors"
                      >
                        Download site.zip ({Math.max(1, Math.round(zip.size / 1024))} KB)
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={handleReset}
                      className="h-9 px-4 rounded-[8px] border border-border font-mono text-[12px] text-text hover:border-cyan transition-colors"
                    >
                      Start new plan
                    </button>
                  </div>
                </div>
              );
            })()}
        </section>
      )}

      {isError && demo.error && (
        <div className="mt-10">
          <ErrorPanel message={demo.error} failReason={demo.failReason} onReset={handleReset} />
        </div>
      )}

      <SubtaskDrawer
        subtask={selectedSubtask}
        runtime={selectedSubId !== null ? demo.runtimes[selectedSubId] : undefined}
        explorerUrl={demo.explorerUrl}
        onClose={() => setSelectedSubId(null)}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────

function RunHeader({
  status,
  chainName,
  runId,
  startedAt,
  completedAt,
  totalCost,
}: {
  status: string;
  chainName: string | null;
  runId: string | null;
  startedAt: number | null;
  completedAt: number | null;
  totalCost: string;
}) {
  const elapsed = startedAt
    ? Math.round(((completedAt ?? Date.now()) - startedAt) / 1000)
    : 0;
  const accent =
    status === 'completed' ? '#6EE7B7' : status === 'executing' ? '#A78BFA' : '#6E6E85';
  return (
    <section className="rounded-[14px] border border-border bg-surface px-6 md:px-8 py-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
          03 · {status === 'completed' ? 'Settled' : 'Executing'}
        </div>
        <div className="font-mono text-[13px] text-text mt-1">
          run{' '}
          <span className="text-text-subtle">
            {runId ? `${runId.slice(0, 8)}…` : '—'}
          </span>
          {chainName ? <> · on {chainName}</> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[12px]">
        <Metric label="Elapsed" value={`${elapsed}s`} />
        <Metric label="Total cost" value={formatUsdc(totalCost)} />
        <span
          className="inline-flex items-center gap-2 h-[26px] px-3 rounded-full border font-mono text-[11px] uppercase tracking-[0.08em]"
          style={{ borderColor: accent, color: accent }}
        >
          <span
            className="w-[6px] h-[6px] rounded-full"
            style={{
              background: accent,
              boxShadow: status === 'executing' ? `0 0 8px ${accent}` : 'none',
            }}
            aria-hidden
          />
          {status === 'completed' ? 'plan settled' : 'in progress'}
        </span>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-text-subtle uppercase tracking-[0.08em]">{label}</span>{' '}
      <span className="text-text">{value}</span>
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────────

/**
 * Compact orientation rail for the long vertical flow. Sticks under the nav
 * so the user always knows which phase the run is in. Derived purely from
 * the hook status — no new state.
 */
function FlowStepper({ status }: { status: string }) {
  const steps = ['Brief', 'Plan', 'Run', 'Settled'] as const;
  const activeIndex =
    status === 'plan-ready'
      ? 1
      : status === 'executing'
        ? 2
        : status === 'completed'
          ? 3
          : 0;
  return (
    <div className="sticky top-16 z-30 -mx-6 md:-mx-10 px-6 md:px-10 py-3 mt-8 bg-canvas/90 backdrop-blur-sm border-b border-border">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em]">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 ${i <= activeIndex ? 'text-text' : 'text-text-subtle'}`}>
              <span
                className="w-[6px] h-[6px] rounded-full"
                style={{
                  background: i < activeIndex ? '#6EE7B7' : i === activeIndex ? '#A78BFA' : '#3a3a4a',
                  boxShadow: i === activeIndex ? '0 0 8px #A78BFA' : 'none',
                }}
                aria-hidden
              />
              {label}
            </span>
            {i < steps.length - 1 ? (
              <span aria-hidden className="text-text-subtle">
                →
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}


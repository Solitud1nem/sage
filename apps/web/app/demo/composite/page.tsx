'use client';

import { Suspense, useCallback, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { ChainPicker } from '@/components/demo/chain-picker';
import { PlanCard } from '@/components/demo/plan-card';
import { PlanEditor } from '@/components/demo/plan-editor';
import { PlanGraph } from '@/components/demo/plan-graph';
import { SubtaskDrawer } from '@/components/demo/subtask-drawer';
import { ReplanPrompt } from '@/components/demo/replan-prompt';
import { ErrorPanel } from '@/components/demo/error-panel';
import { track } from '@/lib/posthog';
import { formatUsdc } from '@/lib/format-usdc';
import {
  useCompositeDemo,
  planFromClassification,
  type WirePlan,
} from '@/hooks/use-composite-demo';

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
  const chainId: 8453 | 5042002 =
    searchParams.get('chain') === 'arc' ? 5042002 : 8453;

  const demo = useCompositeDemo(chainId);

  const setChain = useCallback(
    (next: 8453 | 5042002) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 5042002) params.set('chain', 'arc');
      else params.delete('chain');
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const [brief, setBrief] = useState('');
  const [editing, setEditing] = useState(false);
  const [editedPlan, setEditedPlan] = useState<WirePlan | null>(null);
  const [selectedSubId, setSelectedSubId] = useState<number | null>(null);

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
    void demo.classify(brief.trim());
  };

  const handleApprove = () => {
    if (!planForDisplay) return;
    void demo.approve(planForDisplay);
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

      {isInputPhase && (
        <section className="mt-10 space-y-6">
          <ChainPicker
            chainId={chainId}
            onChange={setChain}
            disabled={demo.status !== 'idle'}
          />
          <form
            onSubmit={submitBrief}
            className="rounded-[14px] border border-border bg-surface p-6 md:p-8"
          >
            <header className="mb-4">
              <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle mb-1">
                01 · Brief
              </div>
              <p className="text-[13px] text-text-muted">
                A sentence or two. The classifier handles any language.
              </p>
            </header>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={4}
              placeholder="e.g. research the top 3 stablecoin yield products on Base and write a comparative report"
              className="w-full px-4 py-3 rounded-[10px] border border-border bg-[#0A0A0F] text-[14px] text-text leading-[1.55] focus:outline-none focus:border-cyan"
              disabled={demo.status === 'classifying'}
            />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
                {demo.status === 'classifying'
                  ? 'classifying · ~5s'
                  : `${brief.trim().length} chars`}
              </div>
              <button
                type="submit"
                disabled={!brief.trim() || demo.status === 'classifying'}
                className="h-10 px-5 rounded-[8px] bg-cyan text-[#0A0A0F] font-mono text-[12px] font-medium hover:bg-[#7AEAF8] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {demo.status === 'classifying' ? 'Classifying…' : 'Classify brief →'}
              </button>
            </div>
          </form>
        </section>
      )}

      {isPlanPhase && demo.classification && planForDisplay && !editing && (
        <section className="mt-10">
          <PlanCard
            classification={{
              ...demo.classification,
              proposed_plan: planForDisplay.subtasks,
              estimated_total_cost_units: planForDisplay.estimated_total_cost_units,
            }}
            brief={brief}
            onApprove={handleApprove}
            onEdit={() => setEditing(true)}
            onCancel={handleReset}
          />
        </section>
      )}

      {isPlanPhase && planForDisplay && editing && (
        <section className="mt-10">
          <PlanEditor
            initialPlan={planForDisplay}
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
          {(() => {
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
          {isDone && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleReset}
                className="h-9 px-4 rounded-[8px] border border-border font-mono text-[12px] text-text hover:border-cyan transition-colors"
              >
                Start new plan
              </button>
            </div>
          )}
        </section>
      )}

      {isError && demo.error && (
        <div className="mt-10">
          <ErrorPanel message={demo.error} onReset={handleReset} />
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
  status: 'executing' | 'completed' | string;
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


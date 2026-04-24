'use client';

import { useEffect, useState } from 'react';

import { TaskInput, type DemoMode } from '@/components/demo/task-input';
import { StepTracker } from '@/components/demo/step-tracker';
import { EventLog } from '@/components/demo/event-log';
import { ResultPanel } from '@/components/demo/result-panel';
import { ErrorPanel } from '@/components/demo/error-panel';
import { useDemoStream } from '@/hooks/use-demo-stream';
import { useWalletDemo } from '@/hooks/use-wallet-demo';

/**
 * /demo — live task-lifecycle showcase.
 *
 *   Watch live  → orchestrator SSE stream (M-INT.5)
 *   Try with wallet → BYO-wallet writes + on-chain polling (M-INT.6)
 *
 * Both hooks expose the same DemoState shape so step-tracker / event-log /
 * result-panel stay mode-agnostic.
 */
export default function DemoPage() {
  const [mode, setMode] = useState<DemoMode>('watch');
  const watch = useDemoStream();
  const wallet = useWalletDemo();
  const active = mode === 'wallet' ? wallet : watch;

  // Reset the inactive hook on every mode switch so UI state doesn't leak.
  useEffect(() => {
    watch.reset();
    wallet.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <div className="mx-auto max-w-[1200px] px-6 md:px-10 py-14">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle mb-3">
        demo / run a task
      </div>
      <h1 className="text-[clamp(36px,4.2vw,52px)] font-medium leading-[1.1] tracking-[-0.015em]">
        Run a task against Base mainnet.
      </h1>
      <p className="mt-5 max-w-[720px] text-[16px] leading-[1.55] text-text-muted">
        Submit a brief, watch the four-step settlement replay on-chain. Start in{' '}
        <span className="text-text font-medium">Watch live</span> mode to see it without signing,
        or switch to <span className="text-text font-medium">Try with wallet</span> to escrow
        0.002 USDC and approve yourself.
      </p>

      <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_1.15fr]">
        <TaskInput
          mode={mode}
          onModeChange={setMode}
          status={active.status}
          onStart={active.start}
          onReset={active.reset}
        />

        <div className="space-y-6">
          <StepTracker
            status={active.status}
            currentStage={active.currentStage}
            steps={active.steps}
            txByStep={active.txByStep}
            explorerUrl={active.explorerUrl}
          />
          <EventLog events={active.events} />
        </div>
      </div>

      {active.status === 'done' && active.result && (
        <div className="mt-8">
          <ResultPanel result={active.result} explorerUrl={active.explorerUrl} />
        </div>
      )}

      {active.status === 'error' && active.error && (
        <div className="mt-8">
          <ErrorPanel message={active.error} onReset={active.reset} />
        </div>
      )}
    </div>
  );
}

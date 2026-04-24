'use client';

import { BASE_MAINNET, txUrl } from '@/chains/base';
import type {
  DemoStatus,
  Stage,
  StepName,
  StepStatus,
} from '@/hooks/use-demo-stream';

const STEPS: Array<{
  name: StepName;
  label: string;
  accent: string;
}> = [
  { name: 'createTask', label: 'createTask', accent: '#5EE3F5' },
  { name: 'acceptTask', label: 'acceptTask', accent: '#A78BFA' },
  { name: 'completeTask', label: 'completeTask', accent: '#F472B6' },
  { name: 'approvePayment', label: 'approvePayment', accent: '#6EE7B7' },
];

interface StepTrackerProps {
  status: DemoStatus;
  currentStage: Stage | null;
  steps: Record<StepName, StepStatus>;
  txByStep: Partial<Record<StepName, string>>;
}

export function StepTracker({ status, currentStage, steps, txByStep }: StepTrackerProps) {
  const stageLabel = stageChipLabel(status, currentStage);

  return (
    <section className="rounded-[14px] border border-border bg-surface p-6 md:p-8">
      <header className="flex items-center justify-between gap-3 mb-8">
        <h2 className="font-mono text-[13px]">
          <span className="text-text-subtle">02</span>{' '}
          <span className="font-medium">Settlement</span>
        </h2>
        <StageChip status={status} label={stageLabel} />
      </header>

      <div className="relative mb-6">
        <div className="absolute top-4 left-4 right-4 h-[1px] bg-border" aria-hidden />

        <ol className="relative grid grid-cols-4 gap-3">
          {STEPS.map((step) => {
            const state = steps[step.name];
            const tx = txByStep[step.name];
            return (
              <li key={step.name} className="flex flex-col items-center text-center">
                <StepNode state={state} accent={step.accent} />
                <div
                  className="mt-3 font-mono text-[11px]"
                  style={{ color: state === 'waiting' ? '#6E6E85' : step.accent }}
                >
                  {step.label}
                </div>
                <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-text-subtle">
                  {state === 'active' ? 'in progress' : state}
                </div>
                <div className="mt-2 min-h-[14px] text-[11px]">
                  {tx ? (
                    <a
                      href={txUrl(BASE_MAINNET.chainId, tx)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-cyan hover:underline underline-offset-4"
                    >
                      {tx.slice(0, 6)}…{tx.slice(-4)}
                    </a>
                  ) : (
                    <span className="text-text-subtle">—</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function StepNode({ state, accent }: { state: StepStatus; accent: string }) {
  if (state === 'complete') {
    return (
      <span
        className="relative z-10 flex items-center justify-center w-8 h-8 rounded-full"
        style={{ background: accent, color: '#0A0A0F' }}
      >
        <CheckIcon />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className="relative z-10 flex items-center justify-center">
        <span
          className="absolute inset-0 rounded-full animate-ping"
          style={{ background: accent, opacity: 0.35 }}
          aria-hidden
        />
        <span
          className="relative w-8 h-8 rounded-full border-[2px]"
          style={{
            borderColor: accent,
            background: `${accent}22`,
          }}
        />
      </span>
    );
  }
  return (
    <span
      className="relative z-10 block w-8 h-8 rounded-full border border-dashed"
      style={{ borderColor: '#6E6E85', background: '#0A0A0F' }}
    />
  );
}

function StageChip({ status, label }: { status: DemoStatus; label: string }) {
  const color =
    status === 'running'
      ? '#A78BFA'
      : status === 'done'
        ? '#6EE7B7'
        : status === 'error'
          ? '#F472B6'
          : '#6E6E85';
  return (
    <span
      className="inline-flex items-center gap-2 h-[26px] px-3 rounded-full border border-border font-mono text-[11px] uppercase tracking-[0.08em]"
      style={{ color }}
    >
      <span
        className="w-[6px] h-[6px] rounded-full"
        style={{ background: color, boxShadow: status === 'running' ? `0 0 8px ${color}` : 'none' }}
        aria-hidden
      />
      {label}
    </span>
  );
}

function stageChipLabel(status: DemoStatus, stage: Stage | null): string {
  if (status === 'idle') return 'idle';
  if (status === 'error') return 'error';
  if (status === 'done') return 'settled';
  if (stage === 'summarize') return 'summarizing · 1/2';
  if (stage === 'translate') return 'translating · 2/2';
  return 'running';
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M2.5 7.5L5.5 10.5L11.5 3.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

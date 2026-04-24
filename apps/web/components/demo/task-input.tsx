'use client';

import { useState } from 'react';
import { ConnectKitButton } from 'connectkit';
import { formatUnits } from 'viem';
import { useAccount, useReadContract } from 'wagmi';

import { useOrchestratorInfo } from '@/hooks/use-orchestrator-info';
import { useSageChain } from '@/hooks/use-sage-chain';
import { usdcAbi } from '@/lib/abi/task-escrow';
import type { DemoStatus } from '@/hooks/use-demo-stream';

export type DemoMode = 'watch' | 'wallet';

const DEFAULT_PROMPT =
  'Summarize the attached 40-page RFP into a 12-bullet exec brief. Return markdown.';

const MIN_USDC = 2_000n; // 0.002 USDC (0.001 × 2 stages)

interface TaskInputProps {
  mode: DemoMode;
  onModeChange: (m: DemoMode) => void;
  status: DemoStatus;
  onStart: (text: string) => void;
  onReset: () => void;
}

export function TaskInput({ mode, onModeChange, status, onStart, onReset }: TaskInputProps) {
  const [text, setText] = useState(DEFAULT_PROMPT);
  const isRunning = status === 'running';
  const canReset = status === 'done' || status === 'error';

  return (
    <section className="rounded-[14px] border border-border bg-surface p-6 md:p-8">
      <header className="flex items-center justify-between gap-3 mb-6">
        <h2 className="font-mono text-[13px]">
          <span className="text-text-subtle">01</span>{' '}
          <span className="font-medium">Task</span>
        </h2>
        <ModeToggle mode={mode} onChange={onModeChange} disabled={isRunning} />
      </header>

      <BriefInput text={text} onChange={setText} disabled={isRunning} />

      {mode === 'watch' ? (
        <WatchMeta />
      ) : (
        <WalletMeta />
      )}

      <div className="mt-6 flex items-center gap-3 flex-wrap">
        {mode === 'wallet' && <WalletStartButton disabled={isRunning || !text.trim()} onStart={() => onStart(text)} isRunning={isRunning} />}
        {mode === 'watch' && (
          <button
            onClick={() => onStart(text)}
            disabled={isRunning || !text.trim()}
            className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] bg-purple text-[#0A0A0F] text-[13px] font-semibold hover:shadow-[0_0_28px_rgba(167,139,250,0.45)] transition-shadow duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
          >
            {isRunning ? 'Running…' : 'Run task →'}
          </button>
        )}
        {canReset && (
          <button
            onClick={onReset}
            className="inline-flex items-center gap-2 h-11 px-4 rounded-[10px] border border-border-hover text-[13px] text-text-muted hover:text-text hover:bg-surface-2 transition-colors duration-200"
          >
            ↺ Reset
          </button>
        )}
      </div>
    </section>
  );
}

function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: DemoMode;
  onChange: (m: DemoMode) => void;
  disabled: boolean;
}) {
  return (
    <div className="inline-flex p-[3px] rounded-[10px] bg-canvas border border-border text-[12px]">
      {(['watch', 'wallet'] as DemoMode[]).map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            onClick={() => !disabled && onChange(m)}
            disabled={disabled}
            className={`px-3 py-1.5 rounded-[7px] font-mono transition-colors duration-200 ${
              active
                ? 'bg-surface-2 text-text'
                : 'text-text-muted hover:text-text disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
          >
            {m === 'watch' ? 'Watch live' : 'Try with wallet'}
          </button>
        );
      })}
    </div>
  );
}

function BriefInput({
  text,
  onChange,
  disabled,
}: {
  text: string;
  onChange: (s: string) => void;
  disabled: boolean;
}) {
  return (
    <>
      <label className="block mb-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
          Brief
        </span>
        <span className="ml-2 text-[11px] text-text-subtle">what the agent should do</span>
      </label>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={3}
        className="w-full min-h-[96px] rounded-[10px] border border-border bg-canvas p-4 text-[14px] leading-[1.55] text-text placeholder:text-text-subtle focus:outline-none focus:border-purple focus:shadow-[0_0_0_3px_rgba(167,139,250,0.25)] transition-[box-shadow,border-color] duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
        placeholder="Describe the work for the agent…"
      />
    </>
  );
}

function WatchMeta() {
  const orchestrator = useOrchestratorInfo();
  const wallet = useSageChain();

  const backendChain = orchestrator.chainName ?? 'unknown';
  const walletOnDifferentChain =
    orchestrator.status === 'ok' &&
    orchestrator.chainId !== null &&
    wallet.chainId !== orchestrator.chainId;

  return (
    <>
      <dl className="mt-5 grid grid-cols-3 gap-4 text-[12px]">
        <Meta label="Amount" value="0.001 USDC" />
        <Meta label="Deadline" value="1 hour" />
        <Meta
          label="Runs on"
          value={orchestrator.status === 'unreachable' ? 'orchestrator offline' : backendChain}
          warn={orchestrator.status !== 'ok'}
        />
      </dl>
      <p className="mt-3 text-[11px] text-text-subtle font-mono">
        sponsored by protocol · no wallet signatures required
      </p>
      {walletOnDifferentChain && (
        <p className="mt-2 text-[11px] text-text-subtle">
          Your wallet is on a different chain — that's fine for Watch live, the orchestrator pays
          on its own chain. To sign yourself, switch mode to <span className="text-text-muted">Try with wallet</span>.
        </p>
      )}
      {orchestrator.status === 'unreachable' && (
        <p className="mt-2 text-[11px] font-mono" style={{ color: '#F472B6' }}>
          Orchestrator at <span className="text-text-muted">NEXT_PUBLIC_ORCHESTRATOR_URL</span>{' '}
          not responding. Run backend locally (see local-dev-setup runbook) or wait for prod deploy.
        </p>
      )}
    </>
  );
}

function WalletMeta() {
  const { address, isConnected } = useAccount();
  const chain = useSageChain();
  const { data: balance } = useReadContract({
    chainId: chain.chainId,
    address: chain.contracts.usdc,
    abi: usdcAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) && chain.isSupported },
  });

  const usdc = typeof balance === 'bigint' ? balance : 0n;
  const hasEnough = usdc >= MIN_USDC;

  return (
    <>
      <dl className="mt-5 grid grid-cols-3 gap-4 text-[12px]">
        <Meta label="You pay" value="0.002 USDC" />
        <Meta
          label="USDC balance"
          value={isConnected ? `${formatUnits(usdc, 6)} USDC` : '—'}
          warn={isConnected && chain.isSupported && !hasEnough}
        />
        <Meta label="Signatures" value="2 permits + 2 approvals" />
      </dl>
      {isConnected && !chain.isSupported && (
        <p className="mt-3 text-[11px] font-mono" style={{ color: '#F472B6' }}>
          Unsupported chain ({chain.chainId}). Switch to Base mainnet (8453) or Base Sepolia (84532)
          to run the demo.
        </p>
      )}
      {isConnected && chain.isSupported && !hasEnough && (
        <p className="mt-3 text-[11px] font-mono" style={{ color: '#F472B6' }}>
          Insufficient USDC on {chain.displayName}. You need at least 0.002 USDC to run both
          stages.
        </p>
      )}
      {!isConnected && (
        <p className="mt-3 text-[11px] text-text-subtle font-mono">
          Connect a wallet to sign permits + writes yourself. You pay 0.002 USDC total (0.001 per
          stage).
        </p>
      )}
    </>
  );
}

function WalletStartButton({
  disabled,
  isRunning,
  onStart,
}: {
  disabled: boolean;
  isRunning: boolean;
  onStart: () => void;
}) {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return (
      <ConnectKitButton.Custom>
        {({ show }) => (
          <button
            onClick={show}
            className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] bg-purple text-[#0A0A0F] text-[13px] font-semibold hover:shadow-[0_0_28px_rgba(167,139,250,0.45)] transition-shadow duration-200"
          >
            Connect wallet to run →
          </button>
        )}
      </ConnectKitButton.Custom>
    );
  }

  return (
    <button
      onClick={onStart}
      disabled={disabled}
      className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] bg-purple text-[#0A0A0F] text-[13px] font-semibold hover:shadow-[0_0_28px_rgba(167,139,250,0.45)] transition-shadow duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
    >
      {isRunning ? 'Running — approve in wallet…' : 'Run with my wallet →'}
    </button>
  );
}

function Meta({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
        {label}
      </dt>
      <dd className={warn ? 'text-pink font-mono' : 'text-text'}>{value}</dd>
    </div>
  );
}

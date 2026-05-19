'use client';

import { useEffect, useState } from 'react';
import { ConnectKitButton } from 'connectkit';
import { formatUnits } from 'viem';
import { useAccount, useReadContract } from 'wagmi';

import { useOrchestratorInfo } from '@/hooks/use-orchestrator-info';
import { useSageChain } from '@/hooks/use-sage-chain';
import { usdcAbi } from '@/lib/abi/task-escrow';
import type { AgentMode, DemoStatus } from '@/hooks/use-demo-stream';

export type DemoMode = 'watch' | 'wallet';

const DEFAULT_INPUTS: Record<AgentMode, string> = {
  pipeline:
    'Summarize the attached 40-page RFP into a 12-bullet exec brief. Return markdown.',
  sentiment:
    'The team shipped the release ahead of schedule and customers love it. Best launch in years.',
  vision: 'https://upload.wikimedia.org/wikipedia/commons/3/3a/Cat03.jpg',
};

const INPUT_LABELS: Record<AgentMode, { label: string; hint: string }> = {
  pipeline: { label: 'Brief', hint: 'what the agent should do' },
  sentiment: { label: 'Text', hint: 'classify the sentiment of this text' },
  vision: { label: 'Image URL', hint: 'public http(s) URL of an image' },
};

const STAGE_COUNT: Record<AgentMode, number> = {
  pipeline: 2,
  sentiment: 1,
  vision: 1,
};

const MIN_USDC: Record<AgentMode, bigint> = {
  pipeline: 2_000n, // 0.002 USDC
  sentiment: 1_000n,
  vision: 1_000n,
};

const SIGNATURE_DESCRIPTIONS: Record<AgentMode, string> = {
  pipeline: '2 permits + 2 approvals',
  sentiment: '1 permit + 1 approval',
  vision: '1 permit + 1 approval',
};

interface TaskInputProps {
  mode: DemoMode;
  onModeChange: (m: DemoMode) => void;
  agentMode: AgentMode;
  onAgentModeChange: (m: AgentMode) => void;
  status: DemoStatus;
  onStart: (input: string) => void;
  onReset: () => void;
}

export function TaskInput({
  mode,
  onModeChange: _onModeChange,
  agentMode,
  onAgentModeChange,
  status,
  onStart,
  onReset,
}: TaskInputProps) {
  const [input, setInput] = useState(DEFAULT_INPUTS[agentMode]);
  const isRunning = status === 'running';
  const canReset = status === 'done' || status === 'error';

  // Reset input to mode default when agentMode changes (each mode has its own default).
  useEffect(() => {
    setInput(DEFAULT_INPUTS[agentMode]);
  }, [agentMode]);

  const inputValid = isInputValid(agentMode, input);

  return (
    <section className="rounded-[14px] border border-border bg-surface p-6 md:p-8">
      <header className="flex items-center justify-between gap-3 mb-6">
        <h2 className="font-mono text-[13px]">
          <span className="text-text-subtle">01</span>{' '}
          <span className="font-medium">Task</span>
        </h2>
        {/* Try-with-wallet temporarily hidden — prototype stage. Wallet code paths preserved
            (useWalletDemo, signUsdcPermit, etc.) and can be re-enabled by restoring this toggle. */}
        {/* <ModeToggle mode={mode} onChange={onModeChange} disabled={isRunning} /> */}
      </header>

      <AgentModeTabs
        agentMode={agentMode}
        onChange={onAgentModeChange}
        disabled={isRunning}
      />

      {agentMode === 'vision' ? (
        <ImageUrlInput
          value={input}
          onChange={setInput}
          disabled={isRunning}
          labels={INPUT_LABELS[agentMode]}
        />
      ) : (
        <BriefInput
          text={input}
          onChange={setInput}
          disabled={isRunning}
          labels={INPUT_LABELS[agentMode]}
        />
      )}

      {mode === 'watch' ? <WatchMeta agentMode={agentMode} /> : <WalletMeta agentMode={agentMode} />}

      <div className="mt-6 flex items-center gap-3 flex-wrap">
        {mode === 'wallet' && (
          <WalletStartButton
            agentMode={agentMode}
            disabled={isRunning || !inputValid}
            onStart={() => onStart(input)}
            isRunning={isRunning}
          />
        )}
        {mode === 'watch' && (
          <button
            onClick={() => onStart(input)}
            disabled={isRunning || !inputValid}
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

// Kept as dead code: Try-with-wallet UI is hidden until env vars stabilize.
// Exported (rather than deleted) so TS's noUnusedLocals doesn't trip on it;
// no caller currently imports it. Restore the toggle by re-adding the JSX
// element where `<ModeToggle …>` used to live.
export function _ModeToggle({
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

function AgentModeTabs({
  agentMode,
  onChange,
  disabled,
}: {
  agentMode: AgentMode;
  onChange: (m: AgentMode) => void;
  disabled: boolean;
}) {
  const tabs: Array<{ mode: AgentMode; label: string; sub: string }> = [
    { mode: 'pipeline', label: 'Pipeline', sub: 'summarize → translate' },
    { mode: 'sentiment', label: 'Sentiment', sub: 'classify text' },
    { mode: 'vision', label: 'Vision', sub: 'describe image' },
  ];

  return (
    <div className="mb-6 grid grid-cols-3 gap-2">
      {tabs.map((tab) => {
        const active = agentMode === tab.mode;
        return (
          <button
            key={tab.mode}
            onClick={() => !disabled && onChange(tab.mode)}
            disabled={disabled}
            className={`flex flex-col items-start gap-1 px-3 py-2.5 rounded-[10px] border text-left transition-colors duration-200 ${
              active
                ? 'border-purple bg-surface-2'
                : 'border-border bg-canvas hover:border-border-hover disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
          >
            <span className={`font-mono text-[12px] ${active ? 'text-text' : 'text-text-muted'}`}>
              {tab.label}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-subtle">
              {tab.sub}
            </span>
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
  labels,
}: {
  text: string;
  onChange: (s: string) => void;
  disabled: boolean;
  labels: { label: string; hint: string };
}) {
  return (
    <>
      <label className="block mb-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
          {labels.label}
        </span>
        <span className="ml-2 text-[11px] text-text-subtle">{labels.hint}</span>
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

function ImageUrlInput({
  value,
  onChange,
  disabled,
  labels,
}: {
  value: string;
  onChange: (s: string) => void;
  disabled: boolean;
  labels: { label: string; hint: string };
}) {
  const trimmed = value.trim();
  const isValid = /^https?:\/\//i.test(trimmed);

  return (
    <>
      <label className="block mb-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
          {labels.label}
        </span>
        <span className="ml-2 text-[11px] text-text-subtle">{labels.hint}</span>
      </label>
      <input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full h-[44px] rounded-[10px] border border-border bg-canvas px-4 text-[14px] text-text placeholder:text-text-subtle focus:outline-none focus:border-purple focus:shadow-[0_0_0_3px_rgba(167,139,250,0.25)] transition-[box-shadow,border-color] duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
        placeholder="https://example.com/image.jpg"
      />
      {trimmed && !isValid && (
        <p className="mt-2 text-[11px] font-mono" style={{ color: '#F472B6' }}>
          URL must start with http:// or https://
        </p>
      )}
      {trimmed && isValid && (
        <div className="mt-3 rounded-[10px] border border-border bg-canvas p-2 max-w-[240px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={trimmed}
            alt="preview"
            className="max-h-[120px] w-auto rounded-[6px]"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      )}
    </>
  );
}

function WatchMeta({ agentMode }: { agentMode: AgentMode }) {
  const orchestrator = useOrchestratorInfo();
  const wallet = useSageChain();

  const backendChain = orchestrator.chainName ?? 'unknown';
  const walletOnDifferentChain =
    orchestrator.status === 'ok' &&
    orchestrator.chainId !== null &&
    wallet.chainId !== orchestrator.chainId;

  const totalAmount = formatUnits(MIN_USDC[agentMode], 6);

  return (
    <>
      <dl className="mt-5 grid grid-cols-3 gap-4 text-[12px]">
        <Meta label="Amount" value={`${totalAmount} USDC`} />
        <Meta label="Stages" value={String(STAGE_COUNT[agentMode])} />
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
          on its own chain. To sign yourself, switch mode to{' '}
          <span className="text-text-muted">Try with wallet</span>.
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

function WalletMeta({ agentMode }: { agentMode: AgentMode }) {
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
  const required = MIN_USDC[agentMode];
  const hasEnough = usdc >= required;
  const requiredDisplay = formatUnits(required, 6);

  return (
    <>
      <dl className="mt-5 grid grid-cols-3 gap-4 text-[12px]">
        <Meta label="You pay" value={`${requiredDisplay} USDC`} />
        <Meta
          label="USDC balance"
          value={isConnected ? `${formatUnits(usdc, 6)} USDC` : '—'}
          warn={isConnected && chain.isSupported && !hasEnough}
        />
        <Meta label="Signatures" value={SIGNATURE_DESCRIPTIONS[agentMode]} />
      </dl>
      {isConnected && !chain.isSupported && (
        <p className="mt-3 text-[11px] font-mono" style={{ color: '#F472B6' }}>
          Unsupported chain ({chain.chainId}). Switch to Base mainnet (8453) or Base Sepolia (84532)
          to run the demo.
        </p>
      )}
      {isConnected && chain.isSupported && !hasEnough && (
        <p className="mt-3 text-[11px] font-mono" style={{ color: '#F472B6' }}>
          Insufficient USDC on {chain.displayName}. You need at least {requiredDisplay} USDC.
        </p>
      )}
      {!isConnected && (
        <p className="mt-3 text-[11px] text-text-subtle font-mono">
          Connect a wallet to sign permits + writes yourself. You pay {requiredDisplay} USDC total.
        </p>
      )}
    </>
  );
}

function WalletStartButton({
  agentMode,
  disabled,
  isRunning,
  onStart,
}: {
  agentMode: AgentMode;
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

  const label =
    agentMode === 'pipeline'
      ? 'Run with my wallet →'
      : agentMode === 'sentiment'
        ? 'Classify with my wallet →'
        : 'Describe with my wallet →';

  return (
    <button
      onClick={onStart}
      disabled={disabled}
      className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] bg-purple text-[#0A0A0F] text-[13px] font-semibold hover:shadow-[0_0_28px_rgba(167,139,250,0.45)] transition-shadow duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
    >
      {isRunning ? 'Running — approve in wallet…' : label}
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

function isInputValid(agentMode: AgentMode, input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (agentMode === 'vision') return /^https?:\/\//i.test(trimmed);
  return true;
}

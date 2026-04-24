'use client';

import { BASE_MAINNET, txUrl } from '@/chains/base';
import type { DemoResult } from '@/hooks/use-demo-stream';

export function ResultPanel({ result }: { result: DemoResult }) {
  return (
    <section className="relative rounded-[14px] border border-border bg-surface overflow-hidden animate-[demo-reveal_360ms_ease-out]">
      <div
        className="h-[2px]"
        style={{ background: 'linear-gradient(90deg, #5EE3F5, #A78BFA, #F472B6, #6EE7B7)' }}
        aria-hidden
      />

      <header className="px-6 md:px-8 pt-6 pb-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[15px] font-medium">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green text-[#0A0A0F]">
            <CheckIcon />
          </span>
          Task settled
        </h3>
        <div className="flex flex-wrap gap-4 font-mono text-[11px] text-text-subtle">
          <Metric label="Duration" value={formatDuration(result.durationMs)} />
          <Metric label="USDC settled" value={formatUsdc(result.totalUsdcSettled)} />
          <Metric label="Transactions" value={result.txHashes.length.toString()} />
        </div>
      </header>

      <div className="px-6 md:px-8 py-6 grid gap-6 md:grid-cols-2">
        <ResultBlock title="Summary" body={result.summary || '—'} />
        <ResultBlock title="Translation (EN → RU)" body={result.translation || '—'} />
      </div>

      {result.txHashes.length > 0 && (
        <div className="px-6 md:px-8 py-4 border-t border-border flex items-center gap-3 flex-wrap">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
            Payments:
          </span>
          {result.txHashes.map((tx, i) => (
            <a
              key={tx}
              href={txUrl(BASE_MAINNET.chainId, tx)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[12px] text-cyan hover:underline underline-offset-4"
            >
              #{i + 1} {tx.slice(0, 8)}…{tx.slice(-4)} ↗
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function ResultBlock({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle mb-2">
        {title}
      </div>
      <p className="text-[14px] leading-[1.65] text-text whitespace-pre-wrap">{body}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="uppercase tracking-[0.08em]">{label}</span>{' '}
      <span className="text-text">{value}</span>
    </span>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatUsdc(amountStr: string): string {
  try {
    const amt = BigInt(amountStr);
    const whole = amt / 1_000_000n;
    const frac = amt % 1_000_000n;
    const fracStr = frac.toString().padStart(6, '0').slice(0, 3);
    return `${whole.toString()}.${fracStr} USDC`;
  } catch {
    return amountStr;
  }
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M2.5 7.5L5.5 10.5L11.5 3.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

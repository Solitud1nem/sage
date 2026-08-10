'use client';

import { ARC_TESTNET_CHAIN_ID } from '@/chains/arc';
import { MONAD_TESTNET_CHAIN_ID } from '@/chains/monad';
import { BASE_MAINNET_CHAIN_ID } from '@/chains/base';
import type { CompositeChainId } from '@/hooks/use-composite-demo';

/**
 * Segmented selector for which Sage-supported chain the composite demo
 * runs on. Lives above the brief input. Wired to URL search state in the
 * page (`?chain=arc`) so the choice survives refresh + is shareable.
 *
 * Frozen after classify — the hook's `runChainRef` backstops the picker
 * disabled state. Mid-run chain switching would misroute approve/retry
 * to the wrong orchestrator.
 *
 * Visual: two pills inside a bordered tray. Active pill takes the cyan
 * accent (same token as `Classify brief →` CTA on the page). Each pill
 * carries its own network status tag (`mainnet · 8453` / `testnet`) so the
 * user knows what they're committing to before clicking — no dangling hint
 * that reads like a third network option.
 */

interface ChainPickerProps {
  chainId: CompositeChainId;
  onChange: (chainId: CompositeChainId) => void;
  disabled?: boolean;
}

const OPTIONS: Array<{
  chainId: CompositeChainId;
  label: string;
  tag: string;
  /** Chain's demo stack is hibernating (2026-08): pill renders disabled. */
  paused?: boolean;
}> = [
  {
    chainId: BASE_MAINNET_CHAIN_ID,
    label: 'Base',
    tag: 'paused',
    paused: true,
  },
  {
    chainId: ARC_TESTNET_CHAIN_ID,
    label: 'Arc',
    tag: 'paused',
    paused: true,
  },
  {
    chainId: MONAD_TESTNET_CHAIN_ID,
    label: 'Monad',
    tag: 'testnet · WMON',
  },
];

export function ChainPicker({ chainId, onChange, disabled }: ChainPickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
        Settlement chain
      </div>
      <div
        role="radiogroup"
        aria-label="Settlement chain"
        aria-disabled={disabled}
        className={`inline-flex items-center gap-1 rounded-[10px] border border-border p-1 bg-[#0A0A0F] ${
          disabled ? 'opacity-50' : ''
        }`}
      >
        {OPTIONS.map((opt) => {
          const active = opt.chainId === chainId;
          const isDisabled = disabled || opt.paused;
          return (
            <button
              key={opt.chainId}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={isDisabled}
              title={opt.paused ? 'Demo stack on this chain is paused — Monad testnet is the active demo chain.' : undefined}
              onClick={() => onChange(opt.chainId)}
              className={`h-8 px-3 rounded-[7px] font-mono text-[12px] flex items-center gap-1.5 transition-colors ${
                active
                  ? 'bg-cyan text-[#0A0A0F]'
                  : 'text-text-muted hover:text-text disabled:cursor-not-allowed'
              } ${opt.paused ? 'opacity-40 cursor-not-allowed hover:text-text-muted' : ''} ${
                disabled && !active ? 'pointer-events-none' : ''
              }`}
            >
              <span>{opt.label}</span>
              <span
                className={`text-[10px] uppercase tracking-[0.08em] px-1.5 rounded ${
                  active ? 'bg-[#0A0A0F]/15 text-[#0A0A0F]' : 'bg-surface text-text-subtle'
                }`}
              >
                {opt.tag}
              </span>
            </button>
          );
        })}
      </div>
      {disabled ? (
        <div className="font-mono text-[11px] text-text-subtle">· frozen for this run</div>
      ) : null}
    </div>
  );
}

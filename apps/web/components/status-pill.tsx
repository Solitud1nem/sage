import type { PropsWithChildren } from 'react';

type PillVariant = 'live' | 'muted';

export function StatusPill({
  variant = 'live',
  children,
}: PropsWithChildren<{ variant?: PillVariant }>) {
  const dotColor = variant === 'live' ? '#6EE7B7' : '#6E6E85';
  const textColor = variant === 'live' ? '#6EE7B7' : 'var(--text-muted)';

  return (
    <span
      className="inline-flex items-center gap-2 px-3 h-[26px] rounded-full border border-border font-mono text-[11px] uppercase tracking-[0.08em]"
      style={{ color: textColor }}
    >
      <span
        className="w-[6px] h-[6px] rounded-full animate-[live-pulse_1.8s_ease-in-out_infinite]"
        style={{ background: dotColor, boxShadow: variant === 'live' ? '0 0 8px rgba(110,231,183,0.6)' : 'none' }}
        aria-hidden
      />
      {children}
    </span>
  );
}

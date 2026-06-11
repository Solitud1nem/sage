export function ErrorPanel({
  message,
  failReason,
  onReset,
}: {
  message: string;
  /** Backend plan_failed tag — 'dispute_refunded' renders the escrow-protection copy. */
  failReason?: string | null;
  onReset: () => void;
}) {
  // M12.1.4: a dispute-refund is the protocol WORKING — the evaluator (or the
  // user) rejected the work and the council returned the escrow. Presenting
  // it as a generic infrastructure failure (the "Common causes" hint) read as
  // breakage to the first live tester.
  const isRefund = failReason === 'dispute_refunded';
  const accent = isRefund ? '#A78BFA' : '#F472B6';
  return (
    <section className="rounded-[14px] border border-border bg-surface p-6 md:p-8">
      <h3 className="flex items-center gap-2 text-[14px] font-medium" style={{ color: accent }}>
        <DotIcon color={accent} />
        {isRefund ? 'Work rejected — escrow refunded' : 'Demo run failed'}
      </h3>
      <p className="mt-3 text-[13px] text-text-muted leading-[1.55] font-mono break-all">
        {message}
      </p>
      {isRefund ? (
        <p className="mt-4 text-[12px] text-text-subtle leading-[1.55]">
          This is the protocol doing its job: the result did not pass verification (after an
          automatic rework attempt), the dispute went to the council, and the escrowed USDC was
          returned to the client on-chain. No payment left for unaccepted work — try the brief
          again or adjust it.
        </p>
      ) : (
        <p className="mt-4 text-[12px] text-text-subtle leading-[1.55]">
          Common causes:{' '}
          <span className="font-mono text-text-muted">NEXT_PUBLIC_ORCHESTRATOR_URL</span> not
          reachable, sponsor wallet out of balance, or registered agent addresses missing from env.
          See{' '}
          <a href="/docs" className="text-purple hover:underline underline-offset-4">
            docs
          </a>{' '}
          for troubleshooting.
        </p>
      )}
      <button
        onClick={onReset}
        className="mt-6 inline-flex items-center gap-2 h-10 px-4 rounded-[10px] border border-border-hover text-[13px] text-text-muted hover:text-text hover:bg-surface-2 transition-colors duration-200"
      >
        ↺ Try again
      </button>
    </section>
  );
}

function DotIcon({ color }: { color: string }) {
  return (
    <span
      className="w-[6px] h-[6px] rounded-full"
      style={{ background: color, boxShadow: `0 0 8px ${color}99` }}
      aria-hidden
    />
  );
}

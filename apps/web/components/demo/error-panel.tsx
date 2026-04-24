export function ErrorPanel({ message, onReset }: { message: string; onReset: () => void }) {
  return (
    <section className="rounded-[14px] border border-border bg-surface p-6 md:p-8">
      <h3 className="flex items-center gap-2 text-[14px] font-medium" style={{ color: '#F472B6' }}>
        <DotIcon />
        Demo run failed
      </h3>
      <p className="mt-3 text-[13px] text-text-muted leading-[1.55] font-mono break-all">
        {message}
      </p>
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
      <button
        onClick={onReset}
        className="mt-6 inline-flex items-center gap-2 h-10 px-4 rounded-[10px] border border-border-hover text-[13px] text-text-muted hover:text-text hover:bg-surface-2 transition-colors duration-200"
      >
        ↺ Try again
      </button>
    </section>
  );
}

function DotIcon() {
  return (
    <span
      className="w-[6px] h-[6px] rounded-full"
      style={{ background: '#F472B6', boxShadow: '0 0 8px rgba(244,114,182,0.6)' }}
      aria-hidden
    />
  );
}

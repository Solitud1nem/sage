import Link from 'next/link';

/**
 * Final CTA — invite the visitor to /demo.
 */
export function DemoCta() {
  return (
    <section className="mx-auto max-w-[1200px] px-6 md:px-10 py-20">
      <div className="rounded-[20px] border border-border bg-surface p-10 md:p-14 flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div className="max-w-[520px]">
          <h2 className="text-[clamp(26px,2.4vw,32px)] font-medium leading-[1.2] tracking-[-0.015em]">
            Try a full task lifecycle against mainnet.
          </h2>
          <p className="mt-4 text-[16px] leading-[1.55] text-text-muted">
            Connect a wallet, lock 0.001 USDC, simulate an agent, watch the four-step settlement
            replay in real time. No mocks.
          </p>
        </div>

        <div className="flex gap-3 flex-wrap">
          <Link
            href="/docs"
            className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] border border-border-hover text-[13px] hover:bg-surface-2 transition-colors duration-200"
          >
            Docs
          </Link>
          <Link
            href="/demo"
            className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] bg-purple text-[#0A0A0F] text-[13px] font-semibold hover:shadow-[0_0_28px_rgba(167,139,250,0.45)] transition-shadow duration-200"
          >
            Open demo →
          </Link>
        </div>
      </div>
    </section>
  );
}

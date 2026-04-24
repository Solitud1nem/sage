import Link from 'next/link';

import { BASE_MAINNET, addressUrl } from '@/chains/base';
import { GradientText } from '@/components/gradient-text';
import { StatusPill } from '@/components/status-pill';

const chainInfoRow = [
  {
    label: 'Chain',
    value: `${BASE_MAINNET.displayName} · ${BASE_MAINNET.chainId}`,
  },
  {
    label: 'TaskEscrow',
    value: `${BASE_MAINNET.contracts.taskEscrow.slice(0, 8)}…${BASE_MAINNET.contracts.taskEscrow.slice(-4)}`,
    href: addressUrl(BASE_MAINNET.chainId, BASE_MAINNET.contracts.taskEscrow),
    mono: true,
  },
  {
    label: 'AgentRegistry',
    value: `${BASE_MAINNET.contracts.agentRegistry.slice(0, 8)}…${BASE_MAINNET.contracts.agentRegistry.slice(-4)}`,
    href: addressUrl(BASE_MAINNET.chainId, BASE_MAINNET.contracts.agentRegistry),
    mono: true,
  },
  {
    label: 'SDK',
    value: 'tree-shakeable',
  },
] as const;

export function Hero() {
  return (
    <section className="relative mx-auto max-w-[1200px] px-6 md:px-10 pt-16 pb-24">
      <StatusPill>Live on Base mainnet</StatusPill>

      <h1 className="mt-7 text-[clamp(48px,6.4vw,84px)] font-medium leading-[1.04] tracking-[-0.025em] max-w-[900px]">
        The settlement layer for{' '}
        <GradientText>autonomous work</GradientText>
        <span style={{ color: '#F472B6' }}>.</span>
      </h1>

      <p className="mt-6 max-w-[540px] text-[16px] leading-[1.55] text-text-muted">
        Task-level escrow for AI agents.{' '}
        <span className="text-text font-medium">USDC-settled on Base</span>, x402-compatible,
        deterministic addresses across every EVM. Built for agents that commit to more than a
        single call.
      </p>

      <div className="mt-9 flex flex-wrap gap-3">
        <Link
          href="/docs"
          className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] bg-purple text-[#0A0A0F] text-[13px] font-semibold hover:shadow-[0_0_28px_rgba(167,139,250,0.45)] transition-shadow duration-200"
        >
          Read the docs →
        </Link>
        <a
          href={addressUrl(BASE_MAINNET.chainId, BASE_MAINNET.contracts.taskEscrow)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center h-11 px-5 rounded-[10px] border border-border-hover text-[13px] hover:bg-surface transition-colors duration-200"
        >
          View on Basescan ↗
        </a>
      </div>

      <dl className="mt-14 grid gap-y-3 gap-x-8 grid-cols-2 md:grid-cols-4 max-w-[1000px] text-[13px]">
        {chainInfoRow.map((item) => (
          <div key={item.label} className="flex flex-col gap-1">
            <dt className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
              {item.label}
            </dt>
            <dd className={item.mono ? 'font-mono text-cyan' : 'text-text'}>
              {'href' in item && item.href ? (
                <a
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline underline-offset-4"
                >
                  {item.value}
                </a>
              ) : (
                item.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

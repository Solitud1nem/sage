import Link from 'next/link';
import { BASE_MAINNET, addressUrl } from '@/chains/base';

/**
 * Footer — mirrors apps/web/design-reference/Home.txt footer layout.
 * Honest-only: no invented packages, no fake community channels.
 */
export function Footer() {
  const escrow = BASE_MAINNET.contracts.taskEscrow;

  return (
    <footer className="border-t border-border mt-20">
      <div className="mx-auto max-w-[1200px] px-6 md:px-10 py-16 grid gap-10 md:grid-cols-[1fr_auto_auto_auto]">
        <div>
          <div className="flex items-center gap-[10px] mb-4">
            <span className="block w-[22px] h-[22px] rounded-md" style={{ background: '#A78BFA' }} aria-hidden />
            <span className="font-medium tracking-[-0.01em] text-[15px]">sage</span>
          </div>
          <p className="text-[13px] text-text-muted max-w-[280px] leading-[1.55]">
            Task-level escrow for autonomous agents. Open-source, MIT-licensed.
          </p>
        </div>

        <FooterColumn title="Protocol" links={[
          { href: addressUrl(BASE_MAINNET.chainId, BASE_MAINNET.contracts.agentRegistry), label: 'Registry', external: true },
          { href: addressUrl(BASE_MAINNET.chainId, escrow), label: 'Contracts', external: true },
          { href: '/#x402', label: 'x402 integration' },
        ]} />

        <FooterColumn title="Developers" links={[
          { href: '/docs', label: 'Docs' },
          { href: 'https://github.com', label: '@sage/core', external: true },
          { href: 'https://github.com', label: '@sage/adapter-evm', external: true },
          { href: '/demo', label: '/demo' },
        ]} />

        <FooterColumn title="Community" links={[
          { href: 'https://github.com', label: 'GitHub', external: true },
          { href: '/changelog', label: 'Changelog' },
        ]} />
      </div>

      <div className="border-t border-border">
        <div className="mx-auto max-w-[1200px] px-6 md:px-10 py-5 flex flex-col md:flex-row justify-between gap-2 text-[11px] text-text-subtle">
          <div>© 2026 Sage Protocol · MIT</div>
          <div className="font-mono">
            {BASE_MAINNET.displayName} · {BASE_MAINNET.chainId} ·{' '}
            <a
              href={addressUrl(BASE_MAINNET.chainId, escrow)}
              target="_blank"
              rel="noreferrer"
              className="hover:text-text transition-colors"
            >
              {escrow.slice(0, 8)}…{escrow.slice(-4)}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: Array<{ href: string; label: string; external?: boolean }>;
}) {
  return (
    <div className="min-w-[140px]">
      <div className="text-[11px] uppercase tracking-[0.08em] font-mono text-text-subtle mb-3">
        {title}
      </div>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.label}>
            {l.external ? (
              <a
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] text-text-muted hover:text-text transition-colors duration-200"
              >
                {l.label}
              </a>
            ) : (
              <Link
                href={l.href}
                className="text-[13px] text-text-muted hover:text-text transition-colors duration-200"
              >
                {l.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

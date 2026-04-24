'use client';

import Link from 'next/link';
import { ConnectKitButton } from 'connectkit';

import { siteConfig } from '@/lib/site-config';

const links = [
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#integrate', label: 'Integrate' },
  { href: '/#live', label: 'Live' },
  { href: '/demo', label: 'Demo' },
  { href: '/docs', label: 'Docs' },
];

export function Nav() {
  return (
    <nav className="sticky top-0 z-40 border-b border-border bg-canvas/90 backdrop-blur-sm">
      <div className="mx-auto max-w-[1200px] px-6 md:px-10 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-[10px]">
          <span
            className="block w-[22px] h-[22px] rounded-md"
            style={{ background: '#A78BFA' }}
            aria-hidden
          />
          <span className="font-medium tracking-[-0.01em] text-[15px]">sage</span>
        </Link>

        <div className="hidden md:flex items-center gap-5 text-[13px] text-text-muted">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-text transition-colors duration-200">
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <a
            href={siteConfig.github}
            target="_blank"
            rel="noreferrer"
            aria-label="Sage on GitHub"
            className="hidden sm:inline-flex items-center gap-2 h-9 px-3 rounded-md border border-border-hover text-[13px] hover:bg-surface transition-colors duration-200"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            GitHub
          </a>

          <ConnectKitButton.Custom>
            {({ isConnected, show, truncatedAddress, ensName }) => (
              <button
                onClick={show}
                className="inline-flex items-center justify-center h-9 px-4 rounded-md bg-purple text-[#0A0A0F] text-[13px] font-medium hover:shadow-[0_0_28px_rgba(167,139,250,0.45)] transition-shadow duration-200"
              >
                {isConnected ? (ensName ?? truncatedAddress) : 'Connect wallet'}
              </button>
            )}
          </ConnectKitButton.Custom>
        </div>
      </div>
    </nav>
  );
}

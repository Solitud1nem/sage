'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

import { track } from '@/lib/posthog';

/**
 * Docs engagement analytics. Mounted once inside `DocsLayout`, so it runs on
 * every /docs sub-page and re-arms on each route change. All four events are
 * consent-gated automatically — `track()` is a no-op until the cookie banner
 * is accepted (per ADR-0006), and `autocapture` stays off.
 *
 * Events (all carry `section`, the slug after /docs):
 *   - docs_section_viewed  — richer than $pageview: includes `from` (the prior
 *     docs section, or the external referrer on first hit).
 *   - docs_scroll_depth    — fired once per page at 25/50/75/100% reached.
 *   - docs_link_clicked     — a link inside the doc body (sidebar nav excluded).
 *   - docs_code_copied      — text copied from a code block.
 */

// Module-level so the prior docs path survives client-side route changes.
let lastDocsPath: string | null = null;

function sectionFromPath(pathname: string): string {
  if (pathname === '/docs') return 'index';
  return pathname.replace(/^\/docs\/?/, '') || 'index';
}

export function DocsAnalytics() {
  const pathname = usePathname();
  const scrollFired = useRef<Set<number>>(new Set());

  // docs_section_viewed — on every docs route.
  useEffect(() => {
    const section = sectionFromPath(pathname);
    const from = lastDocsPath ?? (typeof document !== 'undefined' ? document.referrer || null : null);
    track('docs_section_viewed', { section, from });
    lastDocsPath = pathname;
  }, [pathname]);

  // docs_scroll_depth — 25/50/75/100%, once each per page.
  useEffect(() => {
    scrollFired.current = new Set();
    const section = sectionFromPath(pathname);
    const thresholds = [25, 50, 75, 100];
    const onScroll = () => {
      const total = document.documentElement.scrollHeight;
      if (total <= window.innerHeight) return; // page fits the viewport — nothing to scroll
      const pct = Math.min(100, Math.round(((window.scrollY + window.innerHeight) / total) * 100));
      for (const t of thresholds) {
        if (pct >= t && !scrollFired.current.has(t)) {
          scrollFired.current.add(t);
          track('docs_scroll_depth', { section, depth: t });
        }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // catch short pages / restored scroll position
    return () => window.removeEventListener('scroll', onScroll);
  }, [pathname]);

  // docs_link_clicked (content links only) + docs_code_copied.
  useEffect(() => {
    const section = sectionFromPath(pathname);

    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest('a');
      if (!anchor || !anchor.closest('article')) return; // body links only, not sidebar nav
      const href = anchor.getAttribute('href') ?? '';
      const external = /^https?:\/\//.test(href) && !href.includes(window.location.host);
      track('docs_link_clicked', { section, href, external });
    };

    const onCopy = () => {
      const sel = window.getSelection?.();
      if (!sel || sel.isCollapsed) return;
      const node = sel.anchorNode;
      const el = node?.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node?.parentElement;
      if (el?.closest('pre, code')) {
        track('docs_code_copied', { section, length: sel.toString().length });
      }
    };

    document.addEventListener('click', onClick);
    document.addEventListener('copy', onCopy);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('copy', onCopy);
    };
  }, [pathname]);

  return null;
}

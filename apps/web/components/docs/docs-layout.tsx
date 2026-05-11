'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { DOCS_NAV } from './docs-nav';

/**
 * Shared shell for every /docs sub-page.
 *
 * Two-column on lg+: sticky sidebar nav on the left, content on the right.
 * On smaller screens the sidebar stacks on top of the content (no drawer for
 * now — keep it boring; revisit if mobile traffic justifies the JS cost).
 *
 * `status: "soon"` items in DOCS_NAV render as disabled labels so visitors
 * can see the planned shape of the docs without hitting empty pages. Flip to
 * "live" as each phase ships. Nav data lives in `./docs-nav.ts` so the
 * server-rendered hub can import it without crossing the client boundary.
 */

export function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto max-w-[1200px] px-6 md:px-10 py-14">
      <div className="grid lg:grid-cols-[220px_1fr] gap-12">
        <aside className="lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto pb-8 lg:pb-0">
          <Link
            href="/docs"
            className={`block font-mono text-[11px] uppercase tracking-[0.08em] mb-6 transition-colors duration-200 ${
              pathname === '/docs' ? 'text-purple' : 'text-text-subtle hover:text-text'
            }`}
          >
            ← Docs hub
          </Link>
          <nav className="space-y-7">
            {DOCS_NAV.map((section) => (
              <div key={section.title}>
                <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-subtle mb-3">
                  {section.title}
                </div>
                <ul className="space-y-1.5">
                  {section.items.map((item) => {
                    const isActive = pathname === item.slug;
                    const isSoon = item.status === 'soon';
                    return (
                      <li key={item.slug}>
                        {isSoon ? (
                          <span
                            className="flex items-center justify-between text-[13px] text-text-subtle/60 py-1 cursor-not-allowed"
                            aria-disabled="true"
                          >
                            <span>{item.label}</span>
                            <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-text-subtle/70 ml-2">
                              soon
                            </span>
                          </span>
                        ) : (
                          <Link
                            href={item.slug}
                            className={`block text-[13px] py-1 transition-colors duration-200 ${
                              isActive
                                ? 'text-purple font-medium'
                                : 'text-text-muted hover:text-text'
                            }`}
                          >
                            {item.label}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <article className="min-w-0 max-w-[760px] text-text">
          {children}
        </article>
      </div>
    </div>
  );
}

/**
 * `next` pointer at the foot of every sub-page. Render as
 * `<DocsNextLink href="/docs/concepts" label="Concepts" />`.
 */
export function DocsNextLink({ href, label, hint }: { href: string; label: string; hint?: string }) {
  return (
    <div className="mt-16 pt-8 border-t border-border">
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-subtle mb-2">
        next
      </div>
      <Link
        href={href}
        className="group inline-flex items-baseline gap-2 text-[18px] text-text font-medium hover:text-purple transition-colors duration-200"
      >
        {label}
        <span className="text-text-subtle group-hover:text-purple transition-colors duration-200">
          →
        </span>
      </Link>
      {hint && <p className="mt-2 text-[13px] text-text-muted max-w-[520px]">{hint}</p>}
    </div>
  );
}

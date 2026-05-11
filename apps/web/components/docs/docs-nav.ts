/**
 * Single source of truth for the /docs navigation tree.
 *
 * Kept in a separate non-client module so both the server-rendered hub
 * (`apps/web/app/docs/page.tsx`) and the client sidebar (`docs-layout.tsx`)
 * can import it. Exporting a plain array from a `'use client'` file would
 * fail at the server-client boundary.
 */

export type DocsNavItem = {
  slug: string;
  label: string;
  status: 'live' | 'soon';
};

export type DocsNavSection = {
  title: string;
  items: DocsNavItem[];
};

export const DOCS_NAV: DocsNavSection[] = [
  {
    title: 'Get started',
    items: [
      { slug: '/docs/intro', label: 'Intro', status: 'live' },
      { slug: '/docs/concepts', label: 'Concepts', status: 'live' },
      { slug: '/docs/getting-started', label: 'Getting started', status: 'live' },
    ],
  },
  {
    title: 'Build',
    items: [
      { slug: '/docs/patterns', label: 'Patterns', status: 'live' },
      { slug: '/docs/use-cases', label: 'Use cases', status: 'soon' },
    ],
  },
  {
    title: 'Reference',
    items: [
      { slug: '/docs/api', label: 'API', status: 'soon' },
      { slug: '/docs/contracts', label: 'Contracts', status: 'soon' },
    ],
  },
  {
    title: 'Operate',
    items: [
      { slug: '/docs/architecture', label: 'Architecture', status: 'soon' },
      { slug: '/docs/security', label: 'Security', status: 'soon' },
    ],
  },
];

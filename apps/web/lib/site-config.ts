/**
 * Centralised site-level config. Single source of truth for domain, GitHub,
 * package names — anything that's sprinkled across nav, footer, OG metadata,
 * docs.
 *
 * Env overrides (Cloudflare Pages build): `NEXT_PUBLIC_GITHUB_URL`,
 * `NEXT_PUBLIC_SITE_URL`.
 */

const FALLBACK_GITHUB = 'https://github.com/sage-protocol/sage';
const FALLBACK_SITE = 'https://sage.xyz';

export const siteConfig = {
  name: 'Sage',
  tagline: 'The settlement layer for autonomous work',
  description:
    'Task-level escrow for AI agents. USDC-settled on Base, x402-compatible, deterministic addresses across every EVM. Built for agents that commit to more than a single call.',
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? FALLBACK_SITE).replace(/\/$/, ''),
  github: (process.env.NEXT_PUBLIC_GITHUB_URL ?? FALLBACK_GITHUB).replace(/\/$/, ''),
  packages: {
    core: 'packages/core',
    adapterEvm: 'packages/adapter-evm',
    contracts: 'packages/contracts',
    demoAgents: 'apps/demo-agents',
  },
} as const;

/** `github.com/.../sage/tree/main/<path>` — deep link into a workspace package. */
export function githubTreeUrl(path: string): string {
  return `${siteConfig.github}/tree/main/${path.replace(/^\//, '')}`;
}

/** `github.com/.../sage/blob/main/<path>` — deep link into a single file. */
export function githubBlobUrl(path: string): string {
  return `${siteConfig.github}/blob/main/${path.replace(/^\//, '')}`;
}

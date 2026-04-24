import type { NextConfig } from 'next';

/**
 * Sage web — static export on Cloudflare Pages (ADR-0006).
 *
 * Dynamic behavior (wallet, live tx stream, demo progress) lives in
 * client components. No server-rendered pages in v2.0.
 */
const nextConfig: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  trailingSlash: false,

  // Static export disables Next.js Image Optimization — use <img> or <Image unoptimized>.
  images: { unoptimized: true },

  // Strip console logs in production bundles.
  compiler: { removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false },

  // ESM + workspace packages from @sage/* need transpilation.
  transpilePackages: ['@sage/core', '@sage/adapter-evm'],
};

export default nextConfig;

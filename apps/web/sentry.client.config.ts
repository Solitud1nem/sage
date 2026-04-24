/**
 * Sentry client config — runs in the browser.
 *
 * Errors only (no performance or replay) to keep bundle size down and avoid
 * tracking anything that would surprise a privacy-conscious user. If the DSN
 * env var is missing (local dev) this becomes a no-op.
 */

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'production',
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    ignoreErrors: [
      // Wallet connection cancels are user-initiated, not bugs.
      /UserRejectedRequestError/,
      /User rejected the request/,
      // WalletConnect noise if projectId is missing.
      /WalletConnect.*projectId/i,
    ],
  });
}

/**
 * Sentry edge config — unused in static export but required by Next.js plugin
 * during build if the edge runtime is ever touched. No-op otherwise.
 */

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({ dsn, tracesSampleRate: 0 });
}

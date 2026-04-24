/**
 * Sentry server config — unused in the static-export build but required by
 * `@sentry/nextjs`. Keep it minimal; no server runtime to instrument.
 */

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'production',
    tracesSampleRate: 0,
  });
}

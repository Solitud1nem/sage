/**
 * Next.js 15 client-side instrumentation.
 *
 * Loaded once before any React code runs. We keep it lean: just Sentry init.
 * PostHog is gated by cookie-consent and initialised from <CookieConsent />.
 */

import './sentry.client.config';

export const onRouterTransitionStart = undefined;

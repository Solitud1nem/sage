'use client';

/**
 * PostHog lazy-init after user consent.
 *
 * Per ADR-0006: event-funnel analytics only, session replay disabled,
 * GDPR-compliant cookie-banner gates all tracking.
 */

import posthog from 'posthog-js';

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

let initialized = false;

/** Call after user accepts the cookie banner. */
export function initPostHog(): void {
  if (initialized || !KEY || typeof window === 'undefined') return;
  posthog.init(KEY, {
    api_host: HOST,
    capture_pageview: 'history_change',
    disable_session_recording: true,
    persistence: 'localStorage+cookie',
    respect_dnt: true,
    autocapture: false,
  });
  initialized = true;
}

/** Fire a custom analytics event. Safe before consent — returns noop. */
export function track(event: string, properties?: Record<string, unknown>): void {
  if (!initialized) return;
  posthog.capture(event, properties);
}

/** Reset analytics identity (e.g. on wallet disconnect). */
export function resetAnalytics(): void {
  if (!initialized) return;
  posthog.reset();
}

export { posthog };

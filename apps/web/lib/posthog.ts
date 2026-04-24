'use client';

/**
 * PostHog lazy-init — the lib is dynamically imported only after cookie-consent
 * is granted. Before that, nothing from `posthog-js` is pulled into the bundle.
 *
 * Per ADR-0006: event-funnel analytics only, session-replay disabled, GDPR
 * banner gates everything.
 *
 * Events the app emits:
 *   pageview, demo_started, demo_completed, demo_errored,
 *   wallet_connected, try_with_wallet_converted
 */

import type { PostHog } from 'posthog-js';

type ConsentState = 'granted' | 'denied' | 'unknown';

const CONSENT_KEY = 'sage:cookie-consent:v1';
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

let instance: PostHog | null = null;
let initStarted = false;

export function readConsent(): ConsentState {
  if (typeof window === 'undefined') return 'unknown';
  const v = window.localStorage.getItem(CONSENT_KEY);
  if (v === 'granted' || v === 'denied') return v;
  return 'unknown';
}

export function writeConsent(state: Exclude<ConsentState, 'unknown'>): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CONSENT_KEY, state);
}

/**
 * Lazy init — only after consent. No-op if `NEXT_PUBLIC_POSTHOG_KEY` is
 * unset (local dev).
 */
export async function initPostHog(): Promise<void> {
  if (initStarted || typeof window === 'undefined' || !KEY) return;
  initStarted = true;

  const { default: posthog } = await import('posthog-js');
  posthog.init(KEY, {
    api_host: HOST,
    capture_pageview: 'history_change',
    disable_session_recording: true,
    persistence: 'localStorage+cookie',
    respect_dnt: true,
    autocapture: false,
    loaded: (ph: any) => {
      instance = ph;
    },
  });
}

/** Fire a custom analytics event. Safe before consent — becomes a no-op. */
export function track(event: string, properties?: Record<string, unknown>): void {
  if (!instance) return;
  instance.capture(event, properties);
}

/** Reset analytics identity (e.g. on wallet disconnect). */
export function resetAnalytics(): void {
  if (!instance) return;
  instance.reset();
}

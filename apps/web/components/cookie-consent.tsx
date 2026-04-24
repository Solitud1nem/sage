'use client';

/**
 * Minimal GDPR-compliant cookie banner.
 *
 * - Renders nothing on first paint (avoids hydration mismatch).
 * - Reads consent from localStorage; if unknown, shows the banner.
 * - On "Accept": writes `granted`, lazy-imports PostHog, initialises.
 * - On "Decline": writes `denied`, nothing loads.
 *
 * Per ADR-0006 + M-INT.8 polish.
 */

import { useEffect, useState } from 'react';

import { initPostHog, readConsent, writeConsent } from '@/lib/posthog';

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const state = readConsent();
    if (state === 'granted') {
      void initPostHog();
      return;
    }
    if (state === 'unknown') setVisible(true);
  }, []);

  if (!visible) return null;

  const accept = () => {
    writeConsent('granted');
    void initPostHog();
    setVisible(false);
  };

  const decline = () => {
    writeConsent('denied');
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-labelledby="cookie-consent-title"
      aria-describedby="cookie-consent-body"
      className="fixed inset-x-0 bottom-4 z-50 px-4 md:bottom-6"
    >
      <div className="mx-auto max-w-[760px] rounded-[14px] border border-border bg-surface/95 backdrop-blur-md shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
        <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:gap-6 md:p-6">
          <div className="flex-1 space-y-1">
            <p id="cookie-consent-title" className="text-[13px] font-medium text-text">
              Privacy-friendly analytics
            </p>
            <p id="cookie-consent-body" className="text-[12px] leading-[1.5] text-text-muted">
              We use PostHog for anonymous event counts (demo runs, wallet connects) to see what
              actually gets used. No session replay, no cross-site tracking, no ads. Decline and
              nothing loads.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={decline}
              className="h-9 px-4 rounded-md border border-border-hover text-[12px] text-text-muted hover:bg-surface-2 transition-colors"
            >
              Decline
            </button>
            <button
              onClick={accept}
              className="h-9 px-4 rounded-md bg-purple text-[#0A0A0F] text-[12px] font-medium hover:shadow-[0_0_24px_rgba(167,139,250,0.4)] transition-shadow"
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

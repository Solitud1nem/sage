/**
 * Server-side analytics — anonymous, consent-gated PostHog capture (M11.x).
 *
 * The frontend already captures user clicks, but loses events once the tab
 * closes and never sees the ground truth (council verdicts, on-chain outcomes,
 * which executor ran, costs). This module lets the orchestrator emit those
 * authoritative lifecycle events directly to PostHog.
 *
 * Privacy posture (consent-gated per ADR-0006): the orchestrator only builds a
 * capturer when the frontend passed `analyticsConsent: true` for the run — the
 * server can't see the cookie banner, so consent rides in on the request.
 * Events carry only a random `run_id` (no person identifier, no PII) and set
 * `$process_person_profile: false`, so PostHog stores them as anonymous
 * operational telemetry rather than building person profiles.
 *
 * No-op when `POSTHOG_KEY` is unset (local dev / tests). Fire-and-forget: a
 * capture never blocks or throws into the request path.
 */

const KEY = process.env['POSTHOG_KEY'];
const HOST = process.env['POSTHOG_HOST'] ?? 'https://us.i.posthog.com';

/** A bound capture function: `(event, properties?) => void`. No-op stub when disabled. */
export type Capture = (event: string, properties?: Record<string, unknown>) => void;

const NOOP: Capture = () => {};

/**
 * Build a capturer bound to a run. Returns a no-op when analytics is disabled
 * (no key) or `enabled` is false (no consent for this run).
 *
 * @param distinctId  Stable id for the run — use the runId so PostHog funnels
 *                    count unique runs.
 * @param base        Properties merged into every event (e.g. run_id, chain).
 * @param enabled     Per-run consent flag.
 */
export function createCapture(
  distinctId: string,
  base: Record<string, unknown>,
  enabled: boolean,
): Capture {
  if (!KEY || !enabled) return NOOP;
  return (event, properties = {}) => {
    void fetch(`${HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: KEY,
        event,
        distinct_id: distinctId,
        properties: {
          ...base,
          ...properties,
          source: 'orchestrator',
          // Anonymous — don't create/update a PostHog person profile.
          $process_person_profile: false,
        },
      }),
    }).catch(() => {
      // Telemetry must never affect the run; swallow network errors.
    });
  };
}

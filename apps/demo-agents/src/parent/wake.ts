/**
 * Wake-ping client (ADR-0020 п.4): after `createTask`, the orchestrator pings
 * the executor's `/wake` endpoint so Fly auto_start boots the (scale-to-zero)
 * worker machine and its reconciler picks the task up on-chain.
 *
 * Strictly fire-and-forget and strictly best-effort:
 *   - a failed/lost ping is NOT an error — the worker's boot reconciliation
 *     and the plan-runner's re-ping (while a task sits in Created) recover it,
 *     with escrow-reclaim (CR.3) as the bottom-layer backstop;
 *   - the ping carries the taskId as a log hint only; the worker never trusts
 *     it (dispatch decisions are on-chain reads).
 *
 * Endpoint resolution is lazy: the executor address → endpoint map comes from
 * AgentRegistryV2, fetched once per waker (= once per plan-run) on the first
 * ping and cached. Executors without an http(s) endpoint — the legacy demo
 * workers among them — are simply never pinged, which is what keeps this
 * additive: with no resolvable endpoint the plan-runner behaves exactly as
 * before (pure 10s polling).
 */

import type { AgentRecordV2 } from '@sage/core';

export type WakeFn = (executorAddress: string, hint?: { taskId?: string }) => void;

export interface WakerOptions {
  /** One registry sweep, e.g. () => listActiveAgentsV2(publicClient, addr). */
  readonly fetchAgents: () => Promise<readonly AgentRecordV2[]>;
  /** Per-ping timeout. Default 3000ms. */
  readonly timeoutMs?: number;
  /** Test seam. */
  readonly fetchImpl?: typeof fetch;
  readonly log?: (msg: string) => void;
}

/** endpoint "https://host[/base]" → "https://host[/base]/wake" (idempotent). */
export function wakeUrl(endpoint: string): string | null {
  if (!/^https?:\/\//i.test(endpoint)) return null;
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.endsWith('/wake') ? trimmed : `${trimmed}/wake`;
}

export function createWaker(opts: WakerOptions): WakeFn {
  const log = opts.log ?? ((m: string) => console.error(`[parent.wake] ${m}`));
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 3000;

  // Lazy, memoized endpoint map. A failed fetch resolves to null and is NOT
  // retried within this waker — wake is an optimization, not a dependency.
  let endpointsPromise: Promise<Map<string, string> | null> | null = null;
  function endpoints(): Promise<Map<string, string> | null> {
    endpointsPromise ??= opts
      .fetchAgents()
      .then((agents) => {
        const map = new Map<string, string>();
        for (const agent of agents) {
          const url = wakeUrl(agent.endpoint);
          if (url) map.set(String(agent.id).toLowerCase(), url);
        }
        return map;
      })
      .catch((err) => {
        log(`registry endpoint lookup failed — wakes disabled for this run: ${String(err)}`);
        return null;
      });
    return endpointsPromise;
  }

  return (executorAddress, hint) => {
    void (async () => {
      const map = await endpoints();
      const url = map?.get(executorAddress.toLowerCase());
      if (!url) return; // no http endpoint — legacy worker or unregistered; nothing to wake
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(hint?.taskId ? { taskId: hint.taskId } : {}),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) log(`wake ${url} → HTTP ${res.status} (ignored)`);
      } catch (err) {
        log(`wake ${url} failed (ignored): ${String(err)}`);
      }
    })();
  };
}

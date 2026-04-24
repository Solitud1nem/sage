'use client';

import { useEffect, useState } from 'react';

/**
 * Fetches orchestrator /health once on mount so the frontend can show which
 * chain the demo backend is configured for (may differ from the user's wallet
 * chain — e.g. local-dev runs orchestrator on Sepolia while user has mainnet
 * wallet). Fixes the Watch-live chain honesty gap noted after M-INT.6.
 */

export interface OrchestratorInfo {
  status: 'ok' | 'degraded' | 'unreachable';
  chainId: number | null;
  chainName: string | null;
  explorerUrl: string | null;
  activeDemoRuns: number | null;
}

const ORCHESTRATOR_URL =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:3000';

const INITIAL: OrchestratorInfo = {
  status: 'degraded',
  chainId: null,
  chainName: null,
  explorerUrl: null,
  activeDemoRuns: null,
};

export function useOrchestratorInfo(): OrchestratorInfo {
  const [info, setInfo] = useState<OrchestratorInfo>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetch(`${ORCHESTRATOR_URL}/health`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as {
          status: string;
          chainId?: number;
          chainName?: string;
          explorerUrl?: string;
          activeDemoRuns?: number;
        };
      })
      .then((body) => {
        if (cancelled) return;
        setInfo({
          status: body.status === 'ok' ? 'ok' : 'degraded',
          chainId: body.chainId ?? null,
          chainName: body.chainName ?? null,
          explorerUrl: body.explorerUrl ?? null,
          activeDemoRuns: body.activeDemoRuns ?? null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setInfo({
          status: 'unreachable',
          chainId: null,
          chainName: null,
          explorerUrl: null,
          activeDemoRuns: null,
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return info;
}

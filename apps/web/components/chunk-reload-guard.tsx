'use client';

import { useEffect } from 'react';

/**
 * Recovers from `ChunkLoadError` after a deploy.
 *
 * Static-export builds hash every JS chunk by content, so each deploy produces
 * a new chunk set. A browser tab opened against an older deploy (or an
 * edge-cached stale HTML) references chunk hashes that no longer exist — a
 * lazy import then 404s and throws `ChunkLoadError`, crashing the view.
 *
 * This listens for that specific failure (via both `error` and
 * `unhandledrejection`, since lazy imports surface either way) and reloads the
 * page once, with a cache-busting query param to slip past any stale
 * edge-cached HTML. A short-window sessionStorage guard prevents a reload loop
 * if the fresh load still fails (e.g. the chunk is genuinely gone) — after one
 * attempt we stop and let the normal error surface.
 */

const RELOAD_FLAG = 'sage:chunk-reload-at';
const GUARD_WINDOW_MS = 20_000;

function isChunkLoadError(reason: unknown): boolean {
  if (!reason) return false;
  const name = typeof reason === 'object' && reason !== null ? (reason as { name?: unknown }).name : undefined;
  if (name === 'ChunkLoadError') return true;
  const msg =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : typeof reason === 'object' && reason !== null
          ? String((reason as { message?: unknown }).message ?? '')
          : '';
  return /Loading (?:chunk|CSS chunk) [^ ]+ failed|ChunkLoadError|error loading dynamically imported module/i.test(
    msg,
  );
}

function reloadOnce(): void {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) ?? '0');
    if (Date.now() - last < GUARD_WINDOW_MS) return; // already tried recently — don't loop
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    // sessionStorage blocked (private mode / extensions) — proceed best-effort.
  }
  const url = new URL(window.location.href);
  url.searchParams.set('_r', String(Date.now())); // cache-bust stale edge HTML
  window.location.replace(url.toString());
}

export function ChunkReloadGuard() {
  useEffect(() => {
    // Cosmetic: strip the cache-bust param from the address bar after a
    // successful recovery load (no navigation, just tidy the URL).
    if (typeof window !== 'undefined' && new URL(window.location.href).searchParams.has('_r')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('_r');
      window.history.replaceState(window.history.state, '', url.toString());
    }

    const onError = (e: ErrorEvent) => {
      if (isChunkLoadError(e.error ?? e.message)) reloadOnce();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkLoadError(e.reason)) reloadOnce();
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}

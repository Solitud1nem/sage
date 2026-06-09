import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerResponse } from 'node:http';

import { SseChannel, SseRegistry } from '../../src/shared/sse.js';

// ─── helpers ─────────────────────────────────────────────────────────────

function fakeResponse() {
  const headers: Record<string, unknown>[] = [];
  const chunks: string[] = [];
  let ended = false;
  const res = {
    writeHead(_status: number, h: Record<string, unknown>) {
      headers.push(h);
      return res;
    },
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    end() {
      ended = true;
    },
    on() {
      return res;
    },
  };
  return {
    res: res as unknown as ServerResponse,
    headers,
    chunks,
    get ended() {
      return ended;
    },
  };
}

// ─── attach() headers (CR.12 — no wildcard CORS) ─────────────────────────

describe('SseChannel.attach — headers', () => {
  it('does not set Access-Control-Allow-Origin (server-level allowlist is authoritative)', () => {
    const channel = new SseChannel('cors-test');
    const client = fakeResponse();
    channel.attach(client.res);

    expect(client.headers).toHaveLength(1);
    expect(client.headers[0]).not.toHaveProperty('Access-Control-Allow-Origin');
    expect(client.headers[0]).toMatchObject({ 'Content-Type': 'text/event-stream' });
    channel.close();
  });
});

// ─── registry GC (CR.12 — stuck-run backstop) ────────────────────────────

describe('SseRegistry — GC', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a recently-created open channel alive', async () => {
    const registry = new SseRegistry();
    const channel = registry.create('young-run');

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000); // 30 min
    expect(channel.isClosed).toBe(false);
    expect(registry.get('young-run')).toBe(channel);
  });

  it('force-closes an open channel past the lifetime ceiling, then deletes it', async () => {
    const registry = new SseRegistry();
    const channel = registry.create('stuck-run');
    const client = fakeResponse();
    channel.attach(client.res);

    // Past 2h ceiling → next GC sweep force-closes.
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 61_000);
    expect(channel.isClosed).toBe(true);
    // The attached client got a final `done` with the expiry error.
    expect(client.chunks.join('')).toContain('event: done');
    expect(client.chunks.join('')).toContain('channel expired');
    expect(client.ended).toBe(true);

    // Retention window after the forced close → entry is deleted.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 61_000);
    expect(registry.get('stuck-run')).toBeNull();
    expect(registry.size).toBe(0);
  });

  it('still deletes normally-closed channels after the retention window', async () => {
    const registry = new SseRegistry();
    const channel = registry.create('done-run');
    channel.close({ ok: true });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 61_000);
    expect(registry.get('done-run')).toBeNull();
  });

  it('a closed channel within retention stays reloadable', async () => {
    const registry = new SseRegistry();
    const channel = registry.create('reload-run');
    channel.close({ ok: true });

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000); // 2 min < 5 min retention
    expect(registry.get('reload-run')).toBe(channel);

    // A late client still gets the buffered terminal event.
    const client = fakeResponse();
    channel.attach(client.res);
    expect(client.chunks.join('')).toContain('event: done');
    expect(client.ended).toBe(true);
  });
});

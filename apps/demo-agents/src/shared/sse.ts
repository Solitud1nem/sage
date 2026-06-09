import type { ServerResponse } from 'node:http';

/**
 * Minimal Server-Sent Events primitive for one-way task-lifecycle streaming.
 *
 * Per ADR-0006: SSE over HTTP/2, not WebSocket — one-way event stream fits through
 * Cloudflare / Fly.io load balancers without persistent bidirectional state.
 *
 * Usage:
 *   const channel = new SseChannel();
 *   channel.attach(res);          // GET /api/demo/stream/:id
 *   channel.emit('task_created', { taskId, txHash });
 *   channel.close({ result });    // sends 'done' + closes all clients
 */
export class SseChannel {
  private clients = new Set<ServerResponse>();
  private eventId = 0;
  private closed = false;
  private pingInterval: NodeJS.Timeout | null = null;
  private readonly buffer: Array<{ id: number; event: string; data: string }> = [];

  constructor(public readonly id: string) {}

  /** Attach a new HTTP response as an SSE client. */
  attach(res: ServerResponse): void {
    // No Access-Control-Allow-Origin here (code review 2026-06-09, CR.12):
    // `writeHead` values override the server-level `setHeader` allowlist, so
    // a literal `*` made every stream world-readable from any browser origin.
    // The orchestrator sets ACAO for allowlisted origins before routing, and
    // the Worker gateway applies its own allowlist on passthrough.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Replay buffered events so late-connecting clients see prior history.
    // Closed channels still replay (terminal `done`/`error` is in the buffer)
    // so a browser reload after completion gets the final result.
    for (const ev of this.buffer) {
      this.writeEvent(res, ev.id, ev.event, ev.data);
    }

    if (this.closed) {
      res.end();
      return;
    }

    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));

    if (this.pingInterval === null) {
      this.pingInterval = setInterval(() => this.ping(), 15_000);
    }
  }

  /** Emit a named event with a JSON payload to all attached clients. */
  emit(event: string, data: unknown): void {
    if (this.closed) return;
    this.eventId += 1;
    const payload = JSON.stringify(data ?? null);
    this.buffer.push({ id: this.eventId, event, data: payload });
    for (const res of this.clients) {
      this.writeEvent(res, this.eventId, event, payload);
    }
  }

  /** Emit a final `done` event with optional payload, then close all connections. */
  close(finalPayload?: unknown): void {
    if (this.closed) return;
    this.emit('done', finalPayload ?? {});
    this.closed = true;
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    for (const res of this.clients) {
      res.end();
    }
    this.clients.clear();
  }

  get clientCount(): number {
    return this.clients.size;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private writeEvent(res: ServerResponse, id: number, event: string, data: string): void {
    try {
      res.write(`id: ${id}\n`);
      res.write(`event: ${event}\n`);
      res.write(`data: ${data}\n\n`);
    } catch {
      this.clients.delete(res);
    }
  }

  private ping(): void {
    for (const res of this.clients) {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        this.clients.delete(res);
      }
    }
  }
}

/**
 * In-memory registry of active demo-run channels, keyed by demoRunId.
 *
 * Channels auto-expire after `RETENTION_MS` post-close so reload of the demo
 * page can still retrieve the final result.
 */
export class SseRegistry {
  private readonly channels = new Map<
    string,
    { channel: SseChannel; createdAt: number; closedAt: number | null }
  >();
  private readonly RETENTION_MS = 5 * 60 * 1000; // 5 minutes post-close
  /**
   * Hard ceiling on a channel's lifetime (CR.12): a run that hangs without
   * ever reaching `close()` (crashed runner, eternal pause) used to keep its
   * channel in the map forever. 2h comfortably covers the worst legitimate
   * composite run (8 sub-tasks × 5-min timeout + review pauses ≈ 1h).
   */
  private readonly MAX_CHANNEL_AGE_MS = 2 * 60 * 60 * 1000;
  private gcInterval: NodeJS.Timeout | null = null;

  create(id: string): SseChannel {
    const channel = new SseChannel(id);
    const entry = { channel, createdAt: Date.now(), closedAt: null as number | null };
    this.channels.set(id, entry);
    // Stamp closedAt when the channel actually closes so the GC window is
    // measured post-close. Tracking createdAt instead would GC long-running
    // closed channels too early — a 4-minute run would only stay reloadable
    // for 1 minute after `done`.
    const originalClose = channel.close.bind(channel);
    channel.close = (finalPayload?: unknown) => {
      originalClose(finalPayload);
      entry.closedAt = Date.now();
    };
    this.ensureGc();
    return channel;
  }

  get(id: string): SseChannel | null {
    return this.channels.get(id)?.channel ?? null;
  }

  remove(id: string): void {
    this.channels.delete(id);
  }

  get size(): number {
    return this.channels.size;
  }

  private ensureGc(): void {
    if (this.gcInterval !== null) return;
    this.gcInterval = setInterval(() => this.gc(), 60_000);
    // Don't keep the process alive for the gc timer.
    this.gcInterval.unref?.();
  }

  private gc(): void {
    const now = Date.now();
    for (const [id, { channel, createdAt, closedAt }] of this.channels) {
      if (channel.isClosed && closedAt !== null && now - closedAt > this.RETENTION_MS) {
        this.channels.delete(id);
        continue;
      }
      // Stuck-run backstop (CR.12): force-close channels that never reached
      // `close()` within the lifetime ceiling. Attached clients get a final
      // `done` so they don't hang on a dead stream; the wrapped close stamps
      // `closedAt`, and the regular retention path deletes the entry on a
      // later sweep.
      if (!channel.isClosed && now - createdAt > this.MAX_CHANNEL_AGE_MS) {
        console.error(
          JSON.stringify({ ts: now, event: 'sse.gc.expired_open_channel', channelId: id }),
        );
        channel.close({ ok: false, error: 'channel expired (run never completed)' });
      }
    }
    if (this.channels.size === 0 && this.gcInterval) {
      clearInterval(this.gcInterval);
      this.gcInterval = null;
    }
  }
}

export const demoRegistry = new SseRegistry();

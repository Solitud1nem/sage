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
    if (this.closed) {
      res.writeHead(410, { 'Content-Type': 'text/plain' });
      res.end('stream closed');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*', // CORS handled at server level; this is a fallback.
    });

    // Replay buffered events so late-connecting clients see prior history.
    for (const ev of this.buffer) {
      this.writeEvent(res, ev.id, ev.event, ev.data);
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
  private readonly channels = new Map<string, { channel: SseChannel; createdAt: number }>();
  private readonly RETENTION_MS = 5 * 60 * 1000; // 5 minutes
  private gcInterval: NodeJS.Timeout | null = null;

  create(id: string): SseChannel {
    const channel = new SseChannel(id);
    this.channels.set(id, { channel, createdAt: Date.now() });
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
    for (const [id, { channel, createdAt }] of this.channels) {
      if (channel.isClosed && now - createdAt > this.RETENTION_MS) {
        this.channels.delete(id);
      }
    }
    if (this.channels.size === 0 && this.gcInterval) {
      clearInterval(this.gcInterval);
      this.gcInterval = null;
    }
  }
}

export const demoRegistry = new SseRegistry();

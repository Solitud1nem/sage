import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface BaseAgentOptions {
  name: string;
  port: number;
  onStart?: () => Promise<void>;
  onStop?: () => Promise<void>;
}

/**
 * Base agent with HTTP health endpoint and graceful shutdown.
 * All demo agents extend this pattern.
 */
export class BaseAgent {
  private server: ReturnType<typeof createServer> | null = null;
  private running = false;

  constructor(private readonly options: BaseAgentOptions) {}

  async start(): Promise<void> {
    const { name, port } = this.options;

    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', agent: name }));
        return;
      }

      this.handleRequest(req, res);
    });

    this.server.listen(port, () => {
      console.error(`[${name}] listening on port ${port}`);
    });

    this.running = true;

    if (this.options.onStart) {
      await this.options.onStart();
    }

    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  /** Override in subclasses for custom HTTP handling. */
  protected handleRequest(_req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(404);
    res.end('Not found');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    console.error(`[${this.options.name}] shutting down...`);

    if (this.options.onStop) {
      await this.options.onStop();
    }

    if (this.server) {
      this.server.close();
    }

    process.exit(0);
  }
}

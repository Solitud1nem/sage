/**
 * Generic worker — entry point (M12.0.2, ADR-0020 пп.3–4).
 *
 * One Fly process hosting N agent identities (wallet + capability + price
 * each). Lifecycle is wake-driven, not watch-driven:
 *
 *   boot ──► reconcile pass (scan-back catches tasks created while stopped)
 *   POST /wake ──► reconcile pass (coalesced, throttled)
 *   idle (no passes, no in-flight, IDLE_GRACE elapsed) ──► process.exit(0)
 *        └─ Fly stops the machine; auto_start boots it on the next wake.
 *   SIGTERM/SIGINT ──► drain: stop dispatching, wait for in-flight tasks
 *        (bounded by WORKER_DRAIN_TIMEOUT_MS < fly kill_timeout), exit.
 *
 * Scale-to-zero is implemented by the self-exit, NOT by Fly proxy autostop:
 * the proxy counts inbound connections, and a worker mid-LLM-task has none —
 * autostop would kill it mid-task. `fly.workers.toml` therefore sets
 * auto_stop_machines = "off" + auto_start_machines = true.
 *
 * The wake endpoint is advisory-only: the body's taskId is a log hint, never
 * a dispatch input — all dispatch decisions come from on-chain state (see
 * reconcile.ts). That is what makes a lost ping safe (boot scan-back) and a
 * hostile ping cheap (one bounded, throttled read sweep).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { taskId } from '@sage/core';
import { taskEscrowAbi } from '@sage/adapter-evm';

import { loadIdentities } from './identities.js';
import { buildWorkerRuntime, type WorkerRuntime } from './runtime.js';
import { HANDLERS } from './handlers/index.js';
import { ActivityTracker, executeTask } from './executor.js';
import { createReconciler, type TaskReader } from './reconcile.js';
import { makeArtifactStore, gatewayOriginFromRpcUrl, type ArtifactStore } from './artifacts.js';

const log = (msg: string) => console.error(`[worker] ${msg}`);

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Read a small JSON body; wake hints only, so cap hard and never throw. */
function readHint(req: IncomingMessage): Promise<{ taskId?: string }> {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      if (buf.length > 4096) {
        req.removeAllListeners('data');
        resolve({});
      }
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(buf) as { taskId?: unknown };
        resolve(typeof parsed.taskId === 'string' ? { taskId: parsed.taskId } : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function buildReader(runtime: WorkerRuntime): TaskReader {
  const first = runtime.runtimes[0]!;
  return {
    async nextTaskId() {
      return await runtime.publicClient.readContract({
        address: runtime.escrowAddress,
        abi: taskEscrowAbi,
        functionName: 'nextTaskId',
      });
    },
    async getTask(id: bigint) {
      return first.bundle.sage.tasks.getTask(taskId(id.toString()));
    },
  };
}

function main(): void {
  const identities = loadIdentities();
  const runtime = buildWorkerRuntime(identities);

  // Every hosted identity must have a handler for its capability — a worker
  // that would accept escrowed tasks it cannot execute must not boot.
  for (const rt of runtime.runtimes) {
    if (!HANDLERS[rt.identity.capability]) {
      throw new Error(
        `Identity "${rt.identity.id}" claims capability "${rt.identity.capability}" but no handler is registered.`,
      );
    }
  }

  const port = intEnv('PORT', 3100);
  const idleGraceMs = intEnv('WORKER_IDLE_GRACE_S', 90) * 1000; // 0 → idle-exit off (local dev)
  const drainTimeoutMs = intEnv('WORKER_DRAIN_TIMEOUT_MS', 110_000); // < fly kill_timeout (120s)

  const activity = new ActivityTracker();
  let draining = false;
  let activePasses = 0;

  // Artifact store (M12.1.1): needs the gateway origin + backend key. The
  // origin usually falls out of the proxied RPC_URL; ARTIFACTS_GATEWAY_URL
  // overrides for direct-node setups. Without both, handlers that produce
  // artifacts fail honestly instead of silently inlining megabytes on-chain.
  let artifacts: ArtifactStore | undefined;
  const gatewayUrl =
    process.env['ARTIFACTS_GATEWAY_URL'] ?? gatewayOriginFromRpcUrl(process.env['RPC_URL'] ?? '');
  const backendKey = process.env['SAGE_BACKEND_KEY'];
  if (gatewayUrl && backendKey) {
    artifacts = makeArtifactStore({ gatewayUrl, backendKey });
    log(`artifact store: ${gatewayUrl}/api/artifacts`);
  } else {
    log('artifact store DISABLED (no gateway url / backend key) — artifact-producing handlers will fail honestly');
  }

  const reconciler = createReconciler({
    reader: buildReader(runtime),
    addresses: new Set(runtime.byAddress.keys()),
    bootScanBack: intEnv('WORKER_BOOT_SCAN_BACK', 200),
    minScanIntervalMs: intEnv('WORKER_MIN_SCAN_INTERVAL_MS', 3000),
    isDraining: () => draining,
    dispatch: (id, task, resume) => {
      const rt = runtime.byAddress.get(String(task.executor).toLowerCase())!;
      return executeTask(rt, HANDLERS[rt.identity.capability]!, id, task, {
        activity,
        openaiApiKey: runtime.openaiApiKey,
        anthropicApiKey: runtime.anthropicApiKey,
        serperApiKey: runtime.serperApiKey,
        ...(artifacts ? { artifacts } : {}),
      }, resume);
    },
  });

  /** A running pass counts as busy for idle-exit even with zero in-flight tasks. */
  function trackedPass(reason: string): void {
    activePasses += 1;
    activity.touch();
    void reconciler.requestPass(reason).finally(() => {
      activePasses -= 1;
      activity.touch();
    });
  }

  const server = createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      json(res, 200, {
        status: draining ? 'draining' : 'ok',
        identities: runtime.runtimes.map((rt) => ({
          id: rt.identity.id,
          address: rt.address,
          capability: rt.identity.capability,
        })),
        inFlight: activity.inFlight,
        chain: runtime.chain,
      });
      return;
    }
    if (req.url === '/wake' && req.method === 'POST') {
      if (draining) {
        json(res, 503, { status: 'draining' });
        return;
      }
      void readHint(req).then((hint) => {
        log(`wake received${hint.taskId ? ` (hint: task ${hint.taskId})` : ''}`);
        trackedPass('wake');
        json(res, 202, { status: 'reconciling' });
      });
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port, () => {
    log(
      `listening on :${port} — chain ${runtime.chain}, identities: ` +
        runtime.runtimes.map((rt) => `${rt.identity.id}(${rt.address})`).join(', '),
    );
  });

  // Boot reconciliation — the scale-to-zero recovery path: anything created
  // while this machine was stopped is picked up here.
  trackedPass('boot');

  // Idle-exit: this is the "auto_stop" half of scale-to-zero. Fly's proxy
  // autostop is off (it can't see in-flight on-chain work) — we stop ourselves.
  if (idleGraceMs > 0) {
    const idleTimer = setInterval(() => {
      if (draining) return;
      if (activity.inFlight === 0 && activePasses === 0 && activity.idleForMs() >= idleGraceMs) {
        log(`idle for ${Math.round(activity.idleForMs() / 1000)}s — exiting for scale-to-zero`);
        server.close();
        process.exit(0);
      }
    }, 10_000);
    idleTimer.unref();
  }

  async function drain(signal: string): Promise<void> {
    if (draining) return;
    draining = true;
    log(`${signal} — draining (${activity.inFlight} in-flight, ${activePasses} passes)…`);
    const deadline = Date.now() + drainTimeoutMs;
    while ((activity.inFlight > 0 || activePasses > 0) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (activity.inFlight > 0) {
      log(`drain timeout with ${activity.inFlight} in-flight — tasks stay Accepted, next boot resumes them`);
    } else {
      log('drained clean');
    }
    server.close();
    process.exit(0);
  }
  process.on('SIGTERM', () => void drain('SIGTERM'));
  process.on('SIGINT', () => void drain('SIGINT'));
}

main();

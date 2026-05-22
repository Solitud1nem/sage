/**
 * Reliable replacement for `publicClient.watchContractEvent` — polls
 * `TaskEscrow.nextTaskId()` + `getTask(id)` directly instead of relying
 * on `eth_getLogs` filter-based subscription.
 *
 * Why: viem's `watchContractEvent` (both filter mode and `poll: true`
 * mode) doesn't deliver TaskCreated events on Arc testnet RPC, even
 * though raw `eth_getLogs` calls succeed for an address-only filter.
 * Likely Arc's `eth_getLogs` chokes on topic-filter or narrow-range
 * queries that viem emits. See GOTCHAS 2026-05-22.
 *
 * This helper sidesteps the event-log infrastructure entirely: read
 * `nextTaskId` on a fixed interval, iterate any new IDs, fetch each
 * task struct, dispatch only the ones assigned to `myAddress`. Same
 * UX as before; slightly more RPC reads per task creation (~3 reads:
 * one `nextTaskId`, one `getTask` for each new id) — fine within
 * existing quota budget per GOTCHAS 2026-05-13 (target <23k/day).
 *
 * Trade-off vs event watching: we lose the `client` arg that came as
 * an event topic. We re-derive it from the `getTask` struct's
 * `client` field — same value.
 */

import type { Abi, Address, PublicClient } from 'viem';

export interface TaskPollerOptions {
  publicClient: PublicClient;
  escrowAddress: Address;
  /** TaskEscrow ABI — must include `nextTaskId()` and `getTask(uint256)`. */
  abi: Abi;
  /** Worker EOA — dispatch only for tasks where `executor == myAddress`. */
  myAddress: Address;
  pollIntervalMs: number;
  /** Called once per new task that names us as executor. */
  onTaskForMe: (
    taskId: bigint,
    client: Address,
    executor: Address,
  ) => void | Promise<void>;
  /** Optional tag for log lines so multiple pollers in one app are distinguishable. */
  tag?: string;
}

interface TaskStruct {
  client: Address;
  executor: Address;
  amount: bigint;
  deadline: bigint;
  status: number;
  specUri: string;
  resultUri: string;
  completedAt: bigint;
}

/**
 * Starts a recurring poll. Returns a stop function (matches the
 * `watchContractEvent` callback API surface so swap-in is local).
 */
export function pollNewTasks(opts: TaskPollerOptions): () => void {
  const tag = opts.tag ?? 'task-poller';
  let lastSeen: bigint | null = null;
  let stopped = false;

  const readNext = async (): Promise<bigint> => {
    return (await opts.publicClient.readContract({
      address: opts.escrowAddress,
      abi: opts.abi,
      functionName: 'nextTaskId',
    })) as bigint;
  };

  const readTask = async (id: bigint): Promise<TaskStruct> => {
    return (await opts.publicClient.readContract({
      address: opts.escrowAddress,
      abi: opts.abi,
      functionName: 'getTask',
      args: [id],
    })) as TaskStruct;
  };

  // Seed `lastSeen` from current `nextTaskId` so we don't try to handle
  // historical tasks on startup. Failure here is non-fatal — the first
  // successful tick will set it.
  void (async () => {
    try {
      lastSeen = await readNext();
      console.error(`[${tag}] seeded at nextTaskId=${lastSeen}`);
    } catch (err) {
      console.error(`[${tag}] failed to seed nextTaskId at startup:`, err);
    }
  })();

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const current = await readNext();
      if (lastSeen === null) {
        lastSeen = current;
        return;
      }
      for (let id = lastSeen; id < current; id++) {
        const task = await readTask(id);
        if (task.executor.toLowerCase() === opts.myAddress.toLowerCase()) {
          await opts.onTaskForMe(id, task.client, task.executor);
        }
      }
      lastSeen = current;
    } catch (err) {
      console.error(`[${tag}] poll tick failed:`, err);
    }
  };

  const intervalId = setInterval(() => {
    void tick();
  }, opts.pollIntervalMs);

  return () => {
    stopped = true;
    clearInterval(intervalId);
  };
}

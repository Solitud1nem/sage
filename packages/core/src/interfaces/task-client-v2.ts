/**
 * Chain-agnostic interface for the V2 task-escrow surface (per ADR-0017).
 *
 * Adds three operations on top of the v1 `TaskClient`:
 *   - `resolveDispute` — arbiter-only exit from `Disputed`.
 *   - `setArbiter`     — owner-only rotation of the arbiter address.
 *   - `getArbiter`     — view the current arbiter (anyone).
 *
 * All v1 operations are inherited unchanged. Adapters that target a v2
 * contract (e.g. `@sage/adapter-evm` `createTaskEscrowV2Client`) return
 * this interface; the existing v1 `TaskClient` is preserved for legacy
 * contracts and chain-specific adapters that don't expose arbitration.
 */

import type { DisputeOutcome, TaskId } from '../types/task.js';
import type { TaskClient } from './task-client.js';

export interface TaskClientV2 extends TaskClient {
  /**
   * Resolve a disputed task. Callable only by the configured arbiter.
   * Transitions: Disputed → Paid | Refunded | Split.
   *
   * @param taskId        Task to resolve. Must be in `Disputed` status.
   * @param outcome       One of `Paid` (full to executor), `Refunded`
   *                      (full to client), or `Split` (partial — see
   *                      `executorShare`).
   * @param executorShare USDC base units to award the executor when
   *                      `outcome === Split` (strict bounds:
   *                      `0n < executorShare < taskAmount`). MUST be `0n`
   *                      for `Paid` and `Refunded` outcomes.
   * @returns Transaction hash.
   */
  resolveDispute(
    taskId: TaskId,
    outcome: DisputeOutcome,
    executorShare: bigint,
  ): Promise<string>;

  /**
   * Rotate the arbiter address. Callable only by the contract owner.
   * @param newArbiter New arbiter EOA (must be non-zero).
   * @returns Transaction hash.
   */
  setArbiter(newArbiter: `0x${string}`): Promise<string>;

  /**
   * Read the current arbiter address. View, no transaction.
   */
  getArbiter(): Promise<`0x${string}`>;
}

/**
 * Chain-agnostic interface for task escrow operations.
 *
 * Adapters implement this interface to provide chain-specific
 * task lifecycle management (create, accept, complete, pay, dispute, refund).
 */

import type { TaskId, TaskRecord, TaskSpec } from '../types/task.js';

/** Task escrow operations. Implemented by chain-specific adapters. */
export interface TaskClient {
  /**
   * Create a new task with USDC locked in escrow.
   * On EVM: includes EIP-2612 permit for single-tx UX.
   * @returns The new task ID.
   */
  createTask(spec: TaskSpec): Promise<TaskId>;

  /**
   * Accept an assigned task (executor only).
   * Transitions: Created → Accepted.
   * @returns The transaction hash.
   */
  acceptTask(taskId: TaskId): Promise<string>;

  /**
   * Mark a task as complete and submit the result (executor only).
   * Transitions: Accepted → Completed.
   * @param resultUri - URI pointing to the task result.
   * @returns The transaction hash.
   */
  completeTask(taskId: TaskId, resultUri: string): Promise<string>;

  /**
   * Approve payment and release USDC to executor (client only).
   * Transitions: Completed → Paid.
   * @returns The transaction hash.
   */
  approvePayment(taskId: TaskId): Promise<string>;

  /**
   * Dispute a completed task (client only).
   * Cancels the grace-period auto-release.
   * Transitions: Completed → Disputed.
   * @param reason - Human-readable dispute reason.
   * @returns The transaction hash.
   */
  disputeTask(taskId: TaskId, reason: string): Promise<string>;

  /**
   * Trigger refund for an expired task (callable by anyone).
   * Only works if deadline has passed and task is in Created or Accepted.
   * Transitions: Created|Accepted → Refunded.
   * @returns The transaction hash.
   */
  refundExpired(taskId: TaskId): Promise<string>;

  /**
   * Claim auto-release of USDC after grace period (executor only).
   * Only works if task is Completed, grace period elapsed, and no dispute.
   * Transitions: Completed → Paid.
   * @returns The transaction hash.
   */
  claimAutoRelease(taskId: TaskId): Promise<string>;

  /**
   * Get the on-chain record for a specific task.
   * @returns The task record, or null if not found.
   */
  getTask(taskId: TaskId): Promise<TaskRecord | null>;
}

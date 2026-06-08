/**
 * Task-related types for the Sage protocol.
 *
 * Chain-agnostic — adapters map these to chain-native representations.
 */

import type { AgentId } from './agent.js';

/** Opaque task identifier. On EVM this is a uint256; adapters handle conversion. */
export type TaskId = string & { readonly __brand: 'TaskId' };

/** Creates a branded TaskId from a raw string. */
export function taskId(raw: string): TaskId {
  return raw as TaskId;
}

/**
 * Lifecycle status of a task in the escrow.
 *
 * v2 transitions (TaskEscrow at sage:escrow:v1):
 * - Created → Accepted | Expired
 * - Accepted → Completed | Expired
 * - Completed → Paid | Disputed
 * - Disputed → (no exit — frozen permanently)
 *
 * v3 transitions add arbitration (TaskEscrowV2 at sage:escrow:v2, ADR-0017):
 * - Disputed → Paid | Refunded | Split (via arbiter resolveDispute)
 * - `Refunded` is reachable ONLY through arbiter ruling; `Expired` is the
 *   deadline-driven terminal. They are distinct on purpose.
 * - `Split` is a new terminal where executor + client each receive a portion;
 *   the partition is in `TaskRecord.executorShare`.
 */
export enum TaskStatus {
  /** Task created, USDC locked in escrow. Waiting for executor to accept. */
  Created = 'Created',
  /** Executor accepted the task. Work in progress. */
  Accepted = 'Accepted',
  /** Executor marked work as complete. Waiting for client approval or dispute. */
  Completed = 'Completed',
  /** USDC released to executor (terminal). Reached via approvePayment,
   *  claimAutoRelease, OR (v3 only) resolveDispute(outcome=Paid). */
  Paid = 'Paid',
  /** Client disputed the result. v2: frozen. v3: awaiting arbiter ruling. */
  Disputed = 'Disputed',
  /** USDC returned to client. v3 only: reached ONLY via resolveDispute(outcome=Refunded). */
  Refunded = 'Refunded',
  /** Deadline passed without completion. USDC returned to client. Terminal. */
  Expired = 'Expired',
  /** Arbiter awarded partial USDC to each party (terminal, v3 only). See `executorShare`. */
  Split = 'Split',
}

/**
 * Outcomes available to the arbiter when resolving a dispute (v3 / ADR-0017).
 * Subset of `TaskStatus` — passed as the `outcome` argument to `resolveDispute`.
 */
export type DisputeOutcome = TaskStatus.Paid | TaskStatus.Refunded | TaskStatus.Split;

/** On-chain task record as stored in the TaskEscrow contract. */
export interface TaskRecord {
  /** Unique task identifier. */
  readonly id: TaskId;
  /** Address/id of the client who created and funded the task. */
  readonly client: AgentId;
  /** Address/id of the executor assigned to perform the task. */
  readonly executor: AgentId;
  /** Amount locked in escrow (in smallest token unit, e.g. USDC with 6 decimals). */
  readonly amount: bigint;
  /** Unix timestamp (seconds) — deadline for task completion. */
  readonly deadline: number;
  /** Current lifecycle status. */
  readonly status: TaskStatus;
  /** URI pointing to the task specification (IPFS or HTTPS). */
  readonly specUri: string;
  /** URI pointing to the task result. Empty until executor completes. */
  readonly resultUri: string;
  /** Unix timestamp (seconds) when executor called completeTask. 0 if not completed. */
  readonly completedAt: number;
  /**
   * USDC awarded to executor on Split resolution (v3 only). 0 for all non-Split
   * terminals. Client received `amount - executorShare`. Always 0 when reading
   * from a v2 contract — the field is part of v3's Task struct only.
   */
  readonly executorShare: bigint;
}

/** Parameters for creating a new task. */
export interface TaskSpec {
  /** Executor agent to assign the task to. */
  readonly executor: AgentId;
  /** Unix timestamp (seconds) — deadline for completion. */
  readonly deadline: number;
  /** Amount to lock in escrow (smallest token unit). */
  readonly amount: bigint;
  /** URI pointing to the full task specification. */
  readonly specUri: string;
}

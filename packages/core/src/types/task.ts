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
 * Valid transitions:
 * - Created → Accepted | Expired | Refunded
 * - Accepted → Completed | Expired | Refunded
 * - Completed → Paid | Disputed
 * - Disputed → Paid | Refunded (v3: arbitration)
 */
export enum TaskStatus {
  /** Task created, USDC locked in escrow. Waiting for executor to accept. */
  Created = 'Created',
  /** Executor accepted the task. Work in progress. */
  Accepted = 'Accepted',
  /** Executor marked work as complete. Waiting for client approval or dispute. */
  Completed = 'Completed',
  /** Client approved; USDC released to executor. Terminal. */
  Paid = 'Paid',
  /** Client disputed the result. Grace-period auto-release cancelled. */
  Disputed = 'Disputed',
  /** USDC returned to client (deadline expired or dispute resolved). Terminal. */
  Refunded = 'Refunded',
  /** Deadline passed without completion. USDC returned to client. Terminal. */
  Expired = 'Expired',
}

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

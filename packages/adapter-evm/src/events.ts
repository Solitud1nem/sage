/**
 * Event subscription helpers for Sage contracts.
 * Uses viem's watchContractEvent for real-time event streaming.
 */

import type { PublicClient, WatchContractEventReturnType } from 'viem';
import { agentRegistryAbi } from './abi/index.js';
import { taskEscrowAbi } from './abi/index.js';

export type UnwatchFn = WatchContractEventReturnType;

export interface SageEventSubscriptions {
  /** Watch for new agent registrations. */
  onAgentRegistered(
    callback: (agent: `0x${string}`, endpoint: string) => void,
  ): UnwatchFn;

  /** Watch for agent profile updates. */
  onAgentUpdated(
    callback: (agent: `0x${string}`, endpoint: string) => void,
  ): UnwatchFn;

  /** Watch for new task creation. */
  onTaskCreated(
    callback: (taskId: bigint, client: `0x${string}`, executor: `0x${string}`, amount: bigint) => void,
  ): UnwatchFn;

  /** Watch for task acceptance. */
  onTaskAccepted(
    callback: (taskId: bigint, executor: `0x${string}`) => void,
  ): UnwatchFn;

  /** Watch for task completion. */
  onTaskCompleted(
    callback: (taskId: bigint, resultUri: string) => void,
  ): UnwatchFn;

  /** Watch for task payment. */
  onTaskPaid(callback: (taskId: bigint) => void): UnwatchFn;

  /** Watch for task disputes. */
  onTaskDisputed(callback: (taskId: bigint, reason: string) => void): UnwatchFn;

  /** Watch for task expiry/refund. */
  onTaskExpired(callback: (taskId: bigint) => void): UnwatchFn;
}

/** Tuning for the underlying viem `watchContractEvent` polling. */
export interface EventSubscriptionOptions {
  /**
   * Poll interval (ms). Floored at 10_000 — sub-10s polling once blew a
   * Cloudflare Workers daily quota (GOTCHAS 2026-05-13), so the SDK refuses to
   * hand a consumer the dangerous viem default (~4s on a 2s-block chain).
   */
  readonly pollingInterval?: number;
  /**
   * Called when viem's watcher hits a transport/polling error. Without it viem
   * swallows the error and the stream goes silent with no signal. Defaults to a
   * console.error so a dead RPC is at least visible.
   */
  readonly onError?: (error: Error) => void;
}

const MIN_POLLING_INTERVAL_MS = 10_000;

export function createEventSubscriptions(
  publicClient: PublicClient,
  registryAddress: `0x${string}`,
  escrowAddress: `0x${string}`,
  options: EventSubscriptionOptions = {},
): SageEventSubscriptions {
  const pollingInterval = Math.max(
    options.pollingInterval ?? MIN_POLLING_INTERVAL_MS,
    MIN_POLLING_INTERVAL_MS,
  );
  const onError =
    options.onError ?? ((error: Error) => console.error('[sage:events] watcher error:', error));

  return {
    onAgentRegistered(callback) {
      return publicClient.watchContractEvent({
        address: registryAddress,
        abi: agentRegistryAbi,
        eventName: 'AgentRegistered',
        pollingInterval,
        onError,
        onLogs(logs) {
          for (const log of logs) {
            callback(log.args.agent!, log.args.endpoint!);
          }
        },
      });
    },

    onAgentUpdated(callback) {
      return publicClient.watchContractEvent({
        address: registryAddress,
        abi: agentRegistryAbi,
        eventName: 'AgentUpdated',
        pollingInterval,
        onError,
        onLogs(logs) {
          for (const log of logs) {
            callback(log.args.agent!, log.args.endpoint!);
          }
        },
      });
    },

    onTaskCreated(callback) {
      return publicClient.watchContractEvent({
        address: escrowAddress,
        abi: taskEscrowAbi,
        eventName: 'TaskCreated',
        pollingInterval,
        onError,
        onLogs(logs) {
          for (const log of logs) {
            callback(log.args.taskId!, log.args.client!, log.args.executor!, log.args.amount!);
          }
        },
      });
    },

    onTaskAccepted(callback) {
      return publicClient.watchContractEvent({
        address: escrowAddress,
        abi: taskEscrowAbi,
        eventName: 'TaskAccepted',
        pollingInterval,
        onError,
        onLogs(logs) {
          for (const log of logs) {
            callback(log.args.taskId!, log.args.executor!);
          }
        },
      });
    },

    onTaskCompleted(callback) {
      return publicClient.watchContractEvent({
        address: escrowAddress,
        abi: taskEscrowAbi,
        eventName: 'TaskCompleted',
        pollingInterval,
        onError,
        onLogs(logs) {
          for (const log of logs) {
            callback(log.args.taskId!, log.args.resultUri!);
          }
        },
      });
    },

    onTaskPaid(callback) {
      return publicClient.watchContractEvent({
        address: escrowAddress,
        abi: taskEscrowAbi,
        eventName: 'TaskPaid',
        pollingInterval,
        onError,
        onLogs(logs) {
          for (const log of logs) {
            callback(log.args.taskId!);
          }
        },
      });
    },

    onTaskDisputed(callback) {
      return publicClient.watchContractEvent({
        address: escrowAddress,
        abi: taskEscrowAbi,
        eventName: 'TaskDisputed',
        pollingInterval,
        onError,
        onLogs(logs) {
          for (const log of logs) {
            callback(log.args.taskId!, log.args.reason!);
          }
        },
      });
    },

    onTaskExpired(callback) {
      return publicClient.watchContractEvent({
        address: escrowAddress,
        abi: taskEscrowAbi,
        eventName: 'TaskExpired',
        pollingInterval,
        onError,
        onLogs(logs) {
          for (const log of logs) {
            callback(log.args.taskId!);
          }
        },
      });
    },
  };
}

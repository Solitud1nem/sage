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

export function createEventSubscriptions(
  publicClient: PublicClient,
  registryAddress: `0x${string}`,
  escrowAddress: `0x${string}`,
): SageEventSubscriptions {
  return {
    onAgentRegistered(callback) {
      return publicClient.watchContractEvent({
        address: registryAddress,
        abi: agentRegistryAbi,
        eventName: 'AgentRegistered',
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
        onLogs(logs) {
          for (const log of logs) {
            callback(log.args.taskId!);
          }
        },
      });
    },
  };
}

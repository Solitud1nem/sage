import type { PublicClient, WalletClient } from 'viem';
import type { TaskId, TaskRecord, TaskSpec } from '@sage/core';
import type { TaskClient } from '@sage/core';
import { agentId, taskId, TaskStatus } from '@sage/core';
import { taskEscrowAbi } from './abi/index.js';

/** Maps on-chain TaskStatus enum (uint8) to SDK TaskStatus. */
const STATUS_MAP: Record<number, TaskStatus> = {
  0: TaskStatus.Created,
  1: TaskStatus.Accepted,
  2: TaskStatus.Completed,
  3: TaskStatus.Paid,
  4: TaskStatus.Disputed,
  5: TaskStatus.Refunded,
  6: TaskStatus.Expired,
};

export function createTaskEscrowClient(
  publicClient: PublicClient,
  walletClient: WalletClient,
  escrowAddress: `0x${string}`,
  usdcAddress: `0x${string}`,
): TaskClient {
  async function signPermit(amount: bigint): Promise<{
    value: bigint;
    deadline: bigint;
    v: number;
    r: `0x${string}`;
    s: `0x${string}`;
  }> {
    const account = walletClient.account;
    if (!account) throw new Error('WalletClient must have an account');

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const nonce = await publicClient.readContract({
      address: usdcAddress,
      abi: [
        {
          name: 'nonces',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'owner', type: 'address' }],
          outputs: [{ name: '', type: 'uint256' }],
        },
      ] as const,
      functionName: 'nonces',
      args: [account.address],
    });

    const name = await publicClient.readContract({
      address: usdcAddress,
      abi: [
        {
          name: 'name',
          type: 'function',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ name: '', type: 'string' }],
        },
      ] as const,
      functionName: 'name',
    });

    const chainId = await publicClient.getChainId();

    const signature = await walletClient.signTypedData({
      account,
      domain: {
        name,
        version: '2',
        chainId,
        verifyingContract: usdcAddress,
      },
      types: {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Permit',
      message: {
        owner: account.address,
        spender: escrowAddress,
        value: amount,
        nonce,
        deadline,
      },
    });

    const r = `0x${signature.slice(2, 66)}` as `0x${string}`;
    const s = `0x${signature.slice(66, 130)}` as `0x${string}`;
    const v = parseInt(signature.slice(130, 132), 16);

    return { value: amount, deadline, v, r, s };
  }

  return {
    async createTask(spec: TaskSpec): Promise<TaskId> {
      const permit = await signPermit(spec.amount);

      const hash = await walletClient.writeContract({
        address: escrowAddress,
        abi: taskEscrowAbi,
        functionName: 'createTask',
        args: [
          spec.executor as `0x${string}`,
          BigInt(spec.deadline),
          spec.amount,
          spec.specUri,
          {
            value: permit.value,
            deadline: permit.deadline,
            v: permit.v,
            r: permit.r,
            s: permit.s,
          },
        ],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Extract taskId from TaskCreated event
      const taskCreatedTopic = '0x7407b0ef416b5ba5fe0caf5447bb4b7bbbd2adc61093638361dd31a28b14fc5c';
      const log = receipt.logs.find((l) => l.topics[0] === taskCreatedTopic);
      if (!log?.topics[1]) {
        throw new Error('TaskCreated event not found in receipt');
      }
      const id = BigInt(log.topics[1]).toString();
      return taskId(id);
    },

    async acceptTask(id: TaskId) {
      const hash = await walletClient.writeContract({
        address: escrowAddress,
        abi: taskEscrowAbi,
        functionName: 'acceptTask',
        args: [BigInt(id)],
      });
      return hash;
    },

    async completeTask(id: TaskId, resultUri: string) {
      const hash = await walletClient.writeContract({
        address: escrowAddress,
        abi: taskEscrowAbi,
        functionName: 'completeTask',
        args: [BigInt(id), resultUri],
      });
      return hash;
    },

    async approvePayment(id: TaskId) {
      const hash = await walletClient.writeContract({
        address: escrowAddress,
        abi: taskEscrowAbi,
        functionName: 'approvePayment',
        args: [BigInt(id)],
      });
      return hash;
    },

    async disputeTask(id: TaskId, reason: string) {
      const hash = await walletClient.writeContract({
        address: escrowAddress,
        abi: taskEscrowAbi,
        functionName: 'disputeTask',
        args: [BigInt(id), reason],
      });
      return hash;
    },

    async refundExpired(id: TaskId) {
      const hash = await walletClient.writeContract({
        address: escrowAddress,
        abi: taskEscrowAbi,
        functionName: 'refundExpired',
        args: [BigInt(id)],
      });
      return hash;
    },

    async claimAutoRelease(id: TaskId) {
      const hash = await walletClient.writeContract({
        address: escrowAddress,
        abi: taskEscrowAbi,
        functionName: 'claimAutoRelease',
        args: [BigInt(id)],
      });
      return hash;
    },

    async getTask(id: TaskId): Promise<TaskRecord | null> {
      const result = await publicClient.readContract({
        address: escrowAddress,
        abi: taskEscrowAbi,
        functionName: 'getTask',
        args: [BigInt(id)],
      });

      if (result.client === '0x0000000000000000000000000000000000000000') {
        return null;
      }

      return {
        id,
        client: agentId(result.client),
        executor: agentId(result.executor),
        amount: result.amount,
        deadline: Number(result.deadline),
        status: STATUS_MAP[result.status] ?? TaskStatus.Created,
        specUri: result.specUri,
        resultUri: result.resultUri,
        completedAt: Number(result.completedAt),
      };
    },
  };
}

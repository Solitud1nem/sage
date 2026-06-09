/**
 * EVM adapter for the V2 TaskEscrow contract (per ADR-0017).
 *
 * Same surface as `task-escrow.ts` plus three new methods:
 *   - `resolveDispute(taskId, outcome, executorShare)` — arbiter-only exit
 *     from `Disputed`. Outcome ∈ {Paid, Refunded, Split}.
 *   - `setArbiter(newArbiter)` — owner-only rotation.
 *   - `getArbiter()`           — view current arbiter address.
 *
 * `getTask` returns a `TaskRecord` with the V2-specific `executorShare`
 * populated (0n unless status === Split). All v1 read/write paths behave
 * identically to the v1 adapter — only the ABI and one returned field differ.
 *
 * Use this client when the configured `escrowAddress` points at a v3.0
 * deployment (salt: `keccak256("sage:escrow:v2")`). For legacy v1 contracts,
 * `createTaskEscrowClient` from `./task-escrow.js` remains the choice.
 */

import type { Account, Chain, PublicClient, Transport, WalletClient } from 'viem';
import type { DisputeOutcome, TaskClientV2, TaskId, TaskRecord, TaskSpec } from '@sage/core';
import { agentId, taskId, TaskStatus } from '@sage/core';
import { taskEscrowV2Abi } from './abi/index.js';

type BoundWalletClient = WalletClient<Transport, Chain, Account>;

/** Maps on-chain V2 TaskStatus enum (uint8) to SDK TaskStatus. Includes `Split` at 7. */
const STATUS_MAP_V2: Record<number, TaskStatus> = {
  0: TaskStatus.Created,
  1: TaskStatus.Accepted,
  2: TaskStatus.Completed,
  3: TaskStatus.Paid,
  4: TaskStatus.Disputed,
  5: TaskStatus.Refunded,
  6: TaskStatus.Expired,
  7: TaskStatus.Split,
};

/**
 * Decode an on-chain status uint8 (V2/V3). Throws on an unmapped value instead
 * of the old `?? Created` fallback that silently reported an unknown status as
 * an active state — see the v1 client's `decodeStatus` and code review
 * 2026-06-09.
 */
function decodeStatusV2(raw: number): TaskStatus {
  const status = STATUS_MAP_V2[raw];
  if (status === undefined) {
    throw new Error(`Unknown on-chain TaskStatus ${raw} — SDK/contract version mismatch`);
  }
  return status;
}

/** Maps SDK `DisputeOutcome` to the on-chain uint8 expected by `resolveDispute`. */
const OUTCOME_TO_UINT8: Record<DisputeOutcome, number> = {
  [TaskStatus.Paid]: 3,
  [TaskStatus.Refunded]: 5,
  [TaskStatus.Split]: 7,
};

export function createTaskEscrowV2Client(
  publicClient: PublicClient,
  walletClient: BoundWalletClient,
  escrowAddress: `0x${string}`,
  usdcAddress: `0x${string}`,
): TaskClientV2 {
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
        abi: taskEscrowV2Abi,
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

      // TaskCreated event signature topic — same as v1 (event shape unchanged).
      // Match the escrow address too so a same-tx event with an identical
      // signature can't shadow ours.
      const taskCreatedTopic = '0x7407b0ef416b5ba5fe0caf5447bb4b7bbbd2adc61093638361dd31a28b14fc5c';
      const log = receipt.logs.find(
        (l) =>
          l.topics[0] === taskCreatedTopic &&
          l.address.toLowerCase() === escrowAddress.toLowerCase(),
      );
      if (!log?.topics[1]) {
        throw new Error('TaskCreated event not found in receipt');
      }
      const id = BigInt(log.topics[1]).toString();
      return taskId(id);
    },

    async acceptTask(id: TaskId) {
      return walletClient.writeContract({
        address: escrowAddress,
        abi: taskEscrowV2Abi,
        functionName: 'acceptTask',
        args: [BigInt(id)],
      });
    },

    async completeTask(id: TaskId, resultUri: string) {
      return walletClient.writeContract({
        address: escrowAddress,
        abi: taskEscrowV2Abi,
        functionName: 'completeTask',
        args: [BigInt(id), resultUri],
      });
    },

    async approvePayment(id: TaskId) {
      return walletClient.writeContract({
        address: escrowAddress,
        abi: taskEscrowV2Abi,
        functionName: 'approvePayment',
        args: [BigInt(id)],
      });
    },

    async disputeTask(id: TaskId, reason: string) {
      return walletClient.writeContract({
        address: escrowAddress,
        abi: taskEscrowV2Abi,
        functionName: 'disputeTask',
        args: [BigInt(id), reason],
      });
    },

    async refundExpired(id: TaskId) {
      return walletClient.writeContract({
        address: escrowAddress,
        abi: taskEscrowV2Abi,
        functionName: 'refundExpired',
        args: [BigInt(id)],
      });
    },

    async claimAutoRelease(id: TaskId) {
      return walletClient.writeContract({
        address: escrowAddress,
        abi: taskEscrowV2Abi,
        functionName: 'claimAutoRelease',
        args: [BigInt(id)],
      });
    },

    // ─── V2 arbitration surface ───

    async resolveDispute(id: TaskId, outcome: DisputeOutcome, executorShare: bigint) {
      return walletClient.writeContract({
        address: escrowAddress,
        abi: taskEscrowV2Abi,
        functionName: 'resolveDispute',
        args: [BigInt(id), OUTCOME_TO_UINT8[outcome], executorShare],
      });
    },

    async setArbiter(newArbiter: `0x${string}`) {
      return walletClient.writeContract({
        address: escrowAddress,
        abi: taskEscrowV2Abi,
        functionName: 'setArbiter',
        args: [newArbiter],
      });
    },

    async getArbiter() {
      return publicClient.readContract({
        address: escrowAddress,
        abi: taskEscrowV2Abi,
        functionName: 'arbiter',
      });
    },

    async getTask(id: TaskId): Promise<TaskRecord | null> {
      const result = await publicClient.readContract({
        address: escrowAddress,
        abi: taskEscrowV2Abi,
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
        status: decodeStatusV2(result.status),
        specUri: result.specUri,
        resultUri: result.resultUri,
        completedAt: Number(result.completedAt),
        executorShare: result.executorShare,
      };
    },
  };
}

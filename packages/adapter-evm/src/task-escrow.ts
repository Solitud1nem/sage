import type { Account, Chain, PublicClient, Transport, WalletClient } from 'viem';
import type { TaskId, TaskRecord, TaskSpec } from '@sage/core';
import type { TaskClient } from '@sage/core';
import { agentId, taskId, TaskStatus } from '@sage/core';
import { taskEscrowAbi } from './abi/index.js';
import { createPermitSigner, type PermitSignature } from './permit.js';
import { createAllowanceEnsurer, ZERO_PERMIT } from './approve.js';

/**
 * WalletClient with chain + account bound. Required for `writeContract` to
 * type-check without an explicit `chain` parameter at every call site
 * (see GOTCHAS 2026-05-19). Callers must pass a walletClient created with
 * `createWalletClient({ chain, account, … })`.
 */
type BoundWalletClient = WalletClient<Transport, Chain, Account>;

/** Maps on-chain TaskStatus enum (uint8) to SDK TaskStatus.
 *  Includes Split (7) so this v1 client correctly classifies tasks read
 *  from a v3 contract — `chains/base.ts` `taskEscrow` post-cutover points
 *  at TaskEscrowV2, and v1 / v3 contracts share the first 8 status values
 *  by design. executorShare is not surfaced via this client (use
 *  createTaskEscrowV2Client for that). */
const STATUS_MAP: Record<number, TaskStatus> = {
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
 * Decode an on-chain status uint8. The map covers every value the deployed
 * contracts emit (0-7); a value outside that range means the SDK is reading a
 * newer contract than it knows. Throw rather than the old `?? Created`
 * fallback, which silently reported an unknown status as an *active* state —
 * the "cutover ≠ address swap" failure class (see GOTCHAS / code review
 * 2026-06-09). A loud failure is recoverable; a fake Created is not.
 */
function decodeStatus(raw: number): TaskStatus {
  const status = STATUS_MAP[raw];
  if (status === undefined) {
    throw new Error(`Unknown on-chain TaskStatus ${raw} — SDK/contract version mismatch`);
  }
  return status;
}

export interface TaskEscrowClientOptions {
  /**
   * `false` = the settlement token has no EIP-2612 permit (WMON on Monad,
   * ADR-0026): `createTask` ensures an allowance via `approve` and passes a
   * zeroed PermitData instead of signing. Default `true` (USDC posture).
   */
  readonly permit?: boolean;
}

export function createTaskEscrowClient(
  publicClient: PublicClient,
  walletClient: BoundWalletClient,
  escrowAddress: `0x${string}`,
  usdcAddress: `0x${string}`,
  opts?: TaskEscrowClientOptions,
): TaskClient {
  const usePermit = opts?.permit !== false;
  // EIP-2612 permit signing is shared across the v1/v2 clients —
  // see permit.ts (EIP-5267 domain discovery + per-token cache, CR.13).
  // The approve-path twin lives in approve.ts (ADR-0026).
  const signPermit = createPermitSigner(publicClient, walletClient, usdcAddress, escrowAddress);
  const ensureAllowance = createAllowanceEnsurer(publicClient, walletClient, usdcAddress, escrowAddress);

  return {
    async createTask(spec: TaskSpec): Promise<TaskId> {
      let permit: PermitSignature;
      if (usePermit) {
        permit = await signPermit(spec.amount);
      } else {
        await ensureAllowance(spec.amount);
        permit = ZERO_PERMIT;
      }

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

      // Extract taskId from TaskCreated event. Match on the escrow address too,
      // not just the topic — a future hook/multicall in the same tx emitting an
      // identical signature would otherwise shadow the real event.
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
        status: decodeStatus(result.status),
        specUri: result.specUri,
        resultUri: result.resultUri,
        completedAt: Number(result.completedAt),
        // v1 contract has no executorShare. Field exists in TaskRecord for v3
        // compatibility but is always 0n when read through this v1 adapter.
        executorShare: 0n,
      };
    },
  };
}

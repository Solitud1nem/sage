/**
 * Dispute resolution flow (ADR-0019) — wires the on-chain V2 escrow client to
 * the off-chain council judge, producing the `DisputeFlow` capability that the
 * plan-runner invokes when a sub-task is disputed in review mode.
 *
 * Sequence per dispute:
 *   1. `disputeTask(taskId, reason)` — the client (sponsor EOA) moves the task
 *      to `Disputed`.  (Wait receipt.)
 *   2. Council judges `{spec, result, reason}` → verdict.
 *   3. `resolveDispute(taskId, outcome, executorShare)` — the arbiter EOA
 *      (= sponsor, collapse posture) executes the verdict.  (Wait receipt.)
 *
 * Both writes wait for their receipt before returning so the plan-runner's
 * next sponsor-side `createTask` doesn't reuse a pending nonce (same rationale
 * as the approvePayment receipt-wait in plan-runner).
 *
 * Why a separate V2 client: `createSageClient` still wires the V1 `TaskClient`
 * (selectors for create/accept/complete/approve match V2, so the happy path
 * works), but `resolveDispute` is V2-only. This builds a `TaskClientV2` on the
 * same wallet/public client + escrow address for the arbitration writes.
 */

import { TaskStatus, type TaskId } from '@sage/core';
import { createTaskEscrowV2Client } from '@sage/adapter-evm';

import { judgeDispute, type CouncilEnv, type CouncilVerdict } from './council.js';
import type { DisputeFlow, DisputeResolution } from './plan-runner.js';
import type { createSageFromConfig } from '../shared/config.js';

type SageClientBundle = ReturnType<typeof createSageFromConfig>;

/**
 * Map a council verdict to the on-chain `resolveDispute` parameters plus the
 * USDC the executor actually receives (for UI/event display).
 *
 * Contract semantics: `executorShare` must be 0 for `Paid`/`Refunded` (the
 * contract pays the full amount / refunds fully); for `Split` it's the partial
 * USDC to the executor. So the value passed to `resolveDispute` differs from
 * the amount the executor effectively gets under `Paid`.
 */
export function mapVerdict(
  verdict: CouncilVerdict,
  amount: bigint,
): { outcome: TaskStatus.Paid | TaskStatus.Refunded | TaskStatus.Split; callShare: bigint; displayShare: bigint } {
  switch (verdict.outcome) {
    case 'worker':
      return { outcome: TaskStatus.Paid, callShare: 0n, displayShare: amount };
    case 'client':
      return { outcome: TaskStatus.Refunded, callShare: 0n, displayShare: 0n };
    case 'split': {
      // A Split needs a share strictly inside (0, amount); for amount <= 1 no
      // such integer exists, so the contract's bounds check would revert. Fall
      // back to the nearer full outcome by the judge's intended share.
      if (amount <= 1n) {
        const pct = verdict.executorSharePct ?? 50;
        return pct >= 50
          ? { outcome: TaskStatus.Paid, callShare: 0n, displayShare: amount }
          : { outcome: TaskStatus.Refunded, callShare: 0n, displayShare: 0n };
      }
      const pct = BigInt(verdict.executorSharePct ?? 50);
      // Clamp the resulting share into (0, amount) so the contract's
      // bounds check can't revert on a 0 or full share for a Split.
      let share = (amount * pct) / 100n;
      if (share <= 0n) share = 1n;
      if (share >= amount) share = amount - 1n;
      return { outcome: TaskStatus.Split, callShare: share, displayShare: share };
    }
  }
}

/**
 * Build the `DisputeFlow` capability for the plan-runner. Constructs a V2
 * escrow client bound to the bundle's wallet/public client + configured
 * escrow address, and closes over the council env.
 */
export function makeDisputeFlow(bundle: SageClientBundle, councilEnv: CouncilEnv): DisputeFlow {
  const escrow = createTaskEscrowV2Client(
    bundle.publicClient,
    bundle.walletClient,
    bundle.chainConfig.contracts.taskEscrow,
    bundle.chainConfig.contracts.usdc,
  );

  // Both receipts are checked for `reverted` (code review 2026-06-09, H3):
  // a mined-but-reverted disputeTask/resolveDispute previously fell through
  // as success — emitting a false `subtask_dispute_resolved` while the task
  // stayed Disputed with funds escrowed. A throw here propagates through the
  // plan-runner into an honest `plan_failed`.
  const waitChecked = async (hash: string, label: string): Promise<void> => {
    const receipt = await bundle.publicClient.waitForTransactionReceipt({
      hash: hash as `0x${string}`,
    });
    if (receipt.status === 'reverted') {
      throw new Error(`${label} reverted on-chain (tx ${hash})`);
    }
  };

  return async ({ taskId, amount, spec, result, reason }): Promise<DisputeResolution> => {
    // 1. Raise the dispute on-chain (client = sponsor EOA).
    const disputeTxHash = await escrow.disputeTask(taskId as TaskId, reason);
    await waitChecked(disputeTxHash, `disputeTask(${taskId})`);

    // 2. Council verdict.
    const verdict = await judgeDispute({ spec, result, reason }, councilEnv);
    const { outcome, callShare, displayShare } = mapVerdict(verdict, amount);

    // 3. Arbiter executes the verdict on-chain.
    const resolveTxHash = await escrow.resolveDispute(taskId as TaskId, outcome, callShare);
    await waitChecked(resolveTxHash, `resolveDispute(${taskId})`);

    return {
      verdict,
      outcome: verdict.outcome,
      executorShare: displayShare,
      disputeTxHash,
      resolveTxHash,
    };
  };
}

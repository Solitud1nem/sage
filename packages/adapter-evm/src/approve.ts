/**
 * Approve-path funding for settlement tokens without EIP-2612 permit
 * (ADR-0026: WMON on Monad is WETH9-style — no `permit`, no `nonces`).
 *
 * TaskEscrow / TaskEscrowV2 `createTask` wraps its permit call in
 * `try/catch` and then pulls funds via `safeTransferFrom`, so a token
 * without permit works as long as the client holds a sufficient allowance
 * beforehand. This module provides exactly that:
 *
 *   - `createAllowanceEnsurer` — reads `allowance(owner, escrow)` and, when
 *     short, sends an exact-amount `approve` and waits for its receipt
 *     (receipt status is checked: on Monad a tx can be included yet revert
 *     while still paying gas — reserve-balance edge, recon §5).
 *   - `ZERO_PERMIT` — a zeroed PermitData struct to satisfy the ABI. On a
 *     WETH9-style token the escrow's permit attempt hits the fallback (a
 *     0-value `deposit()`) or reverts into the catch — harmless either way.
 *
 * Exact-amount approve (not infinite) is deliberate: the plan-runner is
 * sequential per run, so there is no allowance race, and a bounded
 * allowance keeps the escrow unable to pull more than the task at hand.
 */

import type { Account, Chain, PublicClient, Transport, WalletClient } from 'viem';
import type { PermitSignature } from './permit.js';

type BoundWalletClient = WalletClient<Transport, Chain, Account>;

/** Zeroed PermitData for the no-permit createTask path. */
export const ZERO_PERMIT: PermitSignature = {
  value: 0n,
  deadline: 0n,
  v: 0,
  r: `0x${'0'.repeat(64)}`,
  s: `0x${'0'.repeat(64)}`,
};

const ERC20_ALLOWANCE_ABI = [
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/**
 * Build an allowance ensurer bound to a token + spender. The returned
 * function guarantees `allowance(owner, spender) >= amount` on resolve,
 * topping up with an exact-amount `approve` when needed.
 */
export function createAllowanceEnsurer(
  publicClient: PublicClient,
  walletClient: BoundWalletClient,
  tokenAddress: `0x${string}`,
  spender: `0x${string}`,
): (amount: bigint) => Promise<void> {
  return async (amount: bigint): Promise<void> => {
    const account = walletClient.account;
    if (!account) throw new Error('WalletClient must have an account');

    const allowance = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ALLOWANCE_ABI,
      functionName: 'allowance',
      args: [account.address, spender],
    });
    if (allowance >= amount) return;

    const hash = await walletClient.writeContract({
      address: tokenAddress,
      abi: ERC20_ALLOWANCE_ABI,
      functionName: 'approve',
      args: [spender, amount],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      throw new Error(`approve(${spender}, ${amount}) reverted in tx ${hash}`);
    }
  };
}

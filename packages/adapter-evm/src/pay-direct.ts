/**
 * Direct ERC-20 transfer with permit — escape-hatch when x402 is unavailable.
 *
 * WARNING: This is NOT the recommended payment path.
 * Use sage.callAgent() (x402) for pay-per-call or sage.tasks.createTask() for escrow.
 * This is a fallback for when the x402 facilitator is unreachable.
 */

import type { PublicClient, WalletClient } from 'viem';

const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export interface PayDirectParams {
  /** Recipient address. */
  to: `0x${string}`;
  /** Amount in smallest token unit (e.g. 1_000_000 = 1 USDC). */
  amount: bigint;
  /** Token contract address (defaults to USDC from chain config). */
  token: `0x${string}`;
}

export interface PayDirectClient {
  /**
   * Direct ERC-20 transfer. Escape-hatch — prefer x402 or escrow.
   * @returns Transaction hash.
   */
  payDirect(params: PayDirectParams): Promise<string>;
}

export function createPayDirectClient(
  _publicClient: PublicClient,
  walletClient: WalletClient,
): PayDirectClient {
  return {
    async payDirect({ to, amount, token }) {
      const hash = await walletClient.writeContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [to, amount],
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      return hash;
    },
  };
}

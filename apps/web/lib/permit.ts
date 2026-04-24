'use client';

import type { PublicClient, WalletClient } from 'viem';
import { hexToBigInt, parseSignature } from 'viem';

import { usdcAbi } from '@/lib/abi/task-escrow';

/**
 * EIP-2612 permit signature for USDC (Base mainnet + Sepolia).
 *
 * Circle's USDC uses domain name "USD Coin" with version "2".
 * We sign the Permit typed-data so TaskEscrow.createTask can consume it in
 * a single transaction without a separate approve() round-trip.
 */

export interface PermitData {
  value: bigint;
  deadline: bigint;
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
}

export async function signUsdcPermit(
  publicClient: PublicClient,
  walletClient: WalletClient,
  params: {
    usdcAddress: `0x${string}`;
    owner: `0x${string}`;
    spender: `0x${string}`;
    value: bigint;
    deadlineSeconds?: number; // defaults to 1 hour from now
  },
): Promise<PermitData> {
  const deadlineSeconds = params.deadlineSeconds ?? 3600;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

  const nonce = (await publicClient.readContract({
    address: params.usdcAddress,
    abi: usdcAbi,
    functionName: 'nonces',
    args: [params.owner],
  })) as bigint;

  const chainId = await publicClient.getChainId();

  const signature = await walletClient.signTypedData({
    account: params.owner,
    domain: {
      name: 'USD Coin',
      version: '2',
      chainId,
      verifyingContract: params.usdcAddress,
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
      owner: params.owner,
      spender: params.spender,
      value: params.value,
      nonce,
      deadline,
    },
  });

  const { r, s, v, yParity } = parseSignature(signature);
  return {
    value: params.value,
    deadline,
    // Some wallets return y-parity only; TaskEscrow expects classic v (27/28).
    v: typeof v === 'bigint' ? Number(v) : v ?? (yParity === 1 ? 28 : 27),
    r,
    s,
  };
}

/** Read USDC balance for an owner. */
export async function readUsdcBalance(
  publicClient: PublicClient,
  usdcAddress: `0x${string}`,
  owner: `0x${string}`,
): Promise<bigint> {
  const result = await publicClient.readContract({
    address: usdcAddress,
    abi: usdcAbi,
    functionName: 'balanceOf',
    args: [owner],
  });
  return result as bigint;
}

/** Quick-ish hex→bigint for when viem's hexToBigInt is needed inline. */
export { hexToBigInt };

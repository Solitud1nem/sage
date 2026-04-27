import type { Address, PublicClient } from 'viem';

/**
 * Sponsor balance guard — reject new demo runs when the protocol-funded wallet
 * drops below a configured USDC threshold. Stops the free-demo loop from
 * draining the sponsor to zero and silently breaking.
 *
 * Per ADR-0006: sponsor wallet is the orchestrator EOA, loaded with $20 USDC
 * at launch, auto-rejects below $5 (or whatever SPONSOR_MIN_BALANCE_USDC is).
 */

const USDC_BY_CHAIN: Record<number, Address> = {
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base mainnet
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia
};

const ERC20_BALANCE_OF_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export interface SponsorStatus {
  ok: boolean;
  balance: bigint;
  /** Minimum balance below which new demo-runs are rejected (USDC 6-decimals). */
  minBalance: bigint;
  chainId: number;
  /** Human-friendly warn level: healthy | low | critical. */
  level: 'healthy' | 'low' | 'critical';
}

/**
 * Reads the orchestrator EOA's USDC balance on its active chain and classifies
 * against `minBalance`. Returns `ok=false` when below the threshold.
 */
export async function checkSponsorStatus(
  publicClient: PublicClient,
  sponsor: Address,
  minBalance: bigint,
): Promise<SponsorStatus> {
  const chainId = await publicClient.getChainId();
  const usdc = USDC_BY_CHAIN[chainId];
  if (!usdc) {
    // Unknown chain — allow (don't block dev loops on exotic chains) but flag.
    return {
      ok: true,
      balance: 0n,
      minBalance,
      chainId,
      level: 'healthy',
    };
  }

  const balance = (await publicClient.readContract({
    address: usdc,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: 'balanceOf',
    args: [sponsor],
  })) as bigint;

  // Two bands: below min → critical (reject). Below 2×min → low (accept + warn).
  let level: SponsorStatus['level'] = 'healthy';
  if (balance < minBalance) level = 'critical';
  else if (balance < minBalance * 2n) level = 'low';

  return {
    ok: balance >= minBalance,
    balance,
    minBalance,
    chainId,
    level,
  };
}

/** Format USDC 6-decimal bigint as "0.500" style string. */
export function formatUsdc(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const frac = amount % 1_000_000n;
  const fracStr = frac.toString().padStart(6, '0').slice(0, 3);
  return `${whole.toString()}.${fracStr}`;
}

'use client';

import { useChainId } from 'wagmi';

import { BASE_MAINNET, SAGE_CHAINS, type SageChainConfig } from '@/chains/base';

/**
 * Returns the SageChainConfig for the currently-connected wallet chain.
 *
 * Fallbacks:
 *   - No wallet connected → wagmi returns the first configured chain (Base mainnet).
 *   - Unknown chainId (e.g. user on Ethereum mainnet) → returns BASE_MAINNET anyway
 *     so calls don't crash, and `isSupported` flags that reads/writes will fail.
 *
 * Consumers that need to gate UI on supported chains should check `isSupported`.
 */
export function useSageChain(): SageChainConfig & { isSupported: boolean } {
  const chainId = useChainId();
  const cfg = SAGE_CHAINS[chainId as keyof typeof SAGE_CHAINS];
  return {
    ...(cfg ?? BASE_MAINNET),
    isSupported: cfg !== undefined,
  };
}

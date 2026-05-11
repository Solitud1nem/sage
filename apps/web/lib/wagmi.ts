'use client';

/**
 * wagmi config — Base mainnet + Sepolia, with ConnectKit wallet lineup.
 *
 * Per ADR-0006: viem-only, ConnectKit for modal, RPC behind Cloudflare Worker
 * proxy in production (NEXT_PUBLIC_RPC_URL).
 */

import { createConfig, http } from 'wagmi';
import { base, baseSepolia, mainnet } from 'wagmi/chains';
import { coinbaseWallet, injected, metaMask, walletConnect } from 'wagmi/connectors';

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

const rpcBase = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://mainnet.base.org';
const rpcBaseSepolia = 'https://sepolia.base.org';
// Ethereum mainnet is included only so ConnectKit can resolve ENS names
// (reverse-lookup of connected wallet) without falling back to the chain's
// default public RPC (eth.merkle.io) which blocks CORS. We do NOT support
// Sage operations on chain 1 — useSageChain.isSupported gates demos.
const rpcEthMainnet = 'https://cloudflare-eth.com';

export const wagmiConfig: ReturnType<typeof createConfig> = createConfig({
  chains: [base, baseSepolia, mainnet],
  transports: {
    [base.id]: http(rpcBase),
    [baseSepolia.id]: http(rpcBaseSepolia),
    [mainnet.id]: http(rpcEthMainnet),
  },
  connectors: [
    // Accepts both Coinbase Smart Wallet (passkey-based) and the regular
    // Coinbase Wallet extension/mobile. Design spec labels this "recommended".
    coinbaseWallet({
      appName: 'Sage',
      preference: 'all',
    }),
    metaMask({
      dappMetadata: {
        name: 'Sage',
        url: 'https://sage.xyz',
      },
    }),
    ...(walletConnectProjectId
      ? [
          walletConnect({
            projectId: walletConnectProjectId,
            metadata: {
              name: 'Sage',
              description: 'Chain-agnostic task-escrow protocol for AI agents.',
              url: 'https://sage.xyz',
              icons: [],
            },
            showQrModal: false,
          }),
        ]
      : []),
    // Catch-all for any EIP-1193 provider, including Rainbow, Frame, etc.
    injected({ shimDisconnect: true }),
  ],
  ssr: false,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}

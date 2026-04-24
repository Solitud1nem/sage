'use client';

/**
 * wagmi config — Base mainnet + Sepolia, with ConnectKit wallet lineup.
 *
 * Per ADR-0006: viem-only, ConnectKit for modal, RPC behind Cloudflare Worker
 * proxy in production (NEXT_PUBLIC_RPC_URL).
 */

import { createConfig, http } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { coinbaseWallet, injected, metaMask, walletConnect } from 'wagmi/connectors';

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

const rpcBase = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://mainnet.base.org';
const rpcBaseSepolia = 'https://sepolia.base.org';

export const wagmiConfig = createConfig({
  chains: [base, baseSepolia],
  transports: {
    [base.id]: http(rpcBase),
    [baseSepolia.id]: http(rpcBaseSepolia),
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

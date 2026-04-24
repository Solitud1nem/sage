'use client';

/**
 * Client providers: wagmi + react-query + ConnectKit.
 *
 * PostHog is initialized separately after cookie-consent (not here).
 */

import { ConnectKitProvider, getDefaultConfig } from 'connectkit';
import { type PropsWithChildren, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';

import { wagmiConfig } from '@/lib/wagmi';

export function Providers({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider
          theme="midnight"
          customTheme={{
            '--ck-font-family': 'var(--font-sans)',
            '--ck-accent-color': '#A78BFA',
            '--ck-accent-text-color': '#0A0A0F',
            '--ck-body-background': '#0A0A0F',
            '--ck-body-background-secondary': 'rgba(255,255,255,0.025)',
            '--ck-body-background-tertiary': 'rgba(255,255,255,0.05)',
            '--ck-body-color': '#EDEDF5',
            '--ck-body-color-muted': '#8787A5',
            '--ck-body-divider': 'rgba(255,255,255,0.08)',
            '--ck-primary-button-border-radius': '10px',
            '--ck-primary-button-background': '#A78BFA',
            '--ck-primary-button-color': '#0A0A0F',
            '--ck-primary-button-hover-background': '#A78BFA',
            '--ck-modal-box-shadow': '0 0 28px rgba(167,139,250,0.45)',
            '--ck-border-radius': '14px',
          }}
          options={{
            initialChainId: 8453,
            enforceSupportedChains: false,
            hideBalance: false,
            hideQuestionMarkCTA: true,
            hideNoWalletCTA: false,
          }}
        >
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

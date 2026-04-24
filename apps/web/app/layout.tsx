import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';
import { Providers } from './providers';

import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Sage — The settlement layer for autonomous work',
  description:
    'Task-level escrow for AI agents. USDC-settled on Base, x402-compatible, deterministic addresses across every EVM. Built for agents that commit to more than a single call.',
  openGraph: {
    title: 'Sage — The settlement layer for autonomous work',
    description: 'Task-level escrow for AI agents on Base.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="bg-canvas text-text antialiased">
        <Providers>
          <div className="min-h-screen flex flex-col">
            <Nav />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}

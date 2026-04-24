import { ImageResponse } from 'next/og';

import { siteConfig } from '@/lib/site-config';

export const dynamic = 'force-static';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = `${siteConfig.name} — ${siteConfig.tagline}`;

/**
 * OG image rendered at build time. Matches the landing hero: dark canvas,
 * purple accent, mono tagline row, short pitch. Kept simple — inline SVG
 * element would be nicer but ImageResponse has known quirks with complex SVG.
 */
export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#0A0A0F',
          color: '#EDEDF5',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 80,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 40,
              height: 40,
              background: '#A78BFA',
              borderRadius: 10,
            }}
          />
          <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: '-0.01em' }}>
            {siteConfig.name.toLowerCase()}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 980 }}>
          <div
            style={{
              fontSize: 14,
              fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: '#8787A5',
            }}
          >
            Task-level escrow · Base · USDC
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              fontSize: 68,
              fontWeight: 500,
              letterSpacing: '-0.02em',
              lineHeight: 1.08,
            }}
          >
            The settlement layer for{' '}
            <span style={{ color: '#A78BFA' }}>autonomous work</span>.
          </div>
          <div style={{ fontSize: 24, color: '#8787A5', lineHeight: 1.4, maxWidth: 880 }}>
            x402 handles the call. Sage handles the commitment.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
            fontSize: 14,
            color: '#8787A5',
          }}
        >
          <div>sage.xyz</div>
          <div>chain-agnostic · open source · MIT</div>
        </div>
      </div>
    ),
    size,
  );
}

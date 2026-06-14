'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

// Galaxy touches `window`/WebGL — load it client-only. A server-rendered
// import would break the static export (`output: export`), same reason the
// composite page wraps useSearchParams in Suspense.
const Galaxy = dynamic(() => import('./Galaxy'), { ssr: false });

/**
 * Site-wide background: the reactbits Galaxy starfield tuned to Sage's
 * palette, mounted once in the root layout as a fixed full-viewport layer
 * behind all content. Safety rails the raw component doesn't carry:
 *   - prefers-reduced-motion → frozen frame (no time advancement)
 *   - mobile → lower star density
 *   - WebGL-less → a static radial-gradient tint shows underneath
 *
 * Decorative only: `pointer-events-none` so it never intercepts clicks. A
 * uniform dark scrim sits on top so the starfield reads as a subtle backdrop
 * on every page (incl. text-heavy docs/composite) without hurting legibility.
 */
export function GalaxyBackground() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mobile = window.matchMedia('(max-width: 640px)');
    const sync = () => {
      setReducedMotion(motion.matches);
      setIsMobile(mobile.matches);
    };
    sync();
    motion.addEventListener('change', sync);
    mobile.addEventListener('change', sync);
    return () => {
      motion.removeEventListener('change', sync);
      mobile.removeEventListener('change', sync);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {/* No-WebGL fallback + base tint (matches the .canvas-noise glow). */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(1200px 600px at 70% -10%, rgba(167,139,250,0.12), transparent 60%), radial-gradient(900px 500px at 10% 20%, rgba(94,227,245,0.07), transparent 60%)',
        }}
      />
      <Galaxy
        hueShift={250}
        density={isMobile ? 0.7 : 1.1}
        glowIntensity={0.4}
        saturation={0.5}
        starSpeed={0.4}
        rotationSpeed={0.08}
        twinkleIntensity={0.4}
        mouseInteraction={false}
        mouseRepulsion={false}
        transparent
        disableAnimation={reducedMotion}
      />
      {/* Uniform dark scrim so the starfield stays a subtle backdrop and page
          copy (docs/composite included) keeps its contrast. */}
      <div className="absolute inset-0" style={{ background: 'rgba(10,10,15,0.66)' }} />
    </div>
  );
}

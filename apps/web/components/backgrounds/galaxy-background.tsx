'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

// Galaxy touches `window`/WebGL — load it client-only. A server-rendered
// import would break the static export (`output: export`), same reason the
// composite page wraps useSearchParams in Suspense.
const Galaxy = dynamic(() => import('./Galaxy'), { ssr: false });

/**
 * Hero background: the reactbits Galaxy starfield tuned to Sage's palette,
 * with the safety rails the raw component doesn't carry:
 *   - prefers-reduced-motion → frozen frame (no time advancement)
 *   - off-screen → animation paused (IntersectionObserver)
 *   - mobile → lower star density
 *   - WebGL-less → a static radial-gradient tint shows underneath
 *
 * Decorative only: `pointer-events-none` so it never intercepts clicks, and
 * the canvas is transparent so the area outside the hero box blends into the
 * page background with no visible seam. A left-darken + bottom-fade overlay
 * keeps the hero copy legible.
 */
export function GalaxyBackground() {
  const ref = useRef<HTMLDivElement>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [inView, setInView] = useState(true);

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

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => setInView(entries[0]?.isIntersecting ?? true),
      { threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
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
        glowIntensity={0.45}
        saturation={0.5}
        starSpeed={0.4}
        rotationSpeed={0.08}
        twinkleIntensity={0.4}
        mouseInteraction={false}
        mouseRepulsion={false}
        transparent
        disableAnimation={reducedMotion || !inView}
      />
      {/* Left-darken for copy legibility. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(90deg, rgba(10,10,15,0.92) 0%, rgba(10,10,15,0.55) 45%, rgba(10,10,15,0.12) 100%)',
        }}
      />
      {/* Bottom fade into the page background. */}
      <div
        className="absolute inset-x-0 bottom-0 h-32"
        style={{ background: 'linear-gradient(to bottom, transparent, #0A0A0F)' }}
      />
    </div>
  );
}

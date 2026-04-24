import type { PropsWithChildren } from 'react';

/**
 * Static gradient sweep cyan → purple → pink, applied via background-clip: text.
 * Reserved for "autonomous work" per ADR-0006 / Design System spec.
 */
export function GradientText({ children }: PropsWithChildren) {
  return (
    <span
      className="bg-clip-text text-transparent"
      style={{
        backgroundImage: 'linear-gradient(90deg, #5EE3F5 0%, #A78BFA 55%, #F472B6 100%)',
      }}
    >
      {children}
    </span>
  );
}

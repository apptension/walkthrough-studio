import { forwardRef, memo, type ButtonHTMLAttributes, type CSSProperties } from 'react';

import { cn } from '@/lib/cn';
import { NEON_BLOBS, NEON_SPARKS } from '@/ui/neonFx';

export type NeonButtonSize = 'xs' | 'sm' | 'md' | 'lg';

interface NeonButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Opt-in geometry. Omit it when replacing an existing button — height, padding and
   * corner radius stay with that button's own classes (`.btn`, `.tiny`, pills, …).
   */
  size?: NeonButtonSize;
}

/**
 * Drifting highlights, sparks and a pointer glow. Hidden by CSS until the host
 * matches a brand-gradient button, so it can sit in controls that only turn primary sometimes.
 * Memoized so a parent re-render does not wipe the press ripple added on pointerdown.
 */
export const NeonFx = memo(function NeonFx() {
  return (
    <span className="neon-btn__fx" aria-hidden="true">
      <span className="neon-btn__water">
        {NEON_BLOBS.map((b) => (
          <span
            key={`${b.top}:${b.delay}`}
            className="neon-btn__blob"
            style={
              {
                width: `${b.w}%`,
                height: `${b.h}%`,
                top: `${b.top}%`,
                left: `-${b.w}%`,
                background: `radial-gradient(closest-side, ${b.color}, transparent)`,
                '--dur': `${b.dur}s`,
                '--delay': `${b.delay}s`,
                '--busy-delay': `${b.busy}s`,
              } as CSSProperties
            }
          />
        ))}
        {NEON_SPARKS.map((s) => (
          <span
            key={`${s.left}:${s.top}`}
            className="neon-btn__spark"
            style={{ left: `${s.left}%`, top: `${s.top}%`, animationDuration: `${s.dur}s`, animationDelay: `${s.delay}s` }}
          />
        ))}
      </span>
      <span className="neon-btn__glow" />
    </span>
  );
});

/**
 * Brand-gradient button. Pass `className` through for an existing control (`.btn primary`,
 * `.render-cta primary`, …) and leave `size` unset so its corners stay put.
 * Pass `size` only for a standalone control; that radius is `--radius` (8px), the desk's default.
 */
export const NeonButton = forwardRef<HTMLButtonElement, NeonButtonProps>(function NeonButton(
  { size, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn(size && 'neon-btn', className)} data-size={size} {...rest}>
      <NeonFx />
      {children}
    </button>
  );
});

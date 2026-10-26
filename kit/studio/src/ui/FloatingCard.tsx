import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export type FloatingCardSize = 'sm' | 'lg';

interface FloatingCardProps extends HTMLAttributes<HTMLDivElement> {
  /** `sm` — a quick anchored tip (help, a single notice). `lg` — a popover with several fields or groups (queue add, plate accent). */
  size?: FloatingCardSize;
}

/**
 * The one dark elevated card every anchored popover renders on: radius, border, background and
 * shadow come from here, keyed off `size` (`--radius` / `--radius-lg`), so no popover hand-rolls
 * its own numbers. Each caller still owns its own position, width and transition — this is chrome
 * only. Mirrors `.stage-panel`'s split between shared surface and per-panel layout.
 */
export const FloatingCard = forwardRef<HTMLDivElement, FloatingCardProps>(function FloatingCard(
  { size = 'sm', className, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={cn('floating-card', className)} data-size={size} {...rest}>
      {children}
    </div>
  );
});

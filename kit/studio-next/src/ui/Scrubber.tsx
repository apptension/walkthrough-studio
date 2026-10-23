import { forwardRef, useLayoutEffect, useRef, type InputHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

import { paintRange } from './rangeFill';

type ScrubberProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * The meter every panel drags: a tone-coloured fill up to the value and a glowing thumb.
 * The stage panels, the Inspector and Direction all render this, so a new slider cannot drift.
 */
export const Scrubber = forwardRef<HTMLInputElement, ScrubberProps>(function Scrubber({ className, onInput, ...props }, ref) {
  const local = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    paintRange(local.current);
  });
  return (
    <input
      {...props}
      ref={(el) => {
        local.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      type="range"
      className={cn('sp-range', className)}
      onInput={(e) => {
        paintRange(e.currentTarget);
        onInput?.(e);
      }}
    />
  );
});

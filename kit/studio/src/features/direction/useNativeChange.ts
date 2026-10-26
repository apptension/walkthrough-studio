import { useEffect, useRef, type RefObject } from 'react';

/**
 * A native `change` listener. React's `onChange` fires on every `input` event, but legacy
 * saved range and colour pickers on `change` only (release / picker close).
 */
export function useNativeChange<T extends HTMLElement>(ref: RefObject<T | null>, handler: (e: Event) => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = (e: Event) => latest.current(e);
    el.addEventListener('change', listener);
    return () => el.removeEventListener('change', listener);
  }, [ref]);
}

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface TransitionToggle {
  hidden: boolean;
  /** The "in" class (`is-in` on the Live tab, `is-on` on the warm-up veil). */
  active: boolean;
}

/**
 * The show/hide choreography of `syncLiveTab` and `setLiveWarmup`: unhide, then
 * add the class two frames later so the transition runs; on hide, drop the
 * class and re-hide on `transitionend` of one of `properties` (or after 420 ms).
 * A generation counter drops stale callbacks when the state flips mid-way.
 */
export function useTransitionToggle(
  show: boolean,
  ref: RefObject<HTMLElement | null>,
  properties: readonly string[],
): TransitionToggle {
  const [view, setView] = useState<TransitionToggle>({ hidden: true, active: false });
  const gen = useRef(0);
  const activeRef = useRef(false);
  const props = useRef(properties);
  props.current = properties;

  useLayoutEffect(() => {
    const g = ++gen.current;
    if (show) {
      setView((v) => (v.hidden ? { ...v, hidden: false } : v));
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          if (g !== gen.current) return;
          activeRef.current = true;
          setView({ hidden: false, active: true });
        });
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    const wasIn = activeRef.current;
    activeRef.current = false;
    if (!wasIn) {
      setView({ hidden: true, active: false });
      return;
    }
    setView({ hidden: false, active: false });
    const el = ref.current;
    const hide = (ev?: TransitionEvent) => {
      if (g !== gen.current) return;
      if (ev && ev.target !== el) return;
      if (ev?.propertyName && !props.current.includes(ev.propertyName)) return;
      if (!activeRef.current) setView({ hidden: true, active: false });
    };
    el?.addEventListener('transitionend', hide);
    const timer = setTimeout(() => {
      el?.removeEventListener('transitionend', hide);
      hide();
    }, 420);
    return () => {
      el?.removeEventListener('transitionend', hide);
      clearTimeout(timer);
    };
  }, [show, ref]);

  return view;
}

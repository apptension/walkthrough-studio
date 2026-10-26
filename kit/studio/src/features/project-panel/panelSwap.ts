import { useLayoutEffect, useRef, useState } from 'react';

/**
 * `swapPanelBodies(next, group)` from `kit/studio/app.js`: crossfade the rail's
 * panel bodies. The leaving body gets `is-panel-leave`, the entering one
 * `is-panel-enter`, then `is-panel-ready` two frames later; after 320 ms the old
 * body hides, and `is-panel-ready` drops 420 ms after that. Reduced motion (or
 * nothing visible to leave) swaps at once.
 */

export const PANEL_MS = 320;

export interface PanelBodyView {
  hidden: boolean;
  /** Phase classes to append to the body's own class list. */
  phase: string;
}

type Phase = 'is-panel-leave' | 'is-panel-enter' | 'is-panel-ready';

interface BodyState {
  hidden: boolean;
  phases: Phase[];
}

function initial<T extends string>(ids: readonly T[], active: T): Record<T, BodyState> {
  const out = {} as Record<T, BodyState>;
  for (const id of ids) out[id] = { hidden: id !== active, phases: [] };
  return out;
}

export function usePanelSwap<T extends string>(active: T, ids: readonly T[]): Record<T, PanelBodyView> {
  const [bodies, setBodies] = useState(() => initial(ids, active));
  const bodiesRef = useRef(bodies);
  const gen = useRef(0);
  const first = useRef(true);

  useLayoutEffect(() => {
    bodiesRef.current = bodies;
  }, [bodies]);

  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const now = bodiesRef.current;
    if (!now[active]) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const visible = ids.filter((id) => !now[id].hidden && id !== active);
    // Prefer the panel still entering from a prior swap so a fast re-click doesn't leave two up.
    const current =
      visible.find((id) => now[id].phases.includes('is-panel-enter') || now[id].phases.includes('is-panel-ready')) ?? visible[0];
    if (current === undefined || reduced) {
      gen.current += 1;
      setBodies(initial(ids, active));
      return;
    }
    const g = ++gen.current;
    const update = (fn: (s: Record<T, BodyState>) => void) =>
      setBodies((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = { hidden: prev[id].hidden, phases: [...prev[id].phases] };
        fn(next);
        return next;
      });
    const without = (list: Phase[], ...drop: Phase[]) => list.filter((p) => !drop.includes(p));
    update((s) => {
      for (const id of ids) {
        if (id === current || id === active) continue;
        s[id] = { hidden: true, phases: [] };
      }
      s[active] = { hidden: false, phases: ['is-panel-enter'] };
      s[current] = { hidden: s[current].hidden, phases: [...without(s[current].phases, 'is-panel-enter', 'is-panel-ready', 'is-panel-leave'), 'is-panel-leave'] };
    });
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (g !== gen.current) return;
        update((s) => {
          if (!s[active].phases.includes('is-panel-ready')) s[active].phases.push('is-panel-ready');
        });
      });
    });
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    const swapTimer = setTimeout(() => {
      if (g !== gen.current) return;
      update((s) => {
        s[current] = { hidden: true, phases: [] };
        s[active].phases = without(s[active].phases, 'is-panel-enter');
      });
      // Keep ready briefly so card stagger can finish, then drop the class.
      readyTimer = setTimeout(() => {
        if (g === gen.current) update((s) => void (s[active].phases = without(s[active].phases, 'is-panel-ready')));
      }, 420);
    }, PANEL_MS);
    return () => {
      // A newer swap supersedes this one (gen check); timers still clear on unmount.
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(swapTimer);
      if (readyTimer) clearTimeout(readyTimer);
    };
    // `ids` is a constant tuple at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const out = {} as Record<T, PanelBodyView>;
  for (const id of ids) out[id] = { hidden: bodies[id].hidden, phase: bodies[id].phases.join(' ') };
  return out;
}

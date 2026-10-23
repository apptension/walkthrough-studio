import { useLayoutEffect, useRef, type RefObject } from 'react';

import type { RightTab } from '@/desk/store';

/** `.tools-panel .ptab[data-right]` → its body, in legacy `map` order. */
export const RIGHT_BODIES: Record<RightTab, string> = {
  feedback: 'rightFeedback',
  inspector: 'rightInspector',
  motion: 'rightMotion',
  review: 'rightReview',
};

export const PANEL_MS = 320;
const READY_MS = 420;

const PHASES = ['is-panel-leave', 'is-panel-enter', 'is-panel-ready'] as const;
const clear = (el: HTMLElement) => el.classList.remove(...PHASES);

/**
 * `swapPanelBodies(next, group)` over the right-panel bodies. The bodies render with a
 * fixed `hidden` prop (the inspector body belongs to another feature), so the crossfade
 * drives `hidden` and the phase classes on the DOM exactly as legacy did.
 */
export function swapPanelBodies(next: HTMLElement | null, group: HTMLElement[], gen: { current: number }): void {
  const bodies = group.filter(Boolean);
  if (!next || !bodies.includes(next)) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const visible = bodies.filter((el) => !el.hidden && el !== next);
  const current =
    visible.find((el) => el.classList.contains('is-panel-enter') || el.classList.contains('is-panel-ready')) ?? visible[0];
  if (!current || reduced) {
    for (const el of bodies) {
      el.hidden = el !== next;
      clear(el);
    }
    return;
  }
  const g = ++gen.current;
  for (const el of bodies) {
    if (el === current || el === next) continue;
    el.hidden = true;
    clear(el);
  }
  next.hidden = false;
  clear(next);
  next.classList.add('is-panel-enter');
  current.classList.remove('is-panel-enter', 'is-panel-ready');
  current.classList.add('is-panel-leave');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (g !== gen.current) return;
      next.classList.add('is-panel-ready');
    });
  });
  setTimeout(() => {
    if (g !== gen.current) return;
    current.hidden = true;
    clear(current);
    next.classList.remove('is-panel-enter');
    setTimeout(() => {
      if (g === gen.current) next.classList.remove('is-panel-ready');
    }, READY_MS);
  }, PANEL_MS);
}

/** Crossfade to the active tab's body whenever `rightTab` changes (not on first paint). */
export function useRightPanelSwap(root: RefObject<HTMLElement | null>, tab: RightTab, seq: number): void {
  const gen = useRef(0);
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const host = root.current;
    if (!host) return;
    const find = (id: string) => host.querySelector<HTMLElement>(`#${id}`);
    const group = Object.values(RIGHT_BODIES)
      .map(find)
      .filter((el): el is HTMLElement => el != null);
    swapPanelBodies(find(RIGHT_BODIES[tab]), group, gen);
  }, [root, tab, seq]);
  useLayoutEffect(
    () => () => {
      gen.current += 1;
    },
    [],
  );
}

import { useEffect, type RefObject } from 'react';

import { toast } from '@/desk/toast';

import type { DropEdge } from './model';
import { commitSceneDrop, useScriptSheet } from './sheet';

/**
 * `wireScriptDrag()` — pointer-driven reorder on `#scriptScenes`: a cloned
 * ghost follows the pointer, the hovered scene shows a drop edge, and the
 * script body auto-scrolls near its edges.
 */
export function useScriptDrag(rootRef: RefObject<HTMLOListElement | null>): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let drag: { key: string; ghost: HTMLElement; ox: number; oy: number; clientY: number; overKey: string | null; edge: DropEdge } | null = null;
    let scrollRaf = 0;

    const scriptBody = () => document.querySelector<HTMLElement>('#scriptDialog .script-body');

    const clearDropMarks = () => {
      root.querySelectorAll('.script-scene').forEach((el) => el.classList.remove('is-drop-before', 'is-drop-after', 'is-dragging'));
    };

    const stopScroll = () => {
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      scrollRaf = 0;
    };

    const autoScroll = () => {
      if (!drag) return stopScroll();
      const body = scriptBody();
      if (!body) return;
      const r = body.getBoundingClientRect();
      const zone = 72;
      const y = drag.clientY;
      let dy = 0;
      if (y < r.top + zone) dy = -Math.max(4, Math.round((r.top + zone - y) / 6));
      else if (y > r.bottom - zone) dy = Math.max(4, Math.round((y - (r.bottom - zone)) / 6));
      if (dy) body.scrollTop += dy;
      scrollRaf = requestAnimationFrame(autoScroll);
    };

    const end = () => {
      if (!drag) return;
      stopScroll();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      drag.ghost.remove();
      clearDropMarks();
      drag = null;
      root.classList.remove('is-reordering');
      document.body.classList.remove('ss-is-dragging');
    };

    const hitScene = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.closest<HTMLElement>('#scriptScenes .script-scene:not([hidden])') ?? null;

    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      e.preventDefault();
      drag.clientY = e.clientY;
      drag.ghost.style.transform = `translate(${e.clientX - drag.ox}px, ${e.clientY - drag.oy}px)`;
      const el = hitScene(e.clientX, e.clientY);
      clearDropMarks();
      root.querySelector(`.script-scene[data-key="${CSS.escape(drag.key)}"]`)?.classList.add('is-dragging');
      if (!el || el.dataset.key === drag.key || el.dataset.kind === 'open' || el.dataset.kind === 'close') {
        drag.overKey = null;
        return;
      }
      const box = el.getBoundingClientRect();
      drag.edge = e.clientY < box.top + box.height / 2 ? 'before' : 'after';
      drag.overKey = el.dataset.key ?? null;
      el.classList.add(drag.edge === 'before' ? 'is-drop-before' : 'is-drop-after');
    };

    const onUp = () => {
      if (!drag) return;
      const { key, overKey, edge } = drag;
      end();
      if (overKey && overKey !== key) {
        commitSceneDrop(key, overKey, edge).catch((err: unknown) => {
          toast('Could not reorder', err instanceof Error ? err.message : String(err), 'err');
        });
      }
    };

    const onCancel = () => end();

    const onDown = (e: PointerEvent) => {
      const handle = (e.target as Element | null)?.closest?.('[data-drag-handle]');
      if (!handle || e.button !== 0) return;
      const li = handle.closest<HTMLElement>('.script-scene[data-can-drag]');
      const { script, draftJob } = useScriptSheet.getState();
      if (!li || !script || draftJob || !li.dataset.key) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = li.getBoundingClientRect();
      const ghost = li.cloneNode(true) as HTMLElement;
      ghost.classList.add('ss-drag-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.width = `${rect.width}px`;
      document.body.appendChild(ghost);
      drag = { key: li.dataset.key, ghost, ox: e.clientX - rect.left, oy: e.clientY - rect.top, clientY: e.clientY, overKey: null, edge: 'before' };
      li.classList.add('is-dragging');
      root.classList.add('is-reordering');
      document.body.classList.add('ss-is-dragging');
      ghost.style.transform = `translate(${e.clientX - drag.ox}px, ${e.clientY - drag.oy}px)`;
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      stopScroll();
      scrollRaf = requestAnimationFrame(autoScroll);
    };

    root.addEventListener('pointerdown', onDown);
    return () => {
      root.removeEventListener('pointerdown', onDown);
      end();
    };
  }, [rootRef]);
}

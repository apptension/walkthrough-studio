import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { FloatingCard } from './FloatingCard';
import { helpLabel, helpState, helpTips, subscribeHelp } from './helpStore';

/**
 * Contextual help, ported from `help.js`.
 *
 * Any label with help gets a small "i" button. One shared tooltip shows the text
 * on hover or keyboard focus; a click pins it until Escape, a click outside, a
 * resize or a scroll.
 */

/** The `i` button `attach()` appends to a `[data-help]` element. */
export function HelpTip({ text, label }: { text: string; label: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const current = useSyncExternalStore(subscribeHelp, helpState);
  const open = current.anchor != null && current.anchor === ref.current;

  return (
    <button
      ref={ref}
      type="button"
      className="help-tip"
      aria-label={helpLabel(label)}
      aria-expanded={open}
      aria-describedby={open ? 'helpPop' : undefined}
      onPointerEnter={() => {
        if (helpState().pinned) return;
        const button = ref.current;
        if (button) helpTips.showSoon(button, text);
      }}
      onPointerLeave={() => {
        helpTips.cancelShow();
        if (!helpState().pinned) helpTips.scheduleHide();
      }}
      onFocus={(event) => {
        if (event.currentTarget.matches(':focus-visible')) helpTips.show(event.currentTarget, text);
      }}
      onBlur={() => {
        if (!helpState().pinned) helpTips.scheduleHide();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (open && helpState().pinned) helpTips.hide();
        else helpTips.show(event.currentTarget, text, true);
      }}
    >
      i
    </button>
  );
}

/** The one shared tooltip. Mount once, at the root of the desk. */
export function HelpPop() {
  const current = useSyncExternalStore(subscribeHelp, helpState);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const pop = ref.current;
    const anchor = current.anchor;
    if (!pop || !anchor) return;
    pop.classList.remove('is-in');
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const gap = 8;
    const below = r.bottom + gap + h <= window.innerHeight - 8;
    const top = below ? r.bottom + gap : r.top - gap - h;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    pop.style.top = `${Math.round(top)}px`;
    pop.style.left = `${Math.round(left)}px`;
    pop.dataset['side'] = below ? 'below' : 'above';
    pop.style.setProperty('--arrow-x', `${Math.round(r.left + r.width / 2 - left)}px`);
    const frame = requestAnimationFrame(() => pop.classList.add('is-in'));
    return () => cancelAnimationFrame(frame);
  }, [current]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const anchor = helpState().anchor;
      if (event.key !== 'Escape' || !anchor) return;
      helpTips.hide();
      anchor.focus();
      event.preventDefault();
      event.stopPropagation();
    };
    const onPointer = (event: PointerEvent) => {
      const state = helpState();
      if (!state.pinned) return;
      const target = event.target as Node | null;
      if (target === state.anchor || (target && ref.current?.contains(target))) return;
      helpTips.hide();
    };
    const onScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (helpState().anchor && !(target && ref.current?.contains(target))) helpTips.hide();
    };
    const onResize = () => helpTips.hide();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return createPortal(
    <FloatingCard
      ref={ref}
      id="helpPop"
      className="help-pop"
      role="tooltip"
      hidden={current.anchor == null}
      onPointerEnter={() => helpTips.cancelHide()}
      onPointerLeave={() => {
        if (!helpState().pinned) helpTips.scheduleHide();
      }}
    >
      {current.text}
    </FloatingCard>,
    document.body,
  );
}

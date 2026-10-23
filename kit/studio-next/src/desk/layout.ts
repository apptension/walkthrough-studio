import { dragFrame, releaseDrag, sideRange, timelineRange, TL_CLOSED, TL_MIN, type PanelRange } from '@/logic/panelSize';

import { bridges } from './bridge';
import { desk } from './store';

/**
 * Panel widths and the editor timeline height — `wirePanelResize()` from
 * `kit/studio/app.js`. The sizes live in CSS custom properties on <html>, so a
 * drag never re-renders React.
 *
 * Each side has two properties: `--left-w` is the panel's open width (its content is
 * laid out at this width), `--left-col` overrides the grid column while it slides —
 * mid-drag, or `0px` once folded. Dropping `--left-col` hands the column back to
 * `--left-w`, and `.workspace`'s grid transition animates the difference.
 */

const STORE_KEY = 'wt-studio-panels';
const TL_DEFAULT = 400;
/** Pointer travel below this is a click, not a drag. */
const CLICK_SLOP = 4;

type Side = 'left' | 'right';

const SIDES = {
  left: { width: '--left-w', col: '--left-col', fallback: 268, folded: 'left-collapsed', closing: 'left-closing', name: 'left panel' },
  right: { width: '--right-w', col: '--right-col', fallback: 304, folded: 'right-collapsed', closing: 'right-closing', name: 'right panel' },
} as const;

const root = () => document.documentElement;
const readPx = (name: string, fallback: number) =>
  parseInt(getComputedStyle(root()).getPropertyValue(name), 10) || fallback;

let tlExpanded = TL_DEFAULT;
const folded: Record<Side, boolean> = { left: false, right: false };
const handles: Partial<Record<Side | 'timeline', HTMLElement>> = {};

interface StoredPanels {
  left?: number;
  right?: number;
  leftCollapsed?: boolean;
  rightCollapsed?: boolean;
  tl?: number;
  tlCollapsed?: boolean;
}

function readStored(): StoredPanels {
  try {
    return (JSON.parse(localStorage.getItem(STORE_KEY) || '{}') as StoredPanels | null) ?? {};
  } catch {
    return {};
  }
}

function save(): void {
  localStorage.setItem(
    STORE_KEY,
    JSON.stringify({
      left: openWidth('left'),
      right: openWidth('right'),
      leftCollapsed: folded.left,
      rightCollapsed: folded.right,
      tl: tlExpanded,
      tlCollapsed: desk.get().tlCollapsed,
    }),
  );
}

function renderEditorClips(): void {
  if (bridges.editor?.active) bridges.editor.renderClips();
}

const openWidth = (side: Side) => readPx(SIDES[side].width, SIDES[side].fallback);

/** Width the side column takes right now (0 when folded). */
function columnWidth(side: Side): number {
  if (folded[side]) return 0;
  const col = root().style.getPropertyValue(SIDES[side].col);
  return col ? parseInt(col, 10) || 0 : openWidth(side);
}

function rangeFor(side: Side): PanelRange {
  const ws = document.getElementById('workspace')?.getBoundingClientRect().width || window.innerWidth;
  return sideRange(side, { workspace: ws, other: columnWidth(side === 'left' ? 'right' : 'left') });
}

function describeSide(side: Side): void {
  const handle = handles[side];
  if (!handle) return;
  const r = rangeFor(side);
  const { name } = SIDES[side];
  handle.setAttribute('aria-expanded', folded[side] ? 'false' : 'true');
  handle.setAttribute('aria-valuemin', String(r.min));
  handle.setAttribute('aria-valuemax', String(r.max));
  handle.setAttribute('aria-valuenow', String(folded[side] ? 0 : openWidth(side)));
  handle.title = folded[side]
    ? `Show the ${name} — click, or drag it out`
    : `Drag to resize the ${name} · drag past the edge or double-click to hide`;
}

function describeTimeline(): void {
  const handle = handles.timeline;
  if (!handle) return;
  const collapsed = desk.get().tlCollapsed;
  const r = timelineRange(window.innerHeight);
  handle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  handle.setAttribute('aria-valuemin', String(r.min));
  handle.setAttribute('aria-valuemax', String(r.max));
  handle.setAttribute('aria-valuenow', String(collapsed ? TL_CLOSED : tlExpanded));
  handle.title = collapsed
    ? 'Show the timeline — click, or drag it up'
    : 'Drag to resize the timeline · drag to the bottom or double-click to fold';
}

/** Fold or unfold a side panel; the grid transition animates the column. */
export function setSideCollapsed(side: Side, next: boolean): void {
  const s = SIDES[side];
  folded[side] = next;
  document.body.classList.remove(s.closing);
  document.body.classList.toggle(s.folded, next);
  if (next) root().style.setProperty(s.col, '0px');
  else root().style.removeProperty(s.col);
  describeSide(side);
  describeSide(side === 'left' ? 'right' : 'left');
  save();
}

export function toggleSide(side: Side): void {
  setSideCollapsed(side, !folded[side]);
}

function syncTlToggle(collapsed: boolean): void {
  document.body.classList.toggle('tl-collapsed', collapsed);
}

export function setTlCollapsed(next: boolean): void {
  const collapsed = desk.get().tlCollapsed;
  if (!next && collapsed) root().style.setProperty('--tl-h-editor', `${tlExpanded}px`);
  if (next && !collapsed) {
    const cur = readPx('--tl-h-editor', tlExpanded);
    if (cur >= TL_MIN) tlExpanded = cur;
    root().style.setProperty('--tl-h-editor', `${tlExpanded}px`);
  }
  desk.set({ tlCollapsed: next });
  syncTlToggle(next);
  describeTimeline();
  save();
  renderEditorClips();
}

export function toggleTl(): void {
  setTlCollapsed(!desk.get().tlCollapsed);
}

/**
 * Shared pointer loop: `paint(raw)` per animation frame while dragging, `finish(raw, moved)`
 * on release. `raw` is the size the pointer asks for, unclamped.
 */
function trackDrag(
  e: PointerEvent,
  handle: HTMLElement,
  axis: 'x' | 'y',
  bodyClass: string,
  sizeAt: (delta: number) => number,
  paint: (raw: number) => void,
  finish: (raw: number, moved: boolean) => void,
): void {
  const origin = axis === 'x' ? e.clientX : e.clientY;
  let raw = sizeAt(0);
  let moved = false;
  let frame = 0;
  document.body.classList.add(bodyClass);
  handle.classList.add('is-active');
  const onMove = (ev: PointerEvent) => {
    const delta = (axis === 'x' ? ev.clientX : ev.clientY) - origin;
    if (!moved && Math.abs(delta) < CLICK_SLOP) return;
    moved = true;
    raw = sizeAt(delta);
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint(raw);
    });
  };
  const onUp = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    handle.classList.remove('is-active', 'is-armed');
    // Re-enable the size transition before settling, so a snap/fold animates.
    document.body.classList.remove(bodyClass);
    finish(raw, moved);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function bindSide(handle: HTMLElement, side: Side): () => void {
  const s = SIDES[side];
  const sign = side === 'left' ? 1 : -1;

  const onDown = (e: PointerEvent) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    const start = columnWidth(side);
    const r = rangeFor(side);
    trackDrag(
      e,
      handle,
      'x',
      'is-resizing',
      (dx) => start + sign * dx,
      (raw) => {
        const f = dragFrame(raw, r);
        if (folded[side]) {
          folded[side] = false;
          document.body.classList.remove(s.folded);
        }
        root().style.setProperty(s.col, `${f.size}px`);
        handle.classList.toggle('is-armed', f.armed);
        document.body.classList.toggle(s.closing, f.armed);
      },
      (raw, moved) => {
        if (!moved) {
          if (folded[side]) setSideCollapsed(side, false);
          return;
        }
        const end = releaseDrag(raw, r);
        if (end.collapse) {
          setSideCollapsed(side, true);
          return;
        }
        if (end.size != null) root().style.setProperty(s.width, `${end.size}px`);
        setSideCollapsed(side, false);
      },
    );
  };

  const onKey = (e: KeyboardEvent) => {
    const r = rangeFor(side);
    const cur = openWidth(side);
    const set = (n: number) => {
      root().style.setProperty(s.width, `${Math.min(r.max, Math.max(r.min, n))}px`);
      if (folded[side]) setSideCollapsed(side, false);
      else {
        describeSide(side);
        save();
      }
    };
    const step = e.shiftKey ? 24 : 12;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const grow = (e.key === 'ArrowRight') === (side === 'left');
      set(grow ? cur + step : cur - step);
    } else if (e.key === 'Home') set(r.min);
    else if (e.key === 'End') set(r.max);
    else if (e.key === 'Enter' || e.key === ' ') toggleSide(side);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onDouble = (e: MouseEvent) => {
    e.preventDefault();
    toggleSide(side);
  };

  handle.addEventListener('pointerdown', onDown);
  handle.addEventListener('keydown', onKey);
  handle.addEventListener('dblclick', onDouble);
  return () => {
    handle.removeEventListener('pointerdown', onDown);
    handle.removeEventListener('keydown', onKey);
    handle.removeEventListener('dblclick', onDouble);
  };
}

function bindTimeline(handle: HTMLElement): () => void {
  const onDown = (e: PointerEvent) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    const wasCollapsed = desk.get().tlCollapsed;
    const shell = document.querySelector('.timeline-shell');
    const start = wasCollapsed
      ? TL_CLOSED
      : shell?.getBoundingClientRect().height || readPx('--tl-h-editor', tlExpanded) || tlExpanded;
    const r = timelineRange(window.innerHeight);
    trackDrag(
      e,
      handle,
      'y',
      'is-resizing-y',
      // Drag up → taller timeline (same feel as pulling a Premiere panel).
      (dy) => start - dy,
      (raw) => {
        const f = dragFrame(raw, r);
        if (desk.get().tlCollapsed) {
          desk.set({ tlCollapsed: false });
          syncTlToggle(false);
        }
        root().style.setProperty('--tl-h-editor', `${f.size}px`);
        handle.classList.toggle('is-armed', f.armed);
        document.body.classList.toggle('tl-closing', f.armed);
        renderEditorClips();
      },
      (raw, moved) => {
        document.body.classList.remove('tl-closing');
        if (!moved) {
          if (wasCollapsed) setTlCollapsed(false);
          return;
        }
        const end = releaseDrag(raw, r);
        if (end.collapse) {
          desk.set({ tlCollapsed: false });
          setTlCollapsed(true);
          return;
        }
        if (end.size != null) tlExpanded = end.size;
        root().style.setProperty('--tl-h-editor', `${tlExpanded}px`);
        if (desk.get().tlCollapsed) setTlCollapsed(false);
        else {
          describeTimeline();
          save();
          renderEditorClips();
        }
      },
    );
  };

  const onKey = (e: KeyboardEvent) => {
    const r = timelineRange(window.innerHeight);
    const step = e.shiftKey ? 32 : 16;
    const set = (n: number) => {
      tlExpanded = Math.round(Math.min(r.max, Math.max(r.min, n)));
      root().style.setProperty('--tl-h-editor', `${tlExpanded}px`);
      if (desk.get().tlCollapsed) setTlCollapsed(false);
      else {
        describeTimeline();
        save();
        renderEditorClips();
      }
    };
    if (e.key === 'ArrowUp') set(tlExpanded + step);
    else if (e.key === 'ArrowDown') set(tlExpanded - step);
    else if (e.key === 'Home') set(r.min);
    else if (e.key === 'End') set(r.max);
    else if (e.key === 'Enter' || e.key === ' ') toggleTl();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onDouble = (e: MouseEvent) => {
    e.preventDefault();
    toggleTl();
  };

  handle.addEventListener('pointerdown', onDown);
  handle.addEventListener('keydown', onKey);
  handle.addEventListener('dblclick', onDouble);
  return () => {
    handle.removeEventListener('pointerdown', onDown);
    handle.removeEventListener('keydown', onKey);
    handle.removeEventListener('dblclick', onDouble);
  };
}

/** Restore the stored layout and bind the three resize handles. Returns an unbind. */
export function wirePanelResize(): () => void {
  const stored = readStored();
  if (stored.left) root().style.setProperty('--left-w', `${stored.left}px`);
  if (stored.right) root().style.setProperty('--right-w', `${stored.right}px`);
  let tl = Number(stored.tl);
  if (!Number.isFinite(tl)) {
    try {
      tl = Number(localStorage.getItem('wts.timeline.height'));
    } catch {
      tl = NaN;
    }
  }
  tlExpanded = Number.isFinite(tl) && tl >= TL_MIN ? Math.round(tl) : TL_DEFAULT;
  root().style.setProperty('--tl-h-editor', `${tlExpanded}px`);
  const collapsed = !!stored.tlCollapsed;
  desk.set({ tlCollapsed: collapsed });
  syncTlToggle(collapsed);

  handles.left = document.getElementById('resizeLeft') ?? undefined;
  handles.right = document.getElementById('resizeRight') ?? undefined;
  handles.timeline = document.getElementById('resizeTimeline') ?? undefined;

  for (const side of ['left', 'right'] as const) {
    const want = side === 'left' ? !!stored.leftCollapsed : !!stored.rightCollapsed;
    folded[side] = want;
    document.body.classList.remove(SIDES[side].closing);
    document.body.classList.toggle(SIDES[side].folded, want);
    if (want) root().style.setProperty(SIDES[side].col, '0px');
    else root().style.removeProperty(SIDES[side].col);
  }
  describeSide('left');
  describeSide('right');
  describeTimeline();

  const unbind: Array<() => void> = [];
  if (handles.left) unbind.push(bindSide(handles.left, 'left'));
  if (handles.right) unbind.push(bindSide(handles.right, 'right'));
  if (handles.timeline) unbind.push(bindTimeline(handles.timeline));
  return () => unbind.forEach((fn) => fn());
}

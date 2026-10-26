import { dropPanelPlace, layoutStagePanels, modeOf, nudgePanelPlace, panelDragFrame, parsePanelPlace, serializePanelPlace, type Box, type DragZone, type PanelInput, type PanelOut, type PanelPlace, type Spot } from './stageDock';
import type { TbSize } from './textBarPlace';
import { $, escapeHtml } from './util';

/**
 * The stage control panels — copy, zoom and magnifier — as one family.
 *
 * Every panel has the same anatomy (grip, icon, title, live value, controls, a "?" that holds the
 * shortcuts, collapse, remove) and the same behaviour: it collapses into a labelled pill, drags
 * anywhere in the monitor area, docks onto the top or bottom rail, or attaches back to the thing
 * it edits. All visible panels are laid out together, so two or three on one slide share the
 * rails and keep off each other instead of piling up.
 */

export type PanelId = 'text' | 'zoom' | 'lens';

interface PanelSpec {
  id: PanelId;
  elId: string;
  order: number;
  placeKey: string;
  collapsedKey: string;
  /** Legacy keys dropped on first read. */
  legacy?: string[];
  fallback: () => PanelPlace;
  /** Where an attached panel may sit, and what it must not cover — host px. */
  spots?: (size: TbSize, host: DOMRect) => { spots: Spot[]; avoid?: Box[] } | null;
}

export const PANEL_KEYS = {
  text: { place: 'wts.edTextBar.place', collapsed: 'wts.edTextBar.collapsed', legacy: ['wts.edTextBar.pos'] },
  zoom: { place: 'wts.stagePanel.zoom.place', collapsed: 'wts.stagePanel.zoom.collapsed' },
  lens: { place: 'wts.stagePanel.lens.place', collapsed: 'wts.stagePanel.lens.collapsed' },
} as const;

/** Gap between an attached panel and the thing it edits (screen px). */
const ATTACH_GAP = 14;
/** The zoom bar clears the zoom frame's corner grips. */
const ZOOM_INSET = 30;

let textPrefersTop = false;
const holds = new Map<PanelId, { dx: number; dy: number }>();

const rectIn = (el: Element | null, host: DOMRect): Box | null => {
  if (!el || (el as HTMLElement).hidden) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: r.left - host.left, y: r.top - host.top, w: r.width, h: r.height };
};

/** The zoom bar rides inside the zoom frame — top centre first, bottom centre if that is taken. */
function zoomSpots(size: TbSize, host: DOMRect): { spots: Spot[] } | null {
  const frame = rectIn($('liveZoomBox')?.hidden ? null : $('stageAim'), host);
  if (!frame) return null;
  const cx = frame.x + frame.w / 2;
  return {
    spots: [
      { cx, cy: frame.y + ZOOM_INSET + size.h / 2, weight: 4 },
      { cx, cy: frame.y + frame.h - ZOOM_INSET - size.h / 2, weight: 2 },
      { cx, cy: frame.y - ATTACH_GAP - size.h / 2, weight: 0 },
    ],
  };
}

/**
 * The magnifier bar sits just off the ring, biased toward the middle of the stage so it reads
 * naturally in corners; while the ring is dragged it rides along at a fixed offset.
 */
function lensSpots(size: TbSize, host: DOMRect): { spots: Spot[]; avoid: Box[] } | null {
  const ring = rectIn($('liveLensBox'), host);
  if (!ring) return null;
  const ccx = ring.x + ring.w / 2;
  const ccy = ring.y + ring.h / 2;
  const avoid = [{ x: ring.x - ATTACH_GAP / 2, y: ring.y - ATTACH_GAP / 2, w: ring.w + ATTACH_GAP, h: ring.h + ATTACH_GAP }];
  const hold = holds.get('lens');
  if (hold) return { spots: [{ cx: ccx + hold.dx, cy: ccy + hold.dy, hold: true }], avoid };
  const r = Math.min(ring.w, ring.h) / 2;
  const tx = host.width / 2 - ccx;
  const ty = host.height / 2 - ccy;
  const len = Math.hypot(tx, ty);
  const dirs: Array<[number, number, number]> = [
    [0, 1, 1.5],
    [0, -1, 1.2],
    [1, 0, 0],
    [-1, 0, 0],
  ];
  if (len > 6) dirs.push([tx / len, ty / len, 5]);
  const spots = dirs.map(([ux, uy, weight]) => {
    // Distance along the direction until the panel's box clears the ring.
    const reach = r + ATTACH_GAP + (size.w / 2) * Math.abs(ux) + (size.h / 2) * Math.abs(uy);
    return { cx: ccx + ux * reach, cy: ccy + uy * reach, weight };
  });
  return { spots, avoid };
}

const SPECS: PanelSpec[] = [
  {
    id: 'text',
    elId: 'edTextBar',
    order: 0,
    placeKey: PANEL_KEYS.text.place,
    collapsedKey: PANEL_KEYS.text.collapsed,
    legacy: [...PANEL_KEYS.text.legacy],
    fallback: () => ({ dock: textPrefersTop ? 'top' : 'bottom' }),
  },
  { id: 'zoom', elId: 'edZoomPanel', order: 1, placeKey: PANEL_KEYS.zoom.place, collapsedKey: PANEL_KEYS.zoom.collapsed, fallback: () => ({ dock: 'attach' }), spots: zoomSpots },
  { id: 'lens', elId: 'edLensPanel', order: 2, placeKey: PANEL_KEYS.lens.place, collapsedKey: PANEL_KEYS.lens.collapsed, fallback: () => ({ dock: 'attach' }), spots: lensSpots },
];

const specOf = (id: PanelId): PanelSpec => SPECS.find((s) => s.id === id)!;
const elOf = (id: PanelId): HTMLElement | null => $(specOf(id).elId);
const idOf = (el: Element): PanelId | null => (SPECS.find((s) => s.elId === el.id)?.id ?? null);

// ─── Preferences ────────────────────────────────────────────────────────────────────────

export function panelPlace(id: PanelId): PanelPlace | null {
  const spec = specOf(id);
  try {
    const p = parsePanelPlace(localStorage.getItem(spec.placeKey));
    for (const k of spec.legacy || []) if (localStorage.getItem(k) != null) localStorage.removeItem(k);
    return p;
  } catch {
    return null;
  }
}

export function savePanelPlace(id: PanelId, p: PanelPlace | null): void {
  try {
    const key = specOf(id).placeKey;
    if (p) localStorage.setItem(key, serializePanelPlace(p));
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const effectivePanelPlace = (id: PanelId): PanelPlace => panelPlace(id) || specOf(id).fallback();

export function panelCollapsed(id: PanelId): boolean {
  try {
    return localStorage.getItem(specOf(id).collapsedKey) === '1';
  } catch {
    return false;
  }
}

function savePanelCollapsed(id: PanelId, on: boolean): void {
  try {
    const key = specOf(id).collapsedKey;
    if (on) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** With no saved spot the copy bar goes to the top while a caption owns the lower third. */
export function setTextPrefersTop(on: boolean): boolean {
  const changed = on !== textPrefersTop;
  textPrefersTop = on;
  return changed;
}

/** Pin an attached panel at a fixed offset from its owner while the owner is dragged. */
export function holdPanel(id: PanelId, offset: { dx: number; dy: number } | null): void {
  if (offset) holds.set(id, offset);
  else holds.delete(id);
}

// ─── Host & layout ──────────────────────────────────────────────────────────────────────

let layoutRaf = 0;
const hideTimers = new Map<PanelId, number>();

type Drag = {
  id: PanelId;
  el: HTMLElement;
  pointer: number;
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  host: HTMLElement;
  live: boolean;
  zone: DragZone;
  raw: { cx: number; cy: number } | null;
  spots: Spot[] | undefined;
};
let drag: Drag | null = null;
let suppressClick = false;

const motionOk = (): boolean => typeof matchMedia === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The monitor area once wired (panels can leave the video box), else their React home. */
export function panelHost(): HTMLElement | null {
  return elOf('text')?.parentElement || elOf('zoom')?.parentElement || null;
}

/** A fullscreen stage hides the monitor area, so panels fall back to their React home then. */
function homeFor(from: HTMLElement): HTMLElement {
  const wrap = from.closest<HTMLElement>('.stage-wrap');
  const fs = document.fullscreenElement;
  if (!wrap || (fs && fs.contains(from) && !fs.contains(wrap))) return from;
  return wrap;
}

const sizeOf = (el: HTMLElement): TbSize => ({ w: el.offsetWidth || 240, h: el.offsetHeight || 40 });
const shown = (el: HTMLElement): boolean => !el.hidden && !el.classList.contains('is-leaving');

function setCoords(el: HTMLElement, x: number, y: number): void {
  el.style.setProperty('--sp-x', `${Math.round(x * 10) / 10}px`);
  el.style.setProperty('--sp-y', `${Math.round(y * 10) / 10}px`);
}

/** Apply with transitions off (first show, resize, riding a drag) so the panel doesn't glide. */
function instantly(el: HTMLElement, fn: () => void): void {
  el.classList.add('is-instant');
  fn();
  void el.offsetWidth;
  el.classList.remove('is-instant');
}

function applyBox(el: HTMLElement, box: PanelOut, host: TbSize, instant: boolean): void {
  el.classList.toggle('is-dock-top', box.mode === 'top');
  el.classList.toggle('is-dock-bottom', box.mode === 'bottom');
  el.classList.toggle('is-placed', box.mode === 'free');
  el.classList.toggle('is-attached', box.mode === 'attach');
  // The shortcut card opens toward the roomier side.
  el.dataset['pop'] = box.y + box.h / 2 > host.h / 2 ? 'up' : 'down';
  if (instant) instantly(el, () => setCoords(el, box.x, box.y));
  else setCoords(el, box.x, box.y);
}

export interface LayoutOpts {
  /** Panels (or all, `true`) that jump instead of gliding. */
  instant?: boolean | PanelId[];
  /** Sizes to lay out against — a morphing panel's target size. */
  sizes?: Partial<Record<PanelId, TbSize>>;
}

/** Lay every visible panel out together. A panel in a drag or under a slider thumb stays put. */
export function layoutPanels({ instant = false, sizes = {} }: LayoutOpts = {}): void {
  const host = panelHost();
  if (!host || host.clientWidth < 40 || host.clientHeight < 40) return;
  const hostSize = { w: host.clientWidth, h: host.clientHeight };
  const hostRect = host.getBoundingClientRect();
  const inputs: PanelInput[] = [];
  const els = new Map<PanelId, HTMLElement>();
  for (const spec of SPECS) {
    const el = $(spec.elId);
    if (!el || el.parentElement !== host || !shown(el)) continue;
    if (drag?.live && drag.id === spec.id) continue;
    const size = sizes[spec.id] || sizeOf(el);
    const place = effectivePanelPlace(spec.id);
    const att = place.dock === 'attach' ? spec.spots?.(size, hostRect) : null;
    inputs.push({ id: spec.id, size, place, order: spec.order, spots: att?.spots, avoid: att?.avoid });
    els.set(spec.id, el);
  }
  const out = layoutStagePanels(hostSize, inputs);
  for (const [id, el] of els) {
    const box = out[id];
    if (!box || el.classList.contains('is-adjusting')) continue;
    if (el.classList.contains('is-morphing') && !sizes[id]) continue;
    const jump = instant === true || (Array.isArray(instant) && instant.includes(id)) || !el.style.getPropertyValue('--sp-x');
    applyBox(el, box, hostSize, jump);
  }
}

export function schedulePanelLayout(): void {
  if (layoutRaf) return;
  layoutRaf = requestAnimationFrame(() => {
    layoutRaf = 0;
    layoutPanels();
  });
}

// ─── Show / hide / collapse ─────────────────────────────────────────────────────────────

function syncInert(el: HTMLElement): void {
  const collapsed = el.classList.contains('is-collapsed');
  el.querySelector(':scope > .sp-full')?.toggleAttribute('inert', collapsed);
  el.querySelector(':scope > .sp-mini')?.toggleAttribute('inert', !collapsed);
}

/**
 * Show with the entrance, hide after a short exit so a panel never just blinks out. Returns true
 * when the panel is entering (callers lay it out instantly then). The others reflow either way.
 */
export function showPanel(id: PanelId, show: boolean): boolean {
  const el = elOf(id);
  if (!el) return false;
  if (show) {
    const entering = el.hidden || el.classList.contains('is-leaving');
    clearTimeout(hideTimers.get(id));
    hideTimers.delete(id);
    el.classList.remove('is-leaving');
    el.hidden = false;
    if (el.classList.contains('is-collapsed') !== panelCollapsed(id) && !el.classList.contains('is-morphing')) el.classList.toggle('is-collapsed', panelCollapsed(id));
    syncInert(el);
    if (entering) {
      el.style.removeProperty('--sp-x');
      layoutPanels({ instant: [id] });
    }
    return entering;
  }
  if (el.hidden || hideTimers.has(id)) return false;
  if (drag?.id === id) endDrag(null);
  const finish = () => {
    hideTimers.delete(id);
    if (motionOk() && !el.classList.contains('is-leaving')) return;
    el.classList.remove('is-leaving');
    el.hidden = true;
    schedulePanelLayout();
  };
  if (!motionOk()) {
    finish();
    return false;
  }
  el.classList.add('is-leaving');
  hideTimers.set(id, window.setTimeout(finish, 190));
  return false;
}

/** Pill ⇄ panel. Morphs by pinning the old box size, then transitioning to the new natural size. */
export function setPanelCollapsed(id: PanelId, on: boolean, { focus = false }: { focus?: boolean } = {}): void {
  const el = elOf(id);
  if (!el) return;
  savePanelCollapsed(id, on);
  if (el.classList.contains('is-collapsed') === on) return;
  const morph = motionOk() && !el.hidden;
  const from = { w: el.offsetWidth, h: el.offsetHeight };
  el.classList.remove('is-morphing');
  el.style.removeProperty('width');
  el.style.removeProperty('height');
  el.classList.toggle('is-collapsed', on);
  syncInert(el);
  if (focus) el.querySelector<HTMLElement>(on ? '[data-sp-expand]' : '[data-sp-collapse]')?.focus({ preventScroll: true });
  if (!morph || !from.w) {
    layoutPanels({ instant: [id] });
    return;
  }
  const to = { w: el.offsetWidth, h: el.offsetHeight };
  el.style.width = `${from.w}px`;
  el.style.height = `${from.h}px`;
  void el.offsetWidth;
  // The morph transition must be on before the target size is set; layout flushes styles.
  el.classList.add('is-morphing');
  el.style.width = `${to.w}px`;
  el.style.height = `${to.h}px`;
  // Against the target size, so the panel (and its neighbours) glide to where it will end up.
  layoutPanels({ sizes: { [id]: to } });
  const done = () => {
    clearTimeout(timer);
    el.removeEventListener('transitionend', onEnd);
    el.classList.remove('is-morphing');
    el.style.removeProperty('width');
    el.style.removeProperty('height');
    layoutPanels({ instant: [id] });
  };
  const onEnd = (e: TransitionEvent) => {
    if (e.target === el && e.propertyName === 'width') done();
  };
  const timer = window.setTimeout(done, 620);
  el.addEventListener('transitionend', onEnd);
}

// ─── Shortcut card ──────────────────────────────────────────────────────────────────────

export const COLLAPSE_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path class="sp-chev-l" d="m4.5 7.5 4.5 4.5-4.5 4.5"/><path class="sp-chev-r" d="m19.5 7.5-4.5 4.5 4.5 4.5"/></svg>`;

export interface HelpRow {
  keys: string[];
  label: string;
}

/** The "?" and the shortcut card it reveals on hover or focus. */
export function panelHelpHtml(title: string, rows: HelpRow[]): string {
  const body = rows
    .map((r) => `<span class="sp-help-row"><span class="sp-help-keys">${r.keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join('')}</span><span class="sp-help-label">${escapeHtml(r.label)}</span></span>`)
    .join('');
  return `<button type="button" class="sp-icon-btn sp-help-btn" data-sp-help aria-label="${escapeHtml(title)} shortcuts" aria-haspopup="true"><span aria-hidden="true">?</span></button><span class="sp-help-pop" role="tooltip"><strong class="sp-help-title">${escapeHtml(title)}</strong>${body}</span>`;
}

/** Paint a panel's "?" slot; only touches the DOM when the shortcuts change. */
export function paintPanelHelp(slot: Element | null | undefined, title: string, rows: HelpRow[]): void {
  const el = slot as HTMLElement | null | undefined;
  if (!el) return;
  const html = panelHelpHtml(title, rows);
  if (el.dataset['html'] === html) return;
  el.dataset['html'] = html;
  el.innerHTML = html;
}

/** Moving any panel: the same three lines at the foot of every shortcut card. */
export const PANEL_MOVE_HELP: HelpRow[] = [
  { keys: ['Drag'], label: 'the grip or pill to move · edges dock' },
  { keys: ['Double-click'], label: 'the grip to put it back' },
  { keys: ['←', '→', '↑', '↓'], label: 'nudge the grip · Home / End docks' },
];

// ─── Drag ───────────────────────────────────────────────────────────────────────────────

function setZone(host: HTMLElement, zone: DragZone, spot: Spot | null, size: TbSize): void {
  host.querySelectorAll<HTMLElement>(':scope > [data-sp-zone]').forEach((z) => z.classList.toggle('is-hot', z.dataset['spZone'] === zone));
  const ghost = host.querySelector<HTMLElement>(':scope > .sp-attach-ghost');
  if (!ghost) return;
  ghost.classList.toggle('is-hot', zone === 'attach' && Boolean(spot));
  if (spot) {
    ghost.style.width = `${size.w}px`;
    ghost.style.height = `${size.h}px`;
    ghost.style.translate = `${spot.cx - size.w / 2}px ${spot.cy - size.h / 2}px`;
  }
}

function endDrag(e: PointerEvent | null): void {
  const d = drag;
  if (!d) return;
  drag = null;
  d.host.classList.remove('is-sp-dragging');
  d.host.removeAttribute('data-sp-dragging');
  setZone(d.host, null, null, { w: 0, h: 0 });
  d.el.classList.remove('is-dragging', 'is-magnet');
  if (e) {
    try {
      d.el.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }
  if (!d.live) return;
  suppressClick = true;
  setTimeout(() => (suppressClick = false), 0);
  if (d.raw) {
    const size = sizeOf(d.el);
    const p = dropPanelPlace(d.raw.cx, d.raw.cy, { w: d.host.clientWidth, h: d.host.clientHeight }, size, d.spots);
    savePanelPlace(d.id, p);
    if (p.dock !== 'free' && motionOk()) {
      d.el.classList.remove('is-snapped');
      void d.el.offsetWidth;
      d.el.classList.add('is-snapping', 'is-snapped');
      setTimeout(() => d.el.classList.remove('is-snapping', 'is-snapped'), 640);
    }
  }
  layoutPanels();
}

const ZONES = ['top', 'bottom'] as const;

function mountZones(host: HTMLElement): void {
  for (const zone of ZONES) {
    if (host.querySelector(`:scope > [data-sp-zone="${zone}"]`)) continue;
    host.insertAdjacentHTML('beforeend', `<div class="sp-zone" data-sp-zone="${zone}" aria-hidden="true"><i class="sp-slot"></i><span class="sp-zone-label">Dock ${zone}</span></div>`);
  }
  if (!host.querySelector(':scope > .sp-attach-ghost')) host.insertAdjacentHTML('beforeend', `<div class="sp-attach-ghost" aria-hidden="true"><span>Attach</span></div>`);
}

function unmountZones(host: HTMLElement | null): void {
  host?.querySelectorAll(':scope > [data-sp-zone], :scope > .sp-attach-ghost').forEach((z) => z.remove());
  host?.classList.remove('has-sp-panels', 'is-sp-dragging');
}

function wirePanel(el: HTMLElement, signal: AbortSignal): void {
  const id = idOf(el);
  if (!id) return;
  el.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      const handle = target.closest('[data-sp-grip], [data-sp-expand]');
      // Any quiet part of a panel drags; real controls keep their clicks.
      const quiet = !target.closest('button, a, input, textarea, select, label, output, [data-text], .sp-help');
      if (!handle && !quiet) return;
      e.preventDefault();
      e.stopPropagation();
      const host = panelHost();
      if (!host) return;
      const r = el.getBoundingClientRect();
      drag = { id, el, pointer: e.pointerId, sx: e.clientX, sy: e.clientY, ox: e.clientX - (r.left + r.width / 2), oy: e.clientY - (r.top + r.height / 2), host, live: false, zone: null, raw: null, spots: undefined };
    },
    { signal },
  );
  el.addEventListener(
    'click',
    (e) => {
      if (suppressClick) {
        suppressClick = false;
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest('[data-sp-collapse]')) setPanelCollapsed(id, true, { focus: true });
      else if (target.closest('[data-sp-expand]')) setPanelCollapsed(id, false, { focus: true });
    },
    { signal, capture: true },
  );
  el.addEventListener(
    'dblclick',
    (e) => {
      const target = e.target as HTMLElement;
      e.stopPropagation();
      if (!target.closest('[data-sp-grip]') && target !== el) return;
      savePanelPlace(id, null);
      layoutPanels();
    },
    { signal },
  );
  el.addEventListener(
    'keydown',
    (e) => {
      if (!(e.target as HTMLElement).closest('[data-sp-grip]')) return;
      const host = panelHost();
      if (!host) return;
      if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        e.stopPropagation();
        savePanelPlace(id, { dock: e.key === 'Home' ? 'top' : 'bottom' });
        layoutPanels();
        return;
      }
      const step = e.shiftKey ? 48 : 12;
      const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const d = delta[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      const size = sizeOf(el);
      const hr = host.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const centre = r.width ? { cx: r.left - hr.left + r.width / 2, cy: r.top - hr.top + r.height / 2 } : { cx: host.clientWidth / 2, cy: host.clientHeight / 2 };
      savePanelPlace(id, nudgePanelPlace(effectivePanelPlace(id), centre, d[0], d[1], { w: host.clientWidth, h: host.clientHeight }, size));
      layoutPanels();
    },
    { signal },
  );
}

/**
 * Move the panels into the monitor area, wire drag / collapse / dock / keyboard for each, and
 * keep them laid out as the stage resizes. Everything unbinds through `signal`.
 */
export function wireStagePanels(signal: AbortSignal): void {
  const first = SPECS.map((s) => $(s.elId)).find(Boolean);
  if (!first || first.dataset['spWired']) return;
  const els = SPECS.map((s) => $(s.elId)).filter((el): el is HTMLElement => Boolean(el));
  for (const el of els) el.dataset['spWired'] = '1';
  const home = first.parentElement;
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => schedulePanelLayout()) : null;
  const rehome = () => {
    if (!home) return;
    const next = homeFor(home);
    const prev = els[0]?.parentElement || null;
    if (prev === next) return;
    if (drag) endDrag(null);
    if (prev && prev !== home) unmountZones(prev);
    for (const el of els) next.appendChild(el);
    if (next !== home) {
      next.classList.add('has-sp-panels');
      mountZones(next);
    }
    if (prev) ro?.unobserve(prev);
    ro?.observe(next);
    layoutPanels({ instant: true });
  };
  rehome();
  for (const el of els) {
    ro?.observe(el);
    wirePanel(el, signal);
  }
  document.addEventListener('fullscreenchange', rehome, { signal });
  window.addEventListener(
    'pointermove',
    (e) => {
      const d = drag;
      if (!d || e.pointerId !== d.pointer) return;
      if (!d.live) {
        // A small dead zone keeps a click on the pill a click.
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
        d.live = true;
        try {
          d.el.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        const size = sizeOf(d.el);
        d.spots = specOf(d.id).spots?.(size, d.host.getBoundingClientRect())?.spots?.filter((s) => !s.hold);
        d.host.style.setProperty('--sp-slot-w', `${size.w}px`);
        d.host.style.setProperty('--sp-slot-h', `${size.h}px`);
        d.host.style.setProperty('--sp-slot-r', getComputedStyle(d.el).borderTopLeftRadius || '14px');
        d.host.classList.add('is-sp-dragging');
        d.host.dataset['spDragging'] = d.id;
        d.el.classList.add('is-dragging');
        // The others close up around the gap it leaves.
        layoutPanels();
      }
      const size = sizeOf(d.el);
      const hr = d.host.getBoundingClientRect();
      const f = panelDragFrame(e.clientX - hr.left - d.ox, e.clientY - hr.top - d.oy, { w: d.host.clientWidth, h: d.host.clientHeight }, size, d.spots);
      d.raw = f.raw;
      if (f.zone !== d.zone || f.zone === 'attach') {
        d.zone = f.zone;
        setZone(d.host, f.zone, f.spot, size);
        d.el.classList.toggle('is-magnet', Boolean(f.zone));
      }
      setCoords(d.el, f.cx - size.w / 2, f.cy - size.h / 2);
    },
    { signal },
  );
  const onUp = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.pointer) endDrag(e);
  };
  window.addEventListener('pointerup', onUp, { signal });
  window.addEventListener('pointercancel', onUp, { signal });
  window.addEventListener('resize', () => layoutPanels({ instant: true }), { signal });
  signal.addEventListener('abort', () => {
    drag = null;
    ro?.disconnect();
    cancelAnimationFrame(layoutRaf);
    layoutRaf = 0;
    for (const t of hideTimers.values()) clearTimeout(t);
    hideTimers.clear();
    holds.clear();
    const host = els[0]?.parentElement || null;
    for (const el of els) delete el.dataset['spWired'];
    if (home && host !== home) {
      unmountZones(host);
      for (const el of els) home.appendChild(el);
    }
  });
}

/** The mode a panel is drawn in now (for tests and the shortcut card). */
export const panelMode = (id: PanelId) => modeOf(effectivePanelPlace(id));

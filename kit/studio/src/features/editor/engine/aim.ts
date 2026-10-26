import { FRAME_EDITOR_HIT, lensLoupe, lensZoomCeiling, planFrameEditor } from '@/logic/livePreview';
import { paintRange } from '@/ui/rangeFill';
import { clampZoomCenter } from '@/logic/zoomAim';
import { plateClockMs } from '@/logic/plateTiming';
import { LENS_SIZE_RANGE, clampLensZoom, framePointAt, lensSizeBy, nudgeStep, scaleArea, wheelFactor, zoomFromCorner, zoomFromWheel, type Range } from '@/logic/aimGestures';

import { postDeck } from './data';
import { adoptLens, adoptShot } from './edits';
import { curClip, edToRec, fxClipId, selectedLens, shotKey } from './seq';
import { lensShape, renderFrame } from './stage';
import { PANEL_MOVE_HELP, holdPanel, layoutPanels, paintPanelHelp, schedulePanelLayout, showPanel } from './stagePanels';
import { deckEdit, ed, liveH, liveW, type LensAim } from './state';
import type { Clip, DeckLens, Lens, ZoomShot } from './types';
import { $, LENS_PAD, clamp, lensCentre, loupeOrigin, r3 } from './util';

/** Zoom aim box and magnifier aim box + HUD from `kit/studio/editor.js`. */

// A MediaQueryList keeps itself current, so the query is asked once and read every frame after.
const motionQuery = typeof window !== 'undefined' ? (window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null) : null;
const reducedMotion = (): boolean => Boolean(motionQuery?.matches);

// ─── Zoom aim box (selected zoom shot, paused) ───────────────────────────────────────────
export function selectedShot(): ZoomShot | null {
  if (ed.sel?.type !== 'zoom') return null;
  const own = (ed.deck?.zoomShots || []).find((s) => shotKey(s) === ed.sel?.key);
  if (own) return own;
  // A plate's zoom never passes through the auto planner, so build the same shape from the deck.
  const z = (ed.deck?.plateZooms || []).find((p) => p.id === ed.sel?.key);
  if (!z) return null;
  const space = aimSpace(z.clip);
  return {
    id: z.id,
    clip: z.clip,
    source: 'edit',
    start: z.t,
    end: z.t + z.dur,
    zoom: z.zoom,
    points: [{ t: z.t, cx: (z.nx ?? 0.5) * space.width, cy: (z.ny ?? 0.5) * space.height }],
  };
}

/**
 * The pixel space a mark is aimed in.
 *
 * Recording marks are in capture CSS pixels; a plate has no capture, so its marks are fractions
 * of the delivered frame and are worked here in that frame's pixels.
 */
export function aimSpace(clip?: string | null): { width: number; height: number } {
  const f = clip ? ed.deck?.plateFrame : null;
  return f ? { width: f.width, height: f.height } : { width: liveW(), height: liveH() };
}

/**
 * The overlay's own geometry, as last written.
 *
 * Both aim painters place the overlay every frame, so in a still frame this would rewrite the same
 * three values 120 times a second. Each write dirties layout, and the next painter's
 * `getBoundingClientRect` then has to rebuild it — so the repaint was paying for a reflow to learn
 * what it had just been told. Writing only on a real change keeps layout clean between them.
 */
let aimPlaced: { el: HTMLElement; transform: string; width: string; height: string } | null = null;

/**
 * Lay the aim overlay onto the surface that is on stage.
 *
 * Both boxes position themselves in percentages of their parent, so moving that parent onto the
 * recording's viewport or a plate's fitted frame is all it takes for them to work on either.
 */
export function placeStageAim(clip?: string | null): void {
  const aim = $('stageAim');
  const surface = $(clip ? 'fhdCanvas' : 'liveViewport');
  if (!aim || !surface) return;
  const host = aim.offsetParent?.getBoundingClientRect();
  const box = surface.getBoundingClientRect();
  const next = {
    el: aim,
    transform: `translate(${Math.round(box.left - (host?.left ?? 0))}px, ${Math.round(box.top - (host?.top ?? 0))}px)`,
    width: `${Math.round(box.width)}px`,
    height: `${Math.round(box.height)}px`,
  };
  const was = aimPlaced;
  // A fresh overlay element carries none of these inline, so its first placement always writes.
  if (was && was.el === aim && was.transform === next.transform && was.width === next.width && was.height === next.height) return;
  aimPlaced = next;
  aim.style.transform = next.transform;
  aim.style.width = next.width;
  aim.style.height = next.height;
}

/** Where the playhead stands on whatever clock a mark is written in. */
export function markClock(clip: string | null | undefined, c: Clip | null): number | null {
  if (!clip) return c?.kind === 'live' ? edToRec(c, ed.t) : null;
  return c && fxClipId(c) === clip ? plateClockMs(c, ed.t) / 1000 : null;
}

const fmtZoom = (z: number, digits = 2): string => `${Number(z).toFixed(digits)}×`;

/** Mirror a stage slider into the Inspector's twin so both read the same value mid-drag. */
function syncInspector(selector: string, outId: string, value: number, text: string): void {
  const twin = document.querySelector<HTMLInputElement>(`#inspectorRoot ${selector}`);
  if (twin && document.activeElement !== twin) {
    twin.value = String(value);
    paintRange(twin);
  }
  const out = $(outId);
  if (out) out.textContent = text;
}

/** A wheel, key or double-click edit rests this long before it is saved — one save per gesture. */
const SETTLE_MS = 450;

const zoomRange = (): Range => ed.deck?.ranges?.zoom || [1, 3];
const lensZoomRange = (): Range => ed.deck?.ranges?.lensZoom || [1.2, 2.4];

/** Stage editors take keys once they are clicked or tabbed to; a click anywhere else lets go. */
function holdFocus(box: HTMLElement, signal: AbortSignal): void {
  box.addEventListener('pointerdown', () => box.focus({ preventScroll: true }), { signal });
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (document.activeElement === box && !box.contains(e.target as Node)) box.blur();
    },
    { capture: true, signal },
  );
}

export function paintZoomBox(): void {
  const box = $('liveZoomBox');
  const panel = $('edZoomPanel');
  if (!box) return;
  const shot = selectedShot();
  const c = curClip();
  const rec = markClock(shot?.clip, c);
  placeStageAim(shot?.clip);
  const editor = planFrameEditor({
    selected: Boolean(shot),
    blockStart: shot?.start ?? 0,
    blockEnd: shot?.end ?? 0,
    playhead: rec,
    playing: ed.playing,
    reducedMotion: reducedMotion(),
  });
  if (!editor.visible || !ed.deck || !shot) {
    box.hidden = true;
    showPanel('zoom', false);
    return;
  }
  const zoom = ed.aimZoom || shot.zoom;
  // The stage already shows the push-in; the box is a full-frame drag surface (pan) with corner
  // handles for strength — not a crop preview on a 1× frame.
  box.hidden = false;
  box.dataset['hit'] = String(FRAME_EDITOR_HIT);
  const auto = shot.source === 'auto';
  box.style.left = '0';
  box.style.top = '0';
  box.style.width = '100%';
  box.style.height = '100%';
  box.classList.toggle('is-auto', auto);
  box.classList.add('is-live');
  if (panel) paintZoomPanel(panel, zoom, auto);
  if (!showPanel('zoom', true)) schedulePanelLayout();
}

function paintZoomPanel(panel: HTMLElement, zoom: number, auto: boolean): void {
  const strength = panel.querySelector<HTMLInputElement>('[data-frame-zoom]');
  if (strength) {
    const [lo, hi] = zoomRange();
    strength.min = String(lo);
    strength.max = String(hi);
    if (document.activeElement !== strength) strength.value = String(Number(zoom.toFixed(2)));
  }
  paintRange(strength);
  const kind = panel.querySelector('[data-zoom-kind]');
  if (kind) kind.textContent = auto ? 'Auto zoom' : 'Focus zoom';
  const value = panel.querySelector('[data-zoom-value]');
  if (value) value.textContent = fmtZoom(zoom);
  const pill = panel.querySelector('[data-zoom-pill-value]');
  if (pill) pill.textContent = fmtZoom(zoom);
  const centre = panel.querySelector<HTMLElement>('[data-zoom-center]');
  if (centre) centre.hidden = auto;
  panel.classList.toggle('is-auto', auto);
  paintPanelHelp(
    panel.querySelector('[data-sp-help-slot]'),
    auto ? 'Auto zoom' : 'Zoom',
    auto
      ? [{ keys: ['Drag'], label: 'the frame to take this zoom over' }, ...PANEL_MOVE_HELP]
      : [
          { keys: ['Drag'], label: 'the frame to aim' },
          { keys: ['Drag'], label: 'a corner to push in or pull back' },
          { keys: ['Scroll'], label: 'push in or out' },
          { keys: ['Double-click'], label: 'aim at that point' },
          { keys: ['←', '→', '↑', '↓'], label: 'nudge the aim · ⇧ for bigger steps' },
          { keys: ['+', '−'], label: 'strength' },
          ...PANEL_MOVE_HELP,
        ],
  );
}

/** Where the selected zoom is aimed right now — the pending aim while one is in hand. */
function zoomAimNow(shot: ZoomShot): { cx: number; cy: number; zoom: number } {
  const { width: W, height: H } = aimSpace(shot.clip);
  const p = ed.aim || shot.points?.[0] || { cx: W / 2, cy: H / 2 };
  return { cx: p.cx, cy: p.cy, zoom: ed.aimZoom || shot.zoom };
}

/** Show a zoom aim or strength on the stage without saving it. */
function previewZoom(shot: ZoomShot, next: { cx?: number; cy?: number; zoom?: number }): void {
  const { width: W, height: H } = aimSpace(shot.clip);
  const now = zoomAimNow(shot);
  const zoom = next.zoom ?? now.zoom;
  const aim = clampZoomCenter(next.cx ?? now.cx, next.cy ?? now.cy, { zoom, width: W, height: H });
  ed.aim = { cx: aim.cx, cy: aim.cy };
  ed.aimZoom = zoom;
  paintZoomBox();
  renderFrame();
  syncInspector('[data-shot-zoom]', 'insZoomOut', zoom, fmtZoom(zoom));
}

/**
 * Save the pending aim and strength. The stage keeps showing them until the save lands —
 * clearing first would flash the old framing for a beat.
 */
async function commitZoom(shot: ZoomShot, hint: string): Promise<void> {
  const aim = ed.aim;
  const zoom = ed.aimZoom || shot.zoom;
  try {
    if (shot.source === 'auto') {
      await adoptShot(shot, { ...(aim ? { x: aim.cx, y: aim.cy } : {}), zoom });
      return;
    }
    const space = aimSpace(shot.clip);
    const at = !aim ? {} : shot.clip ? { nx: r3(aim.cx / space.width), ny: r3(aim.cy / space.height) } : { x: aim.cx, y: aim.cy };
    await postDeck({ zooms: deckEdit().zooms.map((z) => (z.id === shot.id ? { ...z, ...at, zoom } : z)) }, { hint });
  } finally {
    if (ed.aim === aim && (ed.aimZoom || shot.zoom) === zoom) {
      ed.aim = null;
      ed.aimZoom = null;
      paintZoomBox();
      renderFrame();
    }
  }
}

let zoomSettle: ReturnType<typeof setTimeout> | null = null;

function settleZoom(shot: ZoomShot, hint: string, ms = SETTLE_MS): void {
  if (zoomSettle) clearTimeout(zoomSettle);
  zoomSettle = setTimeout(() => {
    zoomSettle = null;
    const now = selectedShot();
    if (now && shotKey(now) === shotKey(shot)) void commitZoom(now, hint);
  }, ms);
}

function cancelZoomSettle(): void {
  if (zoomSettle) clearTimeout(zoomSettle);
  zoomSettle = null;
}

/** Aim the selected zoom back at the middle of the frame. */
export function recenterZoom(): Promise<void> | void {
  const shot = selectedShot();
  if (!shot) return;
  const { width: W, height: H } = aimSpace(shot.clip);
  cancelZoomSettle();
  previewZoom(shot, { cx: W / 2, cy: H / 2 });
  return commitZoom(shot, shot.source === 'auto' ? 'That zoom is yours now' : 'Zoom centred');
}

/** Arrow keys pan the zoom, + and − push in and out. Returns whether the key was used. */
function zoomKey(e: KeyboardEvent): boolean {
  const shot = selectedShot();
  if (!shot || $('liveZoomBox')?.hidden) return false;
  const { width: W, height: H } = aimSpace(shot.clip);
  const now = zoomAimNow(shot);
  const [lo, hi] = zoomRange();
  const k = e.key;
  if (k.startsWith('Arrow')) {
    const dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
    const dy = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
    previewZoom(shot, { cx: now.cx + dx * nudgeStep(W / now.zoom, e.shiftKey), cy: now.cy + dy * nudgeStep(H / now.zoom, e.shiftKey) });
  } else if (k === '+' || k === '=') previewZoom(shot, { zoom: r3(clamp(now.zoom + (e.shiftKey ? 0.25 : 0.05), lo, hi)) });
  else if (k === '-' || k === '_') previewZoom(shot, { zoom: r3(clamp(now.zoom - (e.shiftKey ? 0.25 : 0.05), lo, hi)) });
  else return false;
  settleZoom(shot, shot.source === 'auto' ? 'That zoom is yours now' : 'Zoom saved');
  return true;
}

export function wireZoomBox(signal: AbortSignal): void {
  const box = $('liveZoomBox');
  const vp = $('stageAim');
  if (!box || !vp) return;
  holdFocus(box, signal);
  type ZoomDrag = { x: number; y: number; cx: number; cy: number; zoom: number; half: number; shot: ZoomShot; corner: boolean; moved: boolean };
  let drag: ZoomDrag | null = null;
  /** How far the pointer sits from the frame centre, as a share of the frame (0–0.5). */
  const halfAt = (e: PointerEvent): number => {
    const rect = vp.getBoundingClientRect();
    const dx = Math.abs(e.clientX - (rect.left + rect.width / 2)) / Math.max(rect.width, 1);
    const dy = Math.abs(e.clientY - (rect.top + rect.height / 2)) / Math.max(rect.height, 1);
    return Math.max(dx, dy);
  };
  box.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      const shot = selectedShot();
      if (!shot) return;
      cancelZoomSettle();
      const now = zoomAimNow(shot);
      drag = { x: e.clientX, y: e.clientY, cx: now.cx, cy: now.cy, zoom: now.zoom, half: halfAt(e), shot, corner: (e.target as Element).classList.contains('zh'), moved: false };
      box.classList.toggle('is-pushing', drag.corner);
      box.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    },
    { signal },
  );
  box.addEventListener(
    'pointermove',
    (e) => {
      if (!drag) return;
      if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 3) return;
      const rect = vp.getBoundingClientRect();
      const { width: W, height: H } = aimSpace(drag.shot.clip);
      drag.moved = true;
      if (drag.corner) {
        // Relative to the grab: pull toward the centre to push in, out to pull back.
        previewZoom(drag.shot, { cx: drag.cx, cy: drag.cy, zoom: zoomFromCorner(drag.zoom, drag.half, halfAt(e), zoomRange()) });
      } else {
        const zoom = ed.aimZoom || drag.zoom;
        previewZoom(drag.shot, {
          cx: drag.cx - ((e.clientX - drag.x) / rect.width) * (W / zoom),
          cy: drag.cy - ((e.clientY - drag.y) / rect.height) * (H / zoom),
        });
      }
    },
    { signal },
  );
  const finish = async () => {
    if (!drag) return;
    const { shot, moved, corner } = drag;
    drag = null;
    box.classList.remove('is-pushing');
    if (!moved) return;
    await commitZoom(shot, corner ? 'Zoom strength saved' : 'Zoom aimed');
  };
  box.addEventListener('pointerup', () => void finish(), { signal });
  box.addEventListener('pointercancel', () => void finish(), { signal });
  // Double-click aims the zoom at the point under the pointer.
  box.addEventListener(
    'dblclick',
    (e) => {
      const shot = selectedShot();
      if (!shot) return;
      const rect = vp.getBoundingClientRect();
      const { width, height } = aimSpace(shot.clip);
      const now = zoomAimNow(shot);
      const p = framePointAt({ ...now, width, height }, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
      previewZoom(shot, { cx: p.x, cy: p.y });
      settleZoom(shot, shot.source === 'auto' ? 'That zoom is yours now' : 'Zoom aimed', 0);
    },
    { signal },
  );
  // Scroll pushes in or out; the save waits for the wheel to rest.
  box.addEventListener(
    'wheel',
    (e) => {
      const shot = selectedShot();
      if (!shot || drag) return;
      e.preventDefault();
      previewZoom(shot, { zoom: zoomFromWheel(zoomAimNow(shot).zoom, e.deltaY, zoomRange(), e.deltaMode) });
      settleZoom(shot, shot.source === 'auto' ? 'That zoom is yours now' : 'Zoom strength saved');
    },
    { signal, passive: false },
  );
  const panel = $('edZoomPanel');
  // Live: the stage pushes in while the thumb moves; `change` saves once on release.
  panel?.querySelector('[data-frame-zoom]')?.addEventListener(
    'input',
    (e) => {
      const shot = selectedShot();
      if (!shot) return;
      const input = e.target as HTMLInputElement;
      paintRange(input);
      previewZoom(shot, { zoom: Number(input.value) });
    },
    { signal },
  );
  panel?.querySelector('[data-frame-zoom]')?.addEventListener(
    'change',
    (e) => {
      const shot = selectedShot();
      if (!shot) return;
      cancelZoomSettle();
      previewZoom(shot, { zoom: Number((e.target as HTMLInputElement).value) });
      void commitZoom(shot, 'Zoom strength saved');
    },
    { signal },
  );
  panel?.querySelector('[data-frame-remove="zoom"]')?.addEventListener(
    'click',
    () => {
      document.querySelector<HTMLElement>('#inspectorRoot [data-act="remove"]')?.click();
    },
    { signal },
  );
  panel?.querySelector('[data-zoom-center]')?.addEventListener('click', () => void recenterZoom(), { signal });
  holdStill(panel, signal);
}

/** A panel that moves mid-drag loses the thumb: hold it where it is until the pointer lifts. */
function holdStill(panel: HTMLElement | null, signal: AbortSignal): void {
  if (!panel) return;
  panel.querySelectorAll('input[type="range"]').forEach((el) => el.addEventListener('pointerdown', () => panel.classList.add('is-adjusting'), { signal }));
  window.addEventListener(
    'pointerup',
    () => {
      if (!panel.classList.contains('is-adjusting')) return;
      panel.classList.remove('is-adjusting');
      schedulePanelLayout();
    },
    { signal },
  );
}

// ─── Magnifier aim box (selected lens, paused, playhead inside it) ───────────────────────
export const deckLens = (l: Lens): DeckLens | null => deckEdit().lenses.find((x) => x.id === l.id) || null;

/** A geometry patch written in the mark's own units — pixels on the recording, fractions on a plate. */
export function lensPatchFor(l: Lens, patch: Partial<DeckLens>): Partial<DeckLens> {
  if (!l.clip) return patch;
  const { width, height } = aimSpace(l.clip);
  const { x, y, w, h, ...rest } = patch;
  return {
    ...rest,
    ...(x == null ? {} : { nx: r3(x / width) }),
    ...(y == null ? {} : { ny: r3(y / height) }),
    ...(w == null ? {} : { nw: r3(w / width) }),
    ...(h == null ? {} : { nh: r3(h / height) }),
  };
}
export const lensTarget = (l: Lens): { x: number; y: number; w: number; h: number; zoom: number | undefined } => ({
  x: l.rect.x + l.rect.w / 2,
  y: l.rect.y + l.rect.h / 2,
  w: l.rect.w,
  h: l.rect.h,
  zoom: l.source === 'edit' ? deckLens(l)?.zoom : undefined,
});

/** True while the ring is dragged and its panel rides along. */
let lensRiding = false;

/** Magnifier size as a share of the frame width — px of the recording mean nothing on stage. */
const fmtLensSize = (size: number, width: number): string => `${Math.max(1, Math.round((size / Math.max(width, 1)) * 100))}%`;

export function paintLensHud(lens: Lens, zNow: number, sizeNow: number): void {
  const hud = $('edLensPanel');
  if (!hud) return;
  const title = hud.querySelector('[data-lens-hud-title]');
  const controls = hud.querySelector<HTMLElement>('[data-lens-hud-controls]');
  const take = hud.querySelector<HTMLElement>('[data-lens-hud-take]');
  const rm = hud.querySelector('[data-frame-remove="lens"]');
  const recorded = lens.source === 'auto';
  if (title) title.textContent = recorded ? 'Recorded magnifier' : 'Magnifier';
  if (controls) controls.hidden = recorded;
  const zoomOut = hud.querySelector('[data-lens-zoom-value]');
  if (zoomOut) zoomOut.textContent = fmtZoom(zNow, 1);
  const pill = hud.querySelector('[data-lens-pill-value]');
  if (pill) pill.textContent = recorded ? 'Recorded' : fmtZoom(zNow, 1);
  const sizeOut = hud.querySelector('[data-lens-size-value]');
  if (sizeOut) sizeOut.textContent = fmtLensSize(sizeNow, aimSpace(lens.clip).width);
  paintPanelHelp(
    hud.querySelector('[data-sp-help-slot]'),
    recorded ? 'Recorded magnifier' : 'Magnifier',
    recorded
      ? [{ keys: ['Drag'], label: 'the ring to claim it' }, ...PANEL_MOVE_HELP]
      : [
          { keys: ['Drag'], label: 'the ring to aim' },
          { keys: ['Drag'], label: 'the grip on its edge to resize' },
          { keys: ['Scroll'], label: 'size' },
          { keys: ['⌥', 'Scroll'], label: 'strength' },
          { keys: ['←', '→', '↑', '↓'], label: 'nudge · ⇧ for bigger steps' },
          { keys: ['[', ']'], label: 'size' },
          { keys: ['+', '−'], label: 'strength' },
          ...PANEL_MOVE_HELP,
        ],
  );
  if (take) {
    take.hidden = !recorded;
    take.setAttribute('aria-label', 'Take over this recorded magnifier');
  }
  if (rm) rm.setAttribute('aria-label', recorded ? 'Switch off recorded magnifier' : 'Remove magnifier');
  hud.classList.toggle('is-recorded', recorded);
}

export function paintLensBox(): void {
  const box = $('liveLensBox');
  const hud = $('edLensPanel');
  if (!box) return;
  const lens = selectedLens();
  const c = curClip();
  const rec = markClock(lens?.clip, c);
  placeStageAim(lens?.clip);
  const editor = planFrameEditor({
    selected: Boolean(lens) && lens?.source !== 'off',
    blockStart: lens?.t ?? 0,
    blockEnd: (lens?.t ?? 0) + (lens?.dur ?? 0),
    playhead: rec,
    playing: ed.playing,
    reducedMotion: reducedMotion(),
  });
  if (!editor.visible || !lens || rec == null) {
    box.hidden = true;
    showPanel('lens', false);
    return;
  }
  const { width: W, height: H } = aimSpace(lens.clip);
  const shape = ed.lensAim ? lensShape(lens, ed.lensAim) : lens;
  const { x, y } = ed.lensAim || lensCentre(lens, clamp(rec - lens.t, 0, lens.dur));
  const { ox: canvasX, oy: canvasY } = loupeOrigin(x, y, shape.S, W, H);
  const ox = canvasX + LENS_PAD;
  const oy = canvasY + LENS_PAD;
  box.hidden = false;
  box.dataset['hit'] = String(FRAME_EDITOR_HIT);
  const own = lens.source === 'edit' ? deckLens(lens) : null;
  const strength = hud?.querySelector<HTMLInputElement>('[data-frame-lens-zoom]');
  const size = hud?.querySelector<HTMLInputElement>('[data-frame-lens-size]');
  const sizeNow = Math.max(ed.lensAim?.w ?? own?.w ?? lens.rect?.w ?? 80, ed.lensAim?.h ?? own?.h ?? lens.rect?.h ?? 80);
  // The readout is what the loupe draws: an auto strength reads as the loupe's own pick.
  const zNow = ed.lensAim ? (shape.zoom ?? lens.zoom) : (own?.zoom ?? lens.zoom);
  if (strength) {
    const [lo, hi] = lensZoomRange();
    strength.min = String(lo);
    const ceiling = r3(clamp(lensZoomCeiling(sizeNow, { width: W, height: H }), lo, hi));
    strength.max = String(ceiling);
    strength.disabled = ceiling - lo < 0.05;
    if (document.activeElement !== strength) strength.value = String(Number(zNow).toFixed(2));
  }
  if (size) {
    size.min = String(LENS_SIZE_RANGE[0]);
    size.max = String(LENS_SIZE_RANGE[1]);
    if (document.activeElement !== size) size.value = String(Math.round(sizeNow));
  }
  paintRange(strength);
  paintRange(size);
  box.style.left = `${(ox / W) * 100}%`;
  box.style.top = `${(oy / H) * 100}%`;
  box.style.width = `${(shape.diameter / W) * 100}%`;
  box.style.height = `${(shape.diameter / H) * 100}%`;
  box.classList.toggle('is-auto', lens.source === 'auto');
  if (hud) paintLensHud(lens, zNow, sizeNow);
  // While the ring rides the pointer the panel rides with it, without the glide.
  if (!showPanel('lens', true)) {
    if (lensRiding) layoutPanels({ instant: ['lens'] });
    else schedulePanelLayout();
  }
}

/** The selected magnifier's aim right now — the pending one while an edit is in hand. */
function lensAimNow(lens: Lens): LensAim {
  return ed.lensAim || { ...lensTarget(lens), zoom: lens.source === 'edit' ? deckLens(lens)?.zoom : undefined };
}

/** Mirror a pending magnifier into the Inspector's strength and area rows. */
function syncLensInspector(lens: Lens, aim: LensAim): void {
  const loupe = lensLoupe(Math.max(aim.w, aim.h), aim.zoom, aimSpace(lens.clip));
  syncInspector('[data-lens-zoom]', 'insLensOut', loupe.zoom, `${loupe.zoom.toFixed(2)}×${aim.zoom == null ? ' auto' : ''}`);
  for (const side of ['w', 'h'] as const) {
    const row = document.querySelector<HTMLInputElement>(`#inspectorRoot [data-lens-size="${side}"]`);
    if (!row || document.activeElement === row) continue;
    row.value = String(aim[side]);
    paintRange(row);
    const out = row.parentElement?.querySelector('output');
    if (out) out.textContent = `${aim[side]}px`;
  }
}

/**
 * Show a magnifier aim, area or strength on the stage without saving it. The strength never
 * runs past what the loupe can draw for the area, so what you see is what renders.
 */
function previewLensAim(lens: Lens, patch: Partial<LensAim>): void {
  const { width: W, height: H } = aimSpace(lens.clip);
  const next: LensAim = { ...lensAimNow(lens), ...patch };
  next.x = Math.round(clamp(next.x, 0, W));
  next.y = Math.round(clamp(next.y, 0, H));
  const range = lensZoomRange();
  const ceiling = r3(clamp(lensZoomCeiling(Math.max(next.w, next.h), { width: W, height: H }), range[0], range[1]));
  next.zoom = clampLensZoom(next.zoom, ceiling, range);
  ed.lensAim = next;
  paintLensBox();
  renderFrame();
  syncLensInspector(lens, next);
}

/**
 * Save the pending magnifier. The stage holds it until the save lands, so the ring never
 * jumps back to where it was for a beat.
 */
async function commitLens(lens: Lens, hint: string): Promise<void> {
  const aim = ed.lensAim;
  if (!aim) return;
  const geometry = { x: aim.x, y: aim.y, w: aim.w, h: aim.h };
  try {
    if (lens.source === 'auto') {
      await adoptLens(lens, { ...geometry, ...(aim.zoom != null ? { zoom: aim.zoom } : {}) });
      return;
    }
    const patch: Partial<DeckLens> = lensPatchFor(lens, geometry);
    const own = deckLens(lens);
    const next = (l: DeckLens): DeckLens => {
      const out = { ...l, ...patch };
      if (aim.zoom != null) out.zoom = aim.zoom;
      else delete out.zoom;
      return out;
    };
    if (own) await postDeck({ lenses: deckEdit().lenses.map((l) => (l.id === lens.id ? next(l) : l)) }, { hint });
  } finally {
    if (ed.lensAim === aim) {
      ed.lensAim = null;
      paintLensBox();
      renderFrame();
    }
  }
}

let lensSettle: ReturnType<typeof setTimeout> | null = null;

function settleLens(lens: Lens, hint: string, ms = SETTLE_MS): void {
  if (lensSettle) clearTimeout(lensSettle);
  lensSettle = setTimeout(() => {
    lensSettle = null;
    const now = selectedLens();
    if (now && now.key === lens.key) void commitLens(now, hint);
  }, ms);
}

function cancelLensSettle(): void {
  if (lensSettle) clearTimeout(lensSettle);
  lensSettle = null;
}

/** The strength the loupe draws right now — an auto pick reads as the loupe's own choice. */
const lensZoomNow = (lens: Lens, aim: LensAim): number => lensLoupe(Math.max(aim.w, aim.h), aim.zoom, aimSpace(lens.clip)).zoom;

/** Arrow keys move the ring, + and − set strength, [ and ] set size. Returns whether the key was used. */
function lensKey(e: KeyboardEvent): boolean {
  const lens = selectedLens();
  if (!lens || lens.source === 'off' || $('liveLensBox')?.hidden) return false;
  const { width: W, height: H } = aimSpace(lens.clip);
  const now = lensAimNow(lens);
  const k = e.key;
  const range = lensZoomRange();
  if (k.startsWith('Arrow')) {
    const dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
    const dy = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
    previewLensAim(lens, { x: now.x + dx * nudgeStep(W, e.shiftKey), y: now.y + dy * nudgeStep(H, e.shiftKey) });
  } else if (k === '+' || k === '=' || k === '-' || k === '_') {
    const step = (k === '+' || k === '=' ? 1 : -1) * (e.shiftKey ? 0.2 : 0.05);
    previewLensAim(lens, { zoom: r3(clamp(lensZoomNow(lens, now) + step, range[0], range[1])) });
  } else if (k === '[' || k === ']') {
    const size = lensSizeBy(Math.max(now.w, now.h), k === ']' ? (e.shiftKey ? 1.25 : 1.08) : e.shiftKey ? 0.8 : 1 / 1.08);
    previewLensAim(lens, scaleArea(now.w, now.h, size));
  } else return false;
  settleLens(lens, lens.source === 'auto' ? 'That magnifier is yours now' : 'Magnifier saved');
  return true;
}

/** Keys for whichever stage editor has focus — the global shortcuts yield when this returns true. */
export function stageAimKey(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const target = e.target as HTMLElement | null;
  if (!target?.closest) return false;
  if (target.closest('#liveLensBox')) return lensKey(e);
  if (target.closest('#liveZoomBox')) return zoomKey(e);
  return false;
}

export function wireLensBox(signal: AbortSignal): void {
  const box = $('liveLensBox');
  const hud = $('edLensPanel');
  const vp = $('stageAim');
  if (!box || !vp) return;
  holdFocus(box, signal);
  type LensDrag = { x: number; y: number; start: LensAim; lens: Lens; moved: boolean; size: boolean; dist: number };
  let drag: LensDrag | null = null;
  const ringCentre = () => {
    const r = box.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  box.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      const lens = selectedLens();
      if (!lens || lens.source === 'off') return;
      cancelLensSettle();
      const size = (e.target as Element).classList.contains('lens-grip') && lens.source === 'edit';
      const c = ringCentre();
      drag = { x: e.clientX, y: e.clientY, start: lensAimNow(lens), lens, moved: false, size, dist: Math.max(8, Math.hypot(e.clientX - c.x, e.clientY - c.y)) };
      hud?.classList.add('is-riding');
      box.classList.toggle('is-sizing', size);
      // An attached panel rides along at its offset instead of hopping sides under the pointer.
      if (hud && !size && !hud.hidden) {
        const h = hud.getBoundingClientRect();
        holdPanel('lens', { dx: h.left + h.width / 2 - c.x, dy: h.top + h.height / 2 - c.y });
        lensRiding = true;
      }
      box.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    },
    { signal },
  );
  box.addEventListener(
    'pointermove',
    (e) => {
      if (!drag) return;
      if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 3) return;
      drag.moved = true;
      const s = drag.start;
      if (drag.size) {
        // The grip sits on the ring's edge: its distance from the centre scales the area.
        const c = ringCentre();
        const factor = Math.hypot(e.clientX - c.x, e.clientY - c.y) / drag.dist;
        previewLensAim(drag.lens, scaleArea(s.w, s.h, lensSizeBy(Math.max(s.w, s.h), factor)));
        return;
      }
      const rect = vp.getBoundingClientRect();
      const { width: W, height: H } = aimSpace(drag.lens.clip);
      previewLensAim(drag.lens, { x: s.x + ((e.clientX - drag.x) / rect.width) * W, y: s.y + ((e.clientY - drag.y) / rect.height) * H });
    },
    { signal },
  );
  const finish = async () => {
    if (!drag) return;
    const { lens, moved, size } = drag;
    drag = null;
    holdPanel('lens', null);
    lensRiding = false;
    hud?.classList.remove('is-riding');
    box.classList.remove('is-sizing');
    layoutPanels();
    if (!moved) return renderFrame();
    await commitLens(lens, lens.source === 'auto' ? 'That magnifier is yours now' : size ? 'Magnifier resized' : 'Magnifier moved');
  };
  box.addEventListener('pointerup', () => void finish(), { signal });
  box.addEventListener('pointercancel', () => void finish(), { signal });
  // Scroll sizes the area, ⌥/Shift-scroll sets strength; the save waits for the wheel to rest.
  box.addEventListener(
    'wheel',
    (e) => {
      const lens = selectedLens();
      if (!lens || lens.source !== 'edit' || drag) return;
      e.preventDefault();
      const now = lensAimNow(lens);
      const f = wheelFactor(e.deltaY, e.deltaMode);
      if (e.altKey || e.shiftKey) {
        const [lo, hi] = lensZoomRange();
        previewLensAim(lens, { zoom: r3(clamp(lensZoomNow(lens, now) * f, lo, hi)) });
      } else previewLensAim(lens, scaleArea(now.w, now.h, lensSizeBy(Math.max(now.w, now.h), f)));
      settleLens(lens, 'Magnifier saved');
    },
    { signal, passive: false },
  );
  const zoomEl = hud?.querySelector<HTMLInputElement>('[data-frame-lens-zoom]');
  const sizeEl = hud?.querySelector<HTMLInputElement>('[data-frame-lens-size]');
  const editLens = (): Lens | null => {
    const lens = selectedLens();
    return lens?.source === 'edit' ? lens : null;
  };
  // Live: every thumb move re-aims the loupe on stage; `change` saves the settled value once.
  zoomEl?.addEventListener(
    'input',
    () => {
      const lens = editLens();
      if (!lens) return;
      paintRange(zoomEl);
      previewLensAim(lens, { zoom: Number(zoomEl.value) });
    },
    { signal },
  );
  zoomEl?.addEventListener(
    'change',
    () => {
      const lens = editLens();
      if (!lens) return;
      cancelLensSettle();
      previewLensAim(lens, { zoom: Number(zoomEl.value) });
      void commitLens(lens, 'Magnifier saved');
    },
    { signal },
  );
  sizeEl?.addEventListener(
    'input',
    () => {
      const lens = editLens();
      if (!lens) return;
      paintRange(sizeEl);
      const now = lensAimNow(lens);
      previewLensAim(lens, scaleArea(now.w, now.h, Math.round(Number(sizeEl.value))));
    },
    { signal },
  );
  sizeEl?.addEventListener(
    'change',
    () => {
      const lens = editLens();
      if (!lens) return;
      cancelLensSettle();
      const now = lensAimNow(lens);
      previewLensAim(lens, scaleArea(now.w, now.h, Math.round(Number(sizeEl.value))));
      void commitLens(lens, 'Magnifier saved');
    },
    { signal },
  );
  holdStill(hud, signal);
  hud?.querySelector('[data-frame-remove="lens"]')?.addEventListener(
    'click',
    () => {
      document.querySelector<HTMLElement>('#inspectorRoot [data-act="remove"]')?.click();
    },
    { signal },
  );
  hud?.querySelector('[data-lens-hud-take]')?.addEventListener(
    'click',
    () => {
      const lens = selectedLens();
      if (lens?.source === 'auto') void adoptLens(lens);
    },
    { signal },
  );
}

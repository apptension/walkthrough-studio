import { FRAME_EDITOR_HIT, lensZoomCeiling, planFrameEditor } from '@/logic/livePreview';
import { paintRange } from '@/ui/rangeFill';
import { clampZoomCenter } from '@/logic/zoomAim';

import { postDeck } from './data';
import { adoptLens, adoptShot } from './edits';
import { curClip, edToRec, selectedLens, shotKey } from './seq';
import { lensShape, renderFrame } from './stage';
import { deckEdit, ed, liveH, liveW, type LensAim } from './state';
import type { DeckLens, Lens, ZoomShot } from './types';
import { $, LENS_PAD, clamp, escapeHtml, lensCentre, loupeOrigin, r3 } from './util';

/** Zoom aim box and magnifier aim box + HUD from `kit/studio/editor.js`. */

const reducedMotion = (): boolean => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);

// ─── Zoom aim box (selected zoom shot, paused) ───────────────────────────────────────────
export function selectedShot(): ZoomShot | null {
  if (ed.sel?.type !== 'zoom') return null;
  return (ed.deck?.zoomShots || []).find((s) => shotKey(s) === ed.sel?.key) || null;
}

export interface StageKey {
  key: string;
  label: string;
}

/** Gesture hints as `<kbd>` chips — the same vocabulary as the copy bar's Tab / ⌘B / Esc. */
export function stageKeysHtml(keys: StageKey[]): string {
  return keys.map((k) => `<i><kbd>${escapeHtml(k.key)}</kbd>${escapeHtml(k.label)}</i>`).join('');
}

function setHtml(el: Element | null | undefined, html: string): void {
  if (el && (el as HTMLElement).dataset['html'] !== html) {
    (el as HTMLElement).dataset['html'] = html;
    el.innerHTML = html;
  }
}

const fmtZoom = (z: number, digits = 2): string => `${Number(z).toFixed(digits)}×`;

/** Mirror a stage slider into the Inspector's twin so both read the same value mid-drag. */
function syncInspector(selector: string, outId: string, value: number, text: string): void {
  const twin = document.querySelector<HTMLInputElement>(`#inspectorRoot ${selector}`);
  if (twin && document.activeElement !== twin) twin.value = String(value);
  const out = $(outId);
  if (out) out.textContent = text;
}

export function paintZoomBox(): void {
  const box = $('liveZoomBox');
  if (!box) return;
  const shot = selectedShot();
  const c = curClip();
  const rec = c?.kind === 'live' ? edToRec(c, ed.t) : null;
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
    return;
  }
  const zoom = ed.aimZoom || shot.zoom;
  // The stage already shows the push-in; the box is a full-frame drag surface (pan) with corner
  // handles for strength — not a crop preview on a 1× frame.
  box.hidden = false;
  box.dataset['hit'] = String(FRAME_EDITOR_HIT);
  const auto = shot.source === 'auto';
  const strength = box.querySelector<HTMLInputElement>('[data-frame-zoom]');
  if (strength && document.activeElement !== strength) strength.value = String(Number(zoom.toFixed(2)));
  paintRange(strength);
  box.style.left = '0';
  box.style.top = '0';
  box.style.width = '100%';
  box.style.height = '100%';
  box.classList.toggle('is-auto', auto);
  box.classList.add('is-live');
  const kind = box.querySelector('[data-zoom-kind]');
  if (kind) kind.textContent = auto ? 'Auto zoom' : 'Focus zoom';
  const value = box.querySelector('[data-zoom-value]');
  if (value) value.textContent = fmtZoom(zoom);
  setHtml(
    box.querySelector('[data-zoom-keys]'),
    stageKeysHtml(auto ? [{ key: 'Drag', label: 'to take over' }] : [{ key: 'Drag', label: 'aim' }, { key: 'Corners', label: 'push' }]),
  );
  box.querySelector('.frame-editor')?.classList.toggle('is-auto', auto);
}

export function wireZoomBox(signal: AbortSignal): void {
  const box = $('liveZoomBox');
  const vp = $('liveViewport');
  if (!box || !vp) return;
  let drag: { x: number; y: number; cx: number; cy: number; zoom: number; shot: ZoomShot; corner: boolean; moved: boolean } | null = null;
  box.addEventListener(
    'pointerdown',
    (e) => {
      const shot = selectedShot();
      if (!shot) return;
      const W = liveW();
      const H = liveH();
      const p = ed.aim || shot.points?.[0] || { cx: W / 2, cy: H / 2 };
      drag = {
        x: e.clientX,
        y: e.clientY,
        cx: p.cx,
        cy: p.cy,
        zoom: ed.aimZoom || shot.zoom,
        shot,
        corner: (e.target as Element).classList.contains('zh'),
        moved: false,
      };
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
      const rect = vp.getBoundingClientRect();
      const W = liveW();
      const H = liveH();
      drag.moved = true;
      if (drag.corner) {
        // Corners of the full-frame surface: pull toward the centre to push in further.
        const cxPx = rect.left + rect.width / 2;
        const cyPx = rect.top + rect.height / 2;
        const half = Math.max(Math.max(Math.abs(e.clientX - cxPx) / rect.width, Math.abs(e.clientY - cyPx) / rect.height), 0.02);
        const [lo, hi] = ed.deck?.ranges?.zoom || [1, 3];
        ed.aimZoom = r3(clamp(1 / (2 * half), lo, hi));
        ed.aim = { cx: drag.cx, cy: drag.cy };
      } else {
        const zoom = ed.aimZoom || drag.zoom;
        const aim = clampZoomCenter(
          drag.cx - ((e.clientX - drag.x) / rect.width) * (W / zoom),
          drag.cy - ((e.clientY - drag.y) / rect.height) * (H / zoom),
          { zoom, width: W, height: H },
        );
        ed.aim = { cx: aim.cx, cy: aim.cy };
      }
      paintZoomBox();
      renderFrame();
    },
    { signal },
  );
  const finish = async () => {
    if (!drag) return;
    const { shot, moved } = drag;
    drag = null;
    const aim = ed.aim;
    const zoom = ed.aimZoom || shot.zoom;
    ed.aim = null;
    ed.aimZoom = null;
    if (!moved || !aim) return;
    if (shot.source === 'auto') {
      await adoptShot(shot, { x: aim.cx, y: aim.cy, zoom });
      return;
    }
    const zooms = deckEdit().zooms.map((z) => (z.id === shot.id ? { ...z, x: aim.cx, y: aim.cy, zoom } : z));
    await postDeck({ zooms });
  };
  box.addEventListener('pointerup', () => void finish(), { signal });
  box.addEventListener('pointercancel', () => void finish(), { signal });
  box.querySelector('.frame-editor')?.addEventListener('pointerdown', (e) => e.stopPropagation(), { signal });
  // Live: the stage pushes in while the thumb moves; `change` saves once on release.
  box.querySelector('[data-frame-zoom]')?.addEventListener(
    'input',
    (e) => {
      if (!selectedShot()) return;
      const input = e.target as HTMLInputElement;
      ed.aimZoom = Number(input.value);
      paintRange(input);
      paintZoomBox();
      renderFrame();
      syncInspector('[data-shot-zoom]', 'insZoomOut', ed.aimZoom, fmtZoom(ed.aimZoom));
    },
    { signal },
  );
  box.querySelector('[data-frame-zoom]')?.addEventListener(
    'change',
    (e) => {
      const current = selectedShot();
      if (!current) return;
      const nextZoom = Number((e.target as HTMLInputElement).value);
      ed.aimZoom = nextZoom;
      const done = () => {
        ed.aimZoom = null;
      };
      if (current.source === 'auto') {
        void adoptShot(current, { zoom: nextZoom })?.finally(done);
        return;
      }
      const d = deckEdit();
      void postDeck({ zooms: d.zooms.map((z) => (z.id === current.id ? { ...z, zoom: nextZoom } : z)) }, { hint: 'Zoom strength saved' })?.finally(done);
    },
    { signal },
  );
  box.querySelector('[data-frame-remove="zoom"]')?.addEventListener(
    'click',
    () => {
      document.querySelector<HTMLElement>('#inspectorRoot [data-act="remove"]')?.click();
    },
    { signal },
  );
}

// ─── Magnifier aim box (selected lens, paused, playhead inside it) ───────────────────────
export const deckLens = (l: Lens): DeckLens | null => deckEdit().lenses.find((x) => x.id === l.id) || null;
export const lensTarget = (l: Lens): { x: number; y: number; w: number; h: number; zoom: number | undefined } => ({
  x: l.rect.x + l.rect.w / 2,
  y: l.rect.y + l.rect.h / 2,
  w: l.rect.w,
  h: l.rect.h,
  zoom: l.source === 'edit' ? deckLens(l)?.zoom : undefined,
});

/** Gap between the magnifier ring and the HUD card (screen px). */
const LENS_HUD_GAP = 14;

/** Shortest distance from the circle edge to the HUD rect; positive = clear. */
export function lensHudClearance(hx: number, hy: number, hudW: number, hudH: number, ccx: number, ccy: number, r: number, gap: number): number {
  const l = hx - hudW / 2;
  const t = hy - hudH / 2;
  const ri = hx + hudW / 2;
  const b = hy + hudH / 2;
  const nx = clamp(ccx, l, ri);
  const ny = clamp(ccy, t, b);
  return Math.hypot(ccx - nx, ccy - ny) - (r + gap);
}

/**
 * Park the HUD just outside the on-screen magnifier circle, biased toward the stage
 * centre so it reads naturally in corners and never sits on top of the glass.
 */
export function placeLensHud(): void {
  const hud = $('liveLensHud');
  const box = $('liveLensBox');
  const plate = $('playerPlate');
  if (!hud || !box || !plate || box.hidden) return;

  const card = hud.querySelector<HTMLElement>('.lens-stage-hud__card');
  if (!card || hud.classList.contains('is-adjusting')) return;

  const bRect = box.getBoundingClientRect();
  const pRect = plate.getBoundingClientRect();
  const hudW = card.offsetWidth || 188;
  const hudH = card.offsetHeight || 80;

  const ccx = bRect.left + bRect.width / 2;
  const ccy = bRect.top + bRect.height / 2;
  const r = Math.min(bRect.width, bRect.height) / 2;
  const gap = LENS_HUD_GAP;
  const margin = 8;

  const plateCx = pRect.left + pRect.width / 2;
  const plateCy = pRect.top + pRect.height / 2;

  const dirs: Array<{ dx: number; dy: number; weight: number }> = [];
  const dx = plateCx - ccx;
  const dy = plateCy - ccy;
  const dlen = Math.hypot(dx, dy);
  if (dlen < 6) dirs.push({ dx: 0, dy: 1, weight: 4 });
  else {
    dirs.push({ dx: dx / dlen, dy: dy / dlen, weight: 5 });
    dirs.push({ dx: -dx / dlen, dy: -dy / dlen, weight: 1 });
  }
  for (const [ux, uy] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
    [0.707, 0.707],
    [-0.707, 0.707],
    [0.707, -0.707],
    [-0.707, -0.707],
  ] as const) {
    dirs.push({ dx: ux, dy: uy, weight: 0 });
  }

  const clampHud = (hx: number, hy: number) => {
    const halfW = hudW / 2;
    const halfH = hudH / 2;
    return {
      x: clamp(hx, pRect.left + margin + halfW, pRect.right - margin - halfW),
      y: clamp(hy, pRect.top + margin + halfH, pRect.bottom - margin - halfH),
    };
  };

  let best: { x: number; y: number; score: number } | null = null;
  for (const { dx: ux, dy: uy, weight } of dirs) {
    const proj = (hudW / 2) * Math.abs(ux) + (hudH / 2) * Math.abs(uy);
    const dist = r + gap + proj;
    const raw = { x: ccx + ux * dist, y: ccy + uy * dist };
    const { x, y } = clampHud(raw.x, raw.y);
    const clear = lensHudClearance(x, y, hudW, hudH, ccx, ccy, r, gap);
    const overflow =
      (x - hudW / 2 < pRect.left + margin ? 1 : 0) +
      (x + hudW / 2 > pRect.right - margin ? 1 : 0) +
      (y - hudH / 2 < pRect.top + margin ? 1 : 0) +
      (y + hudH / 2 > pRect.bottom - margin ? 1 : 0);
    const score = (clear < 0 ? clear * 12 : clear) - overflow * 80 + weight;
    if (!best || score > best.score) best = { x, y, score };
  }

  if (!best) return;
  hud.style.left = `${best.x - pRect.left}px`;
  hud.style.top = `${best.y - pRect.top}px`;
  hud.style.transform = 'translate(-50%, -50%)';
}

/** Magnifier size as a share of the frame width — px of the recording mean nothing on stage. */
const fmtLensSize = (size: number): string => `${Math.max(1, Math.round((size / Math.max(liveW(), 1)) * 100))}%`;

export function paintLensHud(lens: Lens, zNow: number, sizeNow: number): void {
  const hud = $('liveLensHud');
  if (!hud) return;
  const title = hud.querySelector('[data-lens-hud-title]');
  const meta = hud.querySelector<HTMLElement>('[data-lens-hud-meta]');
  const controls = hud.querySelector<HTMLElement>('[data-lens-hud-controls]');
  const hint = hud.querySelector<HTMLElement>('[data-lens-hud-hint]');
  const take = hud.querySelector<HTMLElement>('[data-lens-hud-take]');
  const rm = hud.querySelector('[data-frame-remove="lens"]');
  const recorded = lens.source === 'auto';
  if (title) title.textContent = recorded ? 'Recorded magnifier' : 'Magnifier';
  if (meta) {
    meta.textContent = recorded ? '' : fmtZoom(zNow, 1);
    meta.hidden = recorded;
  }
  if (controls) controls.hidden = recorded;
  const zoomOut = hud.querySelector('[data-lens-zoom-value]');
  if (zoomOut) zoomOut.textContent = fmtZoom(zNow, 1);
  const sizeOut = hud.querySelector('[data-lens-size-value]');
  if (sizeOut) sizeOut.textContent = fmtLensSize(sizeNow);
  if (hint) {
    setHtml(hint, stageKeysHtml([{ key: 'Drag', label: recorded ? 'the ring to claim it' : 'the ring to aim' }]));
    hint.hidden = false;
  }
  if (take) {
    take.hidden = !recorded;
    take.setAttribute('aria-label', 'Take over this recorded magnifier');
  }
  if (rm) rm.setAttribute('aria-label', recorded ? 'Switch off recorded magnifier' : 'Remove magnifier');
  hud.classList.toggle('is-recorded', recorded);
}

export function paintLensBox(): void {
  const box = $('liveLensBox');
  const hud = $('liveLensHud');
  if (!box) return;
  const lens = selectedLens();
  const c = curClip();
  const rec = c?.kind === 'live' ? edToRec(c, ed.t) : null;
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
    if (hud) hud.hidden = true;
    return;
  }
  const W = liveW();
  const H = liveH();
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
  const zNow = ed.lensAim?.zoom ?? own?.zoom ?? lens.zoom;
  const sizeNow = Math.max(ed.lensAim?.w ?? own?.w ?? lens.rect?.w ?? 80, ed.lensAim?.h ?? own?.h ?? lens.rect?.h ?? 80);
  if (strength) {
    const [lo, hi] = ed.deck?.ranges?.lensZoom || [1.2, 2.4];
    strength.min = String(lo);
    const ceiling = r3(clamp(lensZoomCeiling(sizeNow), lo, hi));
    strength.max = String(ceiling);
    strength.disabled = ceiling - lo < 0.05;
    if (document.activeElement !== strength) strength.value = String(Number(zNow).toFixed(2));
  }
  if (size && document.activeElement !== size) size.value = String(Math.round(sizeNow));
  paintRange(strength);
  paintRange(size);
  box.style.left = `${(ox / W) * 100}%`;
  box.style.top = `${(oy / H) * 100}%`;
  box.style.width = `${(shape.diameter / W) * 100}%`;
  box.style.height = `${(shape.diameter / H) * 100}%`;
  box.classList.toggle('is-auto', lens.source === 'auto');
  if (hud) {
    hud.hidden = false;
    paintLensHud(lens, zNow, sizeNow);
    placeLensHud();
  }
}

export function wireLensBox(signal: AbortSignal): void {
  const box = $('liveLensBox');
  const hud = $('liveLensHud');
  const vp = $('liveViewport');
  if (!box || !vp) return;
  let drag: { x: number; y: number; start: ReturnType<typeof lensTarget>; lens: Lens; moved: boolean } | null = null;
  box.addEventListener(
    'pointerdown',
    (e) => {
      const lens = selectedLens();
      if (!lens || lens.source === 'off') return;
      drag = { x: e.clientX, y: e.clientY, start: lensTarget(lens), lens, moved: false };
      hud?.classList.add('is-dragging');
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
      const rect = vp.getBoundingClientRect();
      const W = liveW();
      const H = liveH();
      const dx = ((e.clientX - drag.x) / rect.width) * W;
      const dy = ((e.clientY - drag.y) / rect.height) * H;
      if (Math.abs(dx) + Math.abs(dy) < 2 && !drag.moved) return;
      drag.moved = true;
      const s = drag.start;
      ed.lensAim = { ...s, x: Math.round(clamp(s.x + dx, 0, W)), y: Math.round(clamp(s.y + dy, 0, H)) };
      paintLensBox();
      renderFrame();
    },
    { signal },
  );
  const finish = async () => {
    if (!drag) return;
    const { lens, moved } = drag;
    drag = null;
    hud?.classList.remove('is-dragging');
    const aim = ed.lensAim;
    ed.lensAim = null;
    if (!moved || !aim) return renderFrame();
    const shape = { x: aim.x, y: aim.y, w: aim.w, h: aim.h };
    if (lens.source === 'auto') {
      await adoptLens(lens, shape);
      return;
    }
    await postDeck({ lenses: deckEdit().lenses.map((l) => (l.id === lens.id ? { ...l, ...shape } : l)) }, { hint: 'Magnifier moved' });
  };
  box.addEventListener('pointerup', () => void finish(), { signal });
  box.addEventListener('pointercancel', () => void finish(), { signal });
  hud?.addEventListener('pointerdown', (e) => e.stopPropagation(), { signal });
  const saveLensPatch = (patch: Partial<DeckLens>) => {
    const current = selectedLens();
    if (!current || current.source === 'off') return;
    if (current.source === 'auto') return adoptLens(current, patch);
    const d = deckEdit();
    return postDeck({ lenses: d.lenses.map((l) => (l.id === current.id ? { ...l, ...patch } : l)) }, { hint: 'Magnifier saved' });
  };
  const zoomEl = hud?.querySelector<HTMLInputElement>('[data-frame-lens-zoom]');
  const sizeEl = hud?.querySelector<HTMLInputElement>('[data-frame-lens-size]');
  /** Scale the target area to `size` on its long side, keeping its aspect. */
  const sizedArea = (lens: Lens, size: number) => {
    const own = lens.source === 'edit' ? deckLens(lens) : null;
    const w0 = own?.w ?? lens.rect?.w ?? size;
    const h0 = own?.h ?? lens.rect?.h ?? size;
    const max = Math.max(w0, h0, 1);
    return { w: Math.max(16, Math.round((w0 * size) / max)), h: Math.max(12, Math.round((h0 * size) / max)) };
  };
  // Live: every thumb move re-aims the loupe on stage; `change` saves the settled value once.
  const previewLens = (patch: Partial<LensAim>) => {
    const lens = selectedLens();
    if (!lens || lens.source !== 'edit') return;
    const own = deckLens(lens);
    ed.lensAim = { ...(ed.lensAim || { ...lensTarget(lens), zoom: own?.zoom }), ...patch };
    paintLensBox();
    renderFrame();
  };
  const settle = (patch: Partial<DeckLens>) => {
    void Promise.resolve(saveLensPatch(patch)).finally(() => {
      ed.lensAim = null;
    });
  };
  zoomEl?.addEventListener(
    'input',
    () => {
      const zoom = Number(zoomEl.value);
      paintRange(zoomEl);
      previewLens({ zoom });
      syncInspector('[data-lens-zoom]', 'insLensOut', zoom, fmtZoom(zoom));
    },
    { signal },
  );
  zoomEl?.addEventListener('change', () => settle({ zoom: Number(zoomEl.value) }), { signal });
  // A panel that slides away mid-drag loses the thumb: hold it still until the pointer lifts.
  for (const el of [zoomEl, sizeEl]) {
    el?.addEventListener('pointerdown', () => hud?.classList.add('is-adjusting'), { signal });
  }
  window.addEventListener(
    'pointerup',
    () => {
      if (!hud?.classList.contains('is-adjusting')) return;
      hud.classList.remove('is-adjusting');
      placeLensHud();
    },
    { signal },
  );
  sizeEl?.addEventListener(
    'input',
    () => {
      const lens = selectedLens();
      if (!lens) return;
      paintRange(sizeEl);
      previewLens(sizedArea(lens, Math.round(Number(sizeEl.value))));
    },
    { signal },
  );
  sizeEl?.addEventListener(
    'change',
    () => {
      const lens = selectedLens();
      if (lens) settle(sizedArea(lens, Math.round(Number(sizeEl.value))));
    },
    { signal },
  );
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

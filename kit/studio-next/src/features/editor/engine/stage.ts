import { api } from '@/desk/api';
import { desk } from '@/desk/store';
import { applyCardMotionToDocument } from '@/logic/cardMotion';
import { cardElapsedMs, cardMarkDuration, cardMarkInClip, cardMarkKey, liveMarksAtRecTime, resolveLiveCardFromPlates } from '@/logic/liveCardStage';
import { lensLoupe, planFrameEditor, planLensPaint, planLiveSeek } from '@/logic/livePreview';
import {
  joinFrameOwner,
  liveRecDiscontinuous,
  playheadOnPlate,
  shouldBlacklistPlateLoad,
  soloJoinFocus,
  stagePointerOwner,
} from '@/logic/plateSync';
import { stageLayout } from '@/logic/stageLayout';
import { sectionAtPlayhead } from './layoutPreview';
import { zoomPreviewStyle } from '@/logic/zoomAim';

import { paintLensBox, paintZoomBox, selectedShot } from './aim';
import { renderInspector } from './inspector';
import { GLASS, glassProfile, glassShade, lensOpenState, rimWidth } from '@/logic/lensGlass';
import { P } from './plateCtl';
import { clipIndexAt, curClip, edToRec, rateAt, selectedLens } from './seq';
import { ed, htmlPlates, live, liveH, liveW, setHtmlPlates, slug, video } from './state';
import { flushPlateResync, markPlateResync, paintTextMode } from './text';
import { paintTools } from './timeline';
import { armLive } from './transport';
import type { Clip, DeckMark, Lens, PlateRow } from './types';
import { $, ICONS, LAYER_PROPS, LENS_PAD, PLATE_ICON, T_GLYPH, clamp, escapeHtml, fmtRate, lensCentre, paintTransition, setLayerStyle, shadeHex, zoomStateAt } from './util';

/** The stage half of `kit/studio/editor.js`: what the monitor shows at the playhead. */

/**
 * The stage previews the render's geometry: the output frame's shape, the take's stage rect in
 * it (fill, inset window or device), corner radius and brand backdrop.
 */
/** The backdrop iframe shows the same HTML the render rasterises, scaled into the output frame. */
function paintBackdrop(url: string | null, shadowFromHtml: boolean): void {
  const frame = document.getElementById('liveBackdrop') as HTMLIFrameElement | null;
  const stage = $('liveStage');
  if (!frame || !stage) return;
  stage.classList.toggle('has-backdrop', Boolean(url));
  if (!url) {
    frame.hidden = true;
    if (frame.getAttribute('src')) frame.removeAttribute('src');
    return;
  }
  frame.hidden = false;
  const next = url.split('?')[0] ?? url;
  const current = frame.getAttribute('src') || '';
  if (!current.includes(next)) frame.src = url;
  if (shadowFromHtml) stage.style.setProperty('--frame-shadow', 'none');
}

export function paintFrame(): void {
  const el = $('liveStage');
  if (!el) return;
  const section = sectionAtPlayhead();
  const space = ed.deck?.space;
  const stage = section?.stage && space?.output ? { output: space.output, stage: section.stage } : space;
  const layout = stageLayout(stage);
  el.classList.toggle('is-framed', Boolean(layout));
  el.classList.toggle('is-inset', Boolean(layout?.placed));
  if (!layout) {
    paintBackdrop(null, false);
    return;
  }
  const cam = ed.deck?.camera || {};
  const bg = cam['background'] || ed.deck?.frame?.background || 'brand';
  const shadow = cam['shadow'] || ed.deck?.frame?.shadow || 'soft';
  const c = ed.deck?.brandColors || {};
  const [c0, c1] = bg === 'accent' ? [c['gold'], c['amber'] || c['gold']] : bg === 'ink' ? [c['ink'], c['ink']] : [c['surface'] || c['ink'], c['ink']];
  const vp = layout.viewport;
  const backdrop = section?.htmlUrl || null;
  const vars: Record<string, string> = {
    '--out-ar': String(layout.aspect),
    '--frame-x': vp.left,
    '--frame-y': vp.top,
    '--frame-w': vp.width,
    '--frame-h': vp.height,
    '--frame-rx': vp.rx,
    '--frame-ry': vp.ry,
    '--frame-c0': c0 || '#151715',
    '--frame-c1': c1 || '#0b120d',
    '--frame-accent': c['gold'] || '#42f272',
    '--frame-glow': bg === 'ink' ? '0%' : bg === 'accent' ? '25%' : '33%',
    '--frame-shadow': backdrop || shadow === 'off' ? 'none' : shadow === 'deep' ? '0 16px 44px rgba(0,0,0,.75)' : '0 12px 34px rgba(0,0,0,.55)',
  };
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  paintBackdrop(backdrop, Boolean(backdrop));
  P.fit();
}

export function syncLiveSource(): void {
  const v = video();
  if (!v || !ed.deck?.live?.url) return;
  const base = ed.deck.live.url.split('?')[0] ?? '';
  if (!v.src.includes(base)) v.src = ed.deck.live.url;
}

/**
 * Who gets the pointer when a card is composited over the recording. The card iframe sits
 * above the take, so by default it would swallow every drag meant for the zoom / magnifier
 * aim boxes underneath. Text mode owns the stage; an aim box in view owns it next; only then
 * does the card keep click-to-edit on its copy. Playback never routes into the iframe.
 */
export function routeStagePointer(cardOnTop: boolean): void {
  const plateL = $('fhdFit');
  if (!plateL) return;
  if (!cardOnTop) {
    plateL.style.pointerEvents = '';
    return;
  }
  const aimBoxUp = !($('liveZoomBox')?.hidden ?? true) || !($('liveLensBox')?.hidden ?? true);
  plateL.style.pointerEvents = stagePointerOwner({ textMode: ed.textMode, playing: ed.playing, aimBoxUp }) === 'card' ? '' : 'none';
}

/** The iframe currently shows this plate's document (even if a fresher build is pending). */
export const plateHolds = (id: string | null | undefined): boolean => Boolean(id) && desk.get().activePlateId === id && P.ready() === id;
// A stale frame counts as ready only while it holds unsaved copy — a forced reload would drop that.
export const plateReady = (id: string | null | undefined): boolean => plateHolds(id) && !(ed.stalePlates.has(id || '') && !P.dirty());

/** Ensure Program live-card HTML rows exist (rebuild if Studio loaded before Apply live cards). */
export async function ensureLiveCards(cardId: string | null = null): Promise<boolean> {
  const has = (id: string) => (htmlPlates() || []).some((p) => p.id === id && p.htmlUrl);
  const anyLive = () => (htmlPlates() || []).some((p) => p.liveCard && p.htmlUrl);
  if (cardId && has(cardId)) return true;
  if (!cardId && anyLive()) return true;
  // Prefer in-memory video payload before hitting the network.
  const fromVideo = desk.get().video?.htmlPlates as unknown as PlateRow[] | undefined;
  if (fromVideo?.length) {
    setHtmlPlates(fromVideo, { video: false });
    if (cardId && has(cardId)) return true;
    if (!cardId && anyLive()) return true;
  }
  try {
    const r = await api<{ plates?: PlateRow[] }>(`/api/video/${encodeURIComponent(slug() || '')}/plates`);
    if (r?.plates) setHtmlPlates(r.plates);
  } catch {
    /* ignore */
  }
  if (cardId && has(cardId)) return true;
  if (!cardId && anyLive()) return true;
  try {
    const r = await api<{ plates?: PlateRow[] }>(`/api/video/${encodeURIComponent(slug() || '')}/plates/rebuild-html`, { method: 'POST', body: {} });
    if (r?.plates) setHtmlPlates(r.plates);
  } catch {
    /* ignore */
  }
  return cardId ? has(cardId) : anyLive();
}

export function plateHtmlKnown(id: string): boolean {
  return Boolean((htmlPlates() || []).find((p) => p.id === id)?.htmlUrl);
}

export async function requestPlate(id: string | null | undefined, { reason = 'show', force = false }: { reason?: string; force?: boolean } = {}): Promise<void> {
  if (!id || ed.loadingPlate === id) return;
  if (!force && plateReady(id)) return;
  // Soft-miss recovery: a cancelled iframe race used to blacklist plates permanently.
  if (ed.missing.has(id)) {
    if (force || plateHtmlKnown(id)) ed.missing.delete(id);
    else return;
  }
  // One iframe: never steal the frame for a prefetch / neighbor while a live card is up.
  const holdCard = ed.liveCardId || ed.compositeCardId || null;
  if (holdCard && id !== holdCard && reason !== 'show') return;
  if (ed.textMode) {
    const keep = ed.liveCardId || desk.get().activePlateId;
    if (keep && id !== keep) return;
  }
  if (String(id).startsWith('overlay:')) {
    const okList = await ensureLiveCards(id);
    if (!okList) {
      ed.missing.add(id);
      return;
    }
    ed.missing.delete(id);
  }
  const gen = (ed.plateReqGen = (ed.plateReqGen || 0) + 1);
  ed.loadingPlate = id;
  paintLoading();
  try {
    if (P.dirty() && desk.get().activePlateId && desk.get().activePlateId !== id) await P.save();
    if (gen !== ed.plateReqGen) return;
    let ok = await P.load(id, { force: force || ed.stalePlates.delete(id) });
    if (gen !== ed.plateReqGen) return;
    // One retry — iframe onload / inline-edit arm can race the first paint.
    if (ok !== true && String(id).startsWith('overlay:') && shouldBlacklistPlateLoad(ok, { activePlateId: desk.get().activePlateId, requestedId: id })) {
      await new Promise((r) => setTimeout(r, 80));
      if (gen !== ed.plateReqGen) return;
      ok = await P.load(id, { force: true });
      if (gen !== ed.plateReqGen) return;
    }
    if (ok !== true) {
      // Cancelled / superseded must not blacklist — that blanked Opening after omit/reorder.
      if (shouldBlacklistPlateLoad(ok, { activePlateId: desk.get().activePlateId, requestedId: id })) {
        ed.missing.add(id);
      }
      return;
    }
    ed.missing.delete(id);
    if (ed.textMode) markPlateResync(id);
    else {
      P.motion();
      if (String(id).startsWith('overlay:')) P.composite(true);
      if (ed.needsPlateResync === id) {
        const c = curClip();
        const ms = c && playheadOnPlate(c, id) ? Math.max(0, (ed.t - c.at) * 1000) : 0;
        P.restart(ms);
        ed.needsPlateResync = null;
      }
    }
  } finally {
    if (ed.loadingPlate === id) ed.loadingPlate = null;
  }
  paintLoading();
  if (gen === ed.plateReqGen) renderFrame();
  if (ed.sel?.type === 'clip' && ed.seq.find((c) => c.id === ed.sel?.id)?.plateId === id) renderInspector();
}

export function joinStyle(c: Clip): string {
  const j = c.join;
  const pinned = j?.pinned?.style;
  const st = pinned && pinned !== 'directed' ? pinned : j?.type || ed.deck?.transitions?.style || 'dissolve';
  if (j?.card && st !== 'dip') return 'dissolve';
  return st === 'directed' ? 'dissolve' : st;
}

type FastSeekVideo = HTMLVideoElement & { fastSeek?: (t: number) => void };

export function applyLiveSeek(v: HTMLVideoElement, rec: number): void {
  ed.wantRec = rec;
  const plan = planLiveSeek({
    currentTime: v.currentTime || 0,
    wantRec: rec,
    seeking: v.seeking,
    readyState: v.readyState,
  });
  if (plan.action !== 'seek') return;
  try {
    const fv = v as FastSeekVideo;
    if (typeof fv.fastSeek === 'function') fv.fastSeek(plan.wantRec);
    else v.currentTime = plan.wantRec;
  } catch {
    /* metadata still arriving */
  }
}

export function drawLive(c: Clip, { outgoing = false }: { outgoing?: boolean } = {}): void {
  const v = video();
  if (!v || !live().exists) return;
  const rec = edToRec(c, ed.t);
  const atEnd = rec >= c.recTo - 0.03;
  if (ed.playing && !atEnd) armLive(v, rec, { outgoing });
  else {
    if (!v.paused) v.pause();
    applyLiveSeek(v, rec);
  }
  const W = liveW();
  const H = liveH();
  // A selected zoom paints its push-in on the stage (strength and aim), so the slider is not a
  // silent aim-box resize — Escape is no longer required to see what the cut will do.
  const shot = !ed.playing && ed.sel?.type === 'zoom' ? selectedShot() : null;
  let zs: { zoom: number; cx?: number | null; cy?: number | null };
  if (shot) {
    const p = ed.aim || shot.points?.[0] || { cx: W / 2, cy: H / 2 };
    zs = { zoom: ed.aimZoom || shot.zoom, cx: p.cx, cy: p.cy };
  } else {
    zs = ed.fx ? zoomStateAt(ed.deck?.zoomShots, rec, ed.deck?.zoomTiming) : { zoom: 1 };
  }
  // Push-ins without an aim point still scale from frame centre (matches ffmpeg default).
  if (zs.zoom > 1.001) {
    const cx = zs.cx ?? W / 2;
    const cy = zs.cy ?? H / 2;
    const style = zoomPreviewStyle(cx, cy, { zoom: zs.zoom, width: W, height: H });
    v.style.transformOrigin = style.transformOrigin;
    v.style.transform = style.transform;
  } else {
    v.style.transform = '';
    v.style.transformOrigin = '';
  }
  const lens = drawLens(outgoing ? null : rec);
  if (!outgoing) ed.hud = { rate: rateAt(rec), zoom: zs.zoom, lens };
}

// ─── Magnifier (canvas loupe over the recording; not scaled by the camera zoom) ──────────
export function lensAt(rec: number | null): Lens | null {
  if (rec == null || !ed.fx) return null;
  const sel = selectedLens();
  const list = (ed.deck?.lenses || []).filter((l) => rec >= l.t && rec <= l.t + l.dur);
  // While aiming, the selected lens shows where it is going to be.
  if (sel && sel.source !== 'off' && ed.lensAim && !ed.playing) return { ...sel, ...lensShape(sel, ed.lensAim) };
  return list.find((l) => l.key === sel?.key) || list[list.length - 1] || null;
}

/** Geometry of a lens with its target moved/resized (same sizing rules as lensGeometry). */
export function lensShape(_lens: Lens, aim: { x: number; y: number; w: number; h: number; zoom?: number | undefined }): {
  rect: { x: number; y: number; w: number; h: number };
  path: null;
  zoom: number;
  diameter: number;
  S: number;
} {
  const rect = { x: aim.x - aim.w / 2, y: aim.y - aim.h / 2, w: aim.w, h: aim.h };
  const { zoom, diameter, S } = lensLoupe(Math.max(rect.w, rect.h), aim.zoom);
  return { rect, path: null, zoom, diameter, S };
}

/** Edge-smear crop so corner targets still fill the loupe (mirrors ffmpeg pad+fillborders). */
export function loupeSourceCanvas(v: HTMLVideoElement, cx: number, cy: number, crop: number, vidW: number, vidH: number): HTMLCanvasElement {
  const size = Math.max(1, Math.round(crop));
  if (!ed.loupeBuf || ed.loupeBuf.width !== size) {
    ed.loupeBuf = document.createElement('canvas');
    ed.loupeBuf.width = size;
    ed.loupeBuf.height = size;
  }
  const buf = ed.loupeBuf;
  const t = buf.getContext('2d');
  if (!t) return buf;
  t.clearRect(0, 0, size, size);
  const x0 = cx - size / 2;
  const y0 = cy - size / 2;
  const left = Math.max(0, Math.ceil(-x0));
  const top = Math.max(0, Math.ceil(-y0));
  const right = Math.max(0, Math.ceil(x0 + size - vidW));
  const bottom = Math.max(0, Math.ceil(y0 + size - vidH));
  const srcX = Math.max(0, Math.floor(x0));
  const srcY = Math.max(0, Math.floor(y0));
  const srcW = Math.max(0, size - left - right);
  const srcH = Math.max(0, size - top - bottom);
  if (srcW > 0 && srcH > 0) t.drawImage(v, srcX, srcY, srcW, srcH, left, top, srcW, srcH);
  if (left > 0 && srcH > 0) t.drawImage(v, srcX, srcY, 1, srcH, 0, top, left, srcH);
  if (right > 0 && srcH > 0) t.drawImage(v, srcX + srcW - 1, srcY, 1, srcH, left + srcW, top, right, srcH);
  if (top > 0 && srcW > 0) t.drawImage(v, srcX, srcY, srcW, 1, left, 0, srcW, top);
  if (bottom > 0 && srcW > 0) t.drawImage(v, srcX, srcY + srcH - 1, srcW, 1, left, top + srcH, srcW, bottom);
  if (left > 0 && top > 0) t.drawImage(v, srcX, srcY, 1, 1, 0, 0, left, top);
  if (right > 0 && top > 0) t.drawImage(v, srcX + srcW - 1, srcY, 1, 1, left + srcW, 0, right, top);
  if (left > 0 && bottom > 0) t.drawImage(v, srcX, srcY + srcH - 1, 1, 1, 0, top + srcH, left, bottom);
  if (right > 0 && bottom > 0) t.drawImage(v, srcX + srcW - 1, srcY + srcH - 1, 1, 1, left + srcW, top + srcH, right, bottom);
  return buf;
}

export function drawLens(rec: number | null): Lens | null {
  const cv = $<HTMLCanvasElement>('liveLens');
  const v = video();
  if (!cv || !v) return null;
  const lens = lensAt(rec);
  const selected = selectedLens();
  const hold = planFrameEditor({
    selected: Boolean(selected) && selected?.source !== 'off',
    blockStart: selected?.t ?? 0,
    blockEnd: (selected?.t ?? 0) + (selected?.dur ?? 0),
    playhead: rec,
    playing: ed.playing,
  }).visible;
  const vp = $('liveViewport');
  const cssW = vp?.clientWidth || 0;
  const cw = Math.round(cssW * (window.devicePixelRatio || 1));
  const ch = Math.round((vp?.clientHeight || 0) * (window.devicePixelRatio || 1));
  if (cv.width !== cw || cv.height !== ch) {
    cv.width = cw;
    cv.height = ch;
  }
  const g = cv.getContext('2d');
  if (!g) return null;
  const paint = planLensPaint({ hasLens: Boolean(lens), viewportCssPx: cssW, readyState: v.readyState, hold });
  if (paint.action === 'clear') {
    g.clearRect(0, 0, cv.width, cv.height);
    return null;
  }
  // Mid-seek the decoder often dips below HAVE_CURRENT_DATA — keep the last loupe.
  if (paint.action === 'keep' || !lens || rec == null) return lens;
  g.clearRect(0, 0, cv.width, cv.height);
  const W = liveW();
  const H = liveH();
  const k = cw / W;
  const aiming = ed.lensAim && !ed.playing && lens.key === ed.sel?.key;
  const T = rec - lens.t;
  const st = aiming ? { open: 1, scale: 1, alpha: 1, swell: 1 } : lensOpenState(T, lens.dur, ed.deck?.lensTiming);
  if (st.alpha <= 0.001) return null;
  const { x: tx, y: ty } = lensCentre(lens, clamp(T, 0, lens.dur));
  const cx = clamp(tx, 0, W);
  const cy = clamp(ty, 0, H);
  const R0 = lens.diameter / 2;
  const R = R0 * st.scale;
  const mx = cx * k;
  const my = cy * k;
  const Rk = R * k;
  const rim = rimWidth(lens.diameter);
  const rimHex = ed.deck?.lensRim || '#F6AA1E';
  // Source: the frame around the target at full zoom, over the glass's whole reach.
  const reach = (1 + GLASS.bulge + GLASS.bevel) / st.swell;
  const crop = (2 * R * reach + 8) / lens.zoom;
  g.save();
  g.globalAlpha = st.alpha;
  // Drop shadow, falling slightly below the glass.
  g.save();
  g.shadowColor = `rgba(0,0,0,${(GLASS.shadow / 255).toFixed(3)})`;
  g.shadowBlur = LENS_PAD * k * 1.1;
  g.shadowOffsetY = GLASS.shadowDrop * Rk;
  g.beginPath();
  g.arc(mx, my, Rk, 0, Math.PI * 2);
  g.fillStyle = '#000';
  g.fill();
  g.restore();
  // Glass: concentric bands, each drawing the magnified frame at that radius' sampling factor
  // (outer bands squeeze toward the bevel, the centre stays flat) — the canvas take on geq's
  // per-pixel refraction.
  g.save();
  g.beginPath();
  g.arc(mx, my, Rk, 0, Math.PI * 2);
  g.clip();
  try {
    const src = loupeSourceCanvas(v, cx, cy, crop, W, H);
    const full = src.width * lens.zoom * k; // on-screen size of the source at full magnification
    const bands = 14;
    for (let i = bands - 1; i >= 0; i--) {
      const d1 = (i + 1) / bands;
      const dm = (i + 0.5) / bands;
      const gF = glassProfile(dm) / st.swell;
      if (i < bands - 1) {
        g.save();
        g.beginPath();
        g.arc(mx, my, Rk * d1, 0, Math.PI * 2);
        g.clip();
      }
      const size = full / gF;
      g.drawImage(src, mx - size / 2, my - size / 2, size, size);
      if (i < bands - 1) g.restore();
    }
  } catch {
    /* frame not decodable yet */
  }
  // Shade: vignette toward the rim and the dark bevel band.
  const vig = g.createRadialGradient(mx, my, 0, mx, my, Rk);
  for (const d of [0, 0.6, 0.8, 0.88, 0.94, 1]) vig.addColorStop(d, `rgba(0,0,0,${(1 - glassShade(d)).toFixed(3)})`);
  g.fillStyle = vig;
  g.fillRect(mx - Rk, my - Rk, 2 * Rk, 2 * Rk);
  // Light: specular blob upper-left, soft top light, edge arc on the lit side, Fresnel crescent lower-right.
  const spec = g.createRadialGradient(mx - 0.5 * Rk, my - 0.52 * Rk, 0, mx - 0.5 * Rk, my - 0.52 * Rk, 0.3 * Rk);
  spec.addColorStop(0, `rgba(255,255,255,${(GLASS.specular / 255).toFixed(3)})`);
  spec.addColorStop(0.5, `rgba(255,255,255,${(GLASS.specular / 255 / 3).toFixed(3)})`);
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = spec;
  g.fillRect(mx - Rk, my - Rk, 2 * Rk, 2 * Rk);
  const top = g.createLinearGradient(0, my - Rk, 0, my);
  top.addColorStop(0, `rgba(255,255,255,${(GLASS.topLight / 255).toFixed(3)})`);
  top.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = top;
  g.fillRect(mx - Rk, my - Rk, 2 * Rk, Rk);
  g.lineCap = 'round';
  g.beginPath();
  g.arc(mx, my, Rk * 0.955, Math.PI * 0.95, Math.PI * 1.55);
  g.lineWidth = Math.max(1, 0.03 * Rk);
  g.strokeStyle = `rgba(255,255,255,${(GLASS.edgeLight / 255).toFixed(3)})`;
  g.stroke();
  g.beginPath();
  g.arc(mx, my, Rk * 0.93, Math.PI * 0.05, Math.PI * 0.45);
  g.lineWidth = 0.12 * Rk;
  g.strokeStyle = `rgba(255,255,255,${(GLASS.crescent / 255 / 2).toFixed(3)})`;
  g.stroke();
  g.restore();
  // Rim: lit metal from the top, a dark outer line, a bright inner bevel.
  const metal = g.createLinearGradient(0, my - Rk, 0, my + Rk);
  metal.addColorStop(0, shadeHex(rimHex, 1 + GLASS.rimLight / 2));
  metal.addColorStop(1, shadeHex(rimHex, 1 - GLASS.rimLight / 2));
  g.beginPath();
  g.arc(mx, my, Math.max(0, R - rim / 2) * k, 0, Math.PI * 2);
  g.lineWidth = rim * k;
  g.strokeStyle = metal;
  g.stroke();
  g.beginPath();
  g.arc(mx, my, Math.max(0, R - 0.6) * k, 0, Math.PI * 2);
  g.lineWidth = Math.max(1, 1.2 * k);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.stroke();
  g.beginPath();
  g.arc(mx, my, Math.max(0, R - rim) * k, 0, Math.PI * 2);
  g.lineWidth = Math.max(1, 1.1 * k);
  g.strokeStyle = 'rgba(255,255,255,0.28)';
  g.stroke();
  g.restore();
  return lens;
}

export function drawPlate(c: Clip): boolean {
  if (!plateReady(c.plateId)) {
    void requestPlate(c.plateId);
    return false;
  }
  if (!ed.textMode) P.seek(Math.max(0, (ed.t - c.at) * 1000));
  return true;
}

export function renderFrame(): void {
  if (!ed.active || !ed.seq.length) return;
  const i = clipIndexAt(ed.t);
  const c = ed.seq[i]!;
  const prev = ed.seq[i - 1];
  const indexChanged = ed.cur !== i;
  ed.cur = i;
  if (indexChanged) {
    ed.liveSeeked = false;
    paintFrame();
  }
  ed.hud = null;
  const inJoin = Boolean(ed.fx && prev && c.overlap > 0 && ed.t < c.at + c.overlap);
  const joinP = inJoin ? (ed.t - c.at) / c.overlap : 0;
  const liveHit = c.kind === 'live' ? liveHitAtPlayhead() : null;
  const editingCard = Boolean(ed.textMode && ed.liveCardId && c.kind === 'live');
  const wantsCard = Boolean(liveHit || editingCard);
  // Plate→live join onto a card: the plate iframe can hold only one of them per frame.
  const frameOwner = inJoin ? joinFrameOwner(prev, c, joinP, { curNeedsCard: wantsCard, lockCard: editingCard }) : null;
  const trans = inJoin && frameOwner !== 'card';
  // One surface: plate→plate / live→live cannot dual-draw. Focus one clip (avoids omitted-middle flash).
  const soloFocus = trans ? soloJoinFocus(prev, c, joinP) : null;
  const plateFocus = soloFocus?.kind === 'plate' ? soloFocus : null;
  const liveFocus = soloFocus?.kind === 'live' ? soloFocus : null;
  const plateL = $('fhdFit');
  const liveL = $('liveStage');
  if (!plateL || !liveL) return;
  const layer = (k: string) => (k === 'plate' ? plateL : liveL);
  for (const L of [plateL, liveL]) for (const p of LAYER_PROPS) setLayerStyle(L, p, '');
  const inL = layer(c.kind);
  const outL = trans && !soloFocus && prev ? layer(prev.kind) : null;
  const showLiveCard = wantsCard && frameOwner !== 'plate';
  const wantCardId = ed.textMode && ed.liveCardId ? ed.liveCardId : liveHit?.card?.id || null;
  // Keep the last composited card visible while its frame loads — hiding the layer every
  // ready-flicker (or while prefetch stole the iframe) looked like a blink storm.
  const cardFrameReady = Boolean(wantCardId && plateReady(wantCardId));
  const showCardLayer = Boolean(
    showLiveCard && (cardFrameReady || (ed.textMode && ed.liveCardId) || (ed.compositeCardId && ed.compositeCardId === wantCardId)),
  );
  const stagePlate = plateFocus || (!soloFocus && c.kind === 'plate' ? c : null);
  // The plate this frame wants in the iframe: the clip on stage, or the outgoing plate of a
  // plate→live wipe. Show the layer only when the iframe actually holds that plate — never the
  // document left over from the previous frame (an omitted plate, the next card…).
  const platePartner = stagePlate || (outL === plateL ? prev : null);
  const plateContentReady = Boolean(platePartner && plateHolds(platePartner.plateId));
  const plateWasHidden = plateL.hidden;
  plateL.hidden = !(showCardLayer || plateContentReady);
  if (plateWasHidden && !plateL.hidden) P.fit();
  liveL.hidden = !(inL === liveL || outL === liveL || liveFocus);
  if (document.body.classList.contains('is-live-card') !== showLiveCard) {
    document.body.classList.toggle('is-live-card', showLiveCard);
    P.fit();
  }
  if (showLiveCard) {
    liveL.hidden = false;
    plateL.style.zIndex = '3';
    liveL.style.zIndex = '1';
    document.body.classList.add('is-live-card');
    if (wantCardId && !cardFrameReady) void requestPlate(wantCardId, { reason: 'show' });
  } else {
    inL.style.zIndex = '2';
    if (outL) outL.style.zIndex = '1';
    plateL.style.pointerEvents = '';
    if (ed.compositeCardId) P.composite(false);
    ed.compositeCardId = null;
    ed.compositeSeekMs = null;
    document.body.classList.remove('is-live-card');
  }

  let ready = true;
  if (stagePlate) {
    ready = drawPlate(stagePlate) && plateContentReady;
  } else if (liveFocus) {
    drawLive(liveFocus, { outgoing: liveFocus === prev });
    if (showLiveCard && liveFocus === c) syncLiveCardComposite(liveHit);
  } else {
    drawLive(c);
    if (showLiveCard) syncLiveCardComposite(liveHit);
  }
  if (trans && soloFocus) {
    // Solo surface: dip the one layer (paintTransition handles inL === outL).
    paintTransition(joinStyle(c), joinP, layer(soloFocus.kind), layer(soloFocus.kind));
    // Hide while seeking across an omitted hole so middle recording frames never paint.
    if (liveFocus && liveRecDiscontinuous(prev, c)) {
      const v = video();
      const want = edToRec(liveFocus, ed.t);
      if (v && (v.seeking || Math.abs((v.currentTime || 0) - want) > 0.45)) liveL.style.opacity = '0';
    }
  } else if (trans && !soloFocus && prev) {
    if (prev.kind === 'plate') drawPlate(prev);
    else drawLive(prev, { outgoing: true });
    paintTransition(joinStyle(c), joinP, inL, outL);
  } else if (c.kind === 'plate' || plateFocus) {
    const v = video();
    if (v && !v.paused) v.pause();
  }
  const stallId = stagePlate?.plateId || c.plateId;
  ed.stall = Boolean(ed.playing && !ready && stallId && !ed.missing.has(stallId));
  const empty = $('plateEmpty');
  if (empty) empty.hidden = !(stagePlate && ed.missing.has(stagePlate.plateId || ''));

  // Get the next surface ready so the cut never waits (skip while editing — don't stomp the frame).
  const n = ed.seq[i + 1];
  if (n && !ed.textMode) {
    // Prefetch only — must not unload a live card currently composited in the plate iframe.
    if (c.kind === 'live' && n.kind === 'plate' && ed.t > c.at + c.overlap && n.at - ed.t < 2.5) {
      void requestPlate(n.plateId, { reason: 'prefetch' });
    }
    if (c.kind === 'plate' && n.kind === 'live' && !trans) {
      const v = video();
      if (v && v.paused && ed.preSeek !== n.id && Math.abs(v.currentTime - n.recFrom) > 0.05) {
        ed.preSeek = n.id;
        v.currentTime = n.recFrom;
      }
    }
  }
  if (c.kind !== 'live') drawLens(null);
  paintHud(c, trans ? joinStyle(c) : null);
  paintZoomBox();
  paintLensBox();
  routeStagePointer(showLiveCard);
  const cardHint = c.kind === 'live' ? liveCardAtPlayhead()?.id || '' : '';
  const cardChanged = cardHint !== ed.cardHint;
  ed.cardHint = cardHint;
  if (indexChanged || cardChanged) {
    paintClipChip();
    if (!ed.textMode) paintTextMode();
  }
  if (indexChanged) {
    paintTools();
    document.querySelectorAll<HTMLElement>('#etlClips .etl-clip').forEach((el) => el.classList.toggle('is-cur', Number(el.dataset['i']) === i));
    // Look/style changed while the playhead was elsewhere — resync as we enter the plate.
    if (c.kind === 'plate' && ed.needsPlateResync === c.plateId && !ed.textMode) flushPlateResync();
  }
}

export function paintHud(_c: Clip, transition: string | null): void {
  const hud = $('edHud');
  if (!hud) return;
  const chips: string[] = [];
  if (transition)
    chips.push(
      `<span class="ed-chip tr">${T_GLYPH[transition] || ICONS['transition']}${escapeHtml(ed.deck?.transitionStyles?.[transition]?.label || transition)}</span>`,
    );
  if (ed.hud && Math.abs(ed.hud.rate - 1) > 0.01)
    chips.push(`<span class="ed-chip speed${ed.hud.rate < 1 ? ' slow' : ''}">${ed.hud.rate < 1 ? ICONS['slow'] : ICONS['speed']}${fmtRate(ed.hud.rate)}</span>`);
  if (ed.hud && ed.hud.zoom > 1.01) chips.push(`<span class="ed-chip zoom">${ICONS['zoom']}${ed.hud.zoom.toFixed(2)}×</span>`);
  if (ed.hud?.lens) chips.push(`<span class="ed-chip lens">${ICONS['lens']}${ed.hud.lens.zoom.toFixed(1)}× magnifier</span>`);
  const html = chips.join('');
  if (hud.innerHTML !== html) hud.innerHTML = html;
}

export function paintLoading(): void {
  const el = $('edLoading');
  if (!el) return;
  const c = curClip();
  const forPlate = ed.loadingPlate && c?.kind === 'plate' && c.plateId === ed.loadingPlate;
  const previewId = ed.liveCardId || ed.compositeCardId || liveCardAtPlayhead()?.id;
  const forCard = ed.loadingPlate && previewId && ed.loadingPlate === previewId;
  el.hidden = !(forPlate || forCard);
}

export const resolveLiveCard = (mark: DeckMark | null | undefined): PlateRow | null =>
  resolveLiveCardFromPlates(mark, htmlPlates(), ed.deck?.marks || []);

export interface LiveHit {
  mark: DeckMark;
  card: PlateRow;
  recT: number;
}

/** Active chapter/caption under the playhead: mark + card + recording clock. */
export function liveHitAtPlayhead(): LiveHit | null {
  const c = curClip();
  if (c?.kind !== 'live') return null;
  const recT = edToRec(c, ed.t);
  const carried = new Set((ed.deck?.layouts?.sections || []).filter((s) => s.textOn).map((s) => s.key));
  const hits = liveMarksAtRecTime(ed.deck?.marks, recT, { recFrom: c.recFrom, recTo: c.recTo }).filter(
    (m) => !(m.kind === 'chapter' && carried.has(m.key || cardMarkKey(m))),
  );
  const mark = hits[0];
  if (!mark) return null;
  const card = resolveLiveCard(mark);
  return card ? { mark, card, recT } : null;
}

export const liveCardAtPlayhead = (): PlateRow | null => liveHitAtPlayhead()?.card || null;

export function marksInLiveClip(c: Clip | null | undefined): DeckMark[] {
  if (c?.kind !== 'live') return [];
  return (ed.deck?.marks || []).filter((m) => cardMarkInClip(m, c));
}

/**
 * Keep the direction-true card HTML composited over the recording (motion seek while
 * playing/scrubbing; text mode owns the frame while editing).
 * Do not prefetch the next overlay into the shared plate iframe — that unloads the
 * current card every frame and blinks the stage.
 */
export function syncLiveCardComposite(hit: LiveHit | null): void {
  const id = ed.textMode && ed.liveCardId ? ed.liveCardId : hit?.card?.id;
  if (!id) {
    ed.compositeCardId = null;
    ed.compositeHoldMs = null;
    ed.compositeSeekMs = null;
    return;
  }
  if (!plateReady(id)) {
    void requestPlate(id, { reason: 'show' });
    return;
  }
  P.composite(true);
  if (ed.compositeCardId !== id) {
    ed.compositeCardId = id;
    ed.compositeHoldMs = null;
    ed.compositeSeekMs = null;
    if (!ed.textMode) P.motion();
    else P.composite(true);
    P.fit();
  }
  if (!ed.textMode && hit?.mark) {
    const holdMs = Math.round(cardMarkDuration(hit.mark) * 1000);
    const elapsed = cardElapsedMs(hit.mark, hit.recT);
    // Timeline / inspector length must drive exit CSS — HTML may still have the record default.
    if (ed.compositeHoldMs !== holdMs) {
      ed.compositeHoldMs = holdMs;
      ed.compositeSeekMs = null;
      const kind = hit.mark.kind === 'chapter' ? 'chapter' : 'caption';
      try {
        const doc = $<HTMLIFrameElement>('plateFrame')?.contentDocument;
        if (doc?.body) applyCardMotionToDocument(doc, kind, holdMs);
      } catch {
        /* cross-origin / unloaded */
      }
      // restart() declines (returns false) when the frame cannot re-run its intro; a plain seek
      // still parks the card at the right moment of the new timing.
      if (!P.restart(elapsed)) P.seek(elapsed);
      ed.compositeSeekMs = elapsed;
      return;
    }
    // Seek only when the card clock moves — per-frame seeks thrash CSS animations.
    if (ed.compositeSeekMs !== elapsed) {
      ed.compositeSeekMs = elapsed;
      P.seek(elapsed);
    }
  }
}

export function paintClipChip(): void {
  const el = $('edClipChip');
  const c = curClip();
  if (!el || !c) return;
  const ico = c.kind === 'live' ? ICONS['film'] : ICONS[PLATE_ICON[c.plateId || ''] || 'plate'];
  el.className = `ed-clip-chip ${c.kind}`;
  el.innerHTML = `${ico}<b>${escapeHtml(c.title)}</b><em>${c.kind === 'live' ? 'Recording' : escapeHtml(c.type || 'Plate')} · ${c.dur.toFixed(1)}s</em>`;
  const textBtn = $<HTMLButtonElement>('edEditText');
  if (textBtn) {
    const card = c.kind === 'live' ? liveCardAtPlayhead() || (ed.liveCardId && { id: ed.liveCardId }) : null;
    const canPlate = c.kind === 'plate' && !ed.missing.has(c.plateId || '');
    const canCard = Boolean(card);
    textBtn.hidden = !(canPlate || canCard || ed.textMode);
    textBtn.title = canCard || ed.liveCardId ? 'Edit chapter/caption copy (opens the live-card template)' : 'Edit the words on this plate';
  }
}

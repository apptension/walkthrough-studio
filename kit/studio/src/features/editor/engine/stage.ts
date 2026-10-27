import { api } from '@/desk/api';
import { desk } from '@/desk/store';
import { applyCardMotionToDocument } from '@/logic/cardMotion';
import { cardElapsedMs, cardMarkDuration, cardMarkInClip, cardMarkKey, liveMarksAtRecTime, resolveLiveCardFromPlates } from '@/logic/liveCardStage';
import { lensLoupe, planLensPaint, planLiveSeek } from '@/logic/livePreview';
import {
  joinFrameOwner,
  liveRecDiscontinuous,
  playheadOnPlate,
  shouldBlacklistPlateLoad,
  soloJoinFocus,
  stagePointerOwner,
  stageReloadIsQuiet,
} from '@/logic/plateSync';
import { getMarkMode, setMarkMode } from '@/logic/mark';
import { isCarryJoin } from '@/logic/plateCarry';
import { nextStageSurface } from '@/logic/platePreload';
import { clipPlayback, plateClockMs } from '@/logic/plateTiming';
import { stageLayout } from '@/logic/stageLayout';
import { sectionAtPlayhead } from './layoutPreview';
import { zoomPreviewStyle } from '@/logic/zoomAim';

import { aimSpace, paintLensBox, paintZoomBox, selectedShot } from './aim';
import { onCarryBackdropReady, syncCarry, type CarryFrame } from './carryStage';
import { renderInspector } from './inspector';
import { isContentSaveResponseValid, paintInspectorUnlessContentTyping } from './plateContentSave';
import {
  bakeStalePlateContent,
  contentSaveIdle,
  contentSaveProjectEpoch,
  flushEditorContentPending,
  hasContentPending,
  settlePlateContent,
} from './plateContentPane';
import { GLASS, glassProfile, glassShade, lensOpenState, rimWidth } from '@/logic/lensGlass';
import { plateStageReady, shouldBakeBeforePlateLoad } from '@/logic/plateSync';
import { refitPlateCompositionDeferred } from './plate';
import { P } from './plateCtl';
import { onPlateGlassChange, placePlateGlass, plateGlassReady, syncPlateGlass, type GlassGeom } from './plateGlass';
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
/** Held frame is paint-ready even when disk HTML is stale (Content live typing). See `plateStageReady`. */
export const plateReady = (id: string | null | undefined): boolean =>
  plateStageReady({ holds: plateHolds(id) });

/**
 * A caption written in the Editor has a mark immediately, but its overlay HTML arrives on the
 * next plates list. "Some live card exists" is not enough — that list is the script's cards.
 */
function addedCardUnresolved(): boolean {
  const marks = ed.deck?.marks;
  if (!marks?.length) return false;
  const plates = htmlPlates() || [];
  return marks.some(
    (m) => m.added && (m.kind === 'chapter' || m.kind === 'caption') && !resolveLiveCardFromPlates(m, plates, marks),
  );
}

/** Ensure Program live-card HTML rows exist (rebuild if Studio loaded before Apply live cards). */
export async function ensureLiveCards(cardId: string | null = null): Promise<boolean> {
  const has = (id: string) => (htmlPlates() || []).some((p) => p.id === id && p.htmlUrl);
  const anyLive = () => (htmlPlates() || []).some((p) => p.liveCard && p.htmlUrl);
  const listed = (): boolean => (cardId ? has(cardId) : anyLive() && !addedCardUnresolved());
  if (listed()) return true;
  // Prefer in-memory video payload before hitting the network.
  const fromVideo = desk.get().video?.htmlPlates as unknown as PlateRow[] | undefined;
  if (fromVideo?.length) {
    setHtmlPlates(fromVideo, { video: false });
    if (listed()) return true;
  }
  try {
    const r = await api<{ plates?: PlateRow[] }>(`/api/video/${encodeURIComponent(slug() || '')}/plates`);
    if (r?.plates) setHtmlPlates(r.plates);
  } catch {
    /* ignore */
  }
  if (listed()) return true;
  const wantSlug = slug() || '';
  const wantEpoch = contentSaveProjectEpoch();
  try {
    await flushEditorContentPending();
    if (!isContentSaveResponseValid(wantSlug, wantEpoch, slug() || '', contentSaveProjectEpoch())) return listed();
    const r = await api<{ plates?: PlateRow[] }>(`/api/video/${encodeURIComponent(slug() || '')}/plates/rebuild-html`, { method: 'POST', body: {} });
    if (!isContentSaveResponseValid(wantSlug, wantEpoch, slug() || '', contentSaveProjectEpoch())) return listed();
    if (r?.plates) setHtmlPlates(r.plates);
  } catch {
    /* ignore */
  }
  return listed();
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
    const activeId = desk.get().activePlateId;
    if (hasContentPending() || ed.stalePlates.has(String(id)) || (activeId && activeId !== id)) {
      await flushEditorContentPending();
    } else {
      await contentSaveIdle();
    }
    if (P.dirty() && activeId && activeId !== id) await P.save();
    if (gen !== ed.plateReqGen) return;
    // Stale = config ahead of baked HTML (Content live typing). Bake before load so a force
    // refetch does not resurrect pre-type copy. Look/palette stale also gets a clean rebuild.
    if (shouldBakeBeforePlateLoad({ stale: ed.stalePlates.has(id) })) {
      await bakeStalePlateContent(id);
      if (gen !== ed.plateReqGen) return;
      // Still holding live paint (or bake reloaded us) — do not wipe the frame.
      if (!force && plateReady(id)) return;
      // Bake deferred (Content caret): keep the stale mark for the retry — never
      // `stalePlates.delete` here or the scheduled bake becomes a no-op.
      if (ed.stalePlates.has(id) && plateHolds(id)) return;
    }
    const pendingStale = ed.stalePlates.has(id);
    const forceLoad = force || pendingStale;
    // Keep `stalePlates` until bake succeeds — clearing here dropped the mark after a failed
    // rebuild and the next visit loaded pre-type HTML with no retry scheduled.
    let ok = await P.load(id, { force: forceLoad });
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
        const ms = c && playheadOnPlate(c, id) ? plateClockMs(c, ed.t) : 0;
        P.restart(ms);
        ed.needsPlateResync = null;
      }
    }
  } finally {
    if (ed.loadingPlate === id) ed.loadingPlate = null;
  }
  paintLoading();
  if (gen === ed.plateReqGen) renderFrame();
  if (ed.sel?.type === 'clip' && ed.seq.find((c) => c.id === ed.sel?.id)?.plateId === id) {
    paintInspectorUnlessContentTyping(renderInspector);
  }
}

export function joinStyle(c: Clip): string {
  const j = c.join;
  if (j?.type === 'continue') return 'continue';
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
export function lensAt(rec: number | null, clip: string | null = null): Lens | null {
  if (rec == null || !ed.fx) return null;
  const sel = selectedLens();
  // `rec` is the recording clock for a recording and the plate's own clock for a plate, so a
  // mark only answers for the surface it was written on.
  const list = (ed.deck?.lenses || []).filter((l) => (l.clip || null) === clip && rec >= l.t && rec <= l.t + l.dur);
  // While aiming, the selected lens shows where it is going to be.
  if (sel && sel.source !== 'off' && ed.lensAim && !ed.playing) return { ...sel, ...lensShape(sel, ed.lensAim) };
  return list.find((l) => l.key === sel?.key) || list[list.length - 1] || null;
}

/** Geometry of a lens with its target moved/resized (same sizing rules as lensGeometry). */
export function lensShape(lens: Lens, aim: { x: number; y: number; w: number; h: number; zoom?: number | undefined }): {
  rect: { x: number; y: number; w: number; h: number };
  path: null;
  zoom: number;
  zoomExact: number;
  diameter: number;
  S: number;
} {
  const rect = { x: aim.x - aim.w / 2, y: aim.y - aim.h / 2, w: aim.w, h: aim.h };
  const { zoom, zoomExact, diameter, S } = lensLoupe(Math.max(rect.w, rect.h), aim.zoom, aimSpace(lens.clip));
  return { rect, path: null, zoom, zoomExact, diameter, S };
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

export interface LoupeSource {
  el?: HTMLVideoElement | null;
  width?: number;
  height?: number;
  clip?: string | null;
  /** The canvas to paint on, and the element whose box the glass is scaled onto. */
  canvas?: string;
  over?: string;
  /** A live picture placed under the canvas instead of sampled pixels; the canvas paints only the glass. */
  glass?: ((g: GlassGeom | null) => void) | null;
}

export function drawLens(rec: number | null, src: LoupeSource = {}): Lens | null {
  const glass = src.glass ?? null;
  let placed = false;
  try {
    const lens = paintLens(rec, src, (g) => {
      placed = true;
      glass?.(g);
    });
    return lens;
  } finally {
    if (glass && !placed) glass(null);
  }
}

/**
 * What each lens canvas holds right now. "Keep the last loupe" is only honest when the last
 * loupe is this lens, on this surface, painted from real pixels: anything else on the canvas is
 * another slide's glass — and a glass painted for the live mirror is a punched-out disc that
 * reads as a dark ring around nothing once the mirror underneath is gone.
 */
interface LensMark {
  key: string;
  clip: string | null;
  via: 'pixels' | 'glass';
}
const lensMarks = new WeakMap<HTMLCanvasElement, LensMark>();

function wipeLens(cv: HTMLCanvasElement | null | undefined): void {
  if (!cv) return;
  if (cv.width && cv.height) cv.getContext('2d')?.clearRect(0, 0, cv.width, cv.height);
  lensMarks.delete(cv);
}

/** The plate loupe and the live mirror under it, both gone. */
export function clearPlateLens(): void {
  wipeLens($<HTMLCanvasElement>('plateLens'));
  placePlateGlass(null);
}

function paintLens(rec: number | null, src: LoupeSource, place: (g: GlassGeom) => void): Lens | null {
  const cv = $<HTMLCanvasElement>(src.canvas || 'liveLens');
  const live = Boolean(src.glass);
  // `el: null` is a surface with nothing to sample yet, not "use the recording": falling back
  // there painted the take's pixels inside a magnifier sitting on a slide.
  const v = live ? null : 'el' in src ? (src.el ?? null) : video();
  if (!cv) return null;
  if (!v && !live) {
    // Nothing to sample this frame (the slide's render does not exist yet): show no loupe
    // rather than whatever the canvas last held.
    wipeLens(cv);
    return null;
  }
  const lens = lensAt(rec, src.clip ?? null);
  const vp = $(src.over || 'liveViewport');
  // A plate's frame is scaled to fit inside its pane, so the glass follows that box rather than
  // the pane: `getBoundingClientRect` already has the fit transform baked in.
  const box = src.over ? vp?.getBoundingClientRect() : null;
  const cssW = (box ? box.width : vp?.clientWidth) || 0;
  const cssH = (box ? box.height : vp?.clientHeight) || 0;
  const cw = Math.round(cssW * (window.devicePixelRatio || 1));
  const ch = Math.round(cssH * (window.devicePixelRatio || 1));
  if (cv.width !== cw || cv.height !== ch) {
    // Resizing a canvas empties it, so there is no longer a last loupe to keep.
    cv.width = cw;
    cv.height = ch;
    lensMarks.delete(cv);
  }
  // The glass canvas is out of flow, so sizing it cannot move its offsetParent — one measurement
  // serves both the canvas placement here and the mirror placement further down. Reading it again
  // after the writes below would force the browser to rebuild layout mid-frame for the same answer.
  const host = box ? cv.offsetParent?.getBoundingClientRect() : undefined;
  if (box) {
    cv.style.width = `${cssW}px`;
    cv.style.height = `${cssH}px`;
    cv.style.transform = `translate(${Math.round(box.left - (host?.left ?? 0))}px, ${Math.round(box.top - (host?.top ?? 0))}px)`;
  }
  const g = cv.getContext('2d');
  if (!g) return null;
  const paint = planLensPaint({ hasLens: Boolean(lens), viewportCssPx: cssW, readyState: v ? v.readyState : 4 });
  if (paint.action === 'clear' || !lens || rec == null) {
    wipeLens(cv);
    return null;
  }
  // Mid-seek the decoder often dips below HAVE_CURRENT_DATA — keep the last loupe, but only when
  // it is this one. A switch of slide, lens or source is never a seek dip.
  if (paint.action === 'keep') {
    const was = lensMarks.get(cv);
    if (was && was.key === lens.key && was.clip === (src.clip ?? null) && was.via === 'pixels') return lens;
    wipeLens(cv);
    return null;
  }
  g.clearRect(0, 0, cv.width, cv.height);
  lensMarks.set(cv, { key: lens.key, clip: src.clip ?? null, via: v ? 'pixels' : 'glass' });
  const W = src.width || liveW();
  const H = src.height || liveH();
  const k = cw / W;
  const aiming = ed.lensAim && !ed.playing && lens.key === ed.sel?.key;
  const T = rec - lens.t;
  const st = aiming ? { open: 1, scale: 1, alpha: 1, swell: 1 } : lensOpenState(T, lens.dur, ed.deck?.lensTiming);
  if (st.alpha <= 0.001) {
    lensMarks.delete(cv);
    return null;
  }
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
  // Source: the frame around the target at full zoom, over the glass's whole reach. The render
  // crops a whole number of source pixels and scales that to the glass, so its magnification is
  // `zoomExact`, not the requested zoom — the stage uses the same number or it drifts ~1%.
  const zoom = lens.zoomExact || lens.zoom;
  const reach = (1 + GLASS.bulge + GLASS.bevel) / st.swell;
  const crop = (2 * R * reach + 8) / zoom;
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
  if (!v) {
    // The live picture sits under this canvas: open the disc the shadow just filled and put it there.
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.globalAlpha = 1;
    g.beginPath();
    g.arc(mx, my, Rk, 0, Math.PI * 2);
    g.fill();
    g.restore();
    const kc = cssW / W;
    place({
      left: (box ? box.left - (host?.left ?? 0) : 0) + cx * kc,
      top: (box ? box.top - (host?.top ?? 0) : 0) + cy * kc,
      r: R * kc,
      cx,
      cy,
      scale: kc * zoom * st.swell,
      alpha: st.alpha,
    });
  }
  // Glass: concentric bands, each drawing the magnified frame at that radius' sampling factor
  // (outer bands squeeze toward the bevel, the centre stays flat) — the canvas take on geq's
  // per-pixel refraction.
  g.save();
  g.beginPath();
  g.arc(mx, my, Rk, 0, Math.PI * 2);
  g.clip();
  try {
    const src = v ? loupeSourceCanvas(v, cx, cy, crop, W, H) : null;
    const full = (src?.width ?? 0) * zoom * k; // on-screen size of the source at full magnification
    // One band per ~2 device px of radius: a fixed count left visible rings on a big loupe and
    // wasted draws on a small one. geq is per-pixel, so more bands is strictly closer to it.
    const bands = src ? Math.round(clamp(Rk / 2, 14, 48)) : 0;
    // Bands run outside in, so each clip circle sits inside the last and `clip` already intersects
    // with what is in force. Letting them accumulate under one save/restore draws the same glass as
    // saving and restoring around all ~48 of them, without the state churn on every frame. The
    // restore is unconditional: an undecodable frame mid-loop must not leave the clip narrowed for
    // the shade and light passes below.
    g.save();
    try {
      for (let i = bands - 1; i >= 0; i--) {
        const d1 = (i + 1) / bands;
        const dm = (i + 0.5) / bands;
        const gF = glassProfile(dm) / st.swell;
        if (i < bands - 1) {
          g.beginPath();
          g.arc(mx, my, Rk * d1, 0, Math.PI * 2);
          g.clip();
        }
        const size = full / gF;
        if (src) g.drawImage(src, mx - size / 2, my - size / 2, size, size);
      }
    } finally {
      g.restore();
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

/**
 * The plate's rendered mp4, held off-DOM and seeked alongside the iframe.
 *
 * The stage shows a plate as a live page, which a canvas cannot sample. The loupe needs real
 * pixels, so it reads the same frame out of the plate's render — the picture the cut will use.
 */
function plateLoupeSource(c: Clip, at: number): HTMLVideoElement | null {
  const url = (ed.deck?.plates || []).find((p) => p.id === (c.repeatOf || c.plateId))?.mp4Url;
  if (!url) return null;
  let v = ed.plateLoupe;
  if (!v) {
    v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    // A video has to be in the document for Chromium to decode frames a canvas can read, so it
    // sits in the plate pane at one pixel: present to the decoder, invisible on stage.
    v.className = 'plate-loupe-src';
    // The first frame and every seek land after this call — repaint so the glass catches up.
    const again = () => renderFrame();
    v.addEventListener('loadeddata', again);
    v.addEventListener('seeked', again);
    ($('fhdFit') || document.body).appendChild(v);
    ed.plateLoupe = v;
  }
  if (v.getAttribute('src') !== url) {
    v.setAttribute('src', url);
    v.load();
  }
  if (v.readyState < 1) return v;
  const clip = c.repeatOf || c.plateId || c.id;
  const sel = selectedLens();
  const needed = Boolean(lensAt(at, clip) || (sel && sel.clip === clip));
  const lag = at - (v.currentTime || 0);
  const drift = Math.abs(lag);
  if (!needed) {
    if (!v.paused) v.pause();
    return v;
  }
  if (ed.playing) {
    // Seeking every frame starves the decoder and the glass stutters, so the source plays with
    // the preview at the plate's own speed and pauses through holds. Small drift is steered
    // out with the playback rate, like a clock locking on; only a big jump seeks.
    const pb = clipPlayback(c);
    const u = ed.t - c.at;
    const holding = u > pb.head && u < pb.head + pb.hold;
    if (holding) {
      if (!v.paused) v.pause();
      if (drift > 1 / 60 && !v.seeking) v.currentTime = at;
      return v;
    }
    if (drift > 0.6 && !v.seeking) v.currentTime = at;
    const steer = drift > 0.6 ? 1 : 1 + clamp(lag * 0.8, -0.3, 0.3);
    const rate = clamp(pb.rate * steer, 0.25, 4);
    if (Math.abs(v.playbackRate - rate) > 0.01) v.playbackRate = rate;
    if (v.paused) void v.play().catch(() => undefined);
    return v;
  }
  if (Math.abs(v.playbackRate - 1) > 0.001) v.playbackRate = 1;
  if (!v.paused) v.pause();
  if (drift > 1 / 60) v.currentTime = at;
  return v;
}

/** The continuous-background state of the slide drawn this frame (null outside a run). */
let carryNow: CarryFrame | null = null;

export function drawPlate(c: Clip): boolean {
  const ready = plateReady(c.plateId);
  carryNow = syncCarry(c, plateHolds(c.plateId));
  if (!ready) {
    // Nothing paints this frame — neither the glass nor the mirror under it may keep showing
    // the slide they last drew over the one being held.
    clearPlateLens();
    void requestPlate(c.plateId);
    return false;
  }
  const at = plateClockMs(c, ed.t) / 1000;
  if (!ed.textMode) P.seek(Math.round(at * 1000), carryNow?.bgMs);
  paintPlateFx(c, at);
  return true;
}

function clearPlateZoom(): void {
  if (ed.plateLoupe && !ed.plateLoupe.paused) ed.plateLoupe.pause();
  clearPlateLens();
  const layer = $('plateFrame');
  if (!layer || !layer.style.transform) return;
  layer.style.transform = '';
  layer.style.transformOrigin = '';
}

/** Camera move and magnifier on a plate — the stage twin of the plate's chain in `produce`. */
function paintPlateFx(c: Clip, at: number): void {
  // The zoom rides the iframe: #fhdCanvas carries the stage fit and #fhdFit carries transitions,
  // so pushing in here composes with both instead of fighting them.
  const layer = $('plateFrame');
  const clip = c.repeatOf || c.plateId || c.id;
  const frame = ed.deck?.plateFrame || { width: liveW(), height: liveH() };
  const shot = !ed.playing && ed.sel?.type === 'zoom' ? selectedShot() : null;
  const live = (ed.deck?.plateZooms || []).find((z) => z.clip === clip && at >= z.t && at <= z.t + z.dur);
  const aimed = shot?.clip === clip ? shot : null;
  if (layer) {
    const zoom = aimed ? ed.aimZoom || aimed.zoom : ed.fx && live ? live.zoom : 1;
    if (zoom > 1.001) {
      const p = (aimed && ed.aim) || aimed?.points?.[0] || { cx: (live?.nx ?? 0.5) * frame.width, cy: (live?.ny ?? 0.5) * frame.height };
      const style = zoomPreviewStyle(p.cx, p.cy, { zoom, width: frame.width, height: frame.height });
      layer.style.transformOrigin = style.transformOrigin;
      layer.style.transform = style.transform;
    } else {
      layer.style.transform = '';
      layer.style.transformOrigin = '';
    }
  }
  // The glass shows the live slide — the copy and look on stage right now, saved or not. The
  // rendered mp4 only stands in while the live mirror loads.
  const sel = selectedLens();
  const needed = Boolean(lensAt(at, clip) || (sel && sel.clip === clip));
  const mirrored = needed && plateGlassReady($<HTMLIFrameElement>('plateFrame'));
  if (mirrored) {
    if (ed.plateLoupe && !ed.plateLoupe.paused) ed.plateLoupe.pause();
    syncPlateGlass($<HTMLIFrameElement>('plateFrame'), Math.round(at * 1000), carryNow?.bgMs);
  } else {
    // The mirror is a sibling of the canvas, so clearing the canvas alone leaves the last glass
    // on stage — the previous slide's pixels under a dead loupe. Tuck it away whenever this
    // frame is not drawing through it (no lens here, or the mirror is still loading the slide).
    placePlateGlass(null);
  }
  const lens = drawLens(at, {
    ...(mirrored ? { glass: placePlateGlass } : { el: plateLoupeSource(c, at), glass: null }),
    width: frame.width,
    height: frame.height,
    clip,
    canvas: 'plateLens',
    over: 'fhdCanvas',
  });
  ed.hud = { rate: clipPlayback(c).rate, zoom: aimed ? ed.aimZoom || aimed.zoom : live?.zoom || 1, lens };
}

onCarryBackdropReady(() => renderFrame());
onPlateGlassChange(() => renderFrame());

export function renderFrame(): void {
  if (!ed.active || !ed.seq.length) return;
  const i = clipIndexAt(ed.t);
  const c = ed.seq[i]!;
  const prev = ed.seq[i - 1];
  const indexChanged = ed.cur !== i;
  const leftClip = indexChanged ? ed.seq[ed.cur] : null;
  ed.cur = i;
  if (indexChanged) {
    ed.liveSeeked = false;
    paintFrame();
    // Scrub/play leave a plate without select() — bake live Content edits so the next visit
    // (and Produce) see rebuilt HTML, not only in-memory paint.
    if (leftClip?.kind === 'plate' && leftClip.plateId && leftClip.plateId !== c.plateId) {
      void settlePlateContent(leftClip.plateId);
    }
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
  // A continuous join hands the copy to the incoming slide at once: the outgoing copy has already
  // cleared, and the shared backdrop covers the frame while the next slide loads.
  const carryJoin = trans && isCarryJoin(prev, c);
  const soloFocus = trans ? (carryJoin ? c : soloJoinFocus(prev, c, joinP)) : null;
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
  carryNow = null;
  if (!stagePlate) syncCarry(null, false);
  // While the next slide arms off-stage, keep the slide already in the frame: a held frame reads
  // as part of the cut, a black one as a glitch. A transparent card never stands in for a slide.
  const held = P.ready();
  const holdSlide = Boolean(
    stagePlate && !plateContentReady && held && !held.startsWith('overlay:') && !ed.missing.has(stagePlate.plateId || ''),
  );
  const plateWasHidden = plateL.hidden;
  plateL.hidden = !(showCardLayer || plateContentReady || holdSlide);
  if (plateWasHidden && !plateL.hidden) {
    P.fit();
    refitPlateCompositionDeferred($<HTMLIFrameElement>('plateFrame'));
  }
  // No slide to hold (the frame had a card up): the take's last frame stands in instead of black.
  const v0 = video();
  const holdTake = Boolean(
    stagePlate && !plateContentReady && !holdSlide && !ed.missing.has(stagePlate.plateId || '') && v0 && v0.readyState >= 2,
  );
  liveL.hidden = !(inL === liveL || outL === liveL || liveFocus || holdTake);
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
  // The iframe is shared with live cards, so a plate's zoom must not outlive the plate.
  if (!stagePlate && !(trans && !soloFocus && prev?.kind === 'plate')) clearPlateZoom();
  if (stagePlate) {
    ready = drawPlate(stagePlate) && plateContentReady;
    // Inside a run the shared backdrop holds the frame: the stage shows while the slide's copy
    // loads over it, and the opening beat (no copy yet) never stalls playback.
    const contentFrame = $('plateFrame');
    const carry = carryNow as CarryFrame | null;
    if (carry?.backdropUp) {
      if (plateL.hidden) {
        plateL.hidden = false;
        P.fit();
        refitPlateCompositionDeferred(contentFrame as HTMLIFrameElement | null);
      }
      if (contentFrame) contentFrame.style.visibility = plateContentReady ? '' : 'hidden';
      if (!ready && carry.contentMs < 350) ready = true;
    } else if (contentFrame?.style.visibility) {
      contentFrame.style.visibility = '';
    }
  } else if (liveFocus) {
    drawLive(liveFocus, { outgoing: liveFocus === prev });
    if (showLiveCard && liveFocus === c) syncLiveCardComposite(liveHit);
  } else {
    drawLive(c);
    if (showLiveCard) syncLiveCardComposite(liveHit);
  }
  if (trans && soloFocus) {
    // Solo surface: dip the one layer (paintTransition handles inL === outL). A continuous join
    // never dips — the backdrop runs straight through.
    if (!carryJoin) paintTransition(joinStyle(c), joinP, layer(soloFocus.kind), layer(soloFocus.kind));
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

  // Get the next surface ready so the cut never waits.
  preloadNextSurface(c, i);
  const n = ed.seq[i + 1];
  if (n && !ed.textMode) {
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

/** The chips as last written, so an unchanged HUD costs nothing to confirm. */
let hudShown: { el: HTMLElement; html: string } | null = null;

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
  // Comparing against `hud.innerHTML` would serialize the chips back out of the DOM every frame
  // just to find they match; remembering what was written answers the same question for free.
  if (hudShown?.el !== hud || hudShown.html !== html) {
    hud.innerHTML = html;
    hudShown = { el: hud, html };
  }
}

let lastPreloadAt = 0;

function preloadNextSurface(c: Clip, i: number): void {
  if (ed.textMode || ed.loadingPlate) return;
  const now = performance.now();
  if (now - lastPreloadAt < 160) return;
  lastPreloadAt = now;
  const carried = carriedChapterKeys();
  const id = nextStageSurface({
    cur: c,
    next: ed.seq[i + 1],
    recNow: c.kind === 'live' ? edToRec(c, ed.t) : 0,
    marks: ed.deck?.marks,
    holding: P.ready(),
    cardFor: (m) => (m.kind === 'chapter' && carried.has(m.key || cardMarkKey(m)) ? null : resolveLiveCard(m)?.id || null),
  });
  if (!id || ed.missing.has(id)) return;
  const stale = ed.stalePlates.has(id);
  // Preload may bypass the back cache (`fresh`) but it only refetches the last baked HTML — it
  // does not rebuild from config, so never clear `stalePlates` here (bake on leave / structural save).
  P.preload(id, { fresh: stale });
}

/** What the stage is waiting on: the slide or card it needs is still loading. */
function stageWaitingOn(): 'slide' | 'card' | null {
  if (!ed.loadingPlate) return null;
  // Rebuilding the plate already showing (Look, Use video look, Background) swaps in off-stage.
  if (stageReloadIsQuiet(desk.get().activePlateId, P.ready(), ed.loadingPlate)) return null;
  const c = curClip();
  if (c?.kind === 'plate' && c.plateId === ed.loadingPlate) return 'slide';
  const previewId = ed.liveCardId || ed.compositeCardId || liveCardAtPlayhead()?.id;
  return previewId && ed.loadingPlate === previewId ? 'card' : null;
}

/* Quick loads (most of them, with the next surface preloaded) never show a loader; a slow one
   gets the mark in the stage corner, and the studio mark in the header follows. */
const LOADER_DELAY_MS = 240;
const LOADER_SCRUB_DELAY_MS = 700;
const LOADER_LABEL_MS = 1100;
const LOADER_MIN_MS = 420;
const LOADER_OUT_MS = 200;
const loader = {
  showTimer: 0 as ReturnType<typeof setTimeout> | 0,
  labelTimer: 0 as ReturnType<typeof setTimeout> | 0,
  hideTimer: 0 as ReturnType<typeof setTimeout> | 0,
  waitSince: 0,
  shownAt: 0,
  ownsMark: false,
};

function markBusy(on: boolean): void {
  if (on) {
    if (getMarkMode() !== 'idle') return;
    setMarkMode('loading');
    loader.ownsMark = true;
    return;
  }
  if (!loader.ownsMark) return;
  loader.ownsMark = false;
  if (getMarkMode() === 'loading') setMarkMode('idle');
}

function showLoader(el: HTMLElement): void {
  loader.showTimer = 0;
  const kind = stageWaitingOn();
  if (!kind) return;
  el.dataset['kind'] = kind;
  el.classList.remove('is-out');
  if (el.hidden) {
    el.hidden = false;
    void el.offsetWidth;
  }
  el.classList.add('is-on');
  loader.shownAt = performance.now();
  loader.labelTimer = setTimeout(() => el.classList.add('is-long'), Math.max(0, LOADER_LABEL_MS - (performance.now() - loader.waitSince)));
  markBusy(true);
}

function hideLoader(el: HTMLElement): void {
  loader.hideTimer = 0;
  if (stageWaitingOn()) return;
  clearTimeout(loader.labelTimer);
  el.classList.remove('is-on', 'is-long');
  el.classList.add('is-out');
  markBusy(false);
  setTimeout(() => {
    if (el.classList.contains('is-on')) return;
    el.hidden = true;
    el.classList.remove('is-out');
  }, LOADER_OUT_MS);
}

export function paintLoading(): void {
  const el = $('edLoading');
  if (!el) return;
  if (stageWaitingOn()) {
    if (loader.hideTimer) clearTimeout(loader.hideTimer);
    loader.hideTimer = 0;
    // Mid-scrub the held frame already says "on its way"; only a real wait earns the mark.
    const delay = ed.drag?.type === 'scrub' || desk.get().scrubbing ? LOADER_SCRUB_DELAY_MS : LOADER_DELAY_MS;
    if (!el.classList.contains('is-on') && !loader.showTimer) {
      loader.waitSince = performance.now();
      loader.showTimer = setTimeout(() => showLoader(el), delay);
    }
    return;
  }
  if (loader.showTimer) clearTimeout(loader.showTimer);
  loader.showTimer = 0;
  if (!el.classList.contains('is-on') || loader.hideTimer) return;
  loader.hideTimer = setTimeout(() => hideLoader(el), Math.max(0, LOADER_MIN_MS - (performance.now() - loader.shownAt)));
}

export const resolveLiveCard = (mark: DeckMark | null | undefined): PlateRow | null =>
  resolveLiveCardFromPlates(mark, htmlPlates(), ed.deck?.marks || []);

export interface LiveHit {
  mark: DeckMark;
  card: PlateRow;
  recT: number;
}

/** Chapters a section layout carries on its own text — they never composite a card. */
const carriedChapterKeys = (): Set<string> => new Set((ed.deck?.layouts?.sections || []).filter((s) => s.textOn).map((s) => s.key));

/** Active chapter/caption under the playhead: mark + card + recording clock. */
export function liveHitAtPlayhead(): LiveHit | null {
  const c = curClip();
  if (c?.kind !== 'live') return null;
  const recT = edToRec(c, ed.t);
  const carried = carriedChapterKeys();
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

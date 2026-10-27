import type { HtmlPlate, Job, Motion, Scene } from '@/api/types';
import { api } from '@/desk/api';
import { drainQueue, watchJob } from '@/desk/jobs';
import { playPlatePreview, setMonitorLabel, setMonitorMode } from '@/desk/monitor';
import { showLeftTab, showRightTab } from '@/desk/panels';
import { clearRunStatus, desk, setButtonBusy, setStatus } from '@/desk/store';
import { toast } from '@/desk/toast';
import { runtime } from '@/desk/runtime';
import { loadVideo } from '@/desk/video';
import { paintMotionLiveOptimistic } from '@/features/direction/actions';
import { renderHtmlPlatePicker } from '@/features/feedback/proposal';
import { hideProposal, resetThinkSteps, setApprovePlateVisible, setThinkStep } from '@/features/feedback/session';
import {
  accentState,
  fieldSource,
  fromElement,
  parseSource,
  positionAt,
  toHtml,
  toggleAccent,
  type AccentState,
  type CopyChar,
  type DomMark,
} from '@/logic/copyEdit';
import { cardOnStage, stageLayout } from '@/logic/stageLayout';
import { layoutsAreCustom, sectionAtPlayhead } from './layoutPreview';

import { chrome, EMPTY_ACCENT } from './chrome';
import { paintStatus } from './edits';
import { openPlate, reloadPlate, selectLive } from './lifecycle';
import { invalidatePlates } from './look';
import {
  PLATE_EDIT_CSS,
  PLATE_PEEK_CSS,
  clearPlateRevealOverrides,
  composePlateForEdit,
  pinLiveAnimationFrames,
  plateEditPeakSec,
} from './plateCss';
import { contentFieldFocused } from './plateContentSave';
import { ed } from './state';
import { paintTextMode } from './text';
import type { FieldDetail, PlateField } from './types';
import { errMessage } from './util';

/**
 * The plate HTML preview from `kit/studio/app.js`: the `#plateFrame` iframe, inline copy
 * editing inside it, the plate accent popover and the scene-bar actions. The iframe DOM is
 * driven imperatively, as it was; the chrome around it renders from the desk store.
 */

const FRONT_ID = 'plateFrame';
const BACK_ID = 'plateFrameBack';
const frameEl = (): HTMLIFrameElement | null => document.getElementById(FRONT_ID) as HTMLIFrameElement | null;
const backEl = (): HTMLIFrameElement | null => document.getElementById(BACK_ID) as HTMLIFrameElement | null;

/** `state.plateFrameReady` — the plate id whose copy is armed in the iframe. */
let plateFrameReady: string | null = null;
let plateLoadToken = 0;
/**
 * The off-stage twin of `#plateFrame`. Documents load and arm there while the stage keeps
 * showing the current one, then the two trade ids — so a cut, a scrub across slides or a
 * caption change never blanks the frame. Everything else keeps addressing `#plateFrame`.
 */
interface BackLoad {
  id: string;
  token: number;
  done: Promise<PlateLoad>;
  /** The stage is waiting on it — a preload must not cancel it. */
  shown: boolean;
}
let backToken = 0;
let backLoad: BackLoad | null = null;
/** Plate armed in the back frame, ready to swap on stage (cross-plate scrub only). */
let backReady: string | null = null;
/** `src` of `#plateFrameBack` when `backReady` was set — must match or the cache is stale HTML. */
let backArmedSrc: string | null = null;
/** `state.plateEditBound`. */
let plateEditBound = false;
let plateReplayTimer: ReturnType<typeof setTimeout> | null = null;
let fhdObs: ResizeObserver | null = null;

export const frameReady = (): string | null => plateFrameReady || null;
export const editBound = (): boolean => plateEditBound;

/** `editor.markDirty()`. */
function markRenderDirty(): void {
  ed.dirtyRender = true;
  paintStatus();
}

/** Dirty flag, Save/Discard and the hint render from `plateDirty`; the editor repaints its text tip. */
export function updatePlateEditChrome(): void {
  paintTextMode();
  if (!chrome.get().editChromePainted) chrome.set({ editChromePainted: true });
}

function setPlateDirty(on: boolean): void {
  if (desk.get().plateDirty !== on) desk.set({ plateDirty: on });
}

/* ———————————————————————————————————————————— stage fit */

export function fitFhdPreview(attempt = 0): void {
  const fit = document.getElementById('fhdFit');
  const canvas = document.getElementById('fhdCanvas');
  if (!fit || !canvas) return;
  if ((document.getElementById('playerPlate'))?.hidden) return;
  const pad = document.body.classList.contains('is-editor') ? 0 : 8;
  const rw = fit.clientWidth - pad * 2;
  const rh = fit.clientHeight - pad * 2;
  // Layout not ready yet (plate pane still 0×0) — retry a few frames
  if ((rw < 32 || rh < 32) && attempt < 30) {
    requestAnimationFrame(() => fitFhdPreview(attempt + 1));
    return;
  }
  // Always show the whole output frame of this video — never crop.
  const out = desk.get().video?.output;
  if (out?.width && out?.height) {
    const was = canvas.style.getPropertyValue('--wt-frame-w');
    canvas.style.setProperty('--wt-frame-w', `${out.width}px`);
    canvas.style.setProperty('--wt-frame-h', `${out.height}px`);
    // The plates in the frames just changed size. Anything they fitted to the old one is wrong.
    if (was !== `${out.width}px`) {
      refitPlateComposition(frameEl());
      refitPlateComposition(backEl());
    }
  }
  const fw = canvas.offsetWidth || 1;
  const fh = canvas.offsetHeight || 1;
  const scale = Math.min(Math.max(rw, 1) / fw, Math.max(rh, 1) / fh);
  fitBackdrop();
  // Cards baked onto an inset take shrink with its window, as in the render.
  // A section layout composites cards on the whole output instead, matching prepareLive.
  const section = sectionAtPlayhead();
  const space = ed.deck?.space;
  const framed = section?.stage && space?.output ? { output: space.output, stage: section.stage } : space;
  const layout = stageLayout(framed);
  const st = framed?.stage;
  const outFrame = framed?.output;
  if (document.body.classList.contains('is-live-card') && layout?.placed && layout.cardsOnStage && !layoutsAreCustom() && st && outFrame) {
    const c = cardOnStage(outFrame, st, scale);
    canvas.style.transform = `translate(${c.dx}px, ${c.dy}px) scale(${c.scale})`;
    canvas.style.borderRadius = `${c.radius}px`;
  } else {
    canvas.style.transform = `scale(${scale})`;
    canvas.style.borderRadius = '';
  }
  const badge = fit.querySelector('.fhd-badge');
  if (badge) badge.textContent = `${fw}×${fh} · ${Math.round(scale * 100)}%`;
}

/** Scale the shared backdrop HTML (output px) down into the output-shaped frame. */
function fitBackdrop(): void {
  const frame = document.getElementById('liveFrame');
  const iframe = document.getElementById('liveBackdrop') as HTMLIFrameElement | null;
  if (!frame || !iframe || iframe.hidden) return;
  const out = ed.deck?.space?.output;
  if (!out?.width || !out.height) return;
  iframe.style.width = `${out.width}px`;
  iframe.style.height = `${out.height}px`;
  iframe.style.transformOrigin = 'top left';
  iframe.style.transform = `scale(${frame.clientWidth / out.width})`;
}

const onWindowResize = () => fitFhdPreview();

export function ensureFhdFitObserver(): void {
  if (fhdObs || typeof ResizeObserver === 'undefined') return;
  const fit = document.getElementById('fhdFit');
  const stage = document.getElementById('stage');
  if (!fit) return;
  fhdObs = new ResizeObserver(() => fitFhdPreview());
  fhdObs.observe(fit);
  if (stage) fhdObs.observe(stage);
  window.addEventListener('resize', onWindowResize);
}

/** Unmount: the legacy observer lived for the page; this one goes with the pane. */
export function disposeFhdFitObserver(): void {
  fhdObs?.disconnect();
  fhdObs = null;
  window.removeEventListener('resize', onWindowResize);
}

/* ———————————————————————————————————————————— loading */

const findPlate = (id: string | null | undefined): HtmlPlate | undefined => (desk.get().htmlPlates || []).find((p) => p.id === id);

export function showPlateHtml(plate: HtmlPlate | string | null | undefined): void {
  const row = typeof plate === 'string' ? findPlate(plate) : plate;
  if (!row) return;
  setMonitorMode('plate');
  void openPlate(row.id);
}

export type PlateLoad = true | false | 'cancelled';

/**
 * Load a plate into the editor stage.
 * Resolves `true` when armed, `false` on hard failure, `'cancelled'` when a newer load stole the iframe
 * (callers must not treat cancel as “plate missing”).
 */
export function loadPlateFrame(plateId: string, { force = false, motionAt }: { force?: boolean; motionAt?: number } = {}): Promise<PlateLoad> {
  const plate = findPlate(plateId);
  if (!plate?.htmlUrl) return Promise.resolve(false);
  if (!force && desk.get().activePlateId === plateId && plateFrameReady === plateId) return Promise.resolve(true);
  if (frameEl() && backEl()) return loadViaBack(plate, force, motionAt);
  // Bust cache so Direction look / copy rebuilds show up when compositing over the take.
  desk.set({ activePlateId: plateId, previewingPlate: `${plate.htmlUrl.split('?')[0]}?t=${Date.now()}`, plateDirty: false });
  plateEditBound = false;
  plateFrameReady = null;
  updatePlateEditChrome();
  const frame = frameEl();
  if (!frame) return Promise.resolve(false);
  const token = (plateLoadToken += 1);
  return new Promise((resolve) => {
    frame.onload = () => {
      if (token !== plateLoadToken) return resolve('cancelled');
      fitFhdPreview();
      refitPlateComposition(frame);
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          enablePlateInlineEdit(frame, {
            onReady: () => {
              if (token !== plateLoadToken) return resolve('cancelled');
              plateFrameReady = plateId;
              if (String(plateId).startsWith('overlay:')) plateSetLiveComposite(true);
              resolve(true);
            },
          }),
        ),
      );
    };
    frame.onerror = () => {
      if (token !== plateLoadToken) return resolve('cancelled');
      resolve(false);
    };
    frame.src = `${plate.htmlUrl.split('?')[0]}?t=${Date.now()}`;
  });
}

const freshUrl = (plate: HtmlPlate): string => `${String(plate.htmlUrl).split('?')[0]}?t=${Date.now()}`;

/** Load and arm a document in the back frame. A newer back load cancels this one. */
function startBackLoad(plate: HtmlPlate, shown: boolean): BackLoad {
  const frame = backEl() as HTMLIFrameElement;
  const token = (backToken += 1);
  backReady = null;
  backArmedSrc = null;
  const armed = new Promise<PlateLoad>((resolve) => {
    frame.onload = () => {
      if (token !== backToken) return resolve('cancelled');
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          enablePlateInlineEdit(frame, {
            bind: false,
            onReady: () => resolve(token === backToken ? true : 'cancelled'),
          }),
        ),
      );
    };
    frame.onerror = () => resolve(token === backToken ? false : 'cancelled');
    frame.src = freshUrl(plate);
  });
  const load: BackLoad = {
    id: plate.id,
    token,
    shown,
    done: armed.then((r) => {
      if (token === backToken) {
        backLoad = null;
        if (r === true) {
          backReady = plate.id;
          backArmedSrc = frame.src || null;
        }
      }
      return r;
    }),
  };
  backLoad = load;
  return load;
}

function backCacheHit(plate: HtmlPlate): boolean {
  if (backReady !== plate.id || !backArmedSrc) return false;
  const back = backEl();
  return Boolean(back?.src && back.src === backArmedSrc);
}

async function loadViaBack(plate: HtmlPlate, force: boolean, motionAt?: number): Promise<PlateLoad> {
  const token = (plateLoadToken += 1);
  let pending: Promise<PlateLoad>;
  if (!force && backCacheHit(plate)) pending = Promise.resolve(true);
  else if (!force && backLoad?.id === plate.id) {
    backLoad.shown = true;
    pending = backLoad.done;
  } else pending = startBackLoad(plate, true).done;
  const r = await pending;
  if (token !== plateLoadToken) return 'cancelled';
  if (r !== true) return r;
  if (backReady !== plate.id) return 'cancelled';
  // Park the hidden frame on the playhead before it becomes the one on screen, so a look or
  // background rebuild doesn't flash the edit still or the opening.
  if (motionAt != null) presentPlateMotion(backEl(), motionAt);
  swapPlateFrames(plate.id);
  return true;
}

/** Inline state that belongs to the stage slot (camera push, carry mask), not to a document. */
const SLOT_STYLES = ['transform', 'transformOrigin', 'visibility'] as const;

function swapPlateFrames(plateId: string): void {
  const front = frameEl();
  const back = backEl();
  if (!front || !back) return;
  const leaving = plateFrameReady;
  const keepLeaving = Boolean(leaving && !desk.get().plateDirty);
  front.onload = null;
  front.onerror = null;
  front.id = BACK_ID;
  back.id = FRONT_ID;
  for (const k of SLOT_STYLES) {
    back.style[k] = front.style[k];
    front.style[k] = '';
  }
  back.removeAttribute('aria-hidden');
  back.removeAttribute('tabindex');
  back.title = 'Plate HTML preview';
  front.setAttribute('aria-hidden', 'true');
  front.tabIndex = -1;
  front.title = '';
  runtime.plateFrame = back;
  // Only cross-plate cuts cache the outgoing doc for a fast scrub back. A same-plate reload (look,
  // background, layout) swaps new HTML on — the frame that just left is an old build and must not
  // sit in `backReady` or the next load will swap it back onto stage.
  const cached = front;
  if (keepLeaving && leaving && leaving !== plateId) {
    backReady = leaving;
    backArmedSrc = cached.src || null;
  } else {
    backReady = null;
    backArmedSrc = null;
  }
  backToken += 1;
  backLoad = null;
  desk.set({ activePlateId: plateId, previewingPlate: back.src, plateDirty: false });
  plateFrameReady = plateId;
  plateEditBound = true;
  updatePlateEditChrome();
  // Refit synchronously here still races image decode; a deferred pass once the slot is sized is
  // what realigns with the encoder after a swap from the back buffer or a hidden `#fhdFit`.
  fitFhdPreview();
  refitPlateCompositionDeferred(back);
  if (String(plateId).startsWith('overlay:')) plateSetLiveComposite(true);
}

/**
 * Warm the next document the stage will need in the back frame. Never touches what is on stage
 * and never cancels a load the stage is waiting on.
 */
export function preloadPlateFrame(plateId: string | null | undefined, { fresh = false }: { fresh?: boolean } = {}): boolean {
  if (!plateId || !frameEl() || !backEl() || backLoad?.shown) return false;
  if (plateFrameReady === plateId && desk.get().activePlateId === plateId) return false;
  const plate = findPlate(plateId);
  if (!plate?.htmlUrl) return false;
  if (backLoad?.id === plateId || (backCacheHit(plate) && !fresh)) return false;
  startBackLoad(plate, false);
  return true;
}

/** The back frame holds a stale build (look, copy or rebuild changed underneath it). */
export function dropPreloadedPlates(id?: string): void {
  if (id && backReady !== id && backLoad?.id !== id) return;
  backReady = null;
  backArmedSrc = null;
  if (backLoad && !backLoad.shown) {
    backToken += 1;
    backLoad = null;
  }
}

interface FitWindow extends Window {
  __fitType?: () => Promise<void> | void;
}

/**
 * Re-run the plate's own type and composition fit against the frame it is sitting in now.
 *
 * A plate fits itself once, from its page script, as soon as its fonts resolve. In the render
 * that is exactly right: Playwright opens the page at the delivery size, so `innerWidth` is the
 * output frame. In the editor the document often beats the stage to it — the back frame loads
 * off-stage, and `--wt-frame-w` is only written when `fitFhdPreview` runs — so the plate can
 * settle against the wrong viewport and bake a shrink (`planFrameFit` floors at 0.6) into
 * `.compose`. That is the slide that looks zoomed out for no reason. Copy edits have the same
 * gap the other way: the encoder refits after every change, the stage used to keep the old fit.
 *
 * `__fitType` clears `font-size` and `.compose`'s `scale` / `translate` before measuring, so
 * calling it again is safe and lands on the same numbers the encoder will.
 */
export function refitPlateComposition(frame: HTMLIFrameElement | null = frameEl()): void {
  try {
    void (frame?.contentWindow as FitWindow | null)?.__fitType?.();
  } catch {
    /* same-origin plates only */
  }
}

/** True when the iframe has the delivery frame size (not collapsed inside a hidden `#fhdFit`). */
function plateFrameSized(frame: HTMLIFrameElement | null): boolean {
  if (!frame) return false;
  try {
    return frame.clientWidth >= 32 && frame.clientHeight >= 32;
  } catch {
    return false;
  }
}

/**
 * Refit once the stage slot is measurable. While the take is on screen `#fhdFit` is `hidden`, so
 * its iframes are 0×0: `__fitType` defers or the composition fit floors at 0.6. Swapping that
 * document back without a fresh measure is the slide that looks zoomed out after scrubbing.
 */
export function refitPlateCompositionDeferred(frame: HTMLIFrameElement | null = frameEl(), attempt = 0): void {
  if (!frame) return;
  requestAnimationFrame(() => {
    if (!plateFrameSized(frame)) {
      if (attempt < 45) refitPlateCompositionDeferred(frame, attempt + 1);
      return;
    }
    refitPlateComposition(frame);
    requestAnimationFrame(() => {
      if (plateFrameSized(frame)) refitPlateComposition(frame);
    });
  });
}

/** Refit once the author stops typing, so sizes never move under the caret mid-word. */
const refitTimers = new WeakMap<Document, ReturnType<typeof setTimeout>>();
export function refitSoon(doc: Document | null | undefined, delay = 500): void {
  if (!doc?.defaultView) return;
  clearTimeout(refitTimers.get(doc));
  refitTimers.set(
    doc,
    setTimeout(() => {
      try {
        void (doc.defaultView as FitWindow | null)?.__fitType?.();
      } catch {
        /* same-origin plates only */
      }
    }, delay),
  );
}

/**
 * Force every CSS animation on the plate to rebuild. Changing look tokens (depth, energy,
 * reveal, atmosphere) while animations sit mid-seek leaves a frozen half-reveal — calling this
 * then seeking makes the stage match what a real render will show.
 */
export function recreatePlateAnimations(doc: Document | null | undefined): void {
  if (!doc?.body) return;
  doc.getElementById('studio-anim-reset')?.remove();
  const reset = doc.createElement('style');
  reset.id = 'studio-anim-reset';
  reset.textContent = '*,*::before,*::after{animation:none!important}';
  doc.head.appendChild(reset);
  void doc.body.offsetHeight;
  reset.remove();
  void doc.body.offsetHeight;
}

/**
 * Color scheme shared by the plate iframe and every live-card document it embeds.
 * Chrome paints an opaque canvas (white or #121212) over the recording whenever the iframe's
 * used color-scheme differs from the embedded root's — and it records `light` for an iframe
 * that was display:none when the document was created, which is how cards load (the layer
 * stays hidden until the card is ready). `light` on both sides is the only pairing that is
 * transparent no matter when the card loaded; `dark` matched only on paper and blanked the take.
 */
const LIVE_COMPOSITE_SCHEME = 'light';

function frameDoc(frame: HTMLIFrameElement | null): Document | null {
  try {
    return frame?.contentDocument || null;
  } catch {
    return null;
  }
}

/**
 * Mark overlay HTML for transparent composite over the recording (Editor + bake).
 * The scheme is pinned on every overlay document, composited or not, so older card HTML built
 * with `color-scheme: dark` cannot reintroduce the opaque canvas.
 */
export function plateSetLiveComposite(on = true, frame: HTMLIFrameElement | null = frameEl()): boolean {
  const doc = frameDoc(frame);
  if (!doc?.body) return false;
  const overlay = String(doc.body.dataset['cardId'] || desk.get().activePlateId || '').startsWith('overlay:');
  if (frame) frame.style.colorScheme = LIVE_COMPOSITE_SCHEME;
  if (overlay) doc.documentElement.style.colorScheme = LIVE_COMPOSITE_SCHEME;
  if (on && overlay) {
    doc.body.dataset['composite'] = '1';
    doc.documentElement.style.background = 'transparent';
    doc.body.style.background = 'transparent';
    const stage = doc.querySelector<HTMLElement>('.preview-stage');
    if (stage) stage.style.background = 'transparent';
  } else {
    delete doc.body.dataset['composite'];
    doc.documentElement.style.background = '';
    doc.body.style.background = '';
  }
  return true;
}

/** Leave the composed edit frame so the plate's own animations can be stepped; copy (and unsaved edits) stay in the DOM. */
function enterPlateMotion(frame: HTMLIFrameElement | null): boolean {
  const doc = frameDoc(frame);
  if (!doc?.body) return false;
  plateSetLiveComposite(true, frame);
  if (doc.body.dataset['motion'] === '1') {
    ensurePlatePeekStyle(doc);
    bindPlateCanvasPick(doc);
    return true;
  }
  try {
    (doc.activeElement as HTMLElement | null)?.blur?.();
  } catch {
    /* ignore */
  }
  // Untouched copy gets the template's reveal markup back so titles rise and cascade again;
  // edited copy keeps its canonical markup until Save rebuilds the plate.
  restorePlateEdits(doc, snapshotPlateEdits(doc), { motion: true });
  doc.body.classList.remove('studio-edit');
  clearPlateRevealOverrides(doc);
  const editStyle = doc.getElementById('studio-edit-style') as HTMLStyleElement | null;
  if (editStyle) editStyle.disabled = true;
  doc.querySelectorAll<HTMLElement>('[data-edit]').forEach((el) => {
    clearLineLayout(el);
    el.removeAttribute('contenteditable');
    el.classList.remove('is-focused');
    if (el.dataset['edit']) el.title = `Click to edit “${el.dataset['edit']}”`;
  });
  // composePlateForEdit cancelled every animation; a one-frame `animation: none` re-creates them.
  recreatePlateAnimations(doc);
  doc.body.dataset['motion'] = '1';
  ensurePlatePeekStyle(doc);
  bindPlateCanvasPick(doc);
  return true;
}

export function plateMotionMode(): boolean {
  return enterPlateMotion(frameEl());
}

interface PlateRuntime {
  renderAt?: (ms: number) => void;
}

interface PlateCarry {
  seek: (contentMs: number, bgMs: number) => void;
  readonly state: { on: boolean };
}

/**
 * Step the plate to ms on its own clock (CSS animations + WebGL atmosphere + count-ups).
 * A slide in a continuous-background run also takes the run's clock for its backdrop.
 */
function seekPlate(frame: HTMLIFrameElement | null, ms: number, bgMs?: number | null): void {
  const doc = frameDoc(frame);
  if (!doc?.body || doc.body.dataset['motion'] !== '1') return;
  const t = Math.max(0, Number(ms) || 0);
  const carry = (frame?.contentWindow as (Window & { __plateCarry?: PlateCarry }) | null)?.__plateCarry;
  if (carry?.state.on) {
    try {
      carry.seek(t, bgMs ?? t);
    } catch {
      /* ignore */
    }
    return;
  }
  for (const a of doc.getAnimations?.() || []) {
    try {
      a.pause();
      a.currentTime = t;
    } catch {
      /* ignore */
    }
  }
  const win: (Window & { __plateRuntime?: PlateRuntime; __plateField?: PlateRuntime }) | null | undefined = frame?.contentWindow;
  const runtime = win?.__plateRuntime || win?.__plateField;
  try {
    runtime?.renderAt?.(t);
  } catch {
    /* ignore */
  }
}

export function plateSeek(ms: number, bgMs?: number | null): void {
  seekPlate(frameEl(), ms, bgMs);
}

/** Step any plate frame already in motion (the loupe's mirror) on the plate's clock. */
export const seekPlateFrame = (frame: HTMLIFrameElement | null, ms: number, bgMs?: number | null): void => seekPlate(frame, ms, bgMs);

/** Step a hidden frame into motion at `ms` before it is swapped on screen. */
export function presentPlateMotion(frame: HTMLIFrameElement | null, ms: number): void {
  if (!enterPlateMotion(frame)) return;
  seekPlate(frame, ms);
}

/**
 * Rebuild plate animations and land on `ms` (offset into the plate; 0 = open).
 * Used after Look / style / Direction changes so CSS tokens reflow without freezing mid-reveal.
 * Callers pass the current playhead offset so live edits keep your place.
 * No-ops while the composed text-edit frame is up — callers exit text mode first.
 */
export function plateRestart(ms = 0): boolean {
  const doc = plateFrameDoc();
  if (!doc?.body) return false;
  if (doc.body.classList.contains('studio-edit')) return false;
  // Drop a half-applied recreate style if a prior call was interrupted mid-flight.
  doc.getElementById('studio-anim-reset')?.remove();
  if (doc.body.dataset['motion'] !== '1') plateMotionMode();
  else recreatePlateAnimations(doc);
  plateSeek(ms);
  return true;
}

/** Back to the composed, editable frame (text editing). */
export function plateTextMode(opts: { onReady?: (() => void) | undefined } = {}): void {
  const frame = frameEl();
  const doc = frame?.contentDocument;
  if (!frame || !doc?.body) {
    opts.onReady?.();
    return;
  }
  const snapshot = snapshotPlateEdits(doc);
  delete doc.body.dataset['motion'];
  enablePlateInlineEdit(frame, { snapshot, onReady: opts.onReady ?? null });
}

export function plateFrameDoc(): Document | null {
  return frameDoc(frameEl());
}

/* ———————————————————————————————————————————— inline copy fields */

/** Markup each field had before Studio armed it, so Replay runs the template's own reveal on untouched copy. */
const plateOriginalMarkup = new WeakMap<Document, Map<string, string>>();

const fieldKind = (el: HTMLElement): string => el.dataset['editKind'] || 'text';
const fieldOpts = (el: HTMLElement) => ({ kind: fieldKind(el), beats: el.dataset['editBeats'] === '1' });
const fieldRaw = (el: HTMLElement): string => (el.getAttribute('data-edit-raw') ?? '').replace(/&#10;/g, '\n');
const blockNode = (n: Element): boolean =>
  n?.nodeType === 1 && (n.tagName === 'DIV' || n.tagName === 'P' || (n.ownerDocument.defaultView || window).getComputedStyle(n).display === 'block');

/** Title-reveal canvases sit inside the heading while it plays. Snapshots keep the type only. */
function fieldMarkup(el: HTMLElement): string {
  if (!el.querySelector('.title-mask, .title-glow')) return el.innerHTML;
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.title-mask, .title-glow').forEach((n) => n.remove());
  return clone.innerHTML;
}

/** Remember the template markup once, before the canonical edit markup replaces it. */
function learnField(el: HTMLElement): void {
  if (el.dataset['editArmed'] === '1') return;
  const doc = el.ownerDocument;
  let originals = plateOriginalMarkup.get(doc);
  if (!originals) {
    originals = new Map();
    plateOriginalMarkup.set(doc, originals);
  }
  const path = el.dataset['edit'] || '';
  if (!originals.has(path)) originals.set(path, fieldMarkup(el));
}

/**
 * Visual packing for multi-line titles. Templates tighten lines with `.mask.word` negative
 * margins — CSS `line-height` alone does not match what you see. Capture box geometry while the
 * reveal markup is still in the DOM (before `studio-edit` opens the masks), then replay it on
 * the plain edit rows.
 */
interface LineLayout {
  fieldH: number;
  fontSize: string;
  letterSpacing: string;
  rows: { height: number; gapAfter: number }[];
}

const lineLayouts = new WeakMap<HTMLElement, LineLayout>();

function titleLineNodes(el: HTMLElement): HTMLElement[] {
  const nested = [...el.querySelectorAll<HTMLElement>(':scope > .title-line, :scope > .line-exit.title-line, :scope > .line-wipe, :scope > .title-cascade')];
  if (nested.length) return nested;
  return [...el.querySelectorAll<HTMLElement>('.title-line, .line-exit.title-line')];
}

function captureLineLayout(el: HTMLElement): LineLayout | null {
  if (fieldKind(el) !== 'lines') return null;
  const view = el.ownerDocument.defaultView;
  if (!view) return null;
  const cs = view.getComputedStyle(el);
  // Use layout boxes (offset*), not getBoundingClientRect — the stage scales the iframe, so
  // client rects are outer CSS pixels and would shrink the title when written back as iframe px.
  const nodes = titleLineNodes(el);
  if (!nodes.length) {
    const layout = { fieldH: el.offsetHeight, fontSize: cs.fontSize, letterSpacing: cs.letterSpacing, rows: [] };
    lineLayouts.set(el, layout);
    return layout;
  }
  const rows = nodes.map((n, i) => {
    const next = nodes[i + 1];
    return {
      height: Math.max(1, Math.round(n.offsetHeight)),
      gapAfter: next ? Math.round(next.offsetTop - (n.offsetTop + n.offsetHeight)) : 0,
    };
  });
  const layout = {
    fieldH: Math.round(el.offsetHeight),
    fontSize: cs.fontSize,
    letterSpacing: cs.letterSpacing,
    rows,
  };
  lineLayouts.set(el, layout);
  return layout;
}

function applyLineLayout(el: HTMLElement): void {
  const layout = lineLayouts.get(el);
  if (!layout) return;
  // Do not write font-size: type-fit already pinned it on the field and clearing it on exit
  // would undo the fit. Packing is height + gap only.
  if (layout.fieldH > 0) el.style.minHeight = `${layout.fieldH}px`;
  const rows = el.querySelectorAll<HTMLElement>(':scope > .title-line, :scope > div');
  rows.forEach((row, i) => {
    const m = layout.rows[i] ?? layout.rows[layout.rows.length - 1];
    if (!m) return;
    row.style.display = 'block';
    row.style.boxSizing = 'border-box';
    row.style.height = `${m.height}px`;
    row.style.lineHeight = `${m.height}px`;
    row.style.margin = '0';
    row.style.padding = '0';
    if (i < rows.length - 1) row.style.marginBottom = `${m.gapAfter}px`;
  });
}

/** Drop packing pins so motion / a rebuild can own the field again. */
function clearLineLayout(el: HTMLElement): void {
  lineLayouts.delete(el);
  el.style.minHeight = '';
  el.querySelectorAll<HTMLElement>(':scope > .title-line, :scope > div').forEach((row) => {
    row.style.removeProperty('display');
    row.style.removeProperty('box-sizing');
    row.style.removeProperty('height');
    row.style.removeProperty('line-height');
    row.style.removeProperty('margin');
    row.style.removeProperty('padding');
    row.style.removeProperty('margin-bottom');
  });
}

/** Snapshot every lines-field's on-screen packing before edit CSS opens the reveal masks. */
function captureAllLineLayouts(doc: Document): void {
  doc.querySelectorAll<HTMLElement>('[data-edit][data-edit-kind="lines"]').forEach((el) => captureLineLayout(el));
}

/**
 * Canonical edit markup: the field's own CSS on plain nodes — one `.title-line` row per title line,
 * accents as the tag the template paints them with (`data-edit-accent`), beats keeping their `·`
 * colour. What the user sees is what the plate renders after Save, gradient included.
 */
function renderFieldChars(el: HTMLElement, chars: CopyChar[]): void {
  const lines = fieldKind(el) === 'lines';
  // Prefer a layout captured before studio-edit; fall back to measuring whatever is still in the DOM.
  if (lines && !lineLayouts.has(el)) captureLineLayout(el);
  el.innerHTML = toHtml(chars, {
    tag: el.dataset['editAccent'] === 'b' ? 'b' : 'span',
    lines,
    sep: el.dataset['editBeats'] === '1',
  });
  if (lines) applyLineLayout(el);
}
const renderField = (el: HTMLElement, source: string) => renderFieldChars(el, parseSource(source));

/** The config value this field holds right now (`*accent*` markers, lines joined with \n). */
function fieldSourceOf(el: HTMLElement): string {
  return fieldSource(fromElement(el, { isBlock: blockNode }).chars, fieldOpts(el));
}

interface PlateSel {
  el: HTMLElement;
  chars: CopyChar[];
  start: number;
  end: number;
}

/** Selection inside an editable field, as char offsets on that field. */
function plateSelection(): PlateSel | null {
  const doc = plateFrameDoc();
  if (!doc?.body?.classList.contains('studio-edit')) return null;
  const sel = doc.getSelection();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const el = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest?.<HTMLElement>('[data-edit]');
  if (!el) return null;
  const marks: DomMark[] = [
    [range.startContainer, range.startOffset],
    [range.endContainer, range.endOffset],
  ];
  const { chars, offsets } = fromElement(el, { isBlock: blockNode, marks });
  return { el, chars, start: Math.min(...offsets), end: Math.max(...offsets) };
}

/** 'on' | 'off' | 'mixed' for the selected words, null when no field is selected. */
export function currentAccentState(): AccentState | null {
  const s = plateSelection();
  return s ? accentState(s.chars, s.start, s.end) : null;
}

/** Active field + accent for the editor inspector and Accent button. */
export function plateSelectionDetail(): FieldDetail {
  const doc = plateFrameDoc();
  const focused = (doc?.activeElement)?.closest?.<HTMLElement>('[data-edit]') || null;
  const s = plateSelection();
  const el = focused || s?.el || null;
  if (!el) return { accent: null, path: null, kind: null, source: null, dirty: false };
  return {
    accent: s ? accentState(s.chars, s.start, s.end) : null,
    path: el.dataset['edit'] || null,
    kind: fieldKind(el),
    source: el.dataset['editArmed'] === '1' ? fieldSourceOf(el) : fieldRaw(el),
    dirty: el.dataset['dirty'] === '1',
  };
}

function notifyPlateSelection(): void {
  // Iframe selectionchange after painting the stage must not bounce into the inspector while
  // the author types in Plate copy, Content, or Layout fields (Recording chapter titles, etc.).
  if (contentFieldFocused()) return;
  window.dispatchEvent(new CustomEvent('plate-selection', { detail: plateSelectionDetail() }));
}

function ensurePlatePeekStyle(doc: Document | null | undefined): void {
  if (!doc?.head) return;
  let peek = doc.getElementById('studio-peek-style');
  if (!peek) {
    peek = doc.createElement('style');
    peek.id = 'studio-peek-style';
    doc.head.appendChild(peek);
  }
  peek.textContent = PLATE_PEEK_CSS;
  ensureStageRenderCss(doc);
}

/**
 * The two rules every renderer adds before it captures a frame (`RENDER_CSS` in
 * lib/shared/renderCss.js, which a parity test keeps this equal to). The `.black` overlay is the
 * template's own fade to and from black, which the encoder drops because `produce` joins slides
 * itself; the grain is frozen so it does not crawl between stepped frames. Without them the stage
 * flashed black at every slide boundary and shimmered where the master is still — discrepancies
 * the author then tried to "fix" in the edit.
 */
export const STAGE_RENDER_CSS = '.grain{animation:none!important}.black{display:none!important}';

function ensureStageRenderCss(doc: Document | null | undefined): void {
  if (!doc?.head || doc.getElementById('studio-render-css')) return;
  const el = doc.createElement('style');
  el.id = 'studio-render-css';
  el.textContent = STAGE_RENDER_CSS;
  doc.head.appendChild(el);
}

/**
 * Carousel / stack cards overlap in projected space. Among AABB hits, prefer the card whose
 * center is closest to the pointer — `event.target` often belongs to a card painted behind.
 */
function pickClosestOverlappingCard(
  cards: HTMLElement[],
  clientX: number,
  clientY: number,
): HTMLElement | null {
  if (!cards.length) return null;
  const hits = cards.filter((card) => {
    const r = card.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  });
  if (!hits.length) return null;
  hits.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const da = (ra.left + ra.width / 2 - clientX) ** 2 + (ra.top + ra.height / 2 - clientY) ** 2;
    const db = (rb.left + rb.width / 2 - clientX) ** 2 + (rb.top + rb.height / 2 - clientY) ** 2;
    return da - db;
  });
  return hits[0] || null;
}

function overlapPickLayout(doc: Document): boolean {
  const layout = doc.body.getAttribute('data-layout') || '';
  return layout === 'carousel' || layout === 'stack';
}

/** Same overlap rule as `pickPlateEditPath`, for `[data-slot]` tiles (icon / empty chrome). */
export function pickPlateSlotEl(
  doc: Document,
  clientX: number,
  clientY: number,
  fallback: Element | null | undefined,
): HTMLElement | null {
  const fromFallback = () => fallback?.closest?.<HTMLElement>('[data-slot]') || null;
  if (!overlapPickLayout(doc)) return fromFallback();
  const card = pickClosestOverlappingCard([...doc.querySelectorAll<HTMLElement>('.cards .card[data-slot]')], clientX, clientY);
  return card || fromFallback();
}

/**
 * Features carousel / stack: pick the card under the pointer (closest center among overlaps),
 * then the field under the point inside that card.
 */
export function pickPlateEditPath(
  doc: Document,
  clientX: number,
  clientY: number,
  fallback: Element | null | undefined,
): string | null {
  const fromFallback = () => fallback?.closest?.<HTMLElement>('[data-edit]')?.dataset?.['edit'] || null;
  if (!overlapPickLayout(doc)) return fromFallback();
  const card = pickClosestOverlappingCard([...doc.querySelectorAll<HTMLElement>('.cards .card')], clientX, clientY);
  if (!card) return fromFallback();
  const fields = [...card.querySelectorAll<HTMLElement>('[data-edit]')];
  const fieldHit = fields.find((el) => {
    const r = el.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  });
  return (fieldHit || fields[0])?.dataset?.['edit'] || fromFallback();
}

/** Motion → text: a click on any `[data-edit]` asks the parent Studio to enter edit mode on that field. */
function bindPlateCanvasPick(doc: Document | null | undefined): void {
  if (!doc?.body || doc.body.dataset['canvasPick'] === '1') return;
  doc.body.dataset['canvasPick'] = '1';
  doc.addEventListener(
    'pointerdown',
    (e) => {
      if (doc.body.classList.contains('studio-edit')) return;
      if (doc.body.dataset['motion'] !== '1') return;
      const target = e.target as Element | null;
      const path = pickPlateEditPath(doc, e.clientX, e.clientY, target);
      // Not on a word: a tile or an image slot opens its content record in the Inspector.
      if (!path) {
        const slotEl = pickPlateSlotEl(doc, e.clientX, e.clientY, target);
        const slot = slotEl?.dataset?.['slot'];
        if (!slot) return;
        e.preventDefault();
        e.stopPropagation();
        const top = window.parent && window.parent !== window ? window.parent : window;
        try {
          top.dispatchEvent(new CustomEvent('plate-canvas-slot', { detail: { slot, kind: slotEl?.dataset?.['slotKind'] || 'record' } }));
        } catch {
          /* same-origin plates */
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const detail = { path };
      // Dispatch once: this listener always runs in the top Studio window (it's bound from the
      // outer bundle onto the plate iframe's document), so `window.parent` is usually `window`
      // itself. Firing on both unconditionally double-invoked every click-to-edit handler,
      // racing two concurrent `enterText()` calls — the slower one would find the first call's
      // animations already cancelled and compose the frame with nothing to pin, leaving
      // per-template reveal elements stuck at their pre-reveal `opacity: 0`.
      const top = window.parent && window.parent !== window ? window.parent : window;
      try {
        top.dispatchEvent(new CustomEvent('plate-canvas-edit', { detail }));
      } catch {
        /* cross-origin shouldn't happen for same-origin plates */
      }
    },
    true,
  );
  // Hover → the Inspector lights the matching record (and the reverse happens from the pane).
  let hovered: string | null = null;
  const sendHover = (slot: string | null) => {
    if (slot === hovered) return;
    hovered = slot;
    const top = window.parent && window.parent !== window ? window.parent : window;
    try {
      top.dispatchEvent(new CustomEvent('plate-canvas-slot-hover', { detail: { slot } }));
    } catch {
      /* same-origin plates */
    }
  };
  doc.addEventListener(
    'pointerover',
    (e) => {
      if (doc.body.dataset['motion'] !== '1' || doc.body.classList.contains('studio-edit')) return;
      sendHover((e.target as Element | null)?.closest?.<HTMLElement>('[data-slot]')?.dataset?.['slot'] || null);
    },
    true,
  );
  doc.addEventListener('pointerleave', () => sendHover(null), true);
  bindPlateSlotDrag(doc);
}

/**
 * Pins and other `[data-slot-drag="xy"]` items move with the pointer across their
 * `[data-drag-surface]`; on release the plate's config takes the new percentages. A press that
 * never travels still opens the record (the pointerdown handler above fires first).
 */
function bindPlateSlotDrag(doc: Document): void {
  let drag: { el: HTMLElement; slot: string; surface: DOMRect; sx: number; sy: number; moved: boolean; x: number; y: number } | null = null;
  const pct = (v: number) => Math.max(0, Math.min(100, Math.round(v * 10) / 10));
  doc.addEventListener(
    'pointerdown',
    (e) => {
      if (doc.body.dataset['motion'] !== '1' || doc.body.classList.contains('studio-edit')) return;
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-slot-drag="xy"]');
      const slot = el?.dataset?.['slot'];
      const surface = el?.closest<HTMLElement>('[data-drag-surface]');
      if (!el || !slot || !surface) return;
      drag = { el, slot, surface: surface.getBoundingClientRect(), sx: e.clientX, sy: e.clientY, moved: false, x: 0, y: 0 };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* older engines */
      }
    },
    true,
  );
  doc.addEventListener(
    'pointermove',
    (e) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      drag.moved = true;
      drag.el.classList.add('is-dragging');
      drag.x = pct(((e.clientX - drag.surface.left) / Math.max(1, drag.surface.width)) * 100);
      drag.y = pct(((e.clientY - drag.surface.top) / Math.max(1, drag.surface.height)) * 100);
      drag.el.style.setProperty('--x', `${drag.x}%`);
      drag.el.style.setProperty('--y', `${drag.y}%`);
      drag.el.classList.toggle('flip', drag.x > 62);
    },
    true,
  );
  const finish = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.el.classList.remove('is-dragging');
    if (!d.moved) return;
    const top = window.parent && window.parent !== window ? window.parent : window;
    try {
      top.dispatchEvent(new CustomEvent('plate-canvas-slot-move', { detail: { slot: d.slot, x: d.x, y: d.y } }));
    } catch {
      /* same-origin plates */
    }
  };
  doc.addEventListener('pointerup', finish, true);
  doc.addEventListener('pointercancel', finish, true);
}

const fieldByPath = (doc: Document, path: string): HTMLElement | undefined =>
  [...doc.querySelectorAll<HTMLElement>('[data-edit]')].find((n) => n.dataset['edit'] === path);

/** Focus a field after text mode is armed; returns false if the path is missing. */
export function focusPlateField(path: string | null | undefined): boolean {
  const doc = plateFrameDoc();
  if (!doc?.body?.classList.contains('studio-edit') || !path) return false;
  const el = fieldByPath(doc, path);
  if (!el) return false;
  doc.querySelectorAll('[data-edit].is-focused').forEach((n) => n.classList.remove('is-focused'));
  el.classList.add('is-focused');
  el.focus({ preventScroll: true });
  try {
    const range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = doc.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch {
    /* some plates use complex trees; focus alone is enough */
  }
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  notifyPlateSelection();
  return true;
}

export function listPlateFields(): PlateField[] {
  const doc = plateFrameDoc();
  if (!doc) return [];
  return [...doc.querySelectorAll<HTMLElement>('[data-edit]')].map((el) => ({
    path: el.dataset['edit'] || '',
    kind: fieldKind(el),
    source: el.dataset['editArmed'] === '1' ? fieldSourceOf(el) : fieldRaw(el),
    dirty: el.dataset['dirty'] === '1',
  }));
}

export function setPlateFieldSource(path: string, source: string | null | undefined): boolean {
  const doc = plateFrameDoc();
  if (!doc?.body?.classList.contains('studio-edit') || !path) return false;
  const el = fieldByPath(doc, path);
  if (!el) return false;
  learnField(el);
  renderField(el, source == null ? '' : String(source));
  el.dataset['editArmed'] = '1';
  markFieldDirty(el);
  notifyPlateSelection();
  return true;
}

/**
 * Paint a value the server has already accepted straight onto the live plate.
 *
 * The Content pane used to reload the whole iframe after every typed field — a cache-busting
 * document load per keystroke pause, which is where the stage went clunky. The saved value is
 * the same copy the rebuild will bake, so writing it into the field is both faster and what the
 * author is waiting to see. Returns false only when no field is on stage; reveal shells are
 * replaced in place (same as `retargetTitleReveal`) so live typing never depends on a reload of
 * still-unbaked HTML.
 */
export function paintPlateFieldValue(
  path: string,
  source: string | number | null | undefined,
  plateId?: string | null,
): boolean {
  const doc = plateFrameDoc();
  if (!doc?.body || !path) return false;
  // Never paint another plate's words onto the frame currently on stage.
  if (plateId && plateFrameReady && plateFrameReady !== plateId) return false;
  const el = fieldByPath(doc, path);
  if (!el) return false;
  // Cascade / wipe / rise shells block plain edit rows — replace them; bake-on-leave restores
  // builder markup. Clear host reveal props so a pinned opacity/clip does not hide the new copy.
  if (el.matches('.title[data-reveal]') && el.querySelector(REVEAL_SHELLS)) {
    for (const prop of REVEAL_HOST_PROPS) el.style.removeProperty(prop);
  }
  learnField(el);
  renderField(el, source == null ? '' : String(source));
  el.dataset['editArmed'] = '1';
  // Content live paint — not stage dirty (config already saved). Mark so motion restore keeps
  // this source instead of snapping back to reveal-shell originals.
  el.dataset['editLive'] = '1';
  delete el.dataset['dirty'];
  refitSoon(doc);
  return true;
}

/** Live paint for draggable callout pins — same `--x` / `--y` as canvas drag, no HTML rebuild. */
export function paintSlotPosition(
  slot: string,
  at: { x: number; y: number },
  plateId?: string | null,
): boolean {
  const doc = plateFrameDoc();
  if (!doc?.body || !slot) return false;
  if (plateId && plateFrameReady && plateFrameReady !== plateId) return false;
  const el = doc.querySelector<HTMLElement>(`[data-slot="${CSS.escape(slot)}"]`);
  if (!el) return false;
  el.style.setProperty('--x', `${at.x}%`);
  el.style.setProperty('--y', `${at.y}%`);
  el.classList.toggle('flip', at.x > 62);
  refitSoon(doc);
  return true;
}

function selectFieldRange(el: HTMLElement, start: number, end: number): void {
  const doc = el.ownerDocument;
  const a = positionAt(el, start, { isBlock: blockNode });
  const b = positionAt(el, end, { isBlock: blockNode });
  const range = doc.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  const sel = doc.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function markFieldDirty(el: HTMLElement): void {
  el.dataset['dirty'] = '1';
  setPlateDirty(true);
  updatePlateEditChrome();
}

/** Accent the selected words (a caret takes its word); accented words lose it. Stage button and ⌘B. */
export function toggleFieldAccent(): boolean {
  const s = plateSelection();
  if (!s) {
    toast('Select words first', 'Click into a text field, then Accent or ⌘B', 'warn');
    return false;
  }
  const r = toggleAccent(s.chars, s.start, s.end);
  if (!r) return false;
  renderFieldChars(s.el, r.chars);
  s.el.focus({ preventScroll: true });
  selectFieldRange(s.el, r.start, r.end);
  markFieldDirty(s.el);
  notifyPlateSelection();
  return true;
}

/** Typed `*word*` becomes an accent on the spot; the caret stays on the same character. */
function absorbTypedAccents(el: HTMLElement): void {
  const sel = el.ownerDocument.getSelection();
  if (!sel?.rangeCount) return;
  const range = sel.getRangeAt(0);
  const { chars, offsets } = fromElement(el, { isBlock: blockNode, marks: [[range.endContainer, range.endOffset]] });
  const plain = chars.map((c) => c.ch).join('');
  const re = /\*([^*\n]+)\*/g;
  const removed: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(plain))) removed.push(m.index, m.index + m[0].length - 1);
  if (!removed.length) return;
  let on = false;
  const marked: CopyChar[] = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (!c) continue;
    if (removed.includes(i)) {
      on = !on;
      continue;
    }
    marked.push({ ch: c.ch, accent: on || c.accent });
  }
  renderFieldChars(el, marked);
  const first = offsets[0] ?? 0;
  const caret = first - removed.filter((i) => i < first).length;
  selectFieldRange(el, caret, caret);
}

/**
 * Force pasted/dropped content to plain text. `contenteditable="plaintext-only"` already does
 * this in current Chromium/Firefox, but Safari's support is inconsistent and the delegated
 * `contenteditable="true"` fallback (old browsers) does not strip formatting at all — rich HTML
 * (fonts, colors, images, tables) pasted from a doc or web page would otherwise wreck a field's
 * markup and silently break accent parsing. Belt and braces: every browser lands on plain text.
 */
function insertPlainText(el: HTMLElement, text: string | null | undefined): void {
  const clean = String(text ?? '').replace(/\r\n?/g, '\n');
  if (!clean) return;
  const doc = el.ownerDocument;
  if (doc.execCommand?.('insertText', false, clean)) return;
  const sel = doc.getSelection();
  if (!sel?.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = doc.createTextNode(clean);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const editTarget = (e: Event): HTMLElement | null => (e.target as Element | null)?.closest?.<HTMLElement>('[data-edit]') || null;

function bindPlateEditDelegation(doc: Document): void {
  if (doc.body.dataset['editDelegated'] === '1') return;
  doc.body.dataset['editDelegated'] = '1';
  doc.body.addEventListener('paste', (e) => {
    const el = editTarget(e);
    if (!el) return;
    e.preventDefault();
    insertPlainText(el, e.clipboardData?.getData('text/plain'));
  });
  doc.body.addEventListener('drop', (e) => {
    const el = editTarget(e);
    if (!el) return;
    e.preventDefault();
    insertPlainText(el, e.dataTransfer?.getData('text/plain'));
  });
  doc.body.addEventListener('input', (e) => {
    const el = editTarget(e);
    if (!el) return;
    markFieldDirty(el);
    absorbTypedAccents(el);
    notifyPlateSelection();
    // The encoder refits type and composition for whatever the copy ended up being. Doing the
    // same once typing settles is what keeps long copy from overflowing on stage but not in the
    // render — the wait is long enough that sizes never jump under the caret mid-word.
    refitSoon(doc);
  });
  doc.body.addEventListener('keydown', (e) => {
    const el = editTarget(e);
    if (!el) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleFieldAccent();
    } else if (e.key === 'Tab') {
      const fields = [...doc.querySelectorAll<HTMLElement>('[data-edit]')];
      if (fields.length < 2) return;
      e.preventDefault();
      const i = fields.indexOf(el);
      const next = fields[(i + (e.shiftKey ? -1 : 1) + fields.length) % fields.length];
      focusPlateField(next?.dataset['edit']);
    } else if (e.key === 'Enter' && fieldKind(el) !== 'lines') {
      // Single-line copy: a line break has nowhere to go in the config.
      e.preventDefault();
    } else if (e.key === 'Escape') {
      el.blur();
      window.dispatchEvent(new CustomEvent('plate-canvas-done'));
    }
  });
  doc.body.addEventListener('focusin', (e) => {
    const el = editTarget(e);
    doc.querySelectorAll('[data-edit].is-focused').forEach((n) => n.classList.remove('is-focused'));
    if (el) el.classList.add('is-focused');
    notifyPlateSelection();
  });
  doc.addEventListener('selectionchange', notifyPlateSelection);
  doc.body.addEventListener('focusout', () => setTimeout(notifyPlateSelection, 0));
}

function armPlateEditables(doc: Document): void {
  doc.querySelectorAll<HTMLElement>('[data-edit]').forEach((el) => {
    learnField(el);
    if (el.dataset['editArmed'] !== '1') {
      el.dataset['editArmed'] = '1';
      renderField(el, fieldRaw(el));
    }
    el.setAttribute('contenteditable', 'plaintext-only');
    if (!el.isContentEditable) el.setAttribute('contenteditable', 'true');
    el.spellcheck = true;
  });
}

interface FieldSnapshot {
  path: string;
  source: string;
  dirty: boolean;
}

function snapshotPlateEdits(doc: Document): FieldSnapshot[] {
  return [...doc.querySelectorAll<HTMLElement>('[data-edit]')].map((el) => ({
    path: el.dataset['edit'] || '',
    source: el.dataset['editArmed'] === '1' ? fieldSourceOf(el) : fieldRaw(el),
    dirty: el.dataset['dirty'] === '1',
  }));
}

/**
 * Put copy back after a rebuild or clone. With `motion`, untouched fields get the template's own
 * reveal markup back so Replay animates them; edited fields show their canonical markup.
 */
function restorePlateEdits(doc: Document, snapshot: FieldSnapshot[] | null | undefined, { motion = false, mark = true } = {}): void {
  if (!snapshot?.length) return;
  const byPath = Object.fromEntries(snapshot.map((s) => [s.path, s]));
  const originals = plateOriginalMarkup.get(doc);
  doc.querySelectorAll<HTMLElement>('[data-edit]').forEach((el) => {
    const path = el.dataset['edit'] || '';
    const s = byPath[path];
    if (!s) return;
    learnField(el);
    if (motion && !s.dirty && el.dataset['editLive'] !== '1') {
      const orig = originals?.get(path);
      if (orig != null) el.innerHTML = orig;
      delete el.dataset['editArmed'];
      delete el.dataset['dirty'];
      delete el.dataset['editLive'];
      return;
    }
    renderField(el, s.source);
    el.dataset['editArmed'] = '1';
    if (s.dirty) el.dataset['dirty'] = '1';
    else delete el.dataset['dirty'];
  });
  if (mark && snapshot.some((s) => s.dirty)) {
    setPlateDirty(true);
    updatePlateEditChrome();
  }
}

/**
 * Carry the copy on stage — unsaved edits included — into another frame of the same plate in
 * motion, the way the stage itself shows it: edited fields in their canonical markup, untouched
 * ones with the template's reveal.
 */
export function mirrorPlateCopy(from: Document, to: Document, { still = false } = {}): void {
  restorePlateEdits(to, snapshotPlateEdits(from), { motion: !still, mark: false });
  if (still) composePlateForEdit(to);
}

/** The stage holds the composed edit still (text mode): bring the loupe's mirror to the same still. */
export function presentPlateStill(frame: HTMLIFrameElement | null, from: Document, onReady: () => void): void {
  const doc = frameDoc(frame);
  if (doc?.body) delete doc.body.dataset['motion'];
  enablePlateInlineEdit(frame, {
    bind: false,
    onReady: () => {
      const to = frameDoc(frame);
      if (to?.body) mirrorPlateCopy(from, to, { still: true });
      onReady();
    },
  });
}

interface InlineEditOpts {
  attempt?: number;
  snapshot?: FieldSnapshot[] | null;
  onReady?: (() => void) | null;
  /** False while arming the off-stage frame: the stage's bound flag follows the swap instead. */
  bind?: boolean;
}

export function enablePlateInlineEdit(frame: HTMLIFrameElement | null, { attempt = 0, snapshot = null, onReady = null, bind = true }: InlineEditOpts = {}): void {
  const doc = frame?.contentDocument;
  if (!doc?.body) {
    onReady?.();
    return;
  }
  // Wait for first paint / animations so layout + SVG pathLength exist
  const ready = (doc.getAnimations?.() || []).length > 0 || attempt >= 6;
  if (!ready) {
    setTimeout(() => enablePlateInlineEdit(frame, { attempt: attempt + 1, snapshot, onReady, bind }), 40);
    return;
  }

  // plateEditPeakSec scans live animations for exit delays — read it, and freeze every running
  // Web Animation to exactly what's on screen right now, BEFORE `body.studio-edit` goes on below.
  // That class's blanket `animation: none !important` rule stops every CSS animation the instant
  // it's applied, so anything done after it can no longer see (or recover) the live frame.
  const peakSec = plateEditPeakSec(doc);
  // Measure title-line packing on the frame the author sees — before pin / studio-edit open the
  // reveal masks (those steps grow the boxes a few pixels and were the residual jump).
  captureAllLineLayouts(doc);
  pinLiveAnimationFrames(doc);

  // Always refresh edit CSS (module may have updated since the iframe first loaded)
  let editStyle = doc.getElementById('studio-edit-style') as HTMLStyleElement | null;
  if (!editStyle) {
    editStyle = doc.createElement('style');
    editStyle.id = 'studio-edit-style';
    doc.head.appendChild(editStyle);
  }
  editStyle.textContent = PLATE_EDIT_CSS;
  editStyle.disabled = false;
  ensurePlatePeekStyle(doc);

  doc.body.classList.add('studio-edit');
  doc.body.dataset['editPeak'] = peakSec.toFixed(2);
  if (String(doc.body.dataset['cardId'] || desk.get().activePlateId || '').startsWith('overlay:')) {
    doc.body.dataset['composite'] = '1';
  }

  // Freeze the motion frame while fields still carry reveal markup — then flatten copy once.
  composePlateForEdit(doc);

  bindPlateEditDelegation(doc);
  bindPlateCanvasPick(doc);
  armPlateEditables(doc);
  doc.querySelectorAll<HTMLElement>('[data-edit]').forEach((el) => {
    if (el.dataset['edit']) el.removeAttribute('title');
  });
  if (snapshot) restorePlateEdits(doc, snapshot);
  composePlateForEdit(doc);
  // Re-apply packing after compose (it can touch overflow on ancestors).
  doc.querySelectorAll<HTMLElement>('[data-edit][data-edit-kind="lines"]').forEach((el) => applyLineLayout(el));
  if (bind) plateEditBound = true;
  requestAnimationFrame(() => onReady?.());
}

const plateLabel = (): string => {
  const s = desk.get();
  return s.activePlateId ? `Plate · ${findPlate(s.activePlateId)?.label || s.activePlateId}` : 'Plate HTML';
};

/** Shells a previous title reveal baked into the heading (see `revealMarkup` in lib/titleReveal.mjs). */
const REVEAL_SHELLS = '.char, .cw, .title-cascade, .line-wipe, .line-exit, .mask, .rise';

/**
 * Host properties a reveal animates directly. The pinned-frame overrides are lifted by
 * `clearPlateRevealOverrides`; these are what the WebGL runtime and a cancelled animation leave
 * on the element itself.
 */
const REVEAL_HOST_PROPS = ['letter-spacing', 'clip-path', '-webkit-clip-path', 'transform', 'filter', 'opacity', 'animation', 'perspective'];

/**
 * Move every title on the plate onto `to` right now.
 *
 * A reveal only runs when the title carries its own markup family: `plates.css` guards each
 * host animation with `:not(:has(.char, .mask, .line-wipe, .title-cascade))`, so a title still
 * wearing cascade letters keeps playing cascade no matter what `data-reveal` says. The server
 * rebuild lands a few hundred ms later and the iframe reloads, but until then the stage showed
 * the reveal the author just replaced. Rebuilding the heading from the raw copy it already
 * carries is the same plain markup the builder emits, so the new reveal takes over at once.
 */
export function retargetTitleReveal(doc: Document | null | undefined, to: string | null | undefined): void {
  if (!doc?.body || !to) return;
  let changed = false;
  doc.querySelectorAll<HTMLElement>('.title[data-reveal]').forEach((title) => {
    if (title.dataset['reveal'] === to) return;
    if (title.querySelector(REVEAL_SHELLS) && title.dataset['edit']) {
      const raw = fieldRaw(title);
      if (raw) renderField(title, raw);
    }
    for (const prop of REVEAL_HOST_PROPS) title.style.removeProperty(prop);
    title.dataset['reveal'] = to;
    changed = true;
  });
  // Two reflows — only worth it when a title actually moved. `paintLook` runs on every hover.
  if (changed) recreatePlateAnimations(doc);
}

/**
 * Replay plate motion in-place — keeps unsaved inline edits.
 * Does not reload the iframe (that would wipe dirty copy).
 */
export function replayPlateInline(): void {
  const frame = frameEl();
  const doc = frame?.contentDocument;
  if (!frame || !doc?.body) {
    toast('No plate loaded', '', 'warn');
    return;
  }
  if (plateReplayTimer) {
    clearTimeout(plateReplayTimer);
    plateReplayTimer = null;
  }

  // Blur any active editor so we snapshot final text
  try {
    (doc.activeElement as HTMLElement | null)?.blur?.();
  } catch {
    /* ignore */
  }
  const snapshot = snapshotPlateEdits(doc);
  const peakSec = plateEditPeakSec(doc);
  const peakMs = Math.round(peakSec * 1000);

  // Let real motion play (including carousel waves) with current copy
  doc.body.classList.remove('studio-edit');
  clearPlateRevealOverrides(doc);
  const editStyle = doc.getElementById('studio-edit-style') as HTMLStyleElement | null;
  if (editStyle) editStyle.disabled = true;
  doc.querySelectorAll('[data-edit]').forEach((el) => el.removeAttribute('contenteditable'));

  // Restart CSS animations without losing DOM text: clone the stage
  const stage = doc.querySelector('.stage');
  if (stage) {
    restorePlateEdits(doc, snapshot, { motion: true });
    // Clone drops data-studio-reveal inline styles so CSS animations can run clean
    stage.replaceWith(stage.cloneNode(true));
  } else {
    for (const a of doc.getAnimations?.() || []) {
      try {
        a.cancel();
      } catch {
        /* ignore */
      }
    }
    // Force reflow + play fresh if any remain
    void doc.body.offsetHeight;
    for (const a of doc.getAnimations?.() || []) {
      try {
        a.currentTime = 0;
        a.play();
      } catch {
        /* ignore */
      }
    }
  }

  // Re-apply snapshot onto cloned nodes immediately (clone already has text; dirty flags)
  restorePlateEdits(doc, snapshot, { motion: true });
  setMonitorLabel(plateLabel(), desk.get().plateDirty ? 'Replaying with unsaved edits…' : 'Replaying…');
  setButtonBusy('btnPlateReplay', true);

  plateReplayTimer = setTimeout(
    () => {
      plateReplayTimer = null;
      enablePlateInlineEdit(frame, { snapshot });
      setButtonBusy('btnPlateReplay', false);
      setMonitorLabel(
        plateLabel(),
        desk.get().plateDirty ? 'Unsaved edits · Replay anytime · Save when ready' : 'Inline edit · timeline paused on this plate',
      );
    },
    Math.max(700, peakMs),
  );
}

/** `#btnPlateReplay`: cold start loads the plate and composes it; otherwise replays in place. */
export function replayPlateButton(): void {
  const frame = frameEl();
  if (!frame?.contentDocument?.body) {
    const plate = findPlate(desk.get().activePlateId);
    if (!plate || !frame) return;
    // Cold start: load then play through to peak
    frame.onload = () => {
      fitFhdPreview();
      // Compose static edit ASAP — no need to wait out the peak timeline
      setTimeout(() => enablePlateInlineEdit(frame), 500);
    };
    frame.src = `${plate.htmlUrl.split('?')[0]}?t=${Date.now()}&play=1`;
    return;
  }
  // In-place replay keeps unsaved inline edits
  replayPlateInline();
}

export function collectPlateEdits(): Record<string, string> {
  const doc = plateFrameDoc();
  if (!doc) return {};
  const fields: Record<string, string> = {};
  doc.querySelectorAll<HTMLElement>('[data-edit][data-dirty="1"]').forEach((el) => {
    const path = el.dataset['edit'];
    if (!path) return;
    fields[path] = fieldSourceOf(el);
  });
  return fields;
}

export async function savePlateCopyEdits(): Promise<void> {
  const s = desk.get();
  const plateId = s.activePlateId;
  if (!plateId) return;
  const fields = collectPlateEdits();
  if (!Object.keys(fields).length) {
    toast('Nothing to save', 'Edit a text field first', 'warn');
    return;
  }
  setButtonBusy('btnPlateSaveCopy', true);
  try {
    const r = await api<{ plates?: HtmlPlate[] }>(`/api/video/${s.slug}/plates/${encodeURIComponent(plateId)}/copy`, {
      method: 'POST',
      body: { fields },
    });
    desk.set({ plateDirty: false });
    renderHtmlPlatePicker(r.plates || desk.get().htmlPlates);
    markRenderDirty();
    await reloadPlate(plateId);
    const live = String(plateId).startsWith('overlay:');
    const n = Object.keys(fields).length;
    toast('Text saved', live ? `${n} field(s) → flow.mjs` : `${n} field(s) updated on the plate`);
    updatePlateEditChrome();
  } catch (err) {
    toast('Save failed', errMessage(err), 'err');
  } finally {
    setButtonBusy('btnPlateSaveCopy', false);
  }
}

export async function discardPlateCopyEdits(): Promise<void> {
  const plateId = desk.get().activePlateId;
  if (!plateId) return;
  desk.set({ plateDirty: false });
  await reloadPlate(plateId);
  updatePlateEditChrome();
}

/* ———————————————————————————————————————————— scene bar */

export async function openPlateFromScene(scene: Scene | null | undefined): Promise<void> {
  if (!scene?.editable) return;
  if (!desk.get().htmlPlates?.some((p) => p.id === scene.plateId)) {
    await rebuildPlateHtmlPreview({ selectFirst: false, plateId: scene.plateId });
  }
  const plate = findPlate(scene.plateId);
  if (plate) showPlateHtml(plate);
  else toast('No HTML yet', 'Rebuild plates first', 'warn');
}

/** Open the inline plate editor for the current (or given) plate scene. */
export async function editCurrentPlate(scene: Scene | null | undefined = desk.get().currentScene): Promise<void> {
  if (scene && !scene.editable && scene.kind === 'live') {
    void selectLive(scene);
    return;
  }
  if (!scene?.editable) {
    toast('Pick a clip', 'Click a plate or live slice on the timeline, or a chip below', 'warn');
    return;
  }
  try {
    await openPlateFromScene(scene);
    toast('Plate editor', 'Click text to edit · Replay keeps unsaved changes · Save when ready');
  } catch (err) {
    toast('Could not open plate', errMessage(err), 'err');
  }
}

/**
 * Prepare AI feedback for this plate — does NOT start the agent.
 * Opens the plate for context, focuses Feedback, and waits for Apply.
 */
export async function askAiForCurrentScene({ motion = false }: { motion?: boolean } = {}): Promise<void> {
  const scene = desk.get().currentScene;
  if (!scene?.editable) {
    toast('Pick a plate', 'Click a plate tip on the timeline first', 'warn');
    return;
  }
  desk.set({ editingPlateId: scene.plateId });
  try {
    await openPlateFromScene(scene);
  } catch {
    /* still open feedback even if HTML missing */
  }
  showRightTab('feedback');
  const prefix = motion ? `Motion on “${scene.title}”: ` : `On the “${scene.title}” plate: `;
  const cur = desk.get().improve.note;
  const note = !cur.trim() ? prefix : !cur.includes(scene.title) ? `${prefix}${cur.trim()}` : cur;
  // Mark which improve goal / plate the next Apply should use
  desk.set((st) => ({
    improve: {
      ...st.improve,
      note,
      goal: motion ? 'motion' : 'scene',
      plateId: scene.plateId,
      label: motion ? `Apply motion · ${scene.title}` : `Apply feedback · ${scene.title}`,
    },
  }));
  requestAnimationFrame(() => {
    const el = document.getElementById('improveNote') as HTMLTextAreaElement | null;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  });
  toast('Describe the change', 'Then click Apply — nothing runs until you do', 'info');
}

/** Open Motion panel for templates — does not enqueue an agent job. */
export function openMotionForCurrentScene(): void {
  const scene = desk.get().currentScene;
  if (scene?.editable) desk.set({ editingPlateId: scene.plateId });
  showRightTab('motion');
  toast('Motion templates', 'Pick a template, Preview plates, then Approve — or Ask AI for a note', 'info');
}

/** @deprecated — kept for any leftover callers; opens editor */
export async function previewCurrentScene(): Promise<void> {
  return editCurrentPlate();
}

export function improveCurrentScene({ motion = false }: { motion?: boolean } = {}): void {
  // Legacy auto-run path — prefer askAiForCurrentScene so the user confirms
  void askAiForCurrentScene({ motion });
}

export async function approvePlateOnly(): Promise<void> {
  const s = desk.get();
  const plateId = s.editingPlateId || s.currentScene?.plateId;
  if (!plateId) {
    toast('No plate selected', '', 'warn');
    return;
  }
  if (s.jobBusy) {
    toast('Busy', 'Wait for the current job, or it will conflict — try again when Ready', 'warn');
    return;
  }
  setButtonBusy('btnApprovePlate', true);
  desk.set({ jobBusy: true });
  try {
    await api(`/api/video/${s.slug}/draft/approve`, { method: 'POST', body: {} });
    hideProposal();
    setStatus('run', `Encoding plate ${plateId}…`);
    desk.set({ activeSurface: 'render' });
    showLeftTab('render');
    const r = await api<{ job: Job }>(`/api/video/${s.slug}/scenes/${encodeURIComponent(plateId)}/render`, {
      method: 'POST',
      body: { scope: 'plate' },
    });
    await watchJob(r.job.id, { surface: 'render' });
    if (s.slug) await loadVideo(s.slug);
    hideProposal();
    resetThinkSteps();
    desk.set({ editingPlateId: null });
    setApprovePlateVisible(false);
    // Preview the freshly encoded plate MP4 in Program (keepPreview so we don't wipe it with the master).
    const scene = desk.get().scenes.find((sc) => sc.plateId === plateId);
    if (scene?.mp4Url) {
      playPlatePreview(scene.mp4Url, scene.title || plateId);
    } else {
      setMonitorMode('program');
    }
    toast('Plate encoded', 'Full video still uses old cut until you Render full');
    showLeftTab('render');
    desk.set({
      bay: {
        pillClass: 'render-pill warn',
        pillText: 'Plate updated',
        headline: 'Plate changed — update the master?',
        reason: 'This plate MP4 is new. Render stitches plates + live + audio into the Program master.',
      },
    });
  } catch (err) {
    toast('Plate render failed', errMessage(err), 'err');
  } finally {
    setButtonBusy('btnApprovePlate', false);
    desk.set({ jobBusy: false, activeSurface: null });
    clearRunStatus();
    void drainQueue();
  }
}

interface RebuildResponse {
  plates?: HtmlPlate[];
  motion?: Motion;
  [key: string]: unknown;
}

/**
 * Apply plates a Direction save already rebuilt on disk (the response that triggered this carries
 * them — no second `/plates/rebuild-html` round trip). `reload` is false for a change the stage
 * already shows live (CSS look tokens, the atmosphere field's own `tuneField`): the list and any
 * inspector state still pick up the fresh data, but the frame itself is left alone so nothing
 * flashes. It is true only when the plate's markup or WebGL field actually changed shape.
 */
export function applyRebuiltPlates(plates: HtmlPlate[], { reload = true }: { reload?: boolean } = {}): void {
  renderHtmlPlatePicker(plates);
  if (!reload) {
    // The frame on stage is already correct (optimistic CSS paint / the field's own tuneField).
    // Still drop anything idle in the back buffer — a plate preloaded just before this save would
    // otherwise carry the pre-save look the moment it swaps onto stage.
    dropPreloadedPlates();
    return;
  }
  plateFrameReady = null;
  dropPreloadedPlates();
  const activeId = desk.get().activePlateId;
  const target = (activeId && plates.find((p) => p.id === activeId)) || plates[0] || null;
  if (ed.active) void invalidatePlates();
  else if (target) showPlateHtml(target);
}

export async function rebuildPlateHtmlPreview({ selectFirst = true, plateId = null }: { selectFirst?: boolean; plateId?: string | null } = {}): Promise<RebuildResponse> {
  setThinkStep('html');
  const activity = 'Rebuilding plate HTML…';
  setStatus('run', activity);
  let r: RebuildResponse;
  try {
    if (ed.active) {
      const { flushAllContentPending } = await import('./plateContentPane');
      await flushAllContentPending();
    }
    r = await api<RebuildResponse>(`/api/video/${desk.get().slug}/plates/rebuild-html`, { method: 'POST', body: {} });
  } finally {
    clearRunStatus(activity);
  }
  // Drop the ready-cache: the same plate id now points at new HTML (bg, atmosphere, palette).
  plateFrameReady = null;
  dropPreloadedPlates();
  renderHtmlPlatePicker(r.plates || []);
  const v = desk.get().video;
  if (r.motion && v) desk.set({ video: { ...v, motion: r.motion } });
  const plates = r.plates || [];
  const activeId = desk.get().activePlateId;
  const target =
    (plateId && plates.find((p) => p.id === plateId)) || (selectFirst ? plates[0] : null) || (activeId && plates.find((p) => p.id === activeId)) || null;
  if (ed.active) {
    // Editor owns the stage: force-reload the plate on the playhead so Look/Direction land live.
    await invalidatePlates();
  } else if (target) {
    setThinkStep('preview');
    showPlateHtml(target);
  }
  return r;
}

/** Return a plate only when the note itself names one; ambient UI selection never narrows smart scope. */
export function inferPlateIdFromFeedback(note: string | null | undefined): string | null {
  const n = String(note || '').toLowerCase();
  const scenes = (desk.get().scenes || []).filter((s) => s.editable);

  for (const s of scenes) {
    const needles = [s.plateId, s.id, s.title, s.type].filter(Boolean).map((x) => String(x).toLowerCase());
    if (needles.some((k) => k.length >= 3 && n.includes(k))) return s.plateId;
  }

  if (/\b(intro(?:duction)?|opening|open plate|brand open)\b/.test(n)) return 'open';
  if (/\b(close|outro|ending|end plate|summary plate)\b/.test(n)) return 'close';

  // Logo size/position without a named plate → open (Introduction)
  if (/\b(logo|lockup)\b/.test(n) && /\b(small(?:er)?|big(?:ger)?|large(?:r)?|high(?:er)?|low(?:er)?|up|down|size|position)\b/.test(n)) {
    return 'open';
  }

  return null;
}

export async function previewPlateAfterEdit(plateId: string | null | undefined): Promise<HtmlPlate | undefined> {
  await rebuildPlateHtmlPreview({ selectFirst: !plateId, plateId: plateId || null });
  const slug = desk.get().slug;
  if (slug) await loadVideo(slug);
  const plates = desk.get().htmlPlates?.length ? desk.get().htmlPlates : (await api<{ plates?: HtmlPlate[] }>(`/api/video/${slug}/plates`)).plates;
  renderHtmlPlatePicker(plates || []);
  const activeId = desk.get().activePlateId;
  const plate = (plateId && (plates || []).find((p) => p.id === plateId)) || (plates || []).find((p) => p.id === activeId) || (plates || [])[0];
  if (plate) {
    desk.set({ editingPlateId: plate.id });
    showPlateHtml(plate); // cache-bust src → animations replay from t=0
  }
  return plate;
}

/* ———————————————————————————————————————————— plate accent */

interface PlateMotionConfig {
  atmosphere?: string;
  titleReveal?: string;
  depth?: string;
  energy?: string;
  sheen?: boolean;
  [key: string]: unknown;
}

interface VideoConfig {
  open?: { motion?: PlateMotionConfig };
  close?: { motion?: PlateMotionConfig };
  interstitials?: Array<{ id: string; motion?: PlateMotionConfig }>;
  [key: string]: unknown;
}

export function currentPlateConfig(plateId: string | null | undefined): { id: string; overrides: string[] } | null {
  if (!plateId) return null;
  const v = desk.get().video;
  if (plateId === 'open' || plateId === 'close') return { id: plateId, overrides: v?.plateAccents?.[plateId] || [] };
  return (v?.interstitials || []).find((i) => i.id === plateId) || null;
}

export async function loadPlateAccent(plateId: string | null | undefined): Promise<void> {
  const opts = desk.get().video?.motionOptions;
  chrome.set({
    accentOptions: {
      atmospheres: opts?.atmospheres || [],
      atmosphereLabels: opts?.atmosphereLabels || {},
      titleReveals: opts?.titleReveals || [],
      titleRevealLabels: opts?.titleRevealLabels || {},
      depths: opts?.depths || [],
      energies: opts?.energies || [],
    },
  });
  let motion: PlateMotionConfig = {};
  try {
    const cfg = (await api<{ config: VideoConfig }>(`/api/video/${desk.get().slug}/config`)).config;
    motion = (plateId === 'open' || plateId === 'close' ? cfg[plateId]?.motion : cfg.interstitials?.find((i) => i.id === plateId)?.motion) || {};
  } catch {
    motion = {};
  }
  chrome.set({
    accentValues: {
      ...EMPTY_ACCENT,
      atmosphere: motion.atmosphere || '',
      titleReveal: motion.titleReveal || '',
      depth: motion.depth || '',
      energy: motion.energy || '',
      sheen: motion.sheen === true ? 'on' : motion.sheen === false ? 'off' : '',
    },
  });
  renderAccentState(Object.keys(motion));
}

export function renderAccentState(keys: string[]): void {
  chrome.set({ accentKeys: keys });
}

export type AccentPatch = Record<string, string | boolean | null> & { reset?: boolean };

export async function savePlateAccent(patch: AccentPatch): Promise<void> {
  const s = desk.get();
  const plateId = s.activePlateId;
  if (!plateId) return;
  try {
    // Optimistic CSS look while the rebuild runs (same tokens as Direction effects).
    if (!patch.reset) {
      const base = s.video?.motion;
      const next = { ...base, ...patch } as Record<string, unknown>;
      if (patch['sheen'] === 'on' || patch['sheen'] === true) next['sheen'] = true;
      if (patch['sheen'] === 'off' || patch['sheen'] === false) next['sheen'] = false;
      paintMotionLiveOptimistic(next as unknown as Parameters<typeof paintMotionLiveOptimistic>[0]);
    }
    const r = await api<{ motion?: Record<string, unknown> }>(`/api/video/${s.slug}/plates/${encodeURIComponent(plateId)}/motion`, {
      method: 'POST',
      body: patch,
    });
    renderAccentState(Object.keys(r.motion || {}));
    await previewPlateAfterEdit(plateId);
    if (chrome.get().accentOpen) void loadPlateAccent(plateId);
    toast(patch.reset ? 'Plate follows the video' : 'Plate accent saved', plateId);
  } catch (err) {
    toast('Accent not saved', errMessage(err), 'err');
  }
}

export function togglePlateAccent(open?: boolean): void {
  const next = open ?? !chrome.get().accentOpen;
  chrome.set({ accentOpen: next });
  if (next) void loadPlateAccent(desk.get().activePlateId);
}

/** Tests start from a clean plate engine. */
export function resetPlateForTests(): void {
  plateFrameReady = null;
  plateLoadToken = 0;
  plateEditBound = false;
  backToken = 0;
  backLoad = null;
  backReady = null;
  backArmedSrc = null;
  if (plateReplayTimer) clearTimeout(plateReplayTimer);
  plateReplayTimer = null;
  disposeFhdFitObserver();
}

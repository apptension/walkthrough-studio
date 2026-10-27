import { api } from '@/desk/api';
import { desk } from '@/desk/store';
import { toast } from '@/desk/toast';
import { plateClockMs } from '@/logic/plateTiming';
import { canReloadPlateFrame, playheadOnPlate, plateClipFor, previewClockMs, shouldParkPlayheadAtClipStart } from '@/logic/plateSync';

import { paintStatus } from './edits';
import { renderInspector } from './inspector';
import { flushAllContentPending } from './plateContentPane';
import { reloadPlate } from './lifecycle';
import { dropPreloadedPlates, retargetTitleReveal } from './plate';
import { paintInspectorUnlessContentTyping } from './plateContentSave';
import { P } from './plateCtl';
import { curClip } from './seq';
import { plateReady, renderFrame } from './stage';
import { ed, setHtmlPlates, slug, timers } from './state';
import { clearPlatePreviewTimers, markPlateResync } from './text';
import { flashHint, plateInfo, renderClipsTrack } from './timeline';
import { paintHead, pause, play, seek } from './transport';
import type { DeckPlate, PlateRow } from './types';
import { $, ICONS, errMessage } from './util';

/** Live plate look / style previews and saves from `kit/studio/editor.js`. */

/**
 * After Look / style / Direction paints the live plate, rebuild its animations at the current
 * playhead offset. Live edits must update the view without yanking you back to the clip start.
 * Pass `{ fromStart: true }` only for an explicit reset-from-open.
 *
 * Uses the plate id (not only the playhead clip) so a Look pick still resyncs when the
 * playhead sits on a live stretch with that plate still loaded in the iframe.
 */
export function refreshPlatePreview(id: string | null | undefined, { fromStart = false }: { fromStart?: boolean } = {}): void {
  const plateId = id || desk.get().activePlateId || null;
  if (!plateId) return;
  if (ed.textMode || ed.loadingPlate === plateId) {
    markPlateResync(plateId);
    return;
  }
  const clip = plateClipFor(ed.seq, plateId, curClip());
  const onPlate = playheadOnPlate(curClip(), plateId);
  const frameReady = P.ready() === plateId;
  if (!frameReady && !plateReady(plateId)) {
    markPlateResync(plateId);
    return;
  }
  if (ed.playing && onPlate) pause();
  if (shouldParkPlayheadAtClipStart(fromStart, onPlate) && clip) {
    ed.t = clip.at;
    paintHead();
  }
  const ms = previewClockMs(clip, ed.t, { fromStart, onPlate }) && clip ? plateClockMs(clip, ed.t) : 0;
  if (typeof P.restart === 'function') P.restart(ms);
  else {
    P.motion?.();
    P.seek?.(ms);
  }
  if (onPlate) renderFrame();
  if (ed.needsPlateResync === plateId) ed.needsPlateResync = null;
}

export function scheduleStylePreview(id: string): void {
  clearTimeout(timers.stylePreview);
  timers.stylePreview = setTimeout(() => refreshPlatePreview(id), 220);
}

export function applyVar(name: string, value: string | null | undefined): void {
  try {
    const doc = $<HTMLIFrameElement>('plateFrame')?.contentDocument;
    if (!doc?.documentElement) return;
    if (value == null || value === '') doc.documentElement.style.removeProperty(name);
    else doc.documentElement.style.setProperty(name, value);
  } catch {
    /* same-origin plates only */
  }
}

interface StyleResponse {
  style?: Record<string, string>;
  plates?: PlateRow[];
}

const platePath = (id: string, path: string) => `/api/video/${encodeURIComponent(slug() || '')}/plates/${encodeURIComponent(id)}/${path}`;

export function queueStyle(id: string, name: string, value: string | null): void {
  ed.pendingStyle.set(name, value);
  scheduleStylePreview(id);
  clearTimeout(ed.styleTimers.get(id));
  ed.styleTimers.set(
    id,
    setTimeout(() => void flushStyle(id), 380),
  );
}

async function flushStyle(id: string): Promise<void> {
  const style = Object.fromEntries(ed.pendingStyle);
  ed.pendingStyle.clear();
  try {
    await flushAllContentPending();
    const r = await api<StyleResponse>(platePath(id, 'style'), { method: 'POST', body: { style } });
    const info = plateInfo(id);
    if (info) info.style = r.style || {};
    if (r.plates) setHtmlPlates(r.plates, { video: false });
    ed.dirtyRender = true;
    paintStatus();
    markStyleRows(id);
    renderClipsTrack();
    // `scheduleStylePreview` already restarted the plate on these values 160ms ago. Restarting
    // again when the save lands is the second flash on every slider drag — do it only when that
    // earlier preview had to stand down (text mode, a load in flight).
    if (ed.needsPlateResync === id) refreshPlatePreview(id);
  } catch (err) {
    toast('Style not saved', errMessage(err), 'err');
  }
}

export function markStyleRows(id: string): void {
  const style = plateInfo(id)?.style || {};
  document.querySelectorAll<HTMLElement>('#inspectorRoot [data-var]').forEach((row) => {
    const name = row.dataset['var'] || '';
    const set = style[name] != null;
    row.classList.toggle('is-set', set);
    const slot = row.querySelector('.var-reset');
    if (slot && row.classList.contains('var-row')) {
      slot.outerHTML = set
        ? `<button type="button" class="var-reset" data-var-reset="${name}" title="Back to the brand value">${ICONS['reset']}</button>`
        : '<i class="var-reset"></i>';
    }
  });
}

export async function resetVar(id: string, name: string): Promise<void> {
  try {
    await flushAllContentPending();
    const r = await api<StyleResponse>(platePath(id, 'style'), { method: 'POST', body: { style: { [name]: null } } });
    const info = plateInfo(id);
    if (info) info.style = r.style || {};
    ed.dirtyRender = true;
    applyVar(name, null);
    await reloadPlate(id);
    refreshPlatePreview(id);
  } catch (err) {
    toast('Reset failed', errMessage(err), 'err');
  }
}

export interface PlateApiResponse extends StyleResponse {
  motion?: Record<string, string | undefined>;
  overrides?: string[];
  layout?: string | null;
  look?: Partial<ResolvedLook> & { vars?: Record<string, string> };
}

export async function plateApi(
  id: string,
  path: string,
  body: Record<string, unknown>,
  okMsg: string | null,
  { reload = true }: { reload?: boolean } = {},
): Promise<PlateApiResponse | null> {
  try {
    await flushAllContentPending();
    const r = await api<PlateApiResponse>(platePath(id, path), { method: 'POST', body });
    const info = plateInfo(id);
    if (info) {
      if (path === 'motion') {
        info.motion = r.motion || {};
        info.overrides = r.overrides || [];
      } else {
        info.style = r.style || {};
        if (path === 'layout') info.layout = r.layout ?? null;
      }
    }
    if (r.plates) setHtmlPlates(r.plates, { video: false });
    ed.dirtyRender = true;
    paintStatus();
    if (reload) await reloadPlate(id);
    if (okMsg) flashHint(okMsg);
    return r;
  } catch (err) {
    toast('Not saved', errMessage(err), 'err');
    return null;
  }
}

// ─── Look (per-plate motion overrides) ──────────────────────────────────────────────────
// The pick lands on the live plate the moment it is made: energy, depth and sheen are CSS
// variables, a title reveal is an attribute. The server rebuild runs behind it and the frame
// reloads only when the markup itself changed (another atmosphere shader, cascade letters).
export const LOOK_KEYS = ['atmosphere', 'titleReveal', 'depth', 'energy', 'sheen'];
let lookGen = 0;
const normAtm = (a: unknown) => (!a || a === 'none' ? 'none' : a);

type ResolvedLook = Record<string, string | null>;

export function plateDoc(id: string): Document | null {
  if (!plateReady(id)) return null;
  try {
    return $<HTMLIFrameElement>('plateFrame')?.contentDocument || null;
  } catch {
    return null;
  }
}

type RuntimeWindow = Window & {
  __plateRuntime?: {
    field?: string | null;
    syncTitles?: () => void;
    tuneField?: (patch: { opacity?: number | undefined; speed?: number | undefined; drift?: number | undefined }) => void;
  };
};

export function frameLook(doc: Document | null): { atmosphere: string | null; titleReveal: string | null } {
  const title = doc?.querySelector<HTMLElement>('.title[data-reveal]');
  let atmosphere: string | null = null;
  try {
    atmosphere = (doc?.defaultView as RuntimeWindow | null | undefined)?.__plateRuntime?.field ?? null;
  } catch {
    /* same-origin plates only */
  }
  return { atmosphere, titleReveal: title ? (title.dataset['reveal'] ?? null) : null };
}

/** The look a key resolves to on this plate: its override, or the video's motion. */
export function lookValue(info: Pick<DeckPlate, 'motion'> | null, key: string): string | null {
  const own = (info?.motion as Record<string, unknown> | undefined)?.[key];
  const vid = ((desk.get().video as { motion?: Record<string, unknown> } | null)?.motion || {});
  if (key === 'sheen') {
    const v = own ?? vid['sheen'];
    return v === false ? 'off' : 'on';
  }
  return ((own ?? vid[key] ?? null) as string | null) ?? null;
}

export function paintLook(doc: Document | null, vars: Record<string, string> | null | undefined, titleReveal: string | null | undefined): void {
  if (!doc) return;
  for (const [name, value] of Object.entries(vars || {})) applyVar(name, value);
  // `retargetTitleReveal` also sheds the markup and host styles the previous reveal left, so the
  // new one is not blocked by the `:has()` guards in plates.css or by a stranded letter-spacing.
  if (titleReveal) retargetTitleReveal(doc, titleReveal);
  try {
    (doc.defaultView as RuntimeWindow | null)?.__plateRuntime?.syncTitles?.();
  } catch {
    /* same-origin plates only */
  }
}

/** Paint CSS look tokens onto the live frame (Direction panel and Look share this). */
export function paintLookVars(vars: Record<string, string> | null | undefined, titleReveal?: string | null): void {
  try {
    paintLook($<HTMLIFrameElement>('plateFrame')?.contentDocument ?? null, vars, titleReveal);
    refreshPlatePreview(desk.get().activePlateId || curClip()?.plateId);
  } catch {
    /* same-origin plates only */
  }
}

/**
 * Presence/Speed live on the stage at once: these are plain numbers baked into the field's draw
 * call (see `kit/lib/atmosphere.mjs`), not CSS, but the runtime exposes `tuneField` precisely so
 * dragging a slider repaints the field in place instead of waiting on a rebuild + reload.
 */
export function tuneAtmosphereLive(opacity: number | undefined, speed: number | undefined): void {
  try {
    const win: RuntimeWindow | null | undefined = $<HTMLIFrameElement>('plateFrame')?.contentWindow;
    win?.__plateRuntime?.tuneField?.({ opacity, speed });
  } catch {
    /* same-origin plates only */
  }
}

/** The atmosphere pattern baked into the plate frame on stage right now — `null` off-stage. */
export function frameAtmosphereOnStage(): string | null {
  return frameLook(plateDoc(desk.get().activePlateId || curClip()?.plateId || '')).atmosphere;
}

/** Markup family for a title reveal. Mirrors `revealMarkup` in kit/lib/titleReveal.mjs. */
function revealMarkupKind(id: string | null | undefined): 'chars' | 'wipe' | 'words' | 'plain' {
  if (id === 'cascade') return 'chars';
  if (id === 'wipe') return 'wipe';
  if (!id || id === 'rise') return 'words';
  return 'plain';
}

/**
 * Does moving a title from `from` to `to` need new markup?
 * Open, close and statement bake the family into the title. Other plates only
 * bake cascade letters — rise, wipe and the plain templates share one title.
 */
function revealNeedsMarkup(id: string, from: string | null | undefined, to: string | null | undefined): boolean {
  if (from === to) return false;
  const shaped = id === 'open' || id === 'close' || plateInfo(id)?.type === 'statement';
  if (!shaped) return revealMarkupKind(from) === 'chars' || revealMarkupKind(to) === 'chars';
  return revealMarkupKind(from) !== revealMarkupKind(to);
}

/** Resolved look of a patch laid on the plate's current overrides — what the frame should show right now. */
export function guessLook(info: Pick<DeckPlate, 'motion'> | null, patch: Record<string, unknown>): ResolvedLook {
  const next: Record<string, unknown> = patch['reset'] ? Object.fromEntries(LOOK_KEYS.map((k) => [k, null])) : patch;
  const out: ResolvedLook = Object.fromEntries(LOOK_KEYS.map((k) => [k, lookValue(info, k)]));
  for (const [key, raw] of Object.entries(next)) {
    if (!LOOK_KEYS.includes(key)) continue;
    const value = raw as string | number | boolean | null | undefined;
    out[key] = value == null || value === '' ? lookValue({ motion: {} }, key) : String(value);
  }
  return out;
}

function sameVars(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if ((a[key] || '') !== (b[key] || '')) return false;
  return true;
}

function lookVarsFor(look: ResolvedLook): Record<string, string> {
  const table = desk.get().video?.motionOptions?.lookVars || {};
  const vars: Record<string, string> = {};
  for (const key of ['energy', 'depth', 'sheen', 'titleReveal']) Object.assign(vars, table[key]?.[look[key] ?? ''] || {});
  return vars;
}

interface LookHover {
  id: string;
  doc: Document;
  /** Inline values on the frame before the first hover touched each token (null: unset). */
  before: Map<string, string | null>;
  reveal: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}
let hover: LookHover | null = null;

/**
 * Hovering a look tile tries it on the stage: the tokens paint at once and, after a short dwell,
 * the plate replays its intro so energy and title reveals read as motion. Nothing is saved and
 * the playhead stays put. Backgrounds need a rebuild, so their tiles preview themselves instead.
 */
export function hoverLook(id: string, key: string, value: string | null): void {
  if (key === 'atmosphere' || ed.playing || ed.textMode || ed.loadingPlate === id) return;
  const doc = plateDoc(id);
  if (!doc?.documentElement || !playheadOnPlate(curClip(), id)) return;
  const info = plateInfo(id);
  const now = guessLook(info, {});
  const want = guessLook(info, { [key]: value });
  if (!hover || hover.id !== id || hover.doc !== doc) hover = { id, doc, before: new Map(), reveal: frameLook(doc).titleReveal, timer: null };
  const h = hover;
  const vars = lookVarsFor(want);
  for (const name of Object.keys(vars)) if (!h.before.has(name)) h.before.set(name, doc.documentElement.style.getPropertyValue(name) || null);
  for (const [name, was] of h.before) if (!(name in vars)) applyVar(name, was);
  paintLook(doc, vars, revealNeedsMarkup(id, now['titleReveal'], want['titleReveal']) ? h.reveal : want['titleReveal']);
  if (h.timer) clearTimeout(h.timer);
  h.timer = setTimeout(() => {
    if (hover !== h || !P.restart?.(0)) return;
    for (const a of doc.getAnimations?.() || []) a.play();
  }, 240);
}

/** Pointer left the tiles: put the frame back exactly as it was. */
export function endHoverLook(): void {
  const h = hover;
  hover = null;
  if (!h) return;
  if (h.timer) clearTimeout(h.timer);
  if (plateDoc(h.id) !== h.doc) return;
  for (const [name, was] of h.before) applyVar(name, was);
  paintLook(h.doc, {}, h.reveal);
  refreshPlatePreview(h.id);
}

/** A tile was picked: the hover becomes the new look, so there is nothing to put back. */
export function commitHoverLook(): void {
  if (hover?.timer) clearTimeout(hover.timer);
  hover = null;
}

export async function changeLook(id: string, patch: Record<string, unknown>): Promise<void> {
  const gen = ++lookGen;
  const info = plateInfo(id);
  const was = { atmosphere: lookValue(info, 'atmosphere'), titleReveal: lookValue(info, 'titleReveal') };
  const want = guessLook(info, patch);

  // 1. Optimistic paint from the table that shipped with the video — the pick shows this frame.
  const doc = plateDoc(id);
  if (doc) {
    const vars = lookVarsFor(want);
    // Always move the title onto the new reveal, even when the rebuild will re-bake its markup:
    // holding the old attribute back left the stage playing the reveal the author just replaced
    // for as long as the save took, and forever when the frame could not be reloaded.
    paintLook(doc, vars, want['titleReveal']);
    refreshPlatePreview(id);
  }

  // 2. Save; the response carries the resolved look, so the frame ends on exactly what render will use.
  const r = await plateApi(id, 'motion', patch, patch['reset'] ? 'Back to the video look' : 'Look updated', { reload: false });
  if (!r || gen !== lookGen) return;
  const look: ResolvedLook & { vars?: Record<string, string> } = { ...want, ...(r.look || {}) } as ResolvedLook & { vars?: Record<string, string> };
  // Let a reload already in flight land first; several quick picks share one.
  while (ed.loadingPlate === id && gen === lookGen) await new Promise((done) => setTimeout(done, 40));
  if (gen !== lookGen) return;
  const after = plateDoc(id);
  const onStage = frameLook(after);
  // Reload when the pick needs new markup, or when the frame on stage is already out of date
  // (stale HTML from an earlier rebuild that skipped the load).
  const markupChanged =
    normAtm(look['atmosphere']) !== normAtm(was.atmosphere) ||
    normAtm(look['atmosphere']) !== normAtm(onStage.atmosphere) ||
    revealNeedsMarkup(id, was.titleReveal, look['titleReveal']) ||
    (onStage.titleReveal != null &&
      look['titleReveal'] != null &&
      onStage.titleReveal !== look['titleReveal'] &&
      revealNeedsMarkup(id, onStage.titleReveal, look['titleReveal']));
  if (after && !markupChanged) {
    const resolved = look.vars || {};
    // The click already painted this and restarted the plate. Doing it again when the save
    // lands is the second flash.
    const already =
      Boolean(doc) && sameVars(lookVarsFor(want), resolved) && (look['titleReveal'] ?? null) === (want['titleReveal'] ?? null);
    if (!already) {
      paintLook(after, resolved, look['titleReveal']);
      refreshPlatePreview(id);
    }
  } else if (
    canReloadPlateFrame({
      dirty: P.dirty(),
      activePlateId: desk.get().activePlateId,
      plateId: id,
      playheadPlateId: curClip()?.plateId || null,
    })
  ) {
    // The reload parks the new frame before it is shown. A second restart would flash it.
    dropPreloadedPlates(id);
    await reloadPlate(id, { paint: false });
  }
  // Off stage, or the HTML itself changed while the playhead sits elsewhere: the next visit shows the rebuilt plate.
  else {
    ed.stalePlates.add(id);
    markPlateResync(id);
  }
  if (gen !== lookGen) return;
  if (ed.sel?.type === 'clip' && ed.seq.find((c) => c.id === ed.sel?.id)?.plateId === id) {
    paintInspectorUnlessContentTyping(renderInspector);
  }
}

/** Every plate's HTML changed (Direction, palette, Apply motion) — drop the ready cache and reload the one on stage. */
export function invalidatePlates(): Promise<void> | null {
  for (const c of ed.seq || []) if (c.plateId) ed.stalePlates.add(c.plateId);
  lookGen += 1;
  clearPlatePreviewTimers();
  const id = desk.get().activePlateId || curClip()?.plateId;
  // Same as changeLook — drop the back buffer so a scrub-back cannot revive pre-look HTML.
  if (id) dropPreloadedPlates(id);
  else dropPreloadedPlates();
  if (ed.active && id) return flushAllContentPending().then(() => reloadPlate(id));
  return null;
}

export function previewRange(fromEd: number, toEd: number): void {
  seek(Math.max(0, fromEd - 0.8));
  play();
  ed.stopAt = Math.min(ed.total, toEd + 0.8);
}

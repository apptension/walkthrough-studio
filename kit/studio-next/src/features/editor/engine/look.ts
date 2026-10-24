import { api } from '@/desk/api';
import { desk } from '@/desk/store';
import { toast } from '@/desk/toast';
import { canReloadPlateFrame, playheadOnPlate, plateClipFor, previewClockMs, shouldParkPlayheadAtClipStart } from '@/logic/plateSync';

import { paintStatus } from './edits';
import { renderInspector } from './inspector';
import { reloadPlate } from './lifecycle';
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
  const ms = previewClockMs(clip, ed.t, { fromStart, onPlate });
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
    const r = await api<StyleResponse>(platePath(id, 'style'), { method: 'POST', body: { style } });
    const info = plateInfo(id);
    if (info) info.style = r.style || {};
    if (r.plates) setHtmlPlates(r.plates, { video: false });
    ed.dirtyRender = true;
    paintStatus();
    markStyleRows(id);
    renderClipsTrack();
    refreshPlatePreview(id);
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

type RuntimeWindow = Window & { __plateRuntime?: { field?: string | null; syncTitles?: () => void } };

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
  if (titleReveal) doc.querySelectorAll<HTMLElement>('.title[data-reveal]').forEach((t) => (t.dataset['reveal'] = titleReveal));
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

export async function changeLook(id: string, patch: Record<string, unknown>): Promise<void> {
  const gen = ++lookGen;
  const info = plateInfo(id);
  const table = desk.get().video?.motionOptions?.lookVars || {};
  const was = { atmosphere: lookValue(info, 'atmosphere'), titleReveal: lookValue(info, 'titleReveal') };
  const want = guessLook(info, patch);

  // 1. Optimistic paint from the table that shipped with the video — the pick shows this frame.
  const doc = plateDoc(id);
  if (doc) {
    const vars: Record<string, string> = {};
    for (const key of ['energy', 'depth', 'sheen', 'titleReveal']) Object.assign(vars, table[key]?.[want[key] ?? ''] || {});
    paintLook(doc, vars, revealNeedsMarkup(id, was.titleReveal, want['titleReveal']) ? null : want['titleReveal']);
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
    paintLook(after, look.vars || {}, look['titleReveal']);
    refreshPlatePreview(id);
  } else if (
    canReloadPlateFrame({
      dirty: P.dirty(),
      activePlateId: desk.get().activePlateId,
      plateId: id,
      playheadPlateId: curClip()?.plateId || null,
    })
  ) {
    await reloadPlate(id);
    refreshPlatePreview(id);
  }
  // Off stage, or the HTML itself changed while the playhead sits elsewhere: the next visit shows the rebuilt plate.
  else {
    ed.stalePlates.add(id);
    markPlateResync(id);
  }
  if (gen !== lookGen) return;
  if (ed.sel?.type === 'clip' && ed.seq.find((c) => c.id === ed.sel?.id)?.plateId === id) renderInspector();
}

/** Every plate's HTML changed (Direction, palette, Apply motion) — drop the ready cache and reload the one on stage. */
export function invalidatePlates(): Promise<void> | null {
  for (const c of ed.seq || []) if (c.plateId) ed.stalePlates.add(c.plateId);
  lookGen += 1;
  clearPlatePreviewTimers();
  const id = desk.get().activePlateId || curClip()?.plateId;
  if (ed.active && id) return reloadPlate(id);
  return null;
}

export function previewRange(fromEd: number, toEd: number): void {
  seek(Math.max(0, fromEd - 0.8));
  play();
  ed.stopAt = Math.min(ed.total, toEd + 0.8);
}

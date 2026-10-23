import { showRightTab } from '@/desk/panels';
import { desk } from '@/desk/store';
import { toast } from '@/desk/toast';
import { clampZoomCenter } from '@/logic/zoomAim';

import { paintLensBox, paintZoomBox, selectedShot } from './aim';
import { addVoiceLine, withMusic, withVoice } from './audio';
import { postDeck } from './data';
import { renderInspector } from './inspector';
import { curClip, edToRec, recToEd, selectedLens } from './seq';
import { renderFrame } from './stage';
import { audioDesk, deckEdit, ed, liveH, liveW, type FxItem } from './state';
import { paintTextMode } from './text';
import { paintSelection, paintTools, renderAudioTracks, renderCardTracks, renderClipsTrack, renderFxTracks } from './timeline';
import { pause, seek } from './transport';
import type { Deck, DeckLens, Lens, Selection, ZoomShot } from './types';
import { $, ICONS, clamp, fmtRate, r3 } from './util';

/** Edits (add / adopt / remove), toolbar tools, selection and the status pill from `kit/studio/editor.js`. */

export async function addRamp(from: number, to: number, rate: number): Promise<void> {
  const speed = [...deckEdit().speed.filter((r) => r.to <= from + 0.001 || r.from >= to - 0.001), { from: r3(from), to: r3(to), rate }];
  const r = await postDeck({ speed }, { hint: `${fmtRate(rate)} speed added` });
  if (r) {
    const i = deckEdit().speed.findIndex((x) => Math.abs(x.from - from) < 0.01);
    if (i >= 0) select({ type: 'ramp', i });
  }
}

export async function addZoomAt(t: number, dur = 3.5, zoom?: number): Promise<void> {
  const c = ed.seq.find((x) => x.kind === 'live' && t >= x.recFrom && t <= x.recTo) || curClip();
  if (!c || c.kind !== 'live' || !ed.deck) return;
  const levels = ed.deck.zoomLevels || {};
  const minZoomSec = ed.deck.ranges?.minZoomSec ?? 0;
  const level = zoom || levels[ed.deck.camera?.['zoom'] ?? ''] || 1.6;
  const start = clamp(t, c.recFrom, Math.max(c.recFrom, c.recTo - minZoomSec));
  const length = clamp(dur, minZoomSec, c.recTo - start);
  const id = `z${Math.round(start * 10)}`;
  const zooms = [...deckEdit().zooms.filter((z) => z.id !== id), { id, t: r3(start), dur: r3(length), zoom: level, x: liveW() / 2, y: liveH() / 2 }];
  const r = await postDeck({ zooms }, { hint: 'Zoom added — drag the box on the stage to aim it' });
  if (r) {
    select({ type: 'zoom', key: id });
    seek(recToEd(c, start + Math.min(1, length / 2)));
  }
}

/** A new magnifier, aimed at the nearest click or typing in the clip when there is one. */
export async function addLensAt(t: number, dur = 2.6): Promise<void> {
  const c = ed.seq.find((x) => x.kind === 'live' && t >= x.recFrom && t <= x.recTo) || curClip();
  if (!c || c.kind !== 'live' || !ed.deck) return;
  const min = ed.deck.ranges?.minLensSec || 1;
  const start = clamp(t, c.recFrom, Math.max(c.recFrom, c.recTo - min));
  const length = clamp(dur, min, Math.max(min, c.recTo - start));
  const W = liveW();
  const H = liveH();
  const near = (ed.deck.marks || [])
    .filter((m) => (m.kind === 'click' || m.kind === 'type') && Number.isFinite(m.x) && m.t >= c.recFrom && m.t <= c.recTo)
    .sort((a, b) => Math.abs(a.t - start - length / 2) - Math.abs(b.t - start - length / 2))[0];
  const aim =
    near && Math.abs(near.t - start - length / 2) < 4 ? { x: Math.round(near.x ?? 0), y: Math.round(near.y ?? 0) } : { x: W / 2, y: H / 2 };
  const id = `m${Math.round(start * 10)}`;
  const lenses = [...deckEdit().lenses.filter((l) => l.id !== id), { id, t: r3(start), dur: r3(length), ...aim, w: 220, h: 56 }];
  const r = await postDeck(
    { lenses },
    { hint: near ? 'Magnifier added on the nearest click — drag it on the stage to aim' : 'Magnifier added — drag it on the stage to aim' },
  );
  if (r) {
    select({ type: 'lens', key: `edit:${id}` });
    seek(recToEd(c, start + Math.min(1.1, length / 2)));
  }
}

export async function adoptLens(lens: Lens, over: Partial<DeckLens> = {}): Promise<void> {
  const t = r3(over.t ?? lens.t);
  const id = `m${Math.round(t * 10)}`;
  const d = deckEdit();
  const lenses: DeckLens[] = [
    ...d.lenses.filter((l) => l.id !== id),
    {
      id,
      t,
      dur: r3(over.dur ?? lens.dur),
      x: Math.round(over.x ?? lens.rect.x + lens.rect.w / 2),
      y: Math.round(over.y ?? lens.rect.y + lens.rect.h / 2),
      w: Math.round(over.w ?? lens.rect.w),
      h: Math.round(over.h ?? lens.rect.h),
      ...(lens.label ? { label: lens.label } : {}),
    },
  ];
  const lensOff = [...new Set([...d.lensOff, r3(lens.t)])];
  const r = await postDeck({ lenses, lensOff }, { hint: 'That magnifier is yours now' });
  if (r) select({ type: 'lens', key: `edit:${id}` });
}

export async function adoptShot(shot: ZoomShot, over: { x?: number; y?: number; zoom?: number; t?: number; dur?: number } = {}): Promise<void> {
  const W = liveW();
  const H = liveH();
  const p = shot.points?.[0] || { cx: W / 2, cy: H / 2 };
  const zoom = over.zoom ?? shot.zoom;
  const aim = clampZoomCenter(over.x ?? p.cx, over.y ?? p.cy, { zoom, width: W, height: H });
  const id = `z${Math.round((over.t ?? shot.start) * 10)}`;
  const d = deckEdit();
  const zooms = [
    ...d.zooms.filter((z) => z.id !== id),
    { id, t: r3(over.t ?? shot.start), dur: r3(over.dur ?? shot.end - shot.start), zoom, x: aim.cx, y: aim.cy },
  ];
  const zoomSkips = [...d.zoomSkips, { from: shot.start, to: shot.end }];
  const r = await postDeck({ zooms, zoomSkips }, { hint: 'That zoom is yours now' });
  if (r) select({ type: 'zoom', key: id });
}

export async function omitClip(id: string | null | undefined): Promise<Deck | null> {
  if (!id || ed.seq.length <= 1) {
    toast('Keep at least one section', 'The cut needs something to play', 'warn');
    return null;
  }
  const d = deckEdit();
  const omit = [...new Set([...(d.omit || []), id])];
  const order = (d.order || []).filter((x) => x !== id);
  return postDeck({ omit, order }, { hint: 'Section removed from the cut' });
}

export async function restoreOmitted(id: string): Promise<Deck | null> {
  const d = deckEdit();
  const omit = (d.omit || []).filter((x) => x !== id);
  const r = await postDeck({ omit }, { hint: 'Section restored' });
  if (r) {
    const c = ed.seq.find((x) => x.id === id) || curClip();
    if (c) seek(c.at + Math.min(0.12, c.dur * 0.25));
    select(c ? { type: 'clip', id: c.id } : null);
  }
  return r;
}

export async function removeSelected(): Promise<void> {
  const s = ed.sel;
  const d = deckEdit();
  if (!s) return;
  if (s.type === 'clip') {
    const r = await omitClip(s.id);
    if (r) {
      // Follow the remapped playhead — do not yank selection to the first clip.
      const pick = curClip() || ed.seq[0] || null;
      select(pick ? { type: 'clip', id: pick.id } : null);
    }
    return;
  }
  if (s.type === 'cut') {
    await postDeck({ cuts: (d.cuts || []).filter((_, i) => i !== s.i) }, { hint: 'Stretch restored' });
    const c = curClip();
    select(c ? { type: 'clip', id: c.id } : null);
    return;
  }
  if (s.type === 'ramp') await postDeck({ speed: d.speed.filter((_, i) => i !== s.i) }, { hint: 'Speed change removed' });
  else if (s.type === 'skip') await postDeck({ zoomSkips: d.zoomSkips.filter((_, i) => i !== s.i) }, { hint: 'Auto zoom allowed again' });
  else if (s.type === 'zoom') {
    const shot = selectedShot();
    if (!shot) return;
    if (shot.source === 'auto') await postDeck({ zoomSkips: [...d.zoomSkips, { from: shot.start, to: shot.end }] }, { hint: 'Auto zoom removed' });
    else await postDeck({ zooms: d.zooms.filter((z) => z.id !== shot.id) }, { hint: 'Zoom removed' });
  } else if (s.type === 'ride') {
    const rides = audioDesk().music.rides.filter((_, i) => i !== s.i);
    await withMusic({ rides }, 'Ride removed');
  } else if (s.type === 'voice') {
    await withVoice(s.key ?? '', { mute: true }, 'Line muted');
  } else if (s.type === 'lens') {
    const l = selectedLens();
    if (!l || l.source === 'off') return;
    if (l.source === 'auto') await postDeck({ lensOff: [...d.lensOff, r3(l.t)] }, { hint: 'Recorded magnifier switched off' });
    else await postDeck({ lenses: d.lenses.filter((x) => x.id !== l.id) }, { hint: 'Magnifier removed' });
  } else if (s.type !== 'range') return;
  const c = curClip();
  select(c ? { type: 'clip', id: c.id } : null);
}

export async function addCut(from: number, to: number): Promise<Deck | null> {
  if (!(to - from >= 0.2)) {
    toast('Cut is too short', 'Drag a longer stretch — at least 0.2s', 'warn');
    return null;
  }
  const cuts = [...(deckEdit().cuts || []), { from: r3(from), to: r3(to) }];
  const r = await postDeck({ cuts }, { hint: `${(to - from).toFixed(1)}s cut from the recording` });
  if (r) {
    const i = (deckEdit().cuts || []).findIndex((c) => c.from <= from + 0.05 && c.to >= to - 0.05);
    if (i >= 0) select({ type: 'cut', i });
  }
  return r;
}

export function toolCut(): Promise<Deck | null> | void {
  const s = ed.sel;
  if (s?.type === 'range') return addCut(s.from ?? 0, s.to ?? 0);
  const c = curClip();
  if (c?.kind !== 'live') return toast('Move onto the recording', 'Cuts remove a stretch of the screen recording', 'warn');
  const from = edToRec(c, ed.t);
  const to = Math.min(c.recTo, from + 2);
  if (to - from < 0.35) return toast('Too close to the end', 'Move the playhead earlier, or drag the stretch on the Cut row', 'warn');
  return addCut(from, to);
}

export function toolSpeed(): Promise<void> | void {
  const s = ed.sel;
  if (s?.type === 'range') return addRamp(s.from ?? 0, s.to ?? 0, 2);
  const c = curClip();
  if (c?.kind !== 'live') return;
  const from = edToRec(c, ed.t);
  const to = Math.min(c.recTo, from + 4);
  if (to - from < (ed.deck?.ranges?.minRampSec ?? 0)) return toast('Too close to the end', 'Move the playhead earlier in the clip', 'warn');
  return addRamp(from, to, 2);
}

export function toolZoom(): Promise<void> | void {
  const s = ed.sel;
  if (s?.type === 'range') return addZoomAt(s.from ?? 0, (s.to ?? 0) - (s.from ?? 0));
  const c = curClip();
  if (c?.kind !== 'live') return;
  return addZoomAt(edToRec(c, ed.t));
}

export function toolLens(): Promise<void> | void {
  const s = ed.sel;
  if (s?.type === 'range') return addLensAt(s.from ?? 0, (s.to ?? 0) - (s.from ?? 0));
  const c = curClip();
  if (c?.kind !== 'live') return;
  return addLensAt(edToRec(c, ed.t));
}

/** Create a blank ad-lib voice line at the playhead and select it. */
export async function toolVoice(): Promise<Deck | null> {
  if (ed.playing) pause();
  return addVoiceLine({ text: '' });
}

// ─── Selection ───────────────────────────────────────────────────────────────────────────
/** Change what is selected without painting — for callers whose next deck paint draws it. */
export function setSelection(sel: Selection | null): void {
  ed.sel = sel;
  ed.aim = null;
  ed.aimZoom = null;
  ed.lensAim = null;
}

export function select(sel: Selection | null): void {
  setSelection(sel);
  renderClipsTrack();
  renderCardTracks();
  renderFxTracks();
  renderAudioTracks();
  paintSelection();
  paintTools();
  paintZoomBox();
  paintLensBox();
  renderFrame();
  paintTextMode();
  renderInspector();
  showInspectorTab();
}

export function selectFx(item: FxItem): void {
  if (item.kind === 'ramp') select({ type: 'ramp', ...(item.i != null ? { i: item.i } : {}) });
  else if (item.kind === 'skip') select({ type: 'skip', ...(item.i != null ? { i: item.i } : {}) });
  else if (item.kind === 'lens') {
    select({ type: 'lens', ...(item.key != null ? { key: item.key } : {}) });
    const c = ed.seq.find((x) => x.kind === 'live' && item.from >= x.recFrom - 0.01 && item.from <= x.recTo);
    if (c) seek(recToEd(c, item.from + Math.min(1.1, (item.to - item.from) / 2)));
  } else {
    select({ type: 'zoom', ...(item.key != null ? { key: item.key } : {}) });
    const c = ed.seq.find((x) => x.kind === 'live' && item.from >= x.recFrom - 0.01 && item.from <= x.recTo);
    if (c) seek(recToEd(c, item.shot?.points?.[0]?.t ?? item.from + Math.min(1, (item.to - item.from) / 2)));
  }
}

/** The legacy clicked `.tools-panel .ptab[data-right="inspector"]` when it was not already active. */
export function showInspectorTab(): void {
  if (desk.get().rightTab !== 'inspector') showRightTab('inspector');
}

// ─── Status ──────────────────────────────────────────────────────────────────────────────
export function paintStatus(): void {
  const el = $('edStatus');
  if (!el || !ed.deck) return;
  const picture = ed.deck.stale || ed.dirtyRender;
  const mix = Boolean(ed.deck.audioStale);
  el.hidden = false;
  el.className = `ed-status${picture || mix ? ' is-stale' : ''}`;
  const renderBtn = `<button type="button" class="ed-render" data-act="render" title="Render the video with these edits">${ICONS['render']}Render</button>`;
  const mixBtn = `<button type="button" class="ed-render" data-act="mix" title="Mix voice and music with these levels">${ICONS['music']}Mix</button>`;
  el.innerHTML = picture
    ? `<span class="ed-dot"></span><span class="ed-status-text">Not in the video yet</span>${renderBtn}${mix ? mixBtn : ''}`
    : mix
      ? `<span class="ed-dot"></span><span class="ed-status-text">Not in the mix yet</span>${mixBtn}`
      : `${ICONS['check']}<span class="ed-status-text">Video is up to date</span>`;
  el.title = ed.deck.summary || '';
}

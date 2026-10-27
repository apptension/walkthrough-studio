import { api } from '@/desk/api';
import { toast } from '@/desk/toast';
import { cardMarkDuration, cardMarkKey } from '@/logic/liveCardStage';
import { clampZoomCenter } from '@/logic/zoomAim';

import { selectedShot } from './aim';
import { applyVoiceDeck, withMusic } from './audio';
import { postDeck, refresh } from './data';
import { select } from './edits';
import { flushEditorContentPending } from './plateContentPane';
import { lensByKey, recToEd, selectedLens, shotKey } from './seq';
import { joinStyle } from './stage';
import { audioDesk, deckEdit, ed, live, liveH, liveW, setHtmlPlates, slug } from './state';
import { flashHint } from './timeline';
import { pause, seek } from './transport';
import type { CardTiming, Clip, Deck, DeckLens, DeckMark, PlateRow, Span } from './types';
import { errMessage, r3 } from './util';

/**
 * Duplicate — every timeline element can be copied, and each copy lands where it makes sense:
 * effects and cards go to the next free stretch after the original on their own row; a voice
 * line or a music ride follows its original; a section (clip, plate, or a picked stretch)
 * plays again right after itself (`edit.repeats`, sharing the footage or plate file); a
 * transition is applied to the next join. ⌘D or the Duplicate button.
 */

export interface DupState {
  ok: boolean;
  /** What the button says / the tooltip names. */
  label: string;
  /** Why it is off, when it is. */
  why?: string;
}

const GAP = 0.25;
const OFF = (label: string, why: string): DupState => ({ ok: false, label, why });

export function canDuplicate(sel = ed.sel): DupState {
  if (!sel) return OFF('Duplicate', 'Select something on the timeline first');
  switch (sel.type) {
    case 'clip': {
      const c = ed.seq.find((x) => x.id === sel.id);
      if (!c) return OFF('Duplicate', 'That section is gone');
      return { ok: true, label: c.kind === 'plate' ? 'Duplicate plate' : 'Duplicate section' };
    }
    case 'range':
      return (sel.to ?? 0) - (sel.from ?? 0) >= 0.4 ? { ok: true, label: 'Duplicate stretch' } : OFF('Duplicate stretch', 'Pick at least 0.4s');
    case 'card':
      return { ok: true, label: 'Duplicate card' };
    case 'zoom':
      return (ed.deck?.zoomShots || []).some((z) => shotKey(z) === sel.key) ? { ok: true, label: 'Duplicate zoom' } : OFF('Duplicate zoom', 'That zoom is gone');
    case 'lens': {
      const l = lensByKey(sel.key);
      if (!l) return OFF('Duplicate magnifier', 'That magnifier is gone');
      return l.source === 'off' ? OFF('Duplicate magnifier', 'Turn it back on first') : { ok: true, label: 'Duplicate magnifier' };
    }
    case 'ramp':
      return { ok: true, label: 'Duplicate speed change' };
    case 'skip':
      return { ok: true, label: 'Duplicate no-zoom stretch' };
    case 'cut':
      return { ok: true, label: 'Duplicate cut' };
    case 'voice':
      return { ok: true, label: 'Duplicate voice line' };
    case 'ride':
      return { ok: true, label: 'Duplicate ride' };
    case 'join':
      return { ok: true, label: 'Use on the next join' };
    case 'music':
    case 'mix':
      return OFF('Duplicate', 'One music bed per video — it loops to fit the cut');
    default:
      return OFF('Duplicate', 'Nothing to duplicate here');
  }
}

/**
 * Earliest start for a `len`-long copy after `after` that overlaps nothing in `busy`, stays in
 * [lo, hi] and passes `fits`. Falls back to the stretch before `before` when the tail is full.
 */
export function freeSlot(
  len: number,
  { after, before, busy, lo, hi, fits = () => true }: { after: number; before: number; busy: Span[]; lo: number; hi: number; fits?: (a: number, b: number) => boolean },
): number | null {
  const sorted = [...busy].sort((a, b) => a.from - b.from);
  const hit = (a: number) => sorted.find((s) => a < s.to - 1e-3 && s.from < a + len - 1e-3);
  let t = after + GAP;
  for (let guard = 0; guard < 4000 && t + len <= hi + 1e-6; guard++) {
    const h = hit(t);
    if (h) t = h.to + GAP;
    else if (fits(t, t + len)) return r3(t);
    else t += 0.1;
  }
  t = before - GAP - len;
  for (let guard = 0; guard < 4000 && t >= lo - 1e-6; guard++) {
    const h = hit(t);
    if (h) t = h.from - GAP - len;
    else if (fits(t, t + len)) return r3(Math.max(lo, t));
    else t -= 0.1;
  }
  return null;
}

/** A recording stretch that plays in the cut (not omitted, not cut away) from start to end. */
function inCut(a: number, b: number): boolean {
  const cuts = deckEdit().cuts || [];
  if (cuts.some((c) => a < c.to && c.from < b)) return false;
  return ed.seq.some((c) => c.kind === 'live' && a >= c.recFrom - 1e-3 && b <= c.recTo + 1e-3);
}

const recSpan = (): { lo: number; hi: number } => {
  const lives = ed.seq.filter((c) => c.kind === 'live');
  return {
    lo: lives.length ? Math.min(...lives.map((c) => c.recFrom)) : 0,
    hi: lives.length ? Math.max(...lives.map((c) => c.recTo)) : live().durationSec || 0,
  };
};

function seekRec(rec: number): void {
  const c = ed.seq.find((x) => x.kind === 'live' && rec >= x.recFrom - 0.01 && rec <= x.recTo);
  if (c) seek(recToEd(c, rec));
}

function noRoom(what: string): null {
  toast(`No room for another ${what}`, 'The row is full after and before it — move or shorten something first', 'warn');
  return null;
}

/** A recording-clock copy: find its slot among `busy`, or say there is none. */
function recSlot(what: string, from: number, to: number, busy: Span[]): number | null {
  const { lo, hi } = recSpan();
  const t = freeSlot(to - from, { after: to, before: from, busy, lo, hi, fits: inCut });
  return t == null ? noRoom(what) : t;
}

// ─── Sections ─────────────────────────────────────────────────────────────────────────────
const liveStart = (id: string): number | null => {
  const m = id.match(/^live-(\d+(?:\.\d+)?)$/);
  return m ? Number(m[1]) : null;
};

/** The planned (uncut, untrimmed) section a live clip comes from, by the recording-clock id. */
export function naturalLive(c: Clip): { id: string; from: number; to: number } | null {
  const ids = (ed.deck?.naturalIds || []).filter((id) => liveStart(id) != null);
  const id = c.repeatOf || ids.filter((x) => (liveStart(x) ?? Infinity) <= c.recFrom + 0.01).sort((a, b) => (liveStart(b) ?? 0) - (liveStart(a) ?? 0))[0];
  if (!id) return null;
  const from = liveStart(id) ?? c.recFrom;
  const next = ids.map((x) => liveStart(x) ?? 0).filter((t) => t > from + 0.01).sort((a, b) => a - b)[0];
  const pieces = ed.seq.filter((x) => x.kind === 'live' && !x.repeatOf && x.recFrom >= from - 0.01 && (next == null || x.recFrom < next - 0.01));
  const trim = (deckEdit().trims || []).find((t) => t.id === id);
  const lastTo = pieces.length ? Math.max(...pieces.map((x) => x.recTo)) : c.recTo;
  return { id, from, to: lastTo + (Number(trim?.trimEnd) || 0) };
}

function nextRepeatId(source: string): string {
  const taken = new Set([...(deckEdit().repeats || []), ...ed.seq.map((c) => c.id)]);
  let n = 2;
  while (taken.has(`${source}+${n}`)) n += 1;
  return `${source}+${n}`;
}

async function repeatSection(c: Clip, stretch: { from: number; to: number } | null = null): Promise<Deck | null> {
  const d = deckEdit();
  const nat = c.kind === 'live' ? naturalLive(c) : null;
  const source = c.kind === 'live' ? nat?.id : c.repeatOf || c.id;
  if (!source) {
    toast('Section not duplicated', 'Render once so the recording has sections', 'warn');
    return null;
  }
  const id = nextRepeatId(source);
  const repeats = [...(d.repeats || []), id];
  const patch: Record<string, unknown> = { repeats };
  if (d.order?.length) {
    const order = d.order.filter((x) => x !== id);
    const at = order.indexOf(c.id);
    order.splice(at >= 0 ? at + 1 : order.length, 0, id);
    patch['order'] = order;
  }
  const own = (d.trims || []).find((t) => t.id === source);
  if (stretch && nat) {
    const trimStart = r3(Math.max(0, stretch.from - nat.from));
    const trimEnd = r3(Math.max(0, nat.to - stretch.to));
    patch['trims'] = [...(d.trims || []).filter((t) => t.id !== id), { id, ...(trimStart ? { trimStart } : {}), ...(trimEnd ? { trimEnd } : {}) }];
  } else if (own) {
    patch['trims'] = [...(d.trims || []).filter((t) => t.id !== id), { ...own, id }];
  }
  const ownTime = c.kind === 'plate' ? (d.plateTimes || []).find((t) => t.id === c.id) : null;
  if (ownTime) patch['plateTimes'] = [...(d.plateTimes || []).filter((t) => t.id !== id), { ...ownTime, id }];
  const what = stretch ? 'That stretch plays again' : c.kind === 'plate' ? 'Plate plays again — copy edits change both' : 'Section plays again';
  const r = await postDeck(patch, { hint: `${what} right after “${c.title}”` });
  if (r) {
    const copy = ed.seq.find((x) => x.id === id) || ed.seq.find((x) => x.id.endsWith(id.slice(id.lastIndexOf('+'))) && x.repeatOf === source);
    if (copy) {
      seek(copy.at + Math.min(0.12, copy.dur * 0.25));
      select({ type: 'clip', id: copy.id });
    }
  }
  return r;
}

/** Remove a duplicated section (any of its cut pieces) from `edit.repeats`. */
export function repeatIdOf(c: Clip): string | null {
  if (!c.repeatOf) return null;
  const n = c.id.match(/\+(\d+)$/)?.[1];
  return n ? `${c.repeatOf}+${n}` : null;
}

export async function dropRepeat(c: Clip): Promise<Deck | null> {
  const id = repeatIdOf(c);
  if (!id) return null;
  const d = deckEdit();
  return postDeck(
    {
      repeats: (d.repeats || []).filter((x) => x !== id),
      order: (d.order || []).filter((x) => x !== id && x !== c.id),
      trims: (d.trims || []).filter((t) => t.id !== id),
      plateTimes: (d.plateTimes || []).filter((t) => t.id !== id),
    },
    { hint: 'Duplicate removed' },
  );
}

/** Turn a plate replay into a plate of its own, so its copy can change on its own. */
export async function detachPlate(c: Clip): Promise<Deck | null> {
  const id = repeatIdOf(c);
  if (!id || c.kind !== 'plate') return null;
  try {
    await flushEditorContentPending();
    const base = `/api/video/${encodeURIComponent(slug() || '')}`;
    const r = await api<Deck & { id: string }>(`${base}/plates/${encodeURIComponent(id)}/detach`, { method: 'POST' });
    const listed = await api<{ plates?: PlateRow[] }>(`${base}/plates`).catch(() => null);
    if (listed?.plates) setHtmlPlates(listed.plates);
    await refresh();
    const own = ed.seq.find((x) => x.plateId === r.id);
    if (own) select({ type: 'clip', id: own.id });
    flashHint('Its own plate now — edit its copy freely');
    return r;
  } catch (err) {
    toast('Plate not separated', errMessage(err), 'err');
    return null;
  }
}

// ─── Cards ────────────────────────────────────────────────────────────────────────────────
async function duplicateCard(): Promise<Deck | null> {
  const s = ed.sel;
  const marks = ed.deck?.marks || [];
  const mark = marks.find((m) => (m.kind === 'chapter' || m.kind === 'caption') && (m.key || cardMarkKey(m)) === s?.key);
  if (!mark) return null;
  const srcKey = mark.copyOf || mark.key || cardMarkKey(mark);
  const dur = cardMarkDuration(mark);
  const busy = marks.filter((m) => m.kind === mark.kind).map((m: DeckMark) => ({ from: m.t, to: m.t + cardMarkDuration(m) }));
  const t = recSlot(mark.kind === 'chapter' ? 'chapter card' : 'caption', mark.t, mark.t + dur, busy);
  if (t == null) return null;
  const used = new Set(marks.map((m) => m.key).concat((deckEdit().cards || []).map((c) => c.key)));
  let n = 2;
  while (used.has(`${srcKey.slice(0, 150)}#${n}`)) n += 1;
  const key = `${srcKey.slice(0, 150)}#${n}`;
  const row: CardTiming = { key, copyOf: srcKey, t, dur: r3(dur) };
  const r = await postDeck({ cards: [...(deckEdit().cards || []), row] }, { hint: `${mark.kind === 'chapter' ? 'Chapter card' : 'Caption'} shows again — same copy and look` });
  if (r) {
    seekRec(t + 0.12);
    select({ type: 'card', key, cardId: s?.cardId ?? null, markT: t, markDur: row.dur });
  }
  return r;
}

// ─── Effects on the recording ───────────────────────────────────────────────────────────
async function duplicateRamp(i: number): Promise<Deck | null> {
  const d = deckEdit();
  const src = d.speed[i];
  if (!src) return null;
  const t = recSlot('speed change', src.from, src.to, d.speed);
  if (t == null) return null;
  const copy = { from: t, to: r3(t + src.to - src.from), rate: src.rate };
  const r = await postDeck({ speed: [...d.speed, copy] }, { hint: 'Speed change duplicated' });
  if (r) {
    const j = deckEdit().speed.findIndex((x) => Math.abs(x.from - copy.from) < 0.01);
    seekRec(copy.from + 0.1);
    if (j >= 0) select({ type: 'ramp', i: j });
  }
  return r;
}

async function duplicateSkip(i: number): Promise<Deck | null> {
  const d = deckEdit();
  const src = d.zoomSkips[i];
  if (!src) return null;
  const t = recSlot('no-zoom stretch', src.from, src.to, d.zoomSkips);
  if (t == null) return null;
  const copy = { from: t, to: r3(t + src.to - src.from) };
  const r = await postDeck({ zoomSkips: [...d.zoomSkips, copy] }, { hint: 'No-zoom stretch duplicated' });
  if (r) {
    const j = deckEdit().zoomSkips.findIndex((x) => Math.abs(x.from - copy.from) < 0.01);
    seekRec(copy.from + 0.1);
    if (j >= 0) select({ type: 'skip', i: j });
  }
  return r;
}

async function duplicateCut(i: number): Promise<Deck | null> {
  const d = deckEdit();
  const src = d.cuts[i];
  if (!src) return null;
  const t = recSlot('cut', src.from, src.to, d.cuts);
  if (t == null) return null;
  const copy = { from: t, to: r3(t + src.to - src.from) };
  const r = await postDeck({ cuts: [...d.cuts, copy] }, { hint: `${(copy.to - copy.from).toFixed(1)}s more cut from the recording` });
  if (r) {
    const j = (deckEdit().cuts || []).findIndex((x) => x.from <= copy.from + 0.05 && x.to >= copy.to - 0.05);
    if (j >= 0) select({ type: 'cut', i: j });
  }
  return r;
}

async function duplicateZoom(): Promise<Deck | null> {
  const shot = selectedShot();
  if (!shot) return null;
  const d = deckEdit();
  const busy = (ed.deck?.zoomShots || []).map((z) => ({ from: z.start, to: z.end }));
  const t = recSlot('zoom', shot.start, shot.end, busy);
  if (t == null) return null;
  const own = shot.source !== 'auto' ? d.zooms.find((z) => z.id === shot.id) : null;
  const W = liveW();
  const H = liveH();
  const p = shot.points?.[0] || { cx: W / 2, cy: H / 2 };
  const aim = own ? { cx: own.x, cy: own.y } : clampZoomCenter(p.cx, p.cy, { zoom: shot.zoom, width: W, height: H });
  let id = `z${Math.round(t * 10)}`;
  while (d.zooms.some((z) => z.id === id)) id = `${id}b`;
  const zooms = [...d.zooms, { id, t, dur: r3(shot.end - shot.start), zoom: own?.zoom ?? shot.zoom, x: aim.cx, y: aim.cy }];
  const r = await postDeck({ zooms }, { hint: 'Zoom duplicated — same level and aim' });
  if (r) {
    seekRec(t + Math.min(1, (shot.end - shot.start) / 2));
    select({ type: 'zoom', key: id });
  }
  return r;
}

async function duplicateLens(): Promise<Deck | null> {
  const l = selectedLens();
  if (!l || l.source === 'off') return null;
  const d = deckEdit();
  const busy = (ed.deck?.lenses || []).map((x) => ({ from: x.t, to: x.t + x.dur }));
  const t = recSlot('magnifier', l.t, l.t + l.dur, busy);
  if (t == null) return null;
  let id = `m${Math.round(t * 10)}`;
  while (d.lenses.some((x) => x.id === id)) id = `${id}b`;
  const own = l.source === 'edit' ? d.lenses.find((x) => x.id === l.id) : null;
  const row: DeckLens = own
    ? { ...own, id, t }
    : {
        id,
        t,
        dur: r3(l.dur),
        x: Math.round(l.rect.x + l.rect.w / 2),
        y: Math.round(l.rect.y + l.rect.h / 2),
        w: Math.round(l.rect.w),
        h: Math.round(l.rect.h),
        ...(l.label ? { label: l.label } : {}),
      };
  const r = await postDeck({ lenses: [...d.lenses, row] }, { hint: 'Magnifier duplicated — same spot and size' });
  if (r) {
    seekRec(t + Math.min(1.1, l.dur / 2));
    select({ type: 'lens', key: `edit:${id}` });
  }
  return r;
}

// ─── Audio ────────────────────────────────────────────────────────────────────────────────
async function duplicateVoice(key: string): Promise<Deck | null> {
  const clips = ed.deck?.audio?.voiceClips || [];
  const src = clips.find((c) => c.key === key);
  if (!src) return null;
  const busy = clips.filter((c) => !c.mute).map((c) => ({ from: c.start, to: c.start + c.dur }));
  const t = freeSlot(Math.max(0.2, src.dur), { after: src.start + src.dur, before: src.start, busy, lo: 0, hi: ed.total });
  if (t == null) return noRoom('voice line');
  if (ed.playing) pause();
  try {
    const r = await api<Deck & { key: string }>(`/api/video/${encodeURIComponent(slug() || '')}/voice/line/add`, {
      method: 'POST',
      body: { copyFrom: key, at: t },
    });
    return applyVoiceDeck(r, r.key, 'Voice line duplicated — Regenerate it to speak it afresh');
  } catch (err) {
    toast('Voice line not duplicated', errMessage(err), 'err');
    return null;
  }
}

async function duplicateRide(i: number): Promise<Deck | null> {
  const rides = audioDesk().music.rides;
  const src = rides[i];
  if (!src) return null;
  const t = freeSlot(src.to - src.from, { after: src.to, before: src.from, busy: rides, lo: 0, hi: ed.total });
  if (t == null) return noRoom('ride');
  const copy = { from: t, to: r3(t + src.to - src.from), gainDb: src.gainDb };
  const r = await withMusic({ rides: [...rides, copy] }, 'Ride duplicated');
  if (r) {
    const j = audioDesk().music.rides.findIndex((x) => Math.abs(x.from - copy.from) < 0.01);
    seek(copy.from);
    if (j >= 0) select({ type: 'ride', i: j });
  }
  return r;
}

// ─── Joins ────────────────────────────────────────────────────────────────────────────────
async function duplicateJoin(i: number): Promise<Deck | null> {
  const c = ed.seq[i];
  if (!c?.join) return null;
  const entry = c.join.pinned && Object.keys(c.join.pinned).length ? { ...c.join.pinned } : { style: joinStyle(c), duration: r3(c.overlap) };
  const same = (x: Clip) => x.join?.key === c.join?.key;
  const target = ed.seq.slice(i + 1).find((x) => x.join && !same(x) && joinStyle(x) !== entry.style) || ed.seq.slice(i + 1).find((x) => x.join && !same(x));
  if (!target?.join) {
    toast('No other join to copy to', 'Every join after this one already plays this transition', 'warn');
    return null;
  }
  const r = await postDeck({ transitions: { ...(deckEdit().transitions || {}), [target.join.key]: entry } }, { hint: `Same transition into “${target.title}”` });
  if (r) {
    const j = ed.seq.find((x) => x.join?.key === target.join?.key);
    if (j) select({ type: 'join', i: j.i });
  }
  return r;
}

export async function duplicateSelected(): Promise<Deck | null> {
  const s = ed.sel;
  const state = canDuplicate(s);
  if (!s || !state.ok) {
    if (state.why) flashHint(state.why);
    return null;
  }
  switch (s.type) {
    case 'clip': {
      const c = ed.seq.find((x) => x.id === s.id);
      return c ? repeatSection(c) : null;
    }
    case 'range': {
      const from = s.from ?? 0;
      const to = s.to ?? 0;
      const c = ed.seq.find((x) => x.id === s.clipId && x.kind === 'live') || ed.seq.find((x) => x.kind === 'live' && from >= x.recFrom - 0.01 && from < x.recTo);
      if (!c) return null;
      const nat = naturalLive(c);
      return repeatSection(c, { from: Math.max(from, nat?.from ?? from), to: Math.min(to, nat?.to ?? to) });
    }
    case 'card':
      return duplicateCard();
    case 'zoom':
      return duplicateZoom();
    case 'lens':
      return duplicateLens();
    case 'ramp':
      return duplicateRamp(s.i ?? -1);
    case 'skip':
      return duplicateSkip(s.i ?? -1);
    case 'cut':
      return duplicateCut(s.i ?? -1);
    case 'voice':
      return duplicateVoice(s.key ?? '');
    case 'ride':
      return duplicateRide(s.i ?? -1);
    case 'join':
      return duplicateJoin(s.i ?? -1);
    default:
      return null;
  }
}
import { capturePlayheadAnchor, restorePlayheadAnchor } from '@/logic/plateSync';

import { deckEdit, ed } from './state';
import type { Clip, Deck, DeckScene, Join, Lens, Span, VoiceClip, ZoomShot } from './types';
import { clamp, clockFromPieces, keptSpans } from './util';
import { placeVoice, voiceSlots } from '@/logic/voicePlace';

/** The sequence half of `kit/studio/editor.js`: the clip layout and the clocks between them. */

export function chapterTitle(from: number, to: number): string | null {
  const marks = (ed.deck?.marks || []).filter((m) => (m.kind === 'chapter' || m.kind === 'caption') && m.t >= from - 0.05 && m.t < to && m.label);
  return (marks.find((m) => m.kind === 'chapter') || marks[0])?.label || null;
}

type ClipDraft = Omit<Clip, 'i' | 'at' | 'overlap' | 'join'>;

/** Scenes that buildSeq lays out — clip `i` indexes this list, not raw deck.scenes. */
export function timelineScenes(deck: Deck | null | undefined): DeckScene[] {
  return (deck?.scenes || []).filter((s) => s.kind === 'plate' || Number(s.dur) > 0);
}

/** Join before scene `segIdx` in the server scene list (`joins[segIdx - 1]`). */
export function joinBeforeScene(deck: Deck | null | undefined, segIdx: number): Join | null {
  if (segIdx <= 0) return null;
  return (deck?.joins || [])[segIdx - 1] ?? null;
}

export function sceneSegmentIndex(scene: DeckScene, fallback: number): number {
  return Number.isFinite(scene.index) ? scene.index! : fallback;
}

export function buildSeq(): void {
  const anchor = capturePlayheadAnchor(ed.seq, ed.t);
  const prevT = ed.t;
  const d = ed.deck;
  ed.clock = clockFromPieces(d?.live?.pieces || []);
  const { toClean } = ed.clock;
  const seq: Clip[] = [];
  // Keep plates even when edit-plan still says dur 0 (added slide, partial render). Live slices
  // with no length are still dropped — they are not scrubbable.
  const scenes = timelineScenes(d);
  const liveOk = Boolean(d?.live?.exists);
  if (scenes.length) {
    scenes.forEach((s, i) => {
      const isLive = s.kind === 'live';
      const join = joinBeforeScene(d, sceneSegmentIndex(s, i));
      const recFrom = isLive ? (s.recFrom ?? s.cleanFrom ?? 0) : null;
      const recTo = isLive ? (s.recTo ?? s.cleanTo ?? (recFrom ?? 0) + s.dur) : null;
      // Plates must not land at dur 0 — a new slide before its MP4 length is known used to
      // collapse to zero in edit-plan and the scrubber would skip through it in one frame.
      const dur = isLive && liveOk
        ? Math.max(0.2, toClean(recTo ?? 0) - toClean(recFrom ?? 0))
        : Math.max(isLive ? 0.2 : 0.5, Number(s.dur) || 0);
      const prev = seq[i - 1];
      const want = !i || s.hardCut ? 0 : (join?.pinned?.duration ?? s.transitionIn?.dur ?? 0);
      const overlap = prev ? clamp(want, 0, Math.min(prev.dur, dur) / 2) : 0;
      seq.push({
        i,
        id: s.id,
        kind: isLive ? 'live' : 'plate',
        plateId: s.plateId || null,
        type: s.type || null,
        title: isLive
          ? (s.title && s.title !== 'Live screencast' ? s.title : null) || chapterTitle(recFrom ?? 0, recTo ?? 0) || 'Recording'
          : s.title,
        at: prev ? prev.at + prev.dur - overlap : 0,
        dur,
        overlap,
        // Plates carry null in legacy; the number type keeps the live math strict.
        recFrom: recFrom as number,
        recTo: recTo as number,
        join,
        ...(s.repeatOf ? { repeatOf: s.repeatOf } : {}),
        ...(!isLive && s.naturalDur ? { naturalDur: s.naturalDur } : {}),
        ...(!isLive && s.holdAt != null ? { holdAt: s.holdAt } : {}),
        ...(!isLive && s.clearAt != null ? { clearAt: s.clearAt } : {}),
        ...(!isLive && s.padOut ? { padOut: s.padOut } : {}),
        ...(!isLive && s.timing ? { timing: s.timing } : {}),
      });
    });
  } else {
    // No render yet: lay out the plates around the whole recording so they can still be styled.
    const plates = d?.plates || [];
    const order: Array<(typeof plates)[number] | { live: true }> = [
      ...plates.filter((p) => p.id === 'open'),
      ...(liveOk ? [{ live: true as const }] : []),
      ...plates.filter((p) => p.id !== 'open' && p.id !== 'close'),
      ...plates.filter((p) => p.id === 'close'),
    ];
    let at = 0;
    const push = (clip: ClipDraft) => {
      seq.push({ ...clip, i: seq.length, at, overlap: 0, join: null });
      at += clip.dur;
    };
    for (const p of order) {
      if (!('live' in p)) {
        push({ id: p.id, kind: 'plate', plateId: p.id, type: p.type || null, title: p.label || p.id, dur: 6, recFrom: null as unknown as number, recTo: null as unknown as number });
        continue;
      }
      const recEnd = d?.live?.durationSec || 0;
      const clean = ed.clock.toClean;
      for (const [a, b] of keptSpans(0, recEnd, d?.deck?.cuts)) {
        const dur = Math.max(0.2, clean(b) - clean(a));
        push({ id: `live-${a.toFixed(2)}`, kind: 'live', plateId: null, type: null, title: 'Recording', dur, recFrom: a, recTo: b });
      }
    }
  }
  ed.seq = seq;
  const last = seq[seq.length - 1];
  ed.total = last ? last.at + last.dur : 0;
  // Prefer the same section after omit/undo/reorder — raw clamp lands on the wrong plate.
  ed.t = restorePlayheadAnchor(ed.seq, ed.total, anchor, prevT);
  projectAudio();
}

/**
 * Lay the narration and the music ducking onto the cut as it stands. voice.json holds where the
 * last mix put each line; a speed ramp or a pinned join moves the picture under it, so the Editor
 * re-places every line with the same rules the voice step uses (studio/voicePlace.js). `start`
 * is where the line lands on the next render, `mixStart` where the current mix has it.
 */
export function projectAudio(): void {
  const audio = ed.deck?.audio;
  if (!audio) return;
  const seq = ed.seq;
  const lives = seq.filter((c) => c.kind === 'live');
  audio.windows = lives.map((c) => ({ start: c.at, end: c.at + c.dur }));
  const clips = audio.voiceClips || [];
  if (!clips.length || !seq.length) return;
  const atRec = (rec: number) => {
    const c = lives.find((l) => rec <= l.recTo + 1e-6) || lives[lives.length - 1];
    if (!c) return null;
    return recToEd(c, clamp(rec, c.recFrom, c.recTo));
  };
  const lineKeys = new Set(clips.filter((c) => c.kind === 'caption' || c.kind === 'chapter').map((c) => c.key));
  const marks = (ed.deck?.marks || [])
    .filter((m) => (m.kind === 'chapter' || m.kind === 'caption') && !m.copyOf && m.label && lineKeys.has(m.label))
    .map((m) => ({ kind: m.kind, label: m.label, at: atRec(m.t) }))
    .filter((m): m is { kind: string | undefined; label: string | undefined; at: number } => m.at != null);
  const open = seq.find((c) => c.plateId === 'open');
  const close = seq.find((c) => c.plateId === 'close');
  const lastLive = lives[lives.length - 1];
  const cut = {
    open: open ? { at: open.at, dur: open.dur } : null,
    close: close ? { at: close.at, dur: close.dur } : null,
    total: ed.total,
    plates: seq.filter((c) => c.kind === 'plate' && !c.repeatOf && c.plateId !== 'open' && c.plateId !== 'close').map((c) => ({ id: c.plateId ?? '', at: c.at, dur: c.dur, inDur: c.overlap })),
    marks: marks.map((m) => ({ kind: m.kind ?? '', label: m.label ?? '', at: m.at })),
    liveEnd: lastLive ? lastLive.at + lastLive.dur : ed.total,
  };
  const placed = placeVoice(voiceSlots(cut, clips.map((c) => ({ key: c.key, kind: c.kind, duration: c.dur }))));
  const byKey = new Map(placed.map((p) => [p.key, p]));
  for (const c of clips) {
    const p = byKey.get(c.key);
    if (c.at != null) {
      c.start = Math.round((c.at + (c.nudge || 0)) * 1000) / 1000;
      c.moved = false;
      c.long = p?.long ?? 0;
      c.late = p?.late ?? 0;
      continue;
    }
    if (!p) continue;
    c.start = Math.round((p.start + (c.nudge || 0)) * 1000) / 1000;
    c.moved = Math.abs(p.start - c.writtenStart) > 0.05;
    c.long = p.long;
    c.late = p.late;
  }
}

export const clipIndexAt = (t: number): number => {
  for (let i = ed.seq.length - 1; i >= 0; i--) if (ed.seq[i]!.at <= t + 1e-4) return i;
  return 0;
};

export function visualSpan(i: number): [number, number] {
  const c = ed.seq[i]!;
  const n = ed.seq[i + 1];
  return [i ? c.at + c.overlap / 2 : 0, n ? n.at + n.overlap / 2 : c.at + c.dur];
}

export function visualIndexAt(t: number): number {
  for (let i = 0; i < ed.seq.length; i++) if (t < visualSpan(i)[1]) return i;
  return ed.seq.length - 1;
}

const toClean = (t: number) => (ed.clock ? ed.clock.toClean(t) : t);
const fromClean = (t: number) => (ed.clock ? ed.clock.fromClean(t) : t);

export const recToEd = (c: Clip, rec: number): number => c.at + (toClean(rec) - toClean(c.recFrom));
export const edToRec = (c: Clip, t: number): number => clamp(fromClean(toClean(c.recFrom) + (t - c.at)), c.recFrom, c.recTo);
export const rateAt = (rec: number): number => deckEdit().speed.find((r) => rec >= r.from && rec < r.to)?.rate || 1;
export const curClip = (): Clip | null => ed.seq[clipIndexAt(ed.t)] || null;
export const shotKey = (s: Pick<ZoomShot, 'id' | 'start'>): string => s.id || `auto@${s.start}`;

/**
 * The key a plate's zooms and magnifiers are filed under. A duplicate plays the same file, so it
 * shares its source's marks — the render keys off `repeatOf || id` for the same reason.
 */
export const fxClipId = (c: Clip | null | undefined): string | null =>
  c && c.kind === 'plate' ? c.repeatOf || c.plateId || c.id : null;

/** Every magnifier the zoom row shows: the ones that render plus recorded ones switched off. */
export const lensItems = (): Lens[] => [
  ...(ed.deck?.lenses || []),
  ...(ed.deck?.recordedLenses || [])
    .filter((l) => l.off)
    .map((l) => ({ ...l, key: `off:${l.t}`, source: 'off' }) as unknown as Lens),
];

/** Magnifiers on the timeline — suppressed recorded ones stay in the inspector only. */
export const visibleLenses = (): Lens[] => lensItems().filter((l) => l.source !== 'off');

export function zoomSkipCovers(from: number, to: number, skips: { from: number; to: number }[] | null | undefined): boolean {
  return (skips || []).some((s) => s.from < to - 0.001 && s.to > from + 0.001);
}

/** Lines removed from the cut (`mute` on the desk) stay in config for undo/mix but not on the timeline. */
export const visibleVoiceClips = (): VoiceClip[] => (ed.deck?.audio?.voiceClips || []).filter((c) => !c.mute);

/** Auto zoom the deck turned off (`zoomSkips`) must not still show as a dashed pill beside “No zoom”. */
export const visibleZoomShots = (): ZoomShot[] =>
  (ed.deck?.zoomShots || []).filter((s) => s.source !== 'auto' || !zoomSkipCovers(s.start, s.end, deckEdit().zoomSkips));

/** Whether a skip row pill should appear (suppress entries are silent; everything else is removable on the row). */
export function zoomSkipOnTimeline(skip: Span, _autoShots: ZoomShot[] | null | undefined): boolean {
  return !skip.suppress;
}

export function visibleZoomSkips(): { skip: Span; i: number }[] {
  const skips = deckEdit().zoomSkips || [];
  const autos = ed.deck?.zoomShots || [];
  return skips.map((skip, i) => ({ skip, i })).filter(({ skip }) => zoomSkipOnTimeline(skip, autos));
}

export const lensByKey = (key: string | null | undefined): Lens | null => lensItems().find((l) => l.key === key) || null;

/** A zoom by its pill key, whether the planner made it on the recording or it sits on a plate. */
export const shotByKey = (key: string | null | undefined): ZoomShot | null => {
  const own = (ed.deck?.zoomShots || []).find((s) => shotKey(s) === key);
  if (own) return own;
  const z = (ed.deck?.plateZooms || []).find((p) => p.id === key);
  return z ? { id: z.id, clip: z.clip, source: 'edit', start: z.t, end: z.t + z.dur, zoom: z.zoom } : null;
};
export const selectedLens = (): Lens | null => (ed.sel?.type === 'lens' ? lensByKey(ed.sel.key) : null);

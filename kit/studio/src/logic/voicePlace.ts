/**
 * Where narration lines land. Shared by the voice step (lib/audio/voice.mjs, which also fits a
 * long line by stretching it) and the Editor, which projects the same placement onto the cut it
 * shows — so a speed ramp that shortens a section moves the voice pills right away, and a line
 * that will not fit any more says so before the render.
 *
 * All windows are delivery seconds. A slot is `{ key, kind, windowStart, windowEnd, markAt, duration }`.
 */

export interface VoiceSlot {
  key: string;
  kind: string;
  windowStart: number;
  windowEnd: number;
  markAt: number | null;
  duration: number;
}

export interface PlacedVoiceSlot extends VoiceSlot {
  start: number;
  end: number;
  late: number;
  long: number;
}

export interface VoiceLine {
  key: string;
  kind: string;
  duration: number;
}

export interface VoiceCut {
  open?: { at: number; dur: number } | null;
  close?: { at: number; dur: number } | null;
  total: number;
  plates?: { id: string; at: number; dur: number; inDur?: number }[];
  marks?: { kind?: string; label: string; at: number }[];
  liveEnd?: number | null;
}

/** The card's title lands before the voice starts. */
export const VOICE_LEAD: Readonly<Record<string, number>> & { readonly caption: number; readonly chapter: number; readonly interstitial: number } =
  Object.freeze({ caption: 0.3, chapter: 0.9, interstitial: 0.7 });
/** Breath between consecutive lines. */
export const VOICE_GAP = 0.45;
/** A line may spill this far into the next window before it counts as long. */
export const VOICE_OVERRUN = 1.2;
/** The intro waits for the open plate's logo; it may run this far past the open into the first live slice. */
export const INTRO_WINDOW = Object.freeze({ start: 1.1, pastOpen: 1.5 });
/** The outro starts once the close plate has settled and ends before the picture does. */
export const OUTRO_WINDOW = Object.freeze({ lead: 0.9, tail: 0.4 });
/** An interstitial line ends before the plate's exits begin. */
export const PLATE_TAIL = 0.35;

const r3 = (v: number): number => Math.round(Number(v) * 1000) / 1000;

/** Earliest start for a slot once the previous line has ended. */
export function slotStart(slot: Pick<VoiceSlot, 'windowStart'>, prevEnd = 0): number {
  return Math.max(slot.windowStart, prevEnd + VOICE_GAP);
}

/** Seconds a line may take from `start` before it counts as long (the outro gets no spill — the video ends). */
export function slotRoom(slot: Pick<VoiceSlot, 'windowEnd' | 'kind'>, start: number): number {
  return slot.windowEnd + (slot.kind === 'outro' ? 0 : VOICE_OVERRUN) - start;
}

/**
 * Lay slots out in window order, each at the earliest start after the previous line. Returns the
 * slots with `start`, `end`, `late` (seconds the previous line pushed it past its window) and
 * `long` (seconds it overruns its room; 0 when it fits).
 */
export function placeVoice<S extends VoiceSlot>(slots: S[]): (S & Pick<PlacedVoiceSlot, 'start' | 'end' | 'late' | 'long'>)[] {
  const ordered = [...slots].sort((a, b) => a.windowStart - b.windowStart);
  let prevEnd = 0;
  return ordered.map((slot) => {
    const start = slotStart(slot, prevEnd);
    const duration = Number(slot.duration) || 0;
    const room = slotRoom(slot, start);
    const placed = {
      ...slot,
      start: r3(start),
      end: r3(start + duration),
      late: r3(Math.max(0, start - slot.windowStart)),
      long: r3(Math.max(0, duration - room)),
    };
    prevEnd = placed.end;
    return placed;
  });
}

/**
 * Build the slot windows for the lines in a cut. `cut` describes the picture:
 *   { open: { at, dur } | null, close: { at, dur } | null, total,
 *     plates: [{ id, at, dur, inDur }], marks: [{ kind, label, at }], liveEnd }
 * `marks` are the caption/chapter marks on the delivery clock (only those with a line); `liveEnd`
 * is where the last live slice ends. `lines` are `{ key, kind, duration }`.
 */
export function voiceSlots(cut: VoiceCut, lines: VoiceLine[]): VoiceSlot[] {
  const marks = [...(cut.marks || [])].sort((a, b) => a.at - b.at);
  const slots: VoiceSlot[] = [];
  for (const line of lines) {
    const base = { key: line.key, kind: line.kind, duration: line.duration, markAt: null };
    if (line.kind === 'intro') {
      if (!cut.open) continue;
      slots.push({ ...base, windowStart: cut.open.at + INTRO_WINDOW.start, windowEnd: cut.open.at + cut.open.dur + INTRO_WINDOW.pastOpen });
    } else if (line.kind === 'outro') {
      if (!cut.close) continue;
      slots.push({ ...base, windowStart: cut.close.at + OUTRO_WINDOW.lead, windowEnd: cut.total - OUTRO_WINDOW.tail });
    } else if (line.kind === 'interstitial') {
      const plate = (cut.plates || []).find((p) => p.id === line.key);
      if (!plate) continue;
      const markAt = plate.at + (plate.inDur || 0) / 2;
      slots.push({ ...base, markAt, windowStart: markAt + VOICE_LEAD.interstitial, windowEnd: plate.at + plate.dur - PLATE_TAIL });
    } else {
      const i = marks.findIndex((m) => m.label === line.key);
      if (i < 0) continue;
      const mark = marks[i] as NonNullable<VoiceCut['marks']>[number];
      const next = marks[i + 1];
      slots.push({
        ...base,
        kind: mark.kind || line.kind,
        markAt: mark.at,
        windowStart: mark.at + (VOICE_LEAD[mark.kind || line.kind] ?? VOICE_LEAD.caption),
        windowEnd: next ? next.at : cut.liveEnd ?? cut.total,
      });
    }
  }
  return slots;
}

/**
 * The Program player plays the last render; the timeline draws the cut as it stands. When the
 * render is fresh the two clocks agree. When edits have moved on, a section is matched by id and
 * mapped proportionally inside it, and anything with no counterpart falls back to the whole length.
 */

export interface ProgramSpan {
  id: string;
  start: number;
  end: number;
}

export interface CutSpan {
  id: string;
  repeatOf?: string | undefined;
  at: number;
  dur: number;
}

export interface ClockFrame {
  programDur: number;
  total: number;
  /** The render matches the cut — the clocks are the same. */
  fresh: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const sameClock = (f: ClockFrame) => f.fresh && Math.abs(f.programDur - f.total) < 0.3;

const ratio = (v: number, from: number, to: number) => (to > 0 ? clamp(v, 0, from) * (to / Math.max(from, 1e-6)) : 0);

export function programToCut(pt: number, spans: readonly ProgramSpan[], cut: readonly CutSpan[], f: ClockFrame): number {
  if (!(f.total > 0)) return 0;
  if (sameClock(f)) return clamp(pt, 0, f.total);
  const span = spans.find((s) => pt >= s.start - 1e-4 && pt < s.end) ?? (pt >= (spans[spans.length - 1]?.end ?? Infinity) ? spans[spans.length - 1] : undefined);
  const clip = span ? cut.find((c) => c.id === span.id && !c.repeatOf) : undefined;
  if (span && clip) return clamp(clip.at + ratio(pt - span.start, span.end - span.start, clip.dur), 0, f.total);
  return clamp(ratio(pt, f.programDur, f.total), 0, f.total);
}

export function cutToProgram(t: number, spans: readonly ProgramSpan[], cut: readonly CutSpan[], f: ClockFrame): number {
  if (!(f.programDur > 0)) return 0;
  if (sameClock(f)) return clamp(t, 0, f.programDur);
  let clip: CutSpan | undefined;
  for (let i = cut.length - 1; i >= 0; i--) {
    if (cut[i]!.at <= t + 1e-4) {
      clip = cut[i];
      break;
    }
  }
  const span = clip ? spans.find((s) => s.id === (clip.repeatOf || clip.id)) : undefined;
  if (clip && span) return clamp(span.start + ratio(t - clip.at, clip.dur, span.end - span.start), 0, f.programDur);
  return clamp(ratio(t, f.total, f.programDur), 0, f.programDur);
}

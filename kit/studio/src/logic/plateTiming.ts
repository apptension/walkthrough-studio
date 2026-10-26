/**
 * A plate's own clock under `edit.plateTimes` — the browser twin of `platePlayback` in
 * `kit/lib/editDeck.mjs`. The render's filter graph and the Studio stage both map a moment of the
 * cut to the plate's clock through this, so a trimmed, held or re-speeded plate previews the same
 * frames it renders.
 */

export const PLATE_RATE_RANGE: readonly [number, number] = [0.5, 3];
export const PLATE_HOLD_MAX = 20;
export const PLATE_TRIM_MAX = 30;
export const MIN_PLATE_KEEP = 0.6;

export interface PlateTimingInput {
  trimStart?: number | undefined;
  trimEnd?: number | undefined;
  hold?: number | undefined;
  rate?: number | undefined;
}

export interface PlatePlayback {
  from: number;
  to: number;
  holdAt: number;
  hold: number;
  rate: number;
  head: number;
  tail: number;
  dur: number;
  baseDur: number;
  identity: boolean;
  toSource: (u: number) => number;
  toOutput: (s: number) => number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function platePlayback(timing: PlateTimingInput | null | undefined, baseDur: number, holdAt: number | null = null): PlatePlayback {
  const t = timing || {};
  const base = Math.max(0, Number(baseDur) || 0);
  const rate = clamp(Number(t.rate) || 1, PLATE_RATE_RANGE[0], PLATE_RATE_RANGE[1]);
  const keep = Math.min(MIN_PLATE_KEEP, base);
  const from = r3(clamp(Number(t.trimStart) || 0, 0, Math.max(0, base - keep)));
  const to = r3(clamp(base - (Number(t.trimEnd) || 0), from + keep, base));
  const hold = r3(clamp(Number(t.hold) || 0, 0, PLATE_HOLD_MAX));
  const settle = holdAt != null && Number.isFinite(Number(holdAt)) ? Number(holdAt) : to - 0.8;
  const at = r3(clamp(settle, from, to));
  const head = (at - from) / rate;
  const tail = (to - at) / rate;
  const dur = r3(head + hold + tail);
  const toSource = (u: number) => {
    const x = Math.max(0, Number(u) || 0);
    if (x <= head) return r3(from + x * rate);
    if (x <= head + hold) return at;
    return r3(Math.min(to, at + (x - head - hold) * rate));
  };
  const toOutput = (s: number) => {
    const x = Number(s) || 0;
    if (x <= from) return 0;
    if (x <= at) return r3((x - from) / rate);
    if (x <= to) return r3(head + hold + (x - at) / rate);
    return dur;
  };
  const identity = from < 1e-3 && to >= base - 1e-3 && hold < 1e-3 && Math.abs(rate - 1) < 1e-3;
  return { from, to, holdAt: at, hold, rate, head: r3(head), tail: r3(tail), dur, baseDur: r3(base), identity, toSource, toOutput };
}

interface TimedClip {
  at: number;
  dur: number;
  naturalDur?: number | undefined;
  holdAt?: number | undefined;
  padOut?: number | undefined;
  timing?: PlateTimingInput | null | undefined;
}

/** The playback a plate clip is showing (identity when it was never retimed). */
export function clipPlayback(clip: TimedClip): PlatePlayback {
  const base = clip.naturalDur ?? Math.max(0.1, clip.dur - (clip.padOut || 0));
  return platePlayback(clip.timing || null, base, clip.holdAt ?? null);
}

/** Milliseconds into the plate's own animation for a playhead `t` on the cut. */
export function plateClockMs(clip: TimedClip | null | undefined, t: number): number {
  if (!clip) return 0;
  const u = Math.max(0, Number(t) - clip.at);
  if (!clip.timing) return Math.round(u * 1000);
  return Math.round(clipPlayback(clip).toSource(u) * 1000);
}

/** A plate-times row with defaults dropped, or null when it is back to natural. */
export function plateTimeRow(id: string, t: PlateTimingInput): (PlateTimingInput & { id: string }) | null {
  const row: PlateTimingInput & { id: string } = { id };
  const trimStart = r3(clamp(Number(t.trimStart) || 0, 0, PLATE_TRIM_MAX));
  const trimEnd = r3(clamp(Number(t.trimEnd) || 0, 0, PLATE_TRIM_MAX));
  const hold = r3(clamp(Number(t.hold) || 0, 0, PLATE_HOLD_MAX));
  const rate = Math.round(clamp(Number(t.rate) || 1, PLATE_RATE_RANGE[0], PLATE_RATE_RANGE[1]) * 100) / 100;
  if (trimStart) row.trimStart = trimStart;
  if (trimEnd) row.trimEnd = trimEnd;
  if (hold) row.hold = hold;
  if (Math.abs(rate - 1) > 0.001) row.rate = rate;
  return Object.keys(row).length > 1 ? row : null;
}

/** Replace (or drop) one plate's row in `edit.plateTimes`. */
export function withPlateTime<T extends { id: string }>(list: T[] | undefined, id: string, next: PlateTimingInput | null): Array<PlateTimingInput & { id: string }> {
  const rest = (list || []).filter((r) => r.id !== id) as Array<PlateTimingInput & { id: string }>;
  const row = next ? plateTimeRow(id, next) : null;
  return row ? [...rest, row] : rest;
}

/**
 * The plate length a requested output duration needs: longer than natural extends the hold,
 * shorter first eats the hold, then trims the outro before the settled frame stays put.
 */
export function timingForDuration(current: PlateTimingInput, baseDur: number, holdAt: number | null, want: number): PlateTimingInput {
  const pb = platePlayback(current, baseDur, holdAt);
  const moving = pb.head + pb.tail;
  const target = Math.max(MIN_PLATE_KEEP, want);
  if (target >= moving) return { ...current, hold: r3(Math.min(PLATE_HOLD_MAX, target - moving)) };
  const over = (moving - target) * pb.rate;
  const tailRoom = Math.max(0, pb.to - pb.holdAt);
  const trimEnd = (Number(current.trimEnd) || 0) + Math.min(over, tailRoom);
  const left = over - Math.min(over, tailRoom);
  const trimStart = (Number(current.trimStart) || 0) + left;
  return { ...current, hold: 0, trimEnd: r3(trimEnd), trimStart: r3(trimStart) };
}

/**
 * The same requested duration reached by retiming the animation instead of holding or trimming:
 * every beat stays, just faster or slower. Past the speed range the hold makes up the rest.
 */
export function timingForStretch(current: PlateTimingInput, baseDur: number, holdAt: number | null, want: number): PlateTimingInput {
  const pb = platePlayback(current, baseDur, holdAt);
  const source = Math.max(0.05, pb.to - pb.from);
  const target = Math.max(MIN_PLATE_KEEP, want);
  const hold = Math.min(pb.hold, Math.max(0, target - source / PLATE_RATE_RANGE[1]));
  const rate = Math.round(clamp(source / Math.max(0.05, target - hold), PLATE_RATE_RANGE[0], PLATE_RATE_RANGE[1]) * 100) / 100;
  const moving = source / rate;
  return { ...current, rate, hold: r3(clamp(target - moving, 0, PLATE_HOLD_MAX)) };
}

/** Speeds a plate can be set to with one click; anything in the range is reachable by slider. */
export const PLATE_RATE_STEPS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 3].filter((r) => r >= PLATE_RATE_RANGE[0] && r <= PLATE_RATE_RANGE[1]);

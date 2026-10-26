/** Seeking helpers for the timeline overview's Program clock. */

export interface TimelineChapter {
  /** The server can send a multi-line title as an array; legacy stringified it. */
  title: string | readonly string[];
  start: number;
}

/** `m:ss.t` — the scrub readout carries tenths so a drag lands on the exact frame you see. */
export function fmtScrub(sec: number): string {
  const s = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const whole = Math.floor(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${Math.floor((s - whole) * 10)}`;
}

/** Keyboard seek target for the timeline slider, or null when the key is not a seek key. */
export function keySeek(key: string, t: number, d: number, chapters: readonly TimelineChapter[], { big = false } = {}): number | null {
  const step = big ? 5 : 1;
  const starts = chapters.map((c) => c.start).sort((a, b) => a - b);
  let next: number | null = null;
  if (key === 'ArrowLeft' || key === 'ArrowDown') next = t - step;
  else if (key === 'ArrowRight' || key === 'ArrowUp') next = t + step;
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = d;
  else if (key === 'PageUp') next = [...starts].reverse().find((s) => s < t - 0.25) ?? 0;
  else if (key === 'PageDown') next = starts.find((s) => s > t + 0.25) ?? d;
  return next == null ? null : Math.min(Math.max(0, next), d);
}

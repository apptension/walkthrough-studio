import type { CaptionCue, Scene } from '@/api/types';
import { fmtShort } from '@/desk/format';

/**
 * The Program timeline's geometry — `renderTimeline(chapters, duration)` from
 * `kit/studio/app.js`, as data. Every position is a percentage string of `d`.
 */

export interface TimelineChapter {
  /** The server can send a multi-line title as an array; legacy stringified it. */
  title: string | readonly string[];
  start: number;
}

const pct = (n: number) => `${n}%`;
const text = (title: TimelineChapter['title'] | undefined) => String(title || '');

export interface RulerTick {
  key: number;
  className: string;
  left: string;
  label: string | null;
}

export function rulerTicks(d: number): RulerTick[] {
  const step = d > 180 ? 30 : d > 60 ? 10 : 5;
  const ticks: RulerTick[] = [];
  for (let t = 0; t <= d; t += step) {
    const major = t % (step * 2) === 0;
    ticks.push({
      key: t,
      className: `tl-tick${major ? ' major' : ''}`,
      left: pct((t / d) * 100),
      label: major || step >= 30 ? fmtShort(t) : null,
    });
  }
  return ticks;
}

export interface ChapterMark {
  key: string;
  left: string;
  title: string;
}

export function chapterMarks(chapters: readonly TimelineChapter[], d: number): ChapterMark[] {
  return chapters.map((c, i) => ({ key: `${i}-${c.start}`, left: pct((c.start / d) * 100), title: text(c.title) }));
}

export interface RegionView {
  key: string;
  kind: 'region' | 'xfade';
  className: string;
  left?: string;
  width: string;
  title?: string;
  sceneId?: string;
  plateId?: string;
}

export interface RegionContext {
  plateMode: boolean;
  activePlateId: string | null;
  /** The scene id of the Editor's live-clip selection, if any. */
  liveSelectionId: string | null;
}

/**
 * Clip lane blocks: one per scene with length, plus its join; without scenes,
 * alternating stripes between chapter starts. `highlightTimelinePlate` and the
 * live selection decide `is-active`.
 */
export function regionViews(
  scenes: readonly Scene[],
  chapters: readonly TimelineChapter[],
  d: number,
  ctx: RegionContext,
): { edit: boolean; regions: RegionView[] } {
  const timed = scenes.filter((s) => s.dur > 0);
  const regions: RegionView[] = [];
  if (timed.length) {
    for (const s of timed) {
      const activePlate = ctx.plateMode && s.editable && Boolean(s.plateId) && s.plateId === ctx.activePlateId;
      const activeLive = ctx.plateMode && !s.editable && ctx.liveSelectionId === s.id;
      const span = `${fmtShort(s.start)}–${fmtShort(s.end)}`;
      regions.push({
        key: `r-${s.id}`,
        kind: 'region',
        className: `tl-region ${s.kind === 'plate' ? 'plate' : 'live'}${activePlate || activeLive ? ' is-active' : ''}${
          s.editable || s.kind === 'live' ? ' is-clickable' : ''
        }`,
        left: pct((s.start / d) * 100),
        width: pct(Math.max(0, (s.dur / d) * 100)),
        title: s.editable
          ? `${s.title} · ${span} · click to edit this plate`
          : `${s.title} · ${span} · click to edit speed, zoom and transitions`,
        sceneId: s.id,
        ...(s.plateId ? { plateId: s.plateId } : {}),
      });
      const join = s.transitionIn;
      if (join?.dur) {
        regions.push({
          key: `x-${s.id}`,
          kind: 'xfade',
          className: `tl-xfade${join.card ? ' card' : ''}`,
          left: pct((s.start / d) * 100),
          width: pct(Math.max(0.25, (join.dur / d) * 100)),
          title: `${join.type} ${join.dur.toFixed(2)}s → ${s.title}`,
        });
      }
    }
    return { edit: true, regions };
  }
  const pts = sortedChapters(chapters);
  pts.forEach((c, i) => {
    const end = i + 1 < pts.length ? (pts[i + 1]?.start ?? d) : d;
    regions.push({
      key: `c-${i}`,
      kind: 'region',
      className: `tl-region ${i % 2 ? 'plate' : 'live'}`,
      width: pct(Math.max(0, ((end - c.start) / d) * 100)),
    });
  });
  return { edit: false, regions };
}

function sortedChapters<T extends TimelineChapter>(chapters: readonly T[]): T[] {
  return [...chapters].sort((a, b) => a.start - b.start);
}

export interface LaneClip {
  key: string;
  left: string;
  width: string;
  title: string;
  label?: string;
}

export function chapterClips(chapters: readonly TimelineChapter[], d: number): LaneClip[] {
  const pts = sortedChapters(chapters);
  return pts.map((c, i) => {
    const end = i + 1 < pts.length ? (pts[i + 1]?.start ?? d) : d;
    return {
      key: `${i}-${c.start}`,
      left: pct((c.start / d) * 100),
      width: pct(Math.max(0.8, ((end - c.start) / d) * 100)),
      title: text(c.title),
      label: text(c.title),
    };
  });
}

export function cueClips(cues: readonly CaptionCue[], d: number): LaneClip[] {
  return cues.map((c, i) => ({
    key: `${i}-${c.start}`,
    left: pct((c.start / d) * 100),
    width: pct(Math.max(0.4, ((Math.max(c.end, c.start + 0.4) - c.start) / d) * 100)),
    title: String(c.text || ''),
  }));
}

/** Playhead / fill percentage and the playhead's flip past 82 %. */
export function playheadPct(t: number, d: number): number {
  return d > 0 ? (t / d) * 100 : 0;
}

/** `seekFromEvent` — pointer x over the track as a 0–1 ratio. */
export function trackRatio(clientX: number, rect: Pick<DOMRect, 'left' | 'width'>): number {
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

/** How close (screen px) the pointer must come to a chapter start before the scrubber clicks onto it. */
export const SNAP_PX = 6;

export interface ScrubPoint {
  ratio: number;
  sec: number;
  /** The chapter the point snapped onto, if any. */
  chapter: string | null;
}

/** Pointer x → time on the track, pulled onto a chapter start within `SNAP_PX` unless `free`. */
export function scrubPoint(
  clientX: number,
  rect: Pick<DOMRect, 'left' | 'width'>,
  d: number,
  chapters: readonly TimelineChapter[],
  { free = false }: { free?: boolean } = {},
): ScrubPoint {
  const ratio = trackRatio(clientX, rect);
  if (!free && d > 0 && rect.width > 0) {
    let best: { ratio: number; title: string; dist: number } | null = null;
    for (const c of chapters) {
      const r = c.start / d;
      const dist = Math.abs(r - ratio) * rect.width;
      if (dist <= SNAP_PX && (!best || dist < best.dist)) best = { ratio: r, title: text(c.title), dist };
    }
    if (best) return { ratio: best.ratio, sec: best.ratio * d, chapter: best.title };
  }
  return { ratio, sec: ratio * d, chapter: null };
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

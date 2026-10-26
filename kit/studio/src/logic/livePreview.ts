/**
 * Live-stage seek and loupe paint rules shared by the Studio Editor.
 * Kept free of DOM so scrubbing / magnifier behaviour can be unit-tested.
 */

import { glassCanvas } from './lensGlass';

const EPSILON = 1 / 90;

export type LiveSeekPlan = { action: 'none' } | { action: 'defer' | 'seek'; wantRec: number };
export type AfterSeekedPlan = { action: 'none' | 'paint' } | { action: 'seek'; wantRec: number };

export interface LiveSeekInput {
  currentTime?: number;
  wantRec?: number;
  seeking?: boolean;
  readyState?: number;
  epsilon?: number;
}

export interface AfterSeekedInput {
  currentTime?: number;
  wantRec?: number;
  playing?: boolean;
  epsilon?: number;
}

export interface LensLoupe {
  zoom: number;
  /**
   * The magnification the render actually lands on. ffmpeg crops a whole number of source pixels
   * (`cropW = even(W / zoom)`) and scales that to `W`, so the glass magnifies by `W / cropW`
   * rather than by the requested `zoom`. Painting the stage with `zoom` drifts up to ~1% from the
   * master; painting it with `zoomExact` does not.
   */
  zoomExact: number;
  diameter: number;
  S: number;
  capped: boolean;
}

export interface FrameEditorInput {
  selected?: boolean;
  blockStart?: number;
  blockEnd?: number;
  playhead?: number | null;
  playing?: boolean;
  reducedMotion?: boolean;
}

export interface LensPaintInput {
  hasLens?: boolean;
  viewportCssPx?: number;
  readyState?: number;
  /** @deprecated Ignored — see `planLensPaint`. */
  hold?: boolean;
}

const isFiniteNumber = (v: unknown): v is number => Number.isFinite(v);

/**
 * Decide whether the recording element should seek to `wantRec`.
 * While a seek is in flight we defer and remember the latest target so the
 * next `seeked` can catch up — otherwise fast timeline scrub drops frames.
 */
export function planLiveSeek({
  currentTime = 0,
  wantRec,
  seeking = false,
  readyState = 0,
  epsilon = EPSILON,
}: LiveSeekInput = {}): LiveSeekPlan {
  if (!isFiniteNumber(wantRec)) return { action: 'none' };
  if (readyState < 1) return { action: 'defer', wantRec };
  if (Math.abs(Number(currentTime) - wantRec) <= epsilon) return { action: 'none' };
  if (seeking) return { action: 'defer', wantRec };
  return { action: 'seek', wantRec };
}

/**
 * After `seeked`, either chase a newer scrub target or paint the stage.
 * Returns `{ action: 'seek', wantRec }` or `{ action: 'paint' }`.
 */
export function planAfterSeeked({
  currentTime = 0,
  wantRec,
  playing = false,
  epsilon = EPSILON,
}: AfterSeekedInput = {}): AfterSeekedPlan {
  if (playing) return { action: 'none' };
  if (isFiniteNumber(wantRec) && Math.abs(Number(currentTime) - wantRec) > epsilon) {
    return { action: 'seek', wantRec };
  }
  return { action: 'paint' };
}

/** Loupe sizing shared with lib/lens.mjs lensGeometry: diameter 300–540, shadow room 36. */
export const LOUPE = Object.freeze({ min: 300, max: 540, room: 90, pad: 36, floorZoom: 1.2 });

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The strongest magnification a target `size` px across can take before the loupe
 * would outgrow its cap. Past this the render drops the strength on its own.
 */
export function lensZoomCeiling(size: unknown, frame?: LoupeFrame | null): number {
  return Math.max(LOUPE.floorZoom, (loupeBounds(frame).max - LOUPE.room) / Math.max(24, Number(size) || 0));
}

/** The frame a loupe is drawn on, in the units its target is measured in. */
export interface LoupeFrame {
  width: number;
  height: number;
}

const even = (v: number): number => Math.round(v / 2) * 2;

/**
 * Smallest and largest loupe for a frame: a phone-sized take gets a loupe in proportion
 * (three quarters of its short side at most), a full HD reel keeps 300–540 px.
 */
export function loupeBounds(frame?: LoupeFrame | null): { min: number; max: number } {
  if (!frame || !(frame.width > 0 && frame.height > 0)) return { min: LOUPE.min, max: LOUPE.max };
  const max = Math.min(LOUPE.max, even(Math.min(frame.width, frame.height) * 0.75));
  return { min: Math.min(LOUPE.min, max), max };
}

/**
 * Loupe for a target `size` px across at a requested `zoom` (undefined = auto).
 * Mirrors lib/lens.mjs so the stage and the Produce master agree on what they draw.
 */
export function lensLoupe(size: unknown, zoom?: number | null, frame?: LoupeFrame | null): LensLoupe {
  const s = Math.max(24, Number(size) || 0);
  const { min, max } = loupeBounds(frame);
  let z = zoom ?? clamp(260 / s, 1.5, 2.4);
  const raw = s * z + LOUPE.room;
  if (raw > max) z = lensZoomCeiling(s, frame);
  const diameter = even(clamp(raw, min, max));
  const { W } = glassCanvas(diameter, LOUPE.pad);
  const cropW = Math.max(2, even(W / z));
  return { zoom: z, zoomExact: W / cropW, diameter, S: diameter + 2 * LOUPE.pad, capped: raw > max };
}

/** Hit target for on-frame magnify and zoom controls. */
export const FRAME_EDITOR_HIT = 44;

/**
 * Whether the on-frame editor (strength, size, remove) stays up.
 * A seek that remains inside the selected block must not hide it, including
 * when the author prefers reduced motion.
 */
export function planFrameEditor({
  selected = false,
  blockStart = 0,
  blockEnd = 0,
  playhead = null,
  playing = false,
  reducedMotion = false,
}: FrameEditorInput = {}): { visible: boolean; reducedMotion: boolean } {
  if (!selected || playing || !isFiniteNumber(playhead)) return { visible: false, reducedMotion: Boolean(reducedMotion) };
  const visible = playhead >= blockStart - 0.05 && playhead <= blockEnd + 0.05;
  return { visible, reducedMotion: Boolean(reducedMotion) };
}

/**
 * Whether drawLens should wipe the canvas and redraw, keep the last loupe,
 * or clear because no lens is active.
 *
 * Clearing while readyState < 2 (common mid-seek) is what makes the magnifier
 * vanish during timeline scrub, so a lens on this frame keeps its last loupe.
 *
 * No lens on this frame always clears, whatever `hold` says. `hold` compares the
 * playhead with the selected lens's block, but the playhead is the clock of the
 * surface on stage — so it also "held" a stale loupe over another slide or the
 * recording that happened to share those seconds. It no longer decides anything.
 */
export function planLensPaint({
  hasLens = false,
  viewportCssPx = 0,
  readyState = 0,
}: LensPaintInput = {}): { action: 'keep' | 'clear' | 'draw' } {
  if (!hasLens || viewportCssPx <= 0) return { action: 'clear' };
  if (readyState < 2) return { action: 'keep' };
  return { action: 'draw' };
}

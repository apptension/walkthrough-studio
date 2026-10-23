/**
 * Live-stage seek and loupe paint rules shared by the Studio Editor.
 * Kept free of DOM so scrubbing / magnifier behaviour can be unit-tested.
 */

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
export function lensZoomCeiling(size: unknown): number {
  return Math.max(LOUPE.floorZoom, (LOUPE.max - LOUPE.room) / Math.max(24, Number(size) || 0));
}

/**
 * Loupe for a target `size` px across at a requested `zoom` (undefined = auto).
 * Mirrors lib/lens.mjs so the stage and the Produce master agree on what they draw.
 */
export function lensLoupe(size: unknown, zoom?: number | null): LensLoupe {
  const s = Math.max(24, Number(size) || 0);
  let z = zoom ?? clamp(260 / s, 1.5, 2.4);
  const raw = s * z + LOUPE.room;
  if (raw > LOUPE.max) z = lensZoomCeiling(s);
  const diameter = Math.round(clamp(raw, LOUPE.min, LOUPE.max) / 2) * 2;
  return { zoom: z, diameter, S: diameter + 2 * LOUPE.pad, capped: raw > LOUPE.max };
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
 * vanish during timeline scrub. `hold` keeps that loupe when the on-frame
 * editor is still inside its block even if the lens lookup missed a frame.
 */
export function planLensPaint({
  hasLens = false,
  viewportCssPx = 0,
  readyState = 0,
  hold = false,
}: LensPaintInput = {}): { action: 'keep' | 'clear' | 'draw' } {
  if (hold && readyState < 2) return { action: 'keep' };
  if (!hasLens || viewportCssPx <= 0) return { action: 'clear' };
  if (readyState < 2) return { action: 'keep' };
  return { action: 'draw' };
}

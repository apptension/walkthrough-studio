import { clampZoomCenter } from './zoomAim';

/**
 * Pointer, wheel and key gestures for the on-stage zoom and magnifier editors. Pure so the
 * stage and its tests agree on how far each gesture moves things.
 */

export type Range = readonly [number, number];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** The loupe's target area on its long side, as the stage editors offer it. */
export const LENS_SIZE_RANGE: Range = [24, 540];

/**
 * Corner drag on the zoom surface, relative to where the drag began.
 * `startHalf`/`half` are how far the pointer sits from the frame centre (share of the frame,
 * 0–0.5). Pulling toward the centre pushes in, pushing out pulls back — and grabbing a corner
 * does not snap the zoom to wherever that corner happens to sit.
 */
export function zoomFromCorner(startZoom: number, startHalf: number, half: number, [lo, hi]: Range): number {
  const ratio = Math.max(startHalf, 0.02) / Math.max(half, 0.02);
  return r3(clamp(startZoom * ratio, lo, hi));
}

/** One wheel step: smooth on a trackpad, a fixed notch on a mouse wheel. */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-clamp(px, -120, 120) * 0.0018);
}

export function zoomFromWheel(zoom: number, deltaY: number, range: Range, deltaMode = 0): number {
  return r3(clamp(zoom * wheelFactor(deltaY, deltaMode), range[0], range[1]));
}

/** A key nudge: a small step, or a large one with Shift. `extent` is the span it moves across. */
export function nudgeStep(extent: number, big: boolean): number {
  return Math.max(1, Math.round(extent * (big ? 0.05 : 0.01)));
}

export interface ZoomView {
  cx: number;
  cy: number;
  zoom: number;
  width: number;
  height: number;
}

/**
 * The frame point under a click on the zoomed stage. `fx`/`fy` are the click's share of the
 * stage surface; the surface shows exactly the clamped crop, so the click lands inside it.
 */
export function framePointAt({ cx, cy, zoom, width, height }: ZoomView, fx: number, fy: number): { x: number; y: number } {
  const { crop } = clampZoomCenter(cx, cy, { zoom, width, height });
  return { x: Math.round(crop.x + clamp(fx, 0, 1) * crop.w), y: Math.round(crop.y + clamp(fy, 0, 1) * crop.h) };
}

/** Scale a target area so its long side is `size`, keeping its aspect. */
export function scaleArea(w0: number, h0: number, size: number): { w: number; h: number } {
  const max = Math.max(w0, h0, 1);
  return { w: Math.max(16, Math.round((w0 * size) / max)), h: Math.max(12, Math.round((h0 * size) / max)) };
}

/** The long side after a wheel step or a drag of the ring's grip, inside the editors' range. */
export function lensSizeBy(size: number, factor: number, [lo, hi]: Range = LENS_SIZE_RANGE): number {
  return Math.round(clamp(size * factor, lo, hi));
}

/** Strength a magnifier can actually draw for its area — the stored value never exceeds it. */
export function clampLensZoom(zoom: number | undefined, ceiling: number, [lo]: Range): number | undefined {
  if (zoom == null) return undefined;
  return r3(clamp(zoom, lo, Math.max(lo, ceiling)));
}

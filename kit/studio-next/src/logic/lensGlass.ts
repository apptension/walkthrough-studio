/**
 * The magnifier's optics and its entrance, shared by the render (lib/lens.mjs, ffmpeg geq) and
 * the Studio stage (editor.js, canvas). Pure numbers and functions — no DOM, no ffmpeg.
 *
 * The loupe is modelled as a thick convex glass:
 *   - magnification peaks at the centre and eases off toward the rim (barrel bulge), so straight
 *     UI lines bow the way they do through a real hand lens;
 *   - a bevel band just inside the rim squeezes the image hard and darkens — the glass edge;
 *   - a touch of chromatic aberration (red/blue fringes grow with radius) and a shaded, lit rim.
 * Its entrance scales up, fades in and "swells" into full magnification; the exit mirrors it,
 * shorter and accelerating.
 */
import { CURVES, DEFAULT_CURVE, curveOf, motionScale, type Curve } from './easing';

export interface LensTiming {
  in: number;
  out: number;
  curve?: string;
}

export interface LensOpenState {
  open: number;
  scale: number;
  alpha: number;
  swell: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const GLASS = Object.freeze({
  /** Barrel (d⁴, so the centre stays flat and legible): magnification at the rim is zoom / (1 + bulge). */
  bulge: 0.12,
  /** Extra squeeze across the bevel band, on top of the bulge. */
  bevel: 0.55,
  /** Normalised radius where the bevel band starts. */
  bevelFrom: 0.88,
  /** Chromatic aberration: red samples (1 + ca·d²) further out, blue (1 − ca·d²). */
  aberration: 0.012,
  /** Radial darkening toward the rim (d⁵) and across the bevel band. */
  vignette: 0.14,
  bevelShade: 0.3,
  /** Surface light, in 0–255: a small specular (upper-left), a thin edge highlight arc on the lit
   *  side, a soft top light, and the bottom-right Fresnel crescent. */
  specular: 54,
  edgeLight: 70,
  topLight: 12,
  crescent: 60,
  /** Rim: how much the lit top differs from the shaded bottom (thickness: rimWidth()). */
  rimLight: 0.5,
  /** Drop shadow: alpha at the rim and how far it falls below the glass (fraction of radius). */
  shadow: 150,
  shadowDrop: 0.045,
  /** Entrance / exit: starting scale, starting magnification (fraction of zoom). */
  scaleIn: 0.72,
  scaleOut: 0.84,
  swellIn: 0.86,
  swellOut: 0.93,
  /** Fade: fraction of the open/close window the opacity ramp takes. */
  fadeIn: 0.45,
  fadeOut: 0.9,
});

/** Largest sampling factor the glass ever asks for (steady state, red channel). */
export const GLASS_REACH = (1 + GLASS.bulge + GLASS.bevel) * (1 + GLASS.aberration);

/** Base loupe timing in seconds; `lensTiming()` scales it by the video's motion speed. */
export const LENS_TIMING: Readonly<LensTiming> = Object.freeze({ in: 0.55, out: 0.42 });

const curveTable: Partial<Record<string, Curve>> = CURVES;

export function lensTiming(camera: { motion?: string; curve?: string } = {}): Required<LensTiming> {
  const k = motionScale(camera.motion);
  const named = camera.curve != null ? curveTable[camera.curve] : undefined;
  return { in: LENS_TIMING.in * k, out: LENS_TIMING.out * k, curve: curveOf(camera.curve) === named ? (camera.curve as string) : DEFAULT_CURVE };
}

/** Bevel band ramp 0..1 for normalised radius d. */
export const bevelRamp = (d: number): number => clamp((d - GLASS.bevelFrom) / (1 - GLASS.bevelFrom), 0, 1);

/** Sampling factor at normalised radius d (1 = full magnification). */
export function glassProfile(d: number): number {
  const b = bevelRamp(d);
  return 1 + GLASS.bulge * d ** 4 + GLASS.bevel * b * b;
}

/** Light multiplier at normalised radius d (vignette × bevel shade). */
export function glassShade(d: number): number {
  return (1 - GLASS.vignette * d ** 5) * (1 - GLASS.bevelShade * bevelRamp(d) ** 1.5);
}

/** Metal rim thickness in px for a loupe of `diameter` px. */
export const rimWidth = (diameter: number): number => 3 + diameter / 200;

/**
 * Entrance state `T` seconds into a lens that lasts `dur`:
 *   open   0..1 — how far along the entrance (min of the in-curve and the exit)
 *   scale  glass radius as a fraction of its full size
 *   alpha  opacity
 *   swell  magnification as a fraction of the full zoom
 */
export function lensOpenState(T: number, dur: number, timing: LensTiming = LENS_TIMING): LensOpenState {
  const curve = curveOf(timing.curve);
  const uIn = clamp(T / Math.max(0.001, timing.in), 0, 1);
  const uOut = clamp((dur - T) / Math.max(0.001, timing.out), 0, 1);
  const eIn = curve.fn(uIn);
  const close = 1 - (1 - uOut) ** 3;
  const open = Math.min(eIn, close);
  const lerp = (a: number, e: number): number => a + (1 - a) * e;
  const alphaIn = 1 - (1 - clamp(uIn / GLASS.fadeIn, 0, 1)) ** 2;
  const alphaOut = 1 - clamp((1 - uOut) / GLASS.fadeOut, 0, 1) ** 2;
  return {
    open,
    scale: Math.min(lerp(GLASS.scaleIn, eIn), lerp(GLASS.scaleOut, close)),
    alpha: Math.min(alphaIn, alphaOut),
    swell: Math.min(lerp(GLASS.swellIn, eIn), lerp(GLASS.swellOut, close)),
  };
}

/** Working canvas for a loupe of diameter D with shadow room `pad`: wide enough for the rim's reach. */
export function glassCanvas(diameter: number, pad: number): { S: number; W: number; over: number } {
  const S = diameter + 2 * pad;
  const need = 2 * Math.ceil((diameter / 2) * GLASS_REACH + 6);
  const W = Math.max(S, need + (need % 2));
  return { S, W, over: (W - S) / 2 };
}

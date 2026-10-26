/**
 * Motion curves shared by the render (ffmpeg expressions), the Studio stage (JS) and in-page CSS.
 * One curve id is stored on the video (`direction.camera.curve`) and drives the camera push-in,
 * the pan between targets and the loupe's open/close, so the preview and the master agree.
 *
 * Every curve has a closed form (Penner equations): ffmpeg's expression evaluator cannot solve a
 * cubic-bezier for t, so the CSS strings are the standard equivalents of the same closed forms.
 * `expr(U)` takes an ffmpeg sub-expression already clipped to 0..1 and returns the eased value.
 */

export interface Curve {
  label: string;
  hint: string;
  css: string;
  fn: (u: number) => number;
  expr: (U: string) => string;
}

export type CurveId = 'glide' | 'smooth' | 'cinematic' | 'snappy';

export interface MotionSpeed {
  label: string;
  hint: string;
  scale: number;
}

export type MotionId = 'unhurried' | 'natural' | 'swift';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export const CURVES: Readonly<Record<CurveId, Curve>> = Object.freeze({
  glide: {
    label: 'Glide',
    hint: 'Quick start, long silky settle — the camera lands without a bump',
    css: 'cubic-bezier(.25,1,.5,1)',
    fn: (u: number) => 1 - (1 - clamp01(u)) ** 4,
    expr: (U: string) => `(1-pow(1-${U},4))`,
  },
  smooth: {
    label: 'Smooth',
    hint: 'Eases in and out equally — balanced, never abrupt',
    css: 'cubic-bezier(.45,0,.55,1)',
    fn: (u: number) => {
      const x = clamp01(u);
      return x * x * x * (x * (x * 6 - 15) + 10);
    },
    expr: (U: string) => `(${U}*${U}*${U}*(${U}*(${U}*6-15)+10))`,
  },
  cinematic: {
    label: 'Cinematic',
    hint: 'Weighty start and end — a dolly move, not a cut',
    css: 'cubic-bezier(.65,0,.35,1)',
    fn: (u: number) => {
      const x = clamp01(u);
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
    },
    expr: (U: string) => `if(lt(${U},0.5),4*${U}*${U}*${U},1-pow(-2*${U}+2,3)/2)`,
  },
  snappy: {
    label: 'Snappy',
    hint: 'Lands fast and sticks — brisk social cuts',
    css: 'cubic-bezier(.16,1,.3,1)',
    // Expo-out, normalised so u=1 reaches exactly 1.
    fn: (u: number) => (1 - 2 ** (-10 * clamp01(u))) / (1 - 2 ** -10),
    expr: (U: string) => `((1-pow(2,-10*${U}))/0.9990234375)`,
  },
});
export const CURVE_IDS = Object.freeze(Object.keys(CURVES)) as readonly CurveId[];
export const DEFAULT_CURVE: CurveId = 'glide';

/** How long camera and loupe moves take, as a multiplier on the authored seconds. */
export const MOTION_SPEEDS: Readonly<Record<MotionId, MotionSpeed>> = Object.freeze({
  unhurried: { label: 'Unhurried', hint: 'Longer moves — dense screens, first-time viewers', scale: 1.3 },
  natural: { label: 'Natural', hint: 'The authored timing', scale: 1 },
  swift: { label: 'Swift', hint: 'Shorter moves — teasers and social cuts', scale: 0.75 },
});
export const MOTION_IDS = Object.freeze(Object.keys(MOTION_SPEEDS)) as readonly MotionId[];
export const DEFAULT_MOTION: MotionId = 'natural';

const curveTable: Partial<Record<string, Curve>> = CURVES;
const motionTable: Partial<Record<string, MotionSpeed>> = MOTION_SPEEDS;

export const curveOf = (id: string | null | undefined): Curve => (id ? curveTable[id] : undefined) || CURVES[DEFAULT_CURVE];
export const motionScale = (id: string | null | undefined): number =>
  ((id ? motionTable[id] : undefined) || MOTION_SPEEDS[DEFAULT_MOTION]).scale;

/** Eased 0..1 for `t` seconds after `from` over `dur` seconds. */
export function easeAt(curve: string | null | undefined, t: number, from: number, dur: number): number {
  return curveOf(curve).fn((t - from) / Math.max(0.001, dur));
}

/**
 * Minimum-jerk profile: the velocity bell a hand draws when it points at something. Used for the
 * pointer glide and for a loupe that travels with it, so both arrive together, in the same way.
 */
export const minJerk = (u: number): number => {
  const x = clamp01(u);
  return x * x * x * (x * (x * 6 - 15) + 10);
};
export const minJerkExpr = (U: string): string => `(${U}*${U}*${U}*(${U}*(${U}*6-15)+10))`;

/** ffmpeg: `clip((T-from)/dur,0,1)` with 3-decimal literals. */
export function unitExpr(timeVar: string, from: number, dur: number): string {
  return `clip((${timeVar}-${Number(from).toFixed(3)})/${Math.max(0.001, dur).toFixed(3)},0,1)`;
}

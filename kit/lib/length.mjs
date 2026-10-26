/**
 * Target length is a hint for the script, not a render format. Any length in range is kept;
 * a longer video just takes longer to record and render. Keep the bounds in step with
 * `kit/studio/src/logic/length.ts`.
 */
export const LENGTH_MIN_SEC = 30;
export const LENGTH_MAX_SEC = 60 * 60;
export const LENGTH_PRESETS = [60, 90, 120, 180];

/** A positive number of seconds, rounded and held inside the range. Anything else uses `fallback`. */
export function clampLengthSec(value, fallback = 120) {
  const n = Number(value);
  const picked = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.min(LENGTH_MAX_SEC, Math.max(LENGTH_MIN_SEC, Math.round(Number(picked) || fallback)));
}

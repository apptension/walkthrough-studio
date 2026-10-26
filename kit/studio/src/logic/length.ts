/**
 * Target length is a hint for the script, not a render format. Keep the bounds in step with
 * `kit/lib/length.mjs`.
 */
export const LENGTH_MIN_SEC = 30;
export const LENGTH_MAX_SEC = 60 * 60;
export const LENGTH_PRESETS = [60, 90, 120, 180] as const;

/** A positive number of seconds, rounded and held inside the range. Anything else uses `fallback`. */
export function clampLengthSec(value: unknown, fallback = 120): number {
  const n = Number(value);
  const picked = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.min(LENGTH_MAX_SEC, Math.max(LENGTH_MIN_SEC, Math.round(Number(picked) || fallback)));
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, half: 0.5 };

/** "about 8 minutes", "90 seconds", "half a minute" → seconds, or null when the text states no duration. */
export function lengthFromText(text: string): number | null {
  if (/\bhalf a minute\b/i.test(text)) return LENGTH_MIN_SEC;
  const m = text.match(/\b(\d+(?:\.\d+)?|a|an|one|two|three|four|five|half)\s*(?:-|\s)?(minutes?|mins?|m|seconds?|secs?|s)\b/i);
  if (!m) return null;
  const n = Number(m[1]) || NUMBER_WORDS[(m[1] || '').toLowerCase()] || 0;
  if (!n) return null;
  const sec = /^m/i.test(m[2] || '') ? n * 60 : n;
  if (sec < 10) return null;
  return clampLengthSec(sec);
}

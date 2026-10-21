/**
 * Monitor / Program player source rules — pure helpers so scrub/play regressions
 * after plate preview, encode, or mode switches can be unit-tested.
 */

export const MONITOR_MODES = Object.freeze(['program', 'plate', 'compare']);

/** Map legacy / mistaken mode ids onto the three real panes. */
export function normalizeMonitorMode(mode) {
  if (mode === 'html' || mode === 'editor') return 'plate';
  if (MONITOR_MODES.includes(mode)) return mode;
  return 'program';
}

/** True when the video element is already pointed at the delivery master (ignore ?t=). */
export function isDeliverySrc(playerSrc, deliveryUrl) {
  if (!playerSrc || !deliveryUrl) return false;
  const master = String(deliveryUrl).split('?')[0];
  if (!master) return false;
  const src = String(playerSrc).split('?')[0];
  return src === master || src.endsWith(master) || src.includes(master);
}

/**
 * Whether Program should reload the delivery master into `#player`.
 * `previewingPlate` means the program element is intentionally showing a plate MP4 / other stand-in.
 */
export function needsProgramRestore({
  monitorMode = 'program',
  previewingPlate = null,
  playerSrc = '',
  deliveryUrl = null,
  force = false,
} = {}) {
  if (normalizeMonitorMode(monitorMode) !== 'program') return false;
  if (!deliveryUrl) return false;
  if (force) return true;
  if (previewingPlate) return true;
  return !isDeliverySrc(playerSrc, deliveryUrl);
}

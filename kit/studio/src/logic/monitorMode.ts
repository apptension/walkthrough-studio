/**
 * Monitor / Program player source rules — pure helpers so scrub/play regressions
 * after plate preview, encode, or mode switches can be unit-tested.
 */

export type MonitorMode = 'program' | 'live' | 'plate' | 'compare';

export const MONITOR_MODES: readonly MonitorMode[] = Object.freeze(['program', 'live', 'plate', 'compare'] as const);

/** Map legacy / mistaken mode ids onto the real panes. */
export function normalizeMonitorMode(mode: unknown): MonitorMode {
  if (mode === 'html' || mode === 'editor') return 'plate';
  if ((MONITOR_MODES as readonly unknown[]).includes(mode)) return mode as MonitorMode;
  return 'program';
}

export interface CaptureState {
  recording?: boolean;
  repairing?: boolean;
}

/**
 * Live tab is only for an active capture (recording or flow repair).
 * Last-frame previews stay off the tab strip — they slide out under Program when capture ends.
 */
export function liveTabVisible({ recording = false, repairing = false }: CaptureState = {}): boolean {
  return Boolean(recording || repairing);
}

/** True when the video element is already pointed at the delivery master (ignore ?t=). */
export function isDeliverySrc(playerSrc: string | null | undefined, deliveryUrl: string | null | undefined): boolean {
  if (!playerSrc || !deliveryUrl) return false;
  const master = String(deliveryUrl).split('?')[0];
  if (!master) return false;
  const src = String(playerSrc).split('?')[0] ?? '';
  return src === master || src.endsWith(master) || src.includes(master);
}

export interface ProgramRestoreInput {
  monitorMode?: string;
  previewingPlate?: unknown;
  playerSrc?: string;
  deliveryUrl?: string | null;
  force?: boolean;
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
}: ProgramRestoreInput = {}): boolean {
  if (normalizeMonitorMode(monitorMode) !== 'program') return false;
  if (!deliveryUrl) return false;
  if (force) return true;
  if (previewingPlate) return true;
  return !isDeliverySrc(playerSrc, deliveryUrl);
}

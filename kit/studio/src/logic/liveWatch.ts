/**
 * Live monitor frame. Program shows the master; Live tab is only while capturing.
 * A finished delivery may keep a last-frame URL for the Live pane resume — not for
 * the Activity bay idle card (that thumb is capture-only).
 */

export interface ProgramPreviewInput {
  recording?: boolean;
  repairing?: boolean;
  previewUrl?: string | null;
  hasLive?: boolean;
  hasDelivery?: boolean;
}

export interface ProgramPreview {
  show: boolean;
  empty: boolean;
  url: string | null;
  badge: '' | 'Live' | 'Repairing' | 'Last frame';
}

export function programPreview({
  recording = false,
  repairing = false,
  previewUrl = null,
  hasLive = false,
  hasDelivery = false,
}: ProgramPreviewInput = {}): ProgramPreview {
  if (recording && previewUrl) return { show: true, empty: false, url: previewUrl, badge: 'Live' };
  if (repairing && previewUrl) return { show: true, empty: false, url: previewUrl, badge: 'Repairing' };
  if (previewUrl) return { show: true, empty: false, url: previewUrl, badge: 'Last frame' };
  return { show: false, empty: !hasLive && !hasDelivery, url: null, badge: '' };
}

/** Activity bay live thumb: only while the page is being captured or repaired. */
export function activityThumbVisible({
  recording = false,
  repairing = false,
}: { recording?: boolean; repairing?: boolean } = {}): boolean {
  return Boolean(recording || repairing);
}

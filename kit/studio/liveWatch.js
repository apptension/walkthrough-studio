/**
 * Live monitor frame. Program shows the master; Live tab is only while capturing.
 * A finished delivery may keep a last-frame URL for the Live pane resume — not for
 * the Activity bay idle card (that thumb is capture-only).
 */

export function programPreview({
  recording = false,
  repairing = false,
  previewUrl = null,
  hasLive = false,
  hasDelivery = false,
} = {}) {
  if (recording && previewUrl) return { show: true, empty: false, url: previewUrl, badge: 'Live' };
  if (repairing && previewUrl) return { show: true, empty: false, url: previewUrl, badge: 'Repairing' };
  if (previewUrl) return { show: true, empty: false, url: previewUrl, badge: 'Last frame' };
  return { show: false, empty: !hasLive && !hasDelivery, url: null, badge: '' };
}

/** Activity bay live thumb: only while the page is being captured or repaired. */
export function activityThumbVisible({ recording = false, repairing = false } = {}) {
  return Boolean(recording || repairing);
}

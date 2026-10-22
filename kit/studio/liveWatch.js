/**
 * Live monitor frame. Program shows the master; Live tab shows this page capture.
 * A finished delivery does not hide the last frame — the Live tab still offers it.
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

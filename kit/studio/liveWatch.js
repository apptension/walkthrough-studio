/** What Program shows while a recording is in progress, and after it stops. */

export function programPreview({
  recording = false,
  repairing = false,
  previewUrl = null,
  hasLive = false,
  hasDelivery = false,
} = {}) {
  if (recording && previewUrl) return { show: true, empty: false, url: previewUrl, badge: 'Live' };
  if (repairing && previewUrl) return { show: true, empty: false, url: previewUrl, badge: 'Repairing' };
  if (previewUrl && !hasDelivery) return { show: true, empty: false, url: previewUrl, badge: 'Last frame' };
  if (hasDelivery && hasLive && !recording) return { show: false, empty: false, url: null, badge: '' };
  return { show: false, empty: !hasLive && !hasDelivery, url: null, badge: '' };
}

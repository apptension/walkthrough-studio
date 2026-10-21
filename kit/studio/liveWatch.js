/** What Program shows while a recording is in progress, and after it stops. */

export function programPreview({ recording = false, previewUrl = null, hasLive = false, hasDelivery = false } = {}) {
  if (recording && previewUrl) return { show: true, empty: false, url: previewUrl };
  if (previewUrl && !hasDelivery) return { show: true, empty: false, url: previewUrl };
  if (hasDelivery && hasLive && !recording) return { show: false, empty: false, url: null };
  return { show: false, empty: !hasLive && !hasDelivery, url: null };
}

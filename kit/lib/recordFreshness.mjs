/** Whether the next render must record again. A new start URL counts even when flow.mjs did not change. */

export function recordNeedsRerecord({
  hasLive = false,
  flowNewer = false,
  recordedUrl = '',
  startUrl = '',
  recordedLogin = null,
  loginRequired = false,
} = {}) {
  if (!hasLive) return false;
  if (flowNewer) return true;
  if (recordedUrl && startUrl && recordedUrl !== startUrl) return true;
  if (recordedLogin != null && Boolean(recordedLogin) !== Boolean(loginRequired)) return true;
  return false;
}

export function recordTakeNote({ hasLive = false, flowNewer = false, urlChanged = false, loginChanged = false } = {}) {
  if (!hasLive) return '';
  const reason = recordRerecordReason({ flowNewer, urlChanged, loginChanged });
  return reason ? `${reason}. This take replaces the old capture.` : '';
}

export function recordRerecordReason({ flowNewer = false, urlChanged = false, loginChanged = false } = {}) {
  if (urlChanged) return 'Start URL changed — re-record before produce';
  if (loginChanged) return 'Sign-in changed — re-record before produce';
  if (flowNewer) return 'flow.mjs is newer than live.mp4 — re-record before produce';
  return '';
}

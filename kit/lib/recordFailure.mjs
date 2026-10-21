/** Whether Program should show the failed take's screenshot. A newer recording hides it. */
export function recordFailureView({ shotMtime = null, liveMtime = null, note = '', screenshot = 'error.png' } = {}) {
  if (shotMtime == null) return null;
  if (liveMtime != null && liveMtime >= shotMtime) return null;
  const line = String(note || '')
    .split('\n')
    .map((part) => part.trim())
    .find(Boolean);
  return {
    message: (line || 'Recording failed').slice(0, 280),
    screenshot,
  };
}

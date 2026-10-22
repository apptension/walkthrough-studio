/** Program's record-failure panel. A newer successful take hides it.
 * Plate-only output is not treated as a captured tour.
 */

function firstLine(note) {
  return (
    String(note || '')
      .split('\n')
      .map((part) => part.trim())
      .find(Boolean) || ''
  );
}

export function describeRecordFailure(note) {
  const text = String(note || '');
  const url = text.match(/https?:\/\/[^\s)]+/)?.[0] || '';
  let reason = 'The recording stopped before the walkthrough finished.';
  let next = 'Re-record once the page is ready, or use Fix with AI to repair the flow.';
  if (/net::ERR|ERR_CONNECTION|ECONNREFUSED/i.test(text)) {
    reason = 'The browser could not open the start URL.';
    next = 'Start the app, confirm the URL, then re-record.';
  } else if (/btnScriptApprove|not enabled|element is not enabled/i.test(text) && /Approve/i.test(text)) {
    reason = 'The script was already approved, so Approve was not clickable.';
    next = 'Close the script sheet and continue, or re-approve only after a real script change.';
  } else if (/page\.goto/i.test(text) && /Timeout \d+ms exceeded/i.test(text)) {
    reason = 'The start URL did not load before the timeout.';
    next = 'Check that the server is running, then re-record.';
  } else if (/Timeout \d+ms exceeded/i.test(text) && /navigating to|waiting until/i.test(text)) {
    reason = 'The start URL did not load before the timeout.';
    next = 'Check that the server is running, then re-record.';
  } else if (/selector retry failed/i.test(text)) {
    reason = 'A control on the page did not match the flow.';
    next = 'Use Fix with AI or edit the selector, then re-record.';
  } else if (/stall/i.test(text)) {
    reason = 'The recording stalled before the next step.';
    next = 'Use Fix with AI to read the stall, or re-record when the page is ready.';
  }
  const line = firstLine(text).replace(/^✗\s*/, '');
  const noisy = /locator\.|Timeout|Error:|page\.|browser has been closed|waiting for|net::ERR|selector retry/i.test(line);
  // Prefer the classified headline; only promote a short plain line when nothing matched.
  const fallback = 'The recording stopped before the walkthrough finished.';
  if (reason === fallback && line && line.length < 160 && !noisy && !/^Error$/.test(line)) reason = line;
  return { reason, url, next, technical: noisy ? line : '' };
}

export function recordFailureView({ shotMtime = null, liveMtime = null, note = '', screenshot = 'error.png' } = {}) {
  if (shotMtime == null) return null;
  // A good take on disk wins. A later aborted retry must not cover Program — the previous
  // live.mp4 is still the product take (failure only deletes the in-progress .recording.mp4).
  if (liveMtime != null) return null;
  const described = describeRecordFailure(note);
  return {
    ...described,
    message: [described.reason, described.url, described.next].filter(Boolean).join(' '),
    screenshot,
  };
}

export function recordFailureNote(view) {
  if (!view) return '';
  return [view.reason, view.url, view.next].filter(Boolean).join('\n');
}

/** A master made of plates alone is not captured product footage. */
export function capturedTour({ hasLive, recordFailed } = {}) {
  return Boolean(hasLive) && !recordFailed;
}

export function recordFailureAction() {
  return { label: 'Re-record', mode: 'full' };
}

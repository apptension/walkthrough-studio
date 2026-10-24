/**
 * ctx.optional(label, fn): a step the story does not depend on (cookie banner, tip, a guessed
 * selector). Its Playwright actions get a short timeout; a miss logs a warning and the take goes on.
 * A capture stall is never swallowed.
 */
export const OPTIONAL_TIMEOUT_MS = 8000;
const DEFAULT_TIMEOUT_MS = 30000;

export async function runOptional(
  { page, label = 'optional step', fn, timeoutMs = OPTIONAL_TIMEOUT_MS, restoreTimeoutMs = DEFAULT_TIMEOUT_MS, log = console.log, mark } = {},
) {
  if (typeof fn !== 'function') throw new Error('optional(label, fn) needs an async function');
  page?.setDefaultTimeout?.(timeoutMs);
  let timer;
  try {
    const backstop = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`optional step took longer than ${timeoutMs + 2000}ms`)), timeoutMs + 2000);
    });
    const value = await Promise.race([Promise.resolve().then(fn), backstop]);
    return value === undefined ? true : value;
  } catch (err) {
    if (err?.name === 'CaptureStallError') throw err;
    const reason = String(err?.message || err).split('\n')[0].slice(0, 200);
    log(`⚠ optional · ${label} skipped: ${reason}`);
    mark?.('optional-skip', `skipped: ${label}`, 'mark', { reason });
    return false;
  } finally {
    clearTimeout(timer);
    page?.setDefaultTimeout?.(restoreTimeoutMs);
  }
}

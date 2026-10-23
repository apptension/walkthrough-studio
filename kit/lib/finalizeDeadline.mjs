/**
 * Bound the capture's shutdown sequence: hide the cursor overlay, stop the screencast,
 * flush the frame encoder, save the session.
 *
 * The flow's own stall watchdog (captureStall.mjs) stops the moment the timed flow
 * finishes — it only ever guarded chapter/caption progress. Everything after that
 * (CDP calls on a page that may be navigating away, an ffmpeg process that may wedge
 * on close) ran with no deadline at all: one hung call froze the whole job with no
 * further log line, forever. Every step here gets a bound and a log line instead.
 */

/**
 * @param {Promise<unknown>} promise
 * @param {number} ms
 * @param {{ now?: () => number, schedule?: Function, clear?: Function }} [clock]
 * @returns {Promise<{ timedOut: boolean, value?: unknown, error?: unknown, elapsedMs: number }>}
 */
export function withDeadline(promise, ms, clock = {}) {
  const now = clock.now ?? Date.now;
  const schedule = clock.schedule ?? setTimeout;
  const clear = clock.clear ?? clearTimeout;
  const startedAt = now();

  let timer;
  const timedOut = new Promise((resolve) => {
    timer = schedule(() => resolve({ timedOut: true, elapsedMs: now() - startedAt }), ms);
  });
  // A rejection becomes a result, not a throw: the race must always settle on whichever
  // side is first, and an unhandled rejection on the loser must never surface later.
  const settled = Promise.resolve(promise).then(
    (value) => ({ timedOut: false, value, elapsedMs: now() - startedAt }),
    (error) => ({ timedOut: false, error, elapsedMs: now() - startedAt }),
  );
  return Promise.race([settled, timedOut]).then((result) => {
    clear(timer);
    return result;
  });
}

export class FinalizeTimeoutError extends Error {
  /**
   * @param {string} label
   * @param {number} ms
   */
  constructor(label, ms) {
    super(`"${label}" did not finish within ${ms}ms — capture shutdown stopped instead of hanging`);
    this.name = 'FinalizeTimeoutError';
    this.label = label;
    this.ms = ms;
  }
}

/**
 * Run one shutdown step with a deadline.
 *
 * `critical` steps are the ones a valid take cannot exist without (writing the encoded
 * video to disk): a timeout there throws `FinalizeTimeoutError` so the take fails fast
 * with a clear reason, same as any other capture failure. Everything else (hiding the
 * cursor overlay, stopping the screencast, saving the session) is best-effort: a timeout
 * logs a warning and the take continues without it.
 *
 * @param {string} label
 * @param {Promise<unknown>} promise
 * @param {{ ms: number, critical?: boolean, log?: (msg: string) => void, clock?: object }} opts
 */
export async function finalizeStep(label, promise, { ms, critical = false, log = console.log, clock } = {}) {
  log(`» finish · ${label}`);
  const result = await withDeadline(promise, ms, clock);
  if (result.timedOut) {
    if (critical) throw new FinalizeTimeoutError(label, ms);
    log(`⚠ finish · "${label}" did not finish within ${ms}ms — continuing without it`);
    return undefined;
  }
  if ('error' in result) throw result.error;
  return result.value;
}

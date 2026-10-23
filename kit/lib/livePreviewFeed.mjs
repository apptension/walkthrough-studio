/**
 * Publish the latest screencast JPEG for the Studio monitor.
 *
 * Playwright acks Chromium only after the frame callback returns, and Chromium
 * stops the cast once a few frames are unacked. A synchronous write of a
 * full-viewport JPEG on that path stalls the cast, so the monitor sits on the
 * last paint — often the click that just navigated. Disk work is scheduled off
 * the callback, and the file is replaced by rename so a reader never decodes a
 * torn JPEG.
 */
import { rename, writeFile } from 'node:fs/promises';

/** How often a new preview file is published. Frames in between are dropped. */
export const PREVIEW_INTERVAL_MS = 100;
/** Wait this long after a navigation before deciding the cast has gone quiet. */
export const SCREENCAST_NAV_GRACE_MS = 1200;
/** Restart attempts for one navigation that never produces a frame. */
export const SCREENCAST_NAV_RESTARTS = 3;

/** `Cache-Control` for a media basename, or undefined to leave the default. */
export function previewCacheControl(filename) {
  if (filename === 'live-preview.jpg' || filename === 'live-preview.json') return 'no-store';
  return undefined;
}

/**
 * Chromium sometimes stops emitting screencast frames after a main-frame
 * navigation. If none have arrived within each grace window, restart the cast,
 * a few times. A frame newer than the navigation resets the counter.
 *
 * The attempt budget is per navigation, not per capture: `attemptsNavigatedAt`
 * remembers which navigation `attempts` applies to, and a later, distinct
 * navigation always starts with a fresh budget. Without this, one click early in
 * a long multi-chapter walkthrough that never recovered its cast would spend the
 * whole budget and leave the live preview frozen for every navigation after it —
 * "it just stops" partway through a capture, never trying again.
 */
export function planScreencastRestart({
  navigatedAt = 0,
  lastFrameAt = 0,
  now = 0,
  attempts = 0,
  attemptsNavigatedAt = 0,
  graceMs = SCREENCAST_NAV_GRACE_MS,
  maxAttempts = SCREENCAST_NAV_RESTARTS,
} = {}) {
  if (!navigatedAt) return { restart: false, attempts, attemptsNavigatedAt };
  if (lastFrameAt >= navigatedAt) return { restart: false, attempts: 0, attemptsNavigatedAt };
  if (navigatedAt !== attemptsNavigatedAt) {
    attempts = 0;
    attemptsNavigatedAt = navigatedAt;
  }
  if (attempts >= maxAttempts) return { restart: false, attempts, attemptsNavigatedAt };
  if (now < navigatedAt + graceMs * (attempts + 1)) return { restart: false, attempts, attemptsNavigatedAt };
  return { restart: true, attempts: attempts + 1, attemptsNavigatedAt };
}

/**
 * @param {string} previewPath
 * @param {string} metaPath
 * @param {object} [opts]
 * @param {number} [opts.intervalMs]
 * @param {() => number} [opts.now]
 * @param {(fn: () => unknown, ms: number) => unknown} [opts.schedule]
 * @param {(id: unknown) => void} [opts.clear]
 * @param {(path: string, data: Buffer | string) => Promise<void>} [opts.writeFile]
 * @param {(from: string, to: string) => Promise<void>} [opts.rename]
 */
export function createLivePreviewFeed(previewPath, metaPath, opts = {}) {
  const intervalMs = opts.intervalMs ?? PREVIEW_INTERVAL_MS;
  const now = opts.now ?? (() => Date.now());
  const schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const clear = opts.clear ?? ((id) => clearTimeout(id));
  const write = opts.writeFile ?? ((path, data) => writeFile(path, data));
  const move = opts.rename ?? ((from, to) => rename(from, to));
  const tmpPath = `${previewPath}.tmp`;

  let latest = null;
  let lastFlush = 0;
  let timer = null;
  let writing = false;
  let closed = false;
  /** @type {Promise<void>} */
  let inflight = Promise.resolve();

  const clearTimer = () => {
    if (timer == null) return;
    clear(timer);
    timer = null;
  };

  const scheduleFlush = () => {
    if (timer != null || writing || closed || latest == null) return;
    const wait = Math.max(0, intervalMs - (now() - lastFlush));
    timer = schedule(() => {
      timer = null;
      return flush();
    }, wait);
  };

  const flush = () => {
    if (writing || latest == null) return inflight;
    const data = latest;
    latest = null;
    writing = true;
    const at = now();
    inflight = (async () => {
      try {
        await write(tmpPath, data);
        await move(tmpPath, previewPath);
        await write(metaPath, JSON.stringify({ at }));
        lastFlush = at;
      } catch {
        /* a preview miss must not stop the take */
      } finally {
        writing = false;
        if (latest != null && !closed) scheduleFlush();
      }
    })();
    return inflight;
  };

  return {
    /** Remember the newest JPEG. Returns immediately — safe on the screencast ack path. */
    push(data) {
      if (closed || data == null) return;
      latest = data;
      scheduleFlush();
    },
    async stop() {
      closed = true;
      clearTimer();
      await inflight;
      if (latest != null) await flush();
    },
  };
}

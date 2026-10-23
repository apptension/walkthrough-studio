/**
 * The reviewer's own take. A guided session films the tour while it is shown, so after Finish
 * the reviewer can keep that recording instead of letting the bot replay the steps.
 *
 * Paused stretches are cut, not frozen: the take clock skips them, frames that arrive while
 * paused are held back, and the screen as it stands on Resume is the first frame after the cut.
 * Chapters come from the same rule the guided replay compiles (`tourChapters`), so the take's
 * chapter marks and the script of record pair by title and every card lands where it was marked.
 *
 * Outputs (video.out/guide): take.mp4 and take.json. `adoptGuidedTake` promotes them to
 * live.mp4 + timeline.json + live-meta.json, exactly the files a bot take leaves behind.
 */
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** On-screen hold of a chapter card in a guided replay, and on the reviewer's take. */
export const CHAPTER_HOLD_MS = 2600;

const TAKE_DIR = (video) => join(video.out, 'guide');
export const takeFiles = (video) => ({
  take: join(TAKE_DIR(video), 'take.mp4'),
  recording: join(TAKE_DIR(video), 'take.recording.mp4'),
  meta: join(TAKE_DIR(video), 'take.json'),
  poster: join(TAKE_DIR(video), 'take-poster.jpg'),
});

/** First words of a page title, as the opening chapter of a tour that starts with an action. */
export function chapterTitle(s, n) {
  const raw = s.title || s.lands || '';
  const words = String(raw).replace(/[|–—·:].*$/, '').trim().split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
  return words || `Moment ${n}`;
}

/**
 * The chapters a tour opens: one for the opening screen when the reviewer acted before their
 * first Mark, then one per Mark. `at` is the step time on the session clock (ms).
 */
export function tourChapters(tour) {
  const steps = tour?.steps || [];
  const firstMark = steps.findIndex((s) => s.type === 'mark');
  const opensWithAction = steps.slice(0, firstMark < 0 ? steps.length : firstMark).some((s) => s.type !== 'start');
  const start = steps.find((s) => s.type === 'start');
  const out = [];
  if (opensWithAction) out.push({ title: chapterTitle(start || {}, out.length + 1), note: '', at: start?.at ?? 0, step: start?.id || null });
  for (const s of steps) {
    if (s.type !== 'mark') continue;
    out.push({ title: s.title || `Moment ${out.length + 1}`, note: s.note || '', at: s.at ?? 0, step: s.id || null });
  }
  return out;
}

/**
 * The take's clock on the wall clock: `begin` when recording starts, `pause`/`resume` around
 * stretches that are cut. `toTake(wall)` is where a wall time lands in the take (ms); a time
 * inside a pause lands on its cut.
 */
export function createTakeClock() {
  let t0 = 0;
  let pausedAt = null;
  let pausedMs = 0;
  const cuts = [];
  const clock = {
    begin(now) {
      t0 = now;
    },
    get started() {
      return t0 > 0;
    },
    get paused() {
      return pausedAt != null;
    },
    get pausedAt() {
      return pausedAt;
    },
    get t0() {
      return t0;
    },
    pause(now) {
      if (!t0 || pausedAt != null) return false;
      pausedAt = now;
      return true;
    },
    resume(now) {
      if (pausedAt == null) return false;
      const dur = Math.max(0, now - pausedAt);
      cuts.push({ wall: pausedAt, dur, at: pausedAt - t0 - pausedMs });
      pausedMs += dur;
      pausedAt = null;
      return true;
    },
    toTake(wall) {
      if (!t0) return 0;
      let shift = 0;
      for (const c of cuts) {
        if (wall >= c.wall + c.dur) shift += c.dur;
        else if (wall >= c.wall) return Math.max(0, c.wall - t0 - shift);
      }
      if (pausedAt != null && wall >= pausedAt) return Math.max(0, pausedAt - t0 - shift);
      return Math.max(0, wall - t0 - shift);
    },
    /** Epoch ms on the take clock — what the frame recorder places frames by. */
    epoch(wall) {
      return t0 + clock.toTake(wall);
    },
    cuts: () => cuts.map((c) => ({ at: Number((c.at / 1000).toFixed(3)), dur: Number((c.dur / 1000).toFixed(3)) })),
    get pausedMs() {
      return pausedMs + (pausedAt != null ? Math.max(0, Date.now() - pausedAt) : 0);
    },
  };
  return clock;
}

/**
 * Screencast frames → frame recorder, through the take clock. Frames painted while paused are
 * held back; Resume places the latest one at the cut, so the take never shows the old screen
 * after the reviewer set something up off camera.
 */
export function createTakeFeed(recorder, clock) {
  let held = null;
  return {
    onFrame(frame) {
      if (!clock.started || !frame?.data) return;
      if (clock.paused && frame.timestamp >= clock.pausedAt) {
        held = frame;
        return;
      }
      recorder.onFrame({ data: frame.data, timestamp: clock.epoch(frame.timestamp) });
    },
    pause(now) {
      held = null;
      return clock.pause(now);
    },
    resume(now) {
      if (!clock.resume(now)) return false;
      if (held) recorder.onFrame({ data: held.data, timestamp: clock.epoch(now) });
      held = null;
      return true;
    },
  };
}

const POINTER_STEPS = { click: 'click', dblclick: 'click', rightclick: 'click', check: 'click', select: 'click', fill: 'type' };

/**
 * The take's timeline in the shape a bot take writes: start, chapters (labels exactly as the
 * script of record names them), pointer marks for auto zoom, end. Times in seconds on the take.
 * @param {object} tour guided-tour.json
 * @param {{ clock: ReturnType<typeof createTakeClock>, tourT0: number, seconds: number }} take
 */
export function takeTimeline(tour, { clock, tourT0, seconds }) {
  const at = (sessionMs) => Number(Math.min(seconds, Math.max(0, clock.toTake(tourT0 + (sessionMs || 0)) / 1000)).toFixed(3));
  const marks = [{ id: 'start', label: 'live start', kind: 'mark', t: 0.001 }];
  tourChapters(tour).forEach((c, i) => {
    marks.push({ id: `chapter-${i + 1}`, label: c.title, kind: 'chapter', t: Math.max(0.001, at(c.at)), body: c.note || '', dur: CHAPTER_HOLD_MS / 1000, step: c.step });
  });
  for (const s of tour?.steps || []) {
    const kind = POINTER_STEPS[s.type];
    const box = s.target?.box;
    if (!kind || !box || !(box.w > 0) || !(box.h > 0)) continue;
    const p = s.target.point || { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    marks.push({
      id: kind,
      label: kind === 'type' ? 'fill' : 'click',
      kind,
      t: at(s.at),
      x: Math.round(p.x),
      y: Math.round(p.y),
      rect: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) },
      step: s.id,
    });
  }
  marks.push({ id: 'end', label: 'live end', kind: 'mark', t: Number(Math.max(0, seconds - 0.4).toFixed(3)) });
  return marks.sort((a, b) => a.t - b.t);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** The reviewer's take from the last guided session, or null when that session filmed nothing. */
export function readGuidedTake(video) {
  const f = takeFiles(video);
  if (!existsSync(f.take)) return null;
  const meta = readJson(f.meta);
  return meta ? { ...meta, file: f.take } : null;
}

/**
 * Keep the reviewer's take as the video's take: live.mp4, timeline.json, live-meta.json and the
 * guided replay as flow.mjs (the script of record — its chapter titles are the take's marks).
 * The previous flow.mjs is kept beside it so a bot re-record of the old script stays one rename away.
 * @param {object} video
 * @param {{ assertPlayable?: Function }} [deps]
 */
export function adoptGuidedTake(video, { assertPlayable = null } = {}) {
  const f = takeFiles(video);
  const meta = readJson(f.meta);
  if (!existsSync(f.take) || !meta) {
    throw new Error('No recording from the last guided session. Show the tour again and press Start recording in the Recorder window.');
  }
  const tour = readJson(join(video.dir, 'guided-tour.json'));
  if (!tour) throw new Error('guided-tour.json is missing — show the tour again.');
  if (meta.tourFinishedAt && tour.finishedAt && meta.tourFinishedAt !== tour.finishedAt) {
    throw new Error('The recording and guided-tour.json come from different sessions — show the tour again.');
  }
  if (assertPlayable) assertPlayable(f.take, { expectedSec: meta.seconds, label: 'your recording' });

  // The script of record goes first, so the take is newer than it and never reads as stale.
  const flow = join(video.dir, 'flow.mjs');
  const replay = join(video.dir, 'guided-flow.mjs');
  if (existsSync(replay)) {
    if (existsSync(flow) && readFileSync(flow, 'utf8') !== readFileSync(replay, 'utf8')) copyFileSync(flow, join(video.dir, 'flow.before-take.mjs'));
    copyFileSync(replay, flow);
  }

  const live = join(video.out, 'live.mp4');
  const staging = join(video.out, 'live.adopting.mp4');
  copyFileSync(f.take, staging);
  renameSync(staging, live);
  writeFileSync(join(video.out, 'timeline.json'), JSON.stringify(meta.timeline, null, 2));
  const liveMeta = {
    slug: video.slug,
    source: 'reviewer',
    flow: null,
    pace: { id: 'reviewer', tempo: 1, override: false, shifts: 0, narrationHoldSec: 0, narrationHoldShare: 0 },
    timeline: meta.timeline,
    overlays: { mode: 'clean', pipeline: 1 },
    capture: {
      frames: meta.frames,
      seconds: meta.seconds,
      capture: meta.capture,
      method: 'reviewer take · screencast JPEG q100, timestamp-placed, lossless x264',
      profile: meta.profile,
      viewport: meta.viewport,
      raster: meta.viewport,
      stage: meta.stage || null,
      cuts: meta.cuts || [],
    },
    startUrl: meta.startUrl || tour.startUrl || null,
    loginRequired: Boolean(video.config?.record?.loginRequired ?? video.config?.env?.email),
    createdAt: meta.recordedAt || new Date().toISOString(),
    adoptedAt: new Date().toISOString(),
  };
  writeFileSync(join(video.out, 'live-meta.json'), JSON.stringify(liveMeta, null, 2));
  if (existsSync(f.poster)) copyFileSync(f.poster, join(video.out, 'live-preview.jpg'));
  for (const stale of ['frame-text.json', 'error.png', 'error.txt']) rmSync(join(video.out, stale), { force: true });
  return {
    seconds: meta.seconds,
    chapters: meta.timeline.filter((m) => m.kind === 'chapter').map((m) => m.label),
    cuts: meta.cuts || [],
    flow: existsSync(replay),
    adoptedAt: liveMeta.adoptedAt,
  };
}

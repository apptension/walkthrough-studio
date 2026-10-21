/**
 * Motion system for live recordings. Same design language as the brand plates:
 * brand font, accent gradient, expo easing, masked text rises, and a matched
 * exit for every entrance. Everything is parametrised by the brand pack.
 */
import { spawn } from 'node:child_process';
import { assertX264Args, BT709_TAGS, losslessX264, QUALITY, toBt709 } from './encode.mjs';
import { renderLiveCardHtml } from './liveCards.mjs';
import { createOverlays } from './overlays.mjs';
import { hexA } from './text.mjs';

export const FPS = 30;
const FRAME_MS = 1000 / FPS;

const palette = (brand) => {
  const c = brand.colors;
  return {
    ink: c.ink,
    surface: c.surface || c.ink,
    gold: c.gold,
    amber: c.amber,
    text: c.text || '#f8fafc',
    muted: c.muted || '#94a3b8',
    onAccent: c.onAccent || '#111',
    font: brand.font.family,
  };
};

/** Load the brand font into every document so overlays never fall back to serif. */
export async function installBrandFonts(context, brand) {
  await context.addInitScript((href) => {
    const add = () => {
      if (document.getElementById('wt-brand-fonts')) return;
      const link = document.createElement('link');
      link.id = 'wt-brand-fonts';
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add);
  }, brand.font.css);
}

/**
 * Accent click point; Playwright locator titles never shown. Playwright's own target highlight is
 * a fixed-radius box, so it is hidden: the focus ring (focus.mjs) follows each element's shape.
 * With the presentation cursor (cursor.mjs) Playwright's pointer and point are off: the cursor
 * draws its own press ripple.
 */
export function actionStyle(brand, { cursor = 'pointer' } = {}) {
  const { gold } = palette(brand);
  return {
    duration: 650,
    position: 'bottom',
    cursor,
    style: {
      point:
        cursor === 'none'
          ? 'display:none !important;'
          : `width:26px;height:26px;border-radius:50%;border:2px solid ${gold};background:${hexA(gold, 0.16)};` +
            `box-shadow:0 0 0 7px ${hexA(gold, 0.12)},0 0 26px ${hexA(gold, 0.55)};`,
      highlight: 'display:none !important; opacity:0 !important;',
      title:
        'display:none !important; visibility:hidden !important; opacity:0 !important; height:0 !important; padding:0 !important; border:none !important; font-size:0 !important;',
    },
  };
}

/**
 * Story state: numbered chapters + captions that carry the chapter name.
 * `mark` receives every chapter/caption so produce can write chapters and validate QC frames.
 */
/**
 * `pace` (optional) is what `narrationDurations` returns: seconds per line keyed by title, plus
 * the lead and gap the voice step uses. With it, a step holds until its line has been spoken
 * before the next card comes in, and a card stays up while its line plays — the cut then reads
 * the same on a fast machine and a loaded one. Without it, steps keep their scripted times.
 */
/**
 * @param {'clean'|'burned'} [overlaysMode]
 *   clean (default) — hold + marks only; Studio/Produce composite cards.
 *   burned — paint into the screencast (legacy).
 */
export function createStory({ wait, mark, brand, pace = null, tempo = () => 1, overlaysMode = 'clean' }) {
  // Overlay floors: below these the card's own enter/exit motion would be cut.
  const CHAPTER_FLOOR = 1500;
  const CAPTION_FLOOR = 1200;
  const paint = overlaysMode !== 'clean';
  const layers = new WeakMap();
  const layer = (page) => {
    if (!layers.has(page)) layers.set(page, createOverlays(page));
    return layers.get(page);
  };
  let chapterNo = 0;
  let chapterTitle = '';
  let spokenUntil = 0; // epoch ms when the current line has finished
  const lineMs = (kind, title) => {
    const sec = pace?.durations?.get(title);
    return sec ? Math.round((pace.lead[kind] + sec) * 1000) : 0;
  };
  // Hold before a card that speaks until the line still playing is done. A card without a line of
  // its own is covered by that line (the voice step gives it the same window), so it never waits.
  const holdForLine = async (title, { always = false } = {}) => {
    if (!always && !pace?.durations?.has(title)) return;
    const remaining = spokenUntil + ((pace?.gap ?? 0) * 1000) / tempo() - Date.now();
    if (remaining > 40) {
      mark('hold', `hold ${(remaining / 1000).toFixed(1)}s before "${title}"`, 'hold', { dur: remaining / 1000, for: title });
      await wait(remaining);
    }
  };
  return {
    /** Full-frame bridge; blocks for its duration so nothing happens underneath. */
    async chapter(page, title, body, duration = 2800) {
      await holdForLine(title);
      const t = tempo();
      const ms = Math.round(Math.max(duration / t, 2200 / t, CHAPTER_FLOOR, lineMs('chapter', title) + 300));
      chapterNo += 1;
      chapterTitle = title;
      mark(`chapter-${chapterNo}`, title, 'chapter', { body, dur: ms / 1000 });
      spokenUntil = Math.max(spokenUntil, Date.now() + lineMs('chapter', title));
      if (paint) {
        await layer(page).retire(['caption']);
        const html = renderLiveCardHtml(brand, 'chapter', { chapterNo, title, body, ms });
        await layer(page).show('chapter', html, ms);
      }
      await wait(ms);
    },
    /**
     * Lower-third caption; the flow keeps acting while it is on screen. One caption at a time:
     * a caption still up exits first and the new one enters just behind it, in the same spot.
     */
    async say(page, title, body, duration = 2400) {
      await holdForLine(title);
      const t = tempo();
      const ms = Math.round(Math.max(duration / t, 1800 / t, CAPTION_FLOOR, lineMs('caption', title) + 400));
      mark(`say-${chapterNo}`, title, 'caption', { body, dur: ms / 1000 });
      spokenUntil = Math.max(spokenUntil, Date.now() + lineMs('caption', title));
      if (paint) {
        const retired = await layer(page).retire(['caption'], 450);
        const html = renderLiveCardHtml(brand, 'caption', { chapterNo, chapterTitle, title, body, ms });
        await layer(page).show('caption', html, ms, {
          delayMs: retired ? 300 : 0,
        });
      }
      await wait(Math.min(ms, Math.max(500, 950 / t)));
    },
    /** End of take: let the last line finish before the recording stops. */
    async settle() {
      await holdForLine('the live end', { always: true });
    },
  };
}

/**
 * Screencast only emits frames when pixels change. Place each JPEG by its
 * timestamp and repeat the previous frame across gaps → true constant 30 fps.
 * Lossless x264 (qp 0, ultrafast): the take is an intermediate only ffmpeg reads, so the
 * delivery encode is the single lossy generation after the browser's JPEG — and ultrafast
 * costs less CPU during capture than a lossy preset, which keeps screencast FPS up.
 */
export function startFrameRecorder(outPath, { width, height }) {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'mjpeg', '-framerate', String(FPS), '-i', 'pipe:0',
    '-vf', toBt709(width, height),
    ...losslessX264(QUALITY.recorder.preset), '-g', '30', '-bf', '0',
    '-pix_fmt', 'yuv420p', ...BT709_TAGS, '-an',
    outPath,
  ];
  assertX264Args('recorder', args);
  const ff = spawn('ffmpeg', args,
    { stdio: ['pipe', 'ignore', 'pipe'] }
  );
  let stderr = '';
  ff.stderr.on('data', (d) => (stderr += d));
  let killed = false;
  const closed = new Promise((resolve, reject) =>
    ff.on('close', (code) =>
      code === 0 || killed ? resolve() : reject(new Error(`ffmpeg ${code}: ${stderr.slice(-1500)}`))
    )
  );

  let t0 = 0;
  let written = 0;
  let last = null;
  let chain = Promise.resolve();
  // Capture health: how many distinct frames the browser delivered and how they were spaced.
  // A starved machine (several recordings at once) shows as a low distinct-frame rate and long gaps.
  let received = 0;
  let lastTs = 0;
  const gaps = [];
  const push = (buf) => new Promise((resolve, reject) => ff.stdin.write(buf, (e) => (e ? reject(e) : resolve())));

  const fillTo = (epochMs) => {
    if (!last || !t0) return;
    const target = Math.floor((epochMs - t0) / FRAME_MS);
    const frame = last;
    const n = target - written;
    if (n <= 0) return;
    written = target;
    chain = chain.then(async () => {
      for (let i = 0; i < n; i++) await push(frame);
    });
  };

  return {
    begin(epochMs) {
      t0 = epochMs;
    },
    onFrame({ data, timestamp }) {
      if (!t0) return;
      fillTo(timestamp);
      last = data;
      received += 1;
      if (lastTs) gaps.push(timestamp - lastTs);
      lastTs = timestamp;
    },
    async finish(epochMs = Date.now()) {
      fillTo(epochMs);
      if (last) {
        written += 1;
        const frame = last;
        chain = chain.then(() => push(frame));
      }
      await chain;
      ff.stdin.end();
      await closed;
      const seconds = written / FPS;
      const sorted = [...gaps].sort((a, b) => a - b);
      const capture = {
        receivedFrames: received,
        distinctFps: seconds ? +(received / seconds).toFixed(1) : 0,
        medianGapMs: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : 0,
        p95GapMs: sorted.length ? Math.round(sorted[Math.floor(sorted.length * 0.95)]) : 0,
        maxGapMs: sorted.length ? Math.round(sorted[sorted.length - 1]) : 0,
      };
      return { frames: written, seconds, capture };
    },
    kill() {
      killed = true;
      try {
        ff.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    },
  };
}

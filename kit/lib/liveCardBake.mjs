/**
 * Bake chapter/caption live cards onto a clean take during produce.
 * Studio always composites HTML for preview; Record (clean) leaves UI only;
 * this module paints direction-true cards into live-clean.
 *
 * Bake clips keep alpha (PNG → VP9 yuva) so the card floats over the UI the same
 * way Studio composites — JPEG black mattes previously wiped the take.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { cpus } from 'node:os';
import { cardMotionCss } from '../studio/cardMotion.js';
import { cardMarkDuration } from '../studio/liveCardStage.js';
import { isCardMark, loadCardMarks } from './cardMarks.mjs';
import { cardMarkKey } from './editDeck.mjs';
import { buildLiveCards } from './liveCards.mjs';
import { DELIVERY } from './project.mjs';
import { FPS } from './motion.mjs';
import { plateBrowserArgs } from './plates.mjs';
import { spawn } from 'node:child_process';
import { duration as mediaDuration } from './media.mjs';

/** Bump when bake pixel format / capture path changes (invalidates prepareLive stamp). */
const BAKE_PIPELINE = 7;
/** Parallel card captures. Each page is its own compositor; 4 fits an M-series GPU. */
const BAKE_CONCURRENCY = Math.max(
  1,
  Math.min(4, Number(process.env.WALKTHROUGH_BAKE_JOBS) || Math.min(4, cpus()?.length || 4))
);

/** Same rule Studio uses for the preview window — one definition, re-exported for callers. */
export { cardMarkDuration };

/** Legacy takes (no meta) are burned — do not double-overlay. */
export function overlaysModeFromLiveMeta(meta) {
  return meta?.overlays?.mode === 'clean' ? 'clean' : 'burned';
}

/**
 * Pair timeline chapter/caption marks with built live-card HTML rows.
 * Cards built by `buildLiveCards` carry `markKey` (the pairing decided once, server-side); marks
 * are matched by key and unmatched marks are skipped. Cards without keys (legacy / hand-built
 * lists) fall back to label-then-order matching.
 * @returns {Array<{ kind, t, dur, label, cardId, htmlPath }>}
 */
export function planCardBakes(timeline, cards) {
  const list = (cards || []).filter((c) => isCardMark(c) && c.htmlPath);
  const byKey = new Map(list.filter((c) => c.markKey).map((c) => [c.markKey, c]));
  const byKind = {
    chapter: list.filter((c) => c.kind === 'chapter').sort((a, b) => (a.flowIndex ?? 0) - (b.flowIndex ?? 0)),
    caption: list.filter((c) => c.kind === 'caption').sort((a, b) => (a.flowIndex ?? 0) - (b.flowIndex ?? 0)),
  };
  const used = { chapter: 0, caption: 0 };
  const legacyPick = (m) => {
    const pool = byKind[m.kind];
    let card =
      pool.find((c) => c.label === m.label) ||
      pool.find((c) => String(c.label || '').includes(String(m.label || '')));
    if (!card) {
      card = pool[used[m.kind]];
      used[m.kind] += 1;
    } else {
      used[m.kind] = Math.max(used[m.kind], pool.indexOf(card) + 1);
    }
    return card || null;
  };
  const out = [];
  for (const m of timeline || []) {
    if (!isCardMark(m)) continue;
    const card = byKey.size ? byKey.get(m.key || cardMarkKey(m)) || null : legacyPick(m);
    if (!card) continue;
    out.push({
      kind: m.kind,
      t: Number(m.t) || 0,
      dur: cardMarkDuration(m),
      label: m.label || card.label || '',
      cardId: card.id,
      htmlPath: card.htmlPath,
    });
  }
  return out;
}

export function bakeStamp(liveStat, plans, look) {
  return createHash('sha1')
    .update(
      JSON.stringify({
        BAKE_PIPELINE,
        live: { size: liveStat.size, mtime: liveStat.mtimeMs },
        look,
        plans: plans.map((p) => ({
          id: p.cardId,
          t: p.t,
          dur: p.dur,
          html: p.htmlPath,
          // Content key of the baked clip: a card whose html changed (copy, per-chapter
          // background) re-runs the clean pass even though its path and timing are the same.
          key: p.key || null,
          ox: p.ox || 0,
          oy: p.oy || 0,
          w: p.w || 0,
          h: p.h || 0,
        })),
      })
    )
    .digest('hex')
    .slice(0, 16);
}

/**
 * ffmpeg inputs + filter fragment that overlays bake clips onto `srcLabel`, ending at `outLabel`.
 * Bake clips are short RGBA MOVs starting at PTS 0 — shift each with setpts so frame 0 lands on
 * the mark time (otherwise captions after ~clipDur never appear: the overlay stream already EOF'd).
 */
export function cardBakeOverlayGraph(plans, bakeFiles, { srcLabel = '[lraw]', outLabel = '[lbake]', startInputIndex = 1 } = {}) {
  const real = [];
  (plans || []).forEach((p, i) => {
    const file = bakeFiles?.[i];
    if (!file || !existsSync(file)) return;
    real.push({ p, file });
  });
  if (!real.length) return { inputs: [], filter: [], outLabel: srcLabel, inputCount: 0 };

  const inputs = [];
  const filter = [];
  let cur = srcLabel;
  real.forEach(({ p }, i) => {
    inputs.push('-i', real[i].file);
    const rawIn = `[${startInputIndex + i}:v]`;
    const rgba = `[lba${i}]`;
    const t0 = p.t.toFixed(3);
    const t1 = (p.t + p.dur).toFixed(3);
    // Delay the clip so its first frame aligns with the mark on the main clock.
    filter.push(`${rawIn}format=rgba,setpts=PTS+${t0}/TB${rgba}`);
    const next = i === real.length - 1 ? outLabel : `[lbx${i}]`;
    const x = Number.isFinite(p.ox) ? Math.round(p.ox) : 0;
    const y = Number.isFinite(p.oy) ? Math.round(p.oy) : 0;
    // repeatlast=0 so the card leaves with its last frame. enable keeps it inside the
    // mark; without that, ffmpeg holds the last frame and the card sticks over the take.
    filter.push(
      `${cur}${rgba}overlay=x=${x}:y=${y}:enable='between(t\\,${t0}\\,${t1})':eof_action=pass:repeatlast=0:format=auto${next}`
    );
    cur = next;
  });
  return { inputs, filter, outLabel, inputCount: real.length };
}

/**
 * PNG pipe → PNG-in-MOV with real RGBA.
 * Chromium already emits the frame size, so the mux copies the packets. Decoding and
 * re-encoding here only steals CPU from the capture running beside it.
 * (libvpx-vp9 often stores as yuv420p and drops alpha — captions then become a black matte.)
 */
export function alphaPipeArgs(outPath, { fps = FPS, copy = true } = {}) {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'image2pipe',
    '-vcodec',
    'png',
    '-framerate',
    String(fps),
    '-i',
    'pipe:0',
  ];
  // A full-frame PNG copied into the mov deadlocks ffmpeg's scheduler on the second
  // chapter. Captions are small enough to copy. Chapters are encoded once, here.
  if (copy) args.push('-c:v', 'copy');
  else args.push('-vf', `fps=${fps},format=rgba`, '-c:v', 'png', '-pix_fmt', 'rgba');
  args.push('-an', outPath);
  return args;
}

function alphaPipeEncoder(outPath, { fps = FPS, copy = true } = {}) {
  const args = alphaPipeArgs(outPath, { fps, copy });
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  let closed = false;
  ff.stderr.on('data', (d) => (stderr += d));
  // ffmpeg can exit mid-frame (bad PNG, early close). Without this, write() EPIPE kills Node.
  ff.stdin.on('error', (e) => {
    if (!closed) stderr += `\n${e.message}`;
  });
  const done = new Promise((resolve, reject) => {
    ff.on('close', (code) => {
      closed = true;
      code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg bake exit ${code}`));
    });
  });
  return {
    write: (buf) =>
      new Promise((resolve, reject) => {
        if (closed || ff.stdin.destroyed) return resolve();
        ff.stdin.write(buf, (err) => {
          if (!err || closed || err.code === 'EPIPE') resolve();
          else reject(err);
        });
      }),
    end: () => {
      if (!ff.stdin.destroyed) ff.stdin.end();
      return done;
    },
  };
}

const floorEven = (n) => Math.max(0, Math.floor(n / 2) * 2);

/**
 * Caption cards cover a corner of the frame. Crop to that box plus a margin so the
 * PNG and the overlay skip the empty pixels. Chapter cards keep the full frame:
 * their field paints edge to edge.
 */
async function measureCaptionClip(page) {
  const box = await page.evaluate(() => {
    const stage = document.querySelector('.preview-stage') || document.body;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    let n = 0;
    for (const el of stage.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.width > 1700 && r.height > 900) continue;
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
      n += 1;
    }
    return n ? { left, top, right, bottom } : null;
  });
  if (!box) return null;
  const margin = 64;
  const x = floorEven(Math.max(0, box.left - margin));
  const y = floorEven(Math.max(0, box.top - margin));
  let w = Math.ceil((Math.min(DELIVERY.width, box.right + margin) - x) / 2) * 2;
  let h = Math.ceil((Math.min(DELIVERY.height, box.bottom + margin) - y) / 2) * 2;
  if (x + w > DELIVERY.width) w = floorEven(DELIVERY.width - x);
  if (y + h > DELIVERY.height) h = floorEven(DELIVERY.height - y);
  if (w < 2 || h < 2 || (w >= 1700 && h >= 900)) return null;
  return { x, y, w, h };
}

/** Content key for one bake clip. The crop box is derived from the html, so it is not part of the key. */
export function bakeClipKey({ html, css, motion, t, dur, pipeline, raster }) {
  return createHash('sha1')
    .update(JSON.stringify({ html, css, motion, t, dur, pipeline, raster }))
    .digest('hex')
    .slice(0, 16);
}

function bakeRaster() {
  const args = plateBrowserArgs();
  if (args.some((a) => a.includes('disable-gpu'))) return 'software';
  if (args.some((a) => a.includes('metal'))) return 'GPU raster (Metal)';
  return 'GPU raster';
}

async function renderBakeClip(browser, htmlPath, outPath, durationSec, kind = 'caption') {
  const viewport = { width: DELIVERY.width, height: DELIVERY.height };
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const frames = Math.max(1, Math.round(durationSec * FPS));
  const motion = cardMotionCss(kind, Math.round(durationSec * 1000));
  let clip = null;
  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.addStyleTag({
      content: 'html,body,.preview-stage{background:transparent!important;color-scheme:dark}',
    });
    await page.evaluate(async (motionSpec) => {
      document.body.dataset.duration = motionSpec.durationSec;
      const root = document.querySelector(motionSpec.selector);
      if (root) {
        for (const [prop, value] of Object.entries(motionSpec.vars)) {
          root.style.setProperty(prop, value);
        }
      }
      const reset = document.createElement('style');
      reset.textContent = '*,*::before,*::after{animation:none!important}';
      document.head.appendChild(reset);
      void document.body.offsetHeight;
      reset.remove();
      void document.body.offsetHeight;
      document.body.dataset.motion = '1';
      await document.fonts.ready;
      for (const a of document.getAnimations()) {
        a.pause();
        a.currentTime = 0;
      }
    }, motion);
    if (kind !== 'chapter') {
      await page.evaluate((t) => {
        for (const a of document.getAnimations()) {
          a.pause();
          a.currentTime = t;
        }
      }, (durationSec * 1000) / 2);
      clip = await measureCaptionClip(page);
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const enc = alphaPipeEncoder(outPath, { copy: kind !== 'chapter' });
    const shot = clip
      ? { format: 'png', optimizeForSpeed: true, clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 1 }, captureBeyondViewport: false }
      : { format: 'png', optimizeForSpeed: true, captureBeyondViewport: false };
    for (let i = 0; i < frames; i++) {
      const ms = (i / FPS) * 1000;
      await page.evaluate((t) => {
        for (const a of document.getAnimations()) {
          a.pause();
          a.currentTime = t;
        }
        try {
          const w = window;
          w.__plateRuntime?.renderAt?.(t);
          w.__plateField?.renderAt?.(t);
        } catch {
          /* ignore */
        }
      }, ms);
      const r = await cdp.send('Page.captureScreenshot', shot);
      await enc.write(Buffer.from(r.data, 'base64'));
    }
    await enc.end();
    return clip;
  } finally {
    await page.close().catch(() => {});
  }
}

/** Stable bake filename — includes start + length so duration trims force a re-render. */
export function bakeClipName(plan, index) {
  const t = Number(plan?.t) || 0;
  const dur = cardMarkDuration(plan);
  const kind = plan?.kind === 'chapter' ? 'chapter' : 'caption';
  return `${String(index).padStart(3, '0')}-${kind}-t${t.toFixed(2)}-d${dur.toFixed(2)}.mov`;
}

function clipKeyFor(plan, css, raster) {
  const html = existsSync(plan.htmlPath) ? readFileSync(plan.htmlPath, 'utf8') : '';
  const motion = cardMotionCss(plan.kind, Math.round(cardMarkDuration(plan) * 1000));
  return bakeClipKey({
    html,
    css,
    motion,
    t: Number(plan.t) || 0,
    dur: cardMarkDuration(plan),
    pipeline: BAKE_PIPELINE,
    raster,
  });
}

/**
 * Ensure bake MOV (PNG/RGBA) clips exist for each plan. Returns paths aligned with plans.
 * A clip is fresh when its content key matches, not when the HTML file is older than the mov.
 */
export async function ensureCardBakeClips(video, plans, { force = false } = {}) {
  const dir = join(video.out, 'overlays', 'bake');
  mkdirSync(dir, { recursive: true });
  const cssPath = join(video.out, 'overlays', 'overlays.css');
  const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : '';
  const paths = plans.map((p, i) => join(dir, bakeClipName(p, i)));
  const keyPath = (out) => out.replace(/\.mov$/, '.json');
  // Every plan carries its content key so the clean-pass stamp follows card content, not paths.
  for (const p of plans) p.key = clipKeyFor(p, css, bakeRaster());
  const fresh = (p, out) => {
    if (!existsSync(out) || !existsSync(keyPath(out))) return false;
    try {
      const saved = JSON.parse(readFileSync(keyPath(out), 'utf8'));
      return saved.key === p.key && saved.pipeline === BAKE_PIPELINE;
    } catch {
      return false;
    }
  };
  const seconds = new Array(plans.length).fill(0);
  for (let i = 0; i < plans.length; i++) {
    if (!existsSync(keyPath(paths[i]))) continue;
    try {
      const saved = JSON.parse(readFileSync(keyPath(paths[i]), 'utf8'));
      const placed = saved.clip;
      if (placed && Number.isFinite(placed.ox)) Object.assign(plans[i], placed);
      else if (placed && Number.isFinite(placed.x)) {
        Object.assign(plans[i], { ox: placed.x, oy: placed.y, w: placed.w, h: placed.h });
      }
      if (Number.isFinite(saved.sec)) seconds[i] = saved.sec;
    } catch {
      /* full frame */
    }
  }
  if (!force && plans.every((p, i) => fresh(p, paths[i]))) return paths;
  const browser = await chromium.launch({ headless: true, args: plateBrowserArgs() });
  const raster = bakeRaster();
  try {
    const queue = plans.map((p, i) => ({ p, i })).filter(({ p, i }) => force || !fresh(p, paths[i]));
    console.log(`» cards · Baking ${queue.length} of ${plans.length} · ${BAKE_CONCURRENCY} at a time`);
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const { p, i } = job;
        const out = paths[i];
        const t0 = Date.now();
        console.log(`» cards · Bake ${p.kind} “${p.label}” @ ${p.t.toFixed(1)}s (${cardMarkDuration(p).toFixed(1)}s)`);
        const clip = await renderBakeClip(browser, p.htmlPath, out, cardMarkDuration(p), p.kind);
        const placed = clip ? { ox: clip.x, oy: clip.y, w: clip.w, h: clip.h } : null;
        if (placed) Object.assign(p, placed);
        seconds[i] = Number(((Date.now() - t0) / 1000).toFixed(1));
        writeFileSync(
          keyPath(out),
          JSON.stringify({ key: p.key, pipeline: BAKE_PIPELINE, raster, clip: placed, sec: seconds[i] })
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(BAKE_CONCURRENCY, queue.length) }, worker));
  } finally {
    await browser.close().catch(() => {});
  }
  writeFileSync(
    join(dir, 'bake-meta.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        count: plans.length,
        pipeline: BAKE_PIPELINE,
        format: 'png-rgba-copy',
        plans: plans.map((p, i) => ({
          file: bakeClipName(p, i),
          kind: p.kind,
          t: p.t,
          dur: cardMarkDuration(p),
          label: p.label,
          ox: p.ox || 0,
          oy: p.oy || 0,
          w: p.w || 0,
          h: p.h || 0,
          sec: seconds[i],
        })),
      },
      null,
      2
    )
  );
  return paths;
}

/** Read live-meta overlays mode; rebuild cards; return bake plan + files for prepareLive. */
export async function prepareLiveCardBakes(video, LIVE) {
  const metaPath = join(video.out, 'live-meta.json');
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : null;
  const mode = overlaysModeFromLiveMeta(meta);
  if (mode !== 'clean') {
    return { mode, plans: [], files: [], stamp: null, look: null };
  }
  const liveDur = existsSync(LIVE) ? mediaDuration(LIVE) : Infinity;
  // Same marks (edit.cards applied) and same pairing the overlay HTML was built from.
  const timeline = loadCardMarks(video, { liveDur });
  const { cards, look } = buildLiveCards(video);
  const plans = planCardBakes(timeline, cards);
  if (!plans.length) return { mode, plans, files: [], stamp: bakeStamp(statSync(LIVE), [], look), look };
  const files = await ensureCardBakeClips(video, plans);
  const stamp = bakeStamp(statSync(LIVE), plans, look);
  return { mode, plans, files, stamp, look };
}

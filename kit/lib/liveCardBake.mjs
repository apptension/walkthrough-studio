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
import { cardMotionCss } from '../studio/cardMotion.js';
import { cardMarkDuration } from '../studio/liveCardStage.js';
import { isCardMark, loadCardMarks } from './cardMarks.mjs';
import { cardMarkKey } from './editDeck.mjs';
import { buildLiveCards } from './liveCards.mjs';
import { DELIVERY } from './project.mjs';
import { FPS } from './motion.mjs';
import { spawn } from 'node:child_process';
import { duration as mediaDuration } from './media.mjs';

/** Bump when bake pixel format / capture path changes (invalidates prepareLive stamp). */
const BAKE_PIPELINE = 5;

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
        plans: plans.map((p) => ({ id: p.cardId, t: p.t, dur: p.dur, html: p.htmlPath })),
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
    filter.push(
      `${cur}${rgba}overlay=x=0:y=0:enable='between(t\\,${t0}\\,${t1})':eof_action=pass:format=auto${next}`
    );
    cur = next;
  });
  return { inputs, filter, outLabel, inputCount: real.length };
}

/**
 * PNG pipe → PNG-in-MOV with real RGBA.
 * (libvpx-vp9 often stores as yuv420p and drops alpha — captions then become a black matte.)
 */
function alphaPipeEncoder(outPath, { width, height, fps = FPS }) {
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
    '-vf',
    `scale=${width}:${height}:flags=bicubic,fps=${fps},format=rgba`,
    '-c:v',
    'png',
    '-pix_fmt',
    'rgba',
    '-an',
    outPath,
  ];
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  ff.stderr.on('data', (d) => (stderr += d));
  const done = new Promise((resolve, reject) => {
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg bake exit ${code}`))));
  });
  return {
    write: (buf) =>
      new Promise((resolve, reject) => {
        ff.stdin.write(buf, (err) => (err ? reject(err) : resolve()));
      }),
    end: () => {
      ff.stdin.end();
      return done;
    },
  };
}

async function renderBakeClip(browser, htmlPath, outPath, durationSec, kind = 'caption') {
  const viewport = { width: DELIVERY.width, height: DELIVERY.height };
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const enc = alphaPipeEncoder(outPath, viewport);
  const frames = Math.max(1, Math.round(durationSec * FPS));
  const motion = cardMotionCss(kind, Math.round(durationSec * 1000));
  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Match Studio composite: transparent stage, motion clock (not the solid Program still).
    await page.addStyleTag({
      content: 'html,body,.preview-stage{background:transparent!important;color-scheme:dark}',
    });
    // Honour timeline / edit.cards length even if overlay HTML was built with a shorter hold.
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
    for (let i = 0; i < frames; i++) {
      const ms = (i / FPS) * 1000;
      await page.evaluate((t) => {
        for (const a of document.getAnimations()) {
          a.pause();
          a.currentTime = t;
        }
        // Plate atmosphere (WebGL) if present.
        try {
          const w = window;
          w.__plateRuntime?.renderAt?.(t);
          w.__plateField?.renderAt?.(t);
        } catch {
          /* ignore */
        }
      }, ms);
      // `allow` keeps the paused seek — `disabled` snaps to exit (blank frames).
      const buf = await page.screenshot({
        type: 'png',
        omitBackground: true,
        animations: 'allow',
        scale: 'css',
      });
      await enc.write(buf);
    }
    await enc.end();
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

/**
 * Ensure bake MOV (PNG/RGBA) clips exist for each plan. Returns paths aligned with plans.
 * Paths embed `t` + `dur` so Editor timeline trims invalidate stale clips (not only HTML mtime).
 */
export async function ensureCardBakeClips(video, plans, { force = false } = {}) {
  const dir = join(video.out, 'overlays', 'bake');
  mkdirSync(dir, { recursive: true });
  const paths = plans.map((p, i) => join(dir, bakeClipName(p, i)));
  const stale = (p, out) => {
    if (!existsSync(out)) return true;
    if (!existsSync(p.htmlPath)) return true;
    if (statSync(out).mtimeMs < statSync(p.htmlPath).mtimeMs) return true;
    // Length must match the plan — old caches ignored duration-only edits.
    try {
      const got = mediaDuration(out);
      if (Math.abs(got - cardMarkDuration(p)) > 0.08) return true;
    } catch {
      return true;
    }
    return false;
  };
  const need = force || plans.some((p, i) => stale(p, paths[i]));
  if (!need) return paths;
  const browser = await chromium.launch({ headless: true });
  try {
    for (let i = 0; i < plans.length; i++) {
      const p = plans[i];
      const out = paths[i];
      if (!force && !stale(p, out)) continue;
      console.log(`» cards · Bake ${p.kind} “${p.label}” @ ${p.t.toFixed(1)}s (${cardMarkDuration(p).toFixed(1)}s)`);
      await renderBakeClip(browser, p.htmlPath, out, cardMarkDuration(p), p.kind);
    }
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
        format: 'png-rgba',
        plans: plans.map((p, i) => ({
          file: bakeClipName(p, i),
          kind: p.kind,
          t: p.t,
          dur: cardMarkDuration(p),
          label: p.label,
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

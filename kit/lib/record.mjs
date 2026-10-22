/**
 * Live capture: runs a video's flow.mjs in a real browser while the Screencast
 * API streams JPEG q100 frames into the timestamp-placed recorder.
 * The flow only describes the product journey; this file owns quality.
 */
import { chromium } from 'playwright';
import { renameSync, rmSync, statSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { actionStyle, createStory, installBrandFonts, startFrameRecorder } from './motion.mjs';
import { createCursor } from './cursor.mjs';
import { resolvePace } from './direction.mjs';
import { createFocus } from './focus.mjs';
import { typeInto, fillField } from './form.mjs';
import {
  CaptureStallError,
  buildStallReport,
  clearStallReport,
  createStallWatchdog,
  writeStallReport,
} from './captureStall.mjs';
import { createMail } from './mail.mjs';
import { openStartUrl, startUrlCandidates } from './startUrl.mjs';
import { clearSelectorReport, installRecordedSelectorRetry, writeSelectorReport } from './selectorRetry.mjs';
import { clearOverlayReport, installOverlayRetry, writeOverlayReport } from './overlayRetry.mjs';
import { describeRecordFailure } from '../studio/recordFailure.js';
import {
  collectPersonSignals,
  contextUsesSession,
  pageNeedsPerson,
  sessionFile,
  shouldKeepWaiting,
  shouldRelaunchHeaded,
  shouldReturnHeadless,
  signInWaitCopy,
  waitFiles,
} from './signInPause.mjs';
import { ensureSignedInOffCamera } from './sessionAuth.mjs';

const PRESS_ACTIONS = new Set(['click', 'dblclick', 'check', 'uncheck', 'setChecked', 'tap', 'selectOption']);
const TYPE_ACTIONS = new Set(['fill', 'pressSequentially']);
// CSS px a lens target's centre must keep from every viewport edge; closer targets are scrolled to centre.
const LENS_ROOM = 240;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function livePath(video) {
  return join(video.out, 'live.mp4');
}

/**
 * @param {object} opts
 * @param {boolean} [opts.headed] Visible browser. Off by default: a headless take has no window to
 *   wander into, and Studio shows the live page on Program.
 * @param {boolean} [opts.handoff] Internal — this headed run exists only because the page asked
 *   for a person. Once they are through, capture returns to the background (see shouldReturnHeadless).
 * @param {number} [opts.signInRound] Internal — how many times the take already went
 *   headless → visible → headless for sign-in.
 */
export async function recordLive(
  video,
  { headed = false, flow, outFile, writeMeta = true, pace: paceArg, handoff = false, signInRound = 0 } = {}
) {
  const { config, brand, out } = video;
  // Every capture attempt owns fresh failure evidence. A later recording job must never
  // repair from a stall, overlay, or selector report left by an earlier attempt.
  clearStallReport(video);
  clearOverlayReport(video);
  clearSelectorReport(video);
  for (const name of ['error.png', 'error.txt']) {
    try {
      unlinkSync(join(out, name));
    } catch {
      /* no stale failure file */
    }
  }
  // Live pace: one tempo over every authored hold. `pace` (CLI --pace) overrides the stored direction
  // for this take only; flows may shift it mid-tour with ctx.pace().
  const basePace = paceArg !== undefined ? resolvePace(paceArg) : brand.direction?.pace || resolvePace();
  const tempo = { value: basePace.tempo };
  const speed = () => tempo.value;
  /** An authored hold at steady pace, played at the current tempo. */
  const hold = (ms) => wait(Math.max(0, ms) / tempo.value);
  const { viewport, slowMo, startUrl, timezone, locale, scroll, deviceScaleFactor } = config.record;
  if (!startUrl) throw new Error('record.startUrl is required in video.config.json');
  const finalOut = outFile || livePath(video);
  // A crashed take must not replace the last good one, so capture lands beside it first.
  const outPath = finalOut.replace(/\.mp4$/, '.recording.mp4');
  let beforeCapture;
  if (!flow) {
    const mod = await import(pathToFileURL(join(video.dir, 'flow.mjs')).href + `?t=${Date.now()}`);
    flow = mod.default;
    beforeCapture = mod.beforeCapture;
  }
  if (typeof flow !== 'function') throw new Error('flow.mjs must export a default async function');

  const timeline = [];
  const frameSamples = [];
  const frameJobs = [];
  let startedAt = 0;
  let stallReject = null;
  /** Set once the Playwright page exists — stall reports include the current URL. */
  let page = null;
  const stallWatchdog = createStallWatchdog({
    onStall: (snap) => {
      let url = null;
      try {
        url = page?.url() || null;
      } catch {
        /* closing */
      }
      const report = buildStallReport({ ...snap, timeline, url }, { slug: video.slug });
      writeStallReport(video, report);
      console.error(`✗ stall · ${report.summary}`);
      for (const h of report.hints.slice(0, 2)) console.error(`  → ${h}`);
      stallReject?.(new CaptureStallError(report));
      // Unblock hung Playwright calls so Promise.race can finish teardown.
      page?.close().catch(() => {});
    },
  });
  const mark = (id, label, kind = 'mark', extra = {}) => {
    const t = startedAt ? (Date.now() - startedAt) / 1000 : 0;
    timeline.push({ id, label, kind, t, ...extra });
    if (kind === 'chapter' || kind === 'caption' || kind === 'pace') {
      stallWatchdog.touchMark(label);
    }
    if (kind === 'chapter' || kind === 'caption') console.log(`» capture · ${label}`);
    if ((kind === 'chapter' || kind === 'caption') && page) {
      const t = startedAt ? (Date.now() - startedAt) / 1000 : 0;
      const shot = page;
      frameJobs.push(
        Promise.race([
          shot.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2500)),
          new Promise((resolve) => setTimeout(() => resolve(''), 800)),
        ])
          .then((text) => {
            if (text) frameSamples.push({ key: label, t: Number(t.toFixed(3)), text });
          })
          .catch(() => {})
      );
    }
    console.log(`  ${t.toFixed(1).padStart(6)}s  ${kind.padEnd(7)}  ${label}`);
  };
  // Framing: auto scroll by default (keeps screencast FPS). Opt into smooth via record.scroll.
  const focus = createFocus({ brand, wait, scroll: scroll || {} });
  // Pace the take to the narration so the cut does not depend on how loaded the machine is.
  // (voice.mjs imports livePath from here, hence the late import.)
  const { narrationDurations } = await import('./audio/voice.mjs');
  const pace = await narrationDurations(video);
  if (pace) {
    const { synthesized, reused } = pace.stats;
    console.log(`· pacing to ${pace.durations.size} narration line(s) (${reused} cached, ${synthesized} synthesized)`);
  }
  // Clean take: cards are composited in Studio and baked at Produce (direction-true).
  // Set direction.overlays.recordMode = "burned" only to debug legacy paint-into-screencast.
  const overlaysMode = video.brand?.direction?.overlays?.recordMode === 'burned' ? 'burned' : 'clean';
  const story = createStory({ wait, mark, brand, pace, tempo: speed, overlaysMode });
  console.log(
    `· pace ${basePace.id}${basePace.custom ? '' : ` (${basePace.tempo}×)`}${paceArg !== undefined ? ' · this take only' : ''} · live cards ${overlaysMode}`
  );

  const browser = await chromium.launch({ headless: !headed, slowMo: Math.round((slowMo || 0) / tempo.value) });
  // Screencast frames are capped at viewport size. DPR 2 antialiases text UIs before downsample,
  // but paints 4× pixels — on WebGL/3D configurators that starves distinct FPS. Per-video override
  // via record.deviceScaleFactor (1 | 2). Quality stays JPEG q100 → lossless x264 either way.
  const dpr = deviceScaleFactor === 1 || deviceScaleFactor === 2 ? deviceScaleFactor : 2;
  if (dpr !== 2) console.log(`· capture DPR ${dpr} (record.deviceScaleFactor) — quality path unchanged`);
  // Lists render times in the browser zone; pin it to the product's so "9am" reads as 9am
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: dpr,
    ...(timezone && { timezoneId: timezone }),
    ...(locale && { locale }),
    ...(contextUsesSession(video) ? { storageState: sessionFile(video) } : {}),
  });
  await installBrandFonts(context, brand);
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  installOverlayRetry(page);
  installRecordedSelectorRetry(page, video);
  const recorder = startFrameRecorder(outPath, viewport);
  const focusTreatment = brand.direction?.focus || 'guided';
  const cursor = await createCursor({ context, page, brand, wait, viewport, settings: brand.direction?.cursor, tempo: speed });
  const showKeys = brand.direction?.keys === true;
  const actionLook = () => actionStyle(brand, { cursor: cursor.playwrightCursor });
  if (cursor.style !== 'classic') {
    console.log(`· cursor ${cursor.style} · glide ${cursor.glide ? 'on' : 'off'} · hand on click ${cursor.hand ? 'on' : 'off'}`);
  }

  /** Glide to the target, then log where the pointer acted (auto zoom follows these). */
  async function beforeAction(locator, name) {
    if (!startedAt) return null;
    stallWatchdog.beginAction(name);
    await focus.intoView(locator);
    const box = await locator.boundingBox().catch(() => null);
    if (!box || box.width < 1 || box.height < 1) return null;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (cursor.glide || PRESS_ACTIONS.has(name)) await cursor.moveTo(x, y);
    // A press: the arrow becomes a pointing hand before the real mousedown pushes it down.
    if (PRESS_ACTIONS.has(name)) await cursor.arm();
    const kind = PRESS_ACTIONS.has(name) ? 'click' : TYPE_ACTIONS.has(name) ? 'type' : null;
    if (kind) {
      timeline.push({
        id: kind,
        label: name,
        kind,
        t: (Date.now() - startedAt) / 1000,
        x: Math.round(x),
        y: Math.round(y),
        rect: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
      });
    }
    return { x, y };
  }

  const contentBox = async (locator) =>
    locator
      .evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const r = range.getBoundingClientRect();
        const b = r.width && r.height ? r : el.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      })
      .catch(() => locator.boundingBox());

  /**
   * A guided lens is authored as a small path of real DOM targets. The post renderer interpolates
   * between these points, while the real pointer takes the same route during capture.
   */
  async function followTargets(targets, { holdMs = 1400, travelMs = 520, zoom, label } = {}) {
    const items = (Array.isArray(targets) ? targets : [targets])
      .map((item) => (typeof item?.evaluate === 'function' ? { locator: item } : item))
      .filter((item) => item.locator);
    if (!items.length) return;
    if (focusTreatment === 'ring') {
      for (const item of items) await focus.show(item.locator).then(() => hold(item.holdMs || holdMs));
      await focus.hide(items.at(-1).locator, 0);
      return;
    }

    await focus.intoView(items[0].locator, { lens: LENS_ROOM });
    await hold(300);
    const rectFor = async (item) => {
      const box = await contentBox(item.locator);
      if (!box) return null;
      return {
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.width),
        h: Math.round(box.height),
      };
    };
    let currentRect = await rectFor(items[0]);
    if (!currentRect) return;
    // Seat the pointer before the lens opens. Between later targets, both travel together.
    if (focusTreatment === 'guided') {
      await cursor.moveTo(currentRect.x + currentRect.w / 2, currentRect.y + currentRect.h / 2, { steps: 8 });
    }
    const startT = startedAt ? (Date.now() - startedAt) / 1000 : 0;
    const elapsed = () => Number(((Date.now() - startedAt) / 1000 - startT).toFixed(3));
    const path = [{ at: 0, rect: currentRect }];
    await hold(items[0].holdMs || holdMs);
    for (let i = 1; i < items.length; i++) {
      const item = items[i];
      await focus.intoView(item.locator, { lens: LENS_ROOM });
      const nextRect = await rectFor(item);
      if (!nextRect) continue;
      // Hold the current lens seat until travel begins, then land the next point when the pointer does.
      path.push({ at: elapsed(), rect: currentRect });
      if (focusTreatment === 'guided') {
        await cursor.moveTo(nextRect.x + nextRect.w / 2, nextRect.y + nextRect.h / 2, {
          ms: travelMs / tempo.value,
          steps: Math.max(8, Math.round(travelMs / tempo.value / 24)),
        });
      } else {
        await hold(travelMs);
      }
      currentRect = nextRect;
      path.push({ at: elapsed(), rect: currentRect });
      await hold(item.holdMs || holdMs);
    }
    if (!path.length) return;
    const dur = Math.max(0.8, (Date.now() - startedAt) / 1000 - startT);
    mark('magnify', label || 'guided focus', 'magnify', {
      t: startT,
      rect: path[0].rect,
      path,
      dur,
      ...(zoom ? { zoom } : {}),
    });
  }

  /**
   * Author a post-production camera move without requiring a click. The mark is resolved from the
   * locator while recording, then the lossless clean pass animates the crop around it.
   */
  async function manualZoom(locator, { holdMs = 2200, level = 'bold', zoom, label = 'manual zoom' } = {}) {
    await focus.intoView(locator, { lens: LENS_ROOM });
    const box = await contentBox(locator);
    if (!box) return false;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await cursor.moveTo(x, y);
    const startT = startedAt ? (Date.now() - startedAt) / 1000 : 0;
    const heldMs = Math.max(1200, holdMs) / tempo.value;
    await wait(heldMs);
    mark('zoom', label, 'zoom', {
      t: startT,
      dur: Math.max(0.8, heldMs / 1000),
      level,
      ...(Number.isFinite(zoom) ? { zoom } : {}),
      x: Math.round(x),
      y: Math.round(y),
      rect: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
    });
    return true;
  }

  /**
   * Cover sensitive live DOM before it reaches a screencast frame. A solid adaptive mask is used
   * because Chromium screencast does not reliably paint backdrop-filter.
   */
  async function maskPrivate(locator, { label = 'Private' } = {}) {
    await focus.intoView(locator);
    const id = await locator.evaluate((el, text) => {
      window.__wtPrivacy ||= new Map();
      const id = `wt-private-${Math.random().toString(36).slice(2)}`;
      const mask = document.createElement('div');
      mask.id = id;
      mask.textContent = text || '••••••';
      Object.assign(mask.style, {
        position: 'fixed',
        zIndex: '2147483645',
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'none',
        borderRadius: '8px',
        color: 'rgba(255,255,255,.72)',
        background: 'rgb(24,27,34)',
        border: '1px solid rgba(255,255,255,.14)',
        boxShadow: '0 8px 28px rgba(0,0,0,.28)',
        font: '600 12px/1 ui-sans-serif,system-ui,sans-serif',
        letterSpacing: '.08em',
      });
      document.documentElement.appendChild(mask);
      let raf;
      const place = () => {
        if (!el.isConnected || !mask.isConnected) return;
        const r = el.getBoundingClientRect();
        Object.assign(mask.style, {
          left: `${Math.floor(r.left - 3)}px`,
          top: `${Math.floor(r.top - 3)}px`,
          width: `${Math.ceil(r.width + 6)}px`,
          height: `${Math.ceil(r.height + 6)}px`,
          display: r.width && r.height ? 'grid' : 'none',
        });
        raf = requestAnimationFrame(place);
      };
      place();
      window.__wtPrivacy.set(id, () => {
        cancelAnimationFrame(raf);
        mask.remove();
        window.__wtPrivacy.delete(id);
      });
      return id;
    }, label);
    const clear = () =>
      page
        .evaluate((maskId) => window.__wtPrivacy?.get(maskId)?.(), id)
        .catch(() => {});
    return { id, clear };
  }

  const ctx = {
    page,
    context,
    browser,
    config,
    env: config.env,
    out,
    mail: createMail(config.env.mailUrl),
    /** Authored at steady pace; the video's pace (direction.pace / --pace / ctx.pace) scales it. */
    wait: hold,
    /** Raw sleep that ignores pace — for app timing (debounce, polling), never for viewer reading time. */
    sleep: wait,
    /**
     * Shift the live pace from here on: ctx.pace('brisk') for a routine form, ctx.pace(0.9) for a
     * dense screen, ctx.pace() back to the video's setting. Returns the tempo now in force.
     */
    pace: (value) => {
      const next = value === undefined || value === null ? basePace : resolvePace(value);
      tempo.value = next.tempo;
      mark('pace', `pace ${next.id}${next.custom ? '' : ` (${next.tempo}×)`}`, 'pace', { tempo: next.tempo, pace: next.id });
      return tempo.value;
    },
    mark,
    say: (title, body, ms) => story.say(page, title, body, ms),
    chapter: (title, body, ms) => story.chapter(page, title, body, ms),
    story,
    brand,
    // The pointer decoration animates between actions (~0.35 s each): switch it (and the focus
    // ring) off around free-hand input such as drawing a signature or dragging, then back on.
    actions: {
      hide: () => {
        focus.state.enabled = false;
        return page.screencast.hideActions();
      },
      show: () => {
        focus.state.enabled = true;
        return page.screencast.showActions(actionLook());
      },
    },
    /** Presentation cursor: glide to a point (viewport pixels) without acting. */
    pointer: {
      moveTo: (x, y, opts) => cursor.moveTo(x, y, opts),
      get position() {
        return { ...cursor.pointer };
      },
    },
    /** Post-production camera move around a locator, independent of clicks. */
    zoom: manualZoom,
    /** Capture-safe masking. Call before the sensitive element can be shown; clear when safe. */
    privacy: {
      mask: maskPrivate,
      clearAll: () =>
        page
          .evaluate(() => [...(window.__wtPrivacy?.values() || [])].forEach((clear) => clear()))
          .catch(() => {}),
    },
    /**
     * Land the focus ring on an element without acting on it.
     * Frames with minimal camera motion (nearest; skips if already visible).
     */
    focus: async (locator, holdMs = 1400, frameOpts = {}) => {
      await focus.show(locator, frameOpts);
      await hold(holdMs);
      await focus.hide(locator, 0);
    },
    /**
     * Frame a locator into view without the ring — for chapter opens and stable camera seats.
     * Prefer this over focus() when you only need the action area visible.
     */
    frame: async (locator, { holdMs = 400, block, behavior } = {}) => {
      if (!(await locator.isVisible().catch(() => false))) return false;
      await focus.intoView(locator, { ...(block ? { block } : {}), ...(behavior ? { behavior } : {}) });
      if (holdMs) await hold(holdMs);
      return true;
    },
    /**
     * After a navigation or heavy UI change: wait until a locator is visible, then hold so the
     * screencast never captures a blank/white intermediate paint under the chapter card.
     */
    settle: async (locator, holdMs = 900) => {
      if (locator) {
        await locator.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
      }
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await hold(holdMs);
    },
    /**
     * Magnifier over an important element. Direction decides guided pointer + lens, spotlight,
     * or a minimal ring. `follow()` below handles a continuous route across several features.
     */
    magnify: async (locator, options = {}) => followTargets(locator, { holdMs: 2400, ...options }),
    /**
     * Travel across related features with one continuous lens:
     *   await follow([kpi, chart, action], { holdMs: 1200, label: 'From signal to action' })
     * Per-target timing: follow([{ locator: kpi, holdMs: 900 }, { locator: chart, holdMs: 1600 }]).
     */
    follow: followTargets,
    /**
     * Click + fill with a focus-stable locator. Prefer this over getByPlaceholder→click→fill:
     * many forms clear the placeholder on focus and the original locator then hangs until timeout.
     */
    typeInto,
    fillField: (patterns, value, opts) => fillField(page, patterns, value, opts),
  };
  const locatorProto = Object.getPrototypeOf(page.locator('html'));
  focus.install(locatorProto, {
    before: beforeAction,
    after: (ctx) => {
      stallWatchdog.endAction();
      if (ctx) cursor.sync(ctx.x, ctx.y);
      // Lets the hand linger a beat, then relaxes to the arrow (no-op when nothing was armed).
      cursor.release();
    },
  });
  const restoreKeys = [];
  if (showKeys) {
    const kb = page.keyboard;
    const origPress = kb.press.bind(kb);
    kb.press = async (key, opts) => {
      if (startedAt) await cursor.showKeys(key);
      return origPress(key, opts);
    };
    const origLocatorPress = locatorProto.press;
    locatorProto.press = async function pressWithKeys(key, opts) {
      if (startedAt) await cursor.showKeys(key);
      return origLocatorPress.call(this, key, opts);
    };
    restoreKeys.push(() => (kb.press = origPress), () => (locatorProto.press = origLocatorPress));
  }

  async function pageState() {
    return pageNeedsPerson(await collectPersonSignals(page));
  }

  // The window opened for the person goes away once they are through — unless the session did not
  // survive the trip to a background browser, in which case the take stays visible.
  const returnsHeadless = shouldReturnHeadless({ handoff, round: signInRound });

  /** @returns {Promise<boolean>} whether the take waited for a person */
  async function pauseIfPerson() {
    if (!(await pageState())) return false;
    const files = waitFiles(out);
    const copy = signInWaitCopy({ returnsHeadless });
    writeFileSync(files.wait, JSON.stringify({ url: page.url(), ...copy, at: new Date().toISOString() }));
    rmSync(files.resume, { force: true });
    if (headed) await page.bringToFront().catch(() => {});
    console.log(`» sign-in · ${copy.title}. ${copy.next}`);
    let typed = false;
    const onStdin = (chunk) => {
      if (String(chunk).includes('\n') || String(chunk).includes('\r')) typed = true;
    };
    if (process.stdin.isTTY) {
      console.log('» sign-in · Press Enter in this terminal when you are done.');
      process.stdin.resume();
      process.stdin.on('data', onStdin);
    }
    const started = Date.now();
    try {
      while (true) {
        // A person typing a password is not a stalled take; keep the watchdog quiet while we wait.
        stallWatchdog.touchMark('waiting for sign-in');
        const still = await pageState();
        const gate = shouldKeepWaiting({
          needed: true,
          resumeExists: existsSync(files.resume) || typed || !still,
          elapsed: Date.now() - started,
        });
        if (gate === false) break;
        if (gate === 'timeout') throw new Error('Sign-in wait timed out. Finish sign-in, then re-record.');
        await wait(400);
      }
    } finally {
      if (process.stdin.isTTY) process.stdin.off('data', onStdin);
    }
    rmSync(files.wait, { force: true });
    rmSync(files.resume, { force: true });
    await context.storageState({ path: sessionFile(video) }).catch(() => {});
    console.log('» sign-in · continuing in this session');
    return true;
  }

  /** Close this browser without finishing the take; the caller starts another recordLive. */
  async function handOff() {
    handedOff = true;
    if (screencastOn) await page.screencast.stop().catch(() => {});
    recorder.kill();
    rmSync(outPath, { force: true });
    stallWatchdog.stop();
    focus.uninstall();
    restoreKeys.forEach((fn) => fn());
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  let handedOff = false;
  let screencastOn = false;
  try {
    console.log('» open · Loading the start page');
    const candidates = startUrlCandidates(startUrl);
    const opened = candidates.length > 1 ? await openStartUrl(startUrl) : { url: startUrl, attempts: candidates };
    if (opened.url !== startUrl) console.log(`» open · ${startUrl} → ${opened.url}`);
    await page.goto(opened.url, { waitUntil: config.record.waitUntil || 'networkidle', timeout: 15000 });
    await page.evaluate((family) => document.fonts.load(`600 20px "${family}"`), brand.font.family);
    await wait(500);

    // Session → saved credentials, all off camera. Password typing must never enter live.mp4.
    const auth = await ensureSignedInOffCamera(page, context, video, {
      say: (msg) => console.log(`» sign-in · ${msg}`),
    });
    if (auth.needsPerson && shouldRelaunchHeaded({ headed, needsPerson: true })) {
      console.log(
        signInRound
          ? '» sign-in · Auto sign-in did not clear the gate. Opening a visible browser; this take stays visible.'
          : '» sign-in · Needs a person (SSO / MFA / no saved password). Opening a visible browser for that step only.'
      );
      await handOff();
      return await recordLive(video, { headed: true, flow, outFile, writeMeta, pace: paceArg, handoff: true, signInRound });
    }
    if (auth.needsPerson && headed) {
      console.log('» sign-in · Waiting for you in the visible browser before capture starts…');
      await pauseIfPerson();
      await context.storageState({ path: sessionFile(video) }).catch(() => {});
    } else if (shouldRelaunchHeaded({ headed, needsPerson: await pageState() })) {
      // Rare: gate appeared after auth check (redirect). Same headed handoff as before.
      console.log('» sign-in · This page needs you. Opening a visible browser for the sign-in step only.');
      await handOff();
      return await recordLive(video, { headed: true, flow, outFile, writeMeta, pace: paceArg, handoff: true, signInRound });
    }

    // Optional pre-roll (cookie banners, extra setup) — still before capture.
    if (typeof beforeCapture === 'function') {
      await beforeCapture({ page, context, env: config.env, brand, wait, config });
    }

    console.log('» capture · Driving the walkthrough');
    startedAt = Date.now();
    recorder.begin(startedAt);
    let lastPreviewAt = 0;
    const previewPath = join(out, 'live-preview.jpg');
    await page.screencast.start({
      size: viewport,
      quality: 100,
      onFrame: (frame) => {
        recorder.onFrame(frame);
        const now = Date.now();
        if (frame?.data && now - lastPreviewAt > 400) {
          lastPreviewAt = now;
          try {
            writeFileSync(previewPath, frame.data);
          } catch {
            /* a preview miss must not stop the take */
          }
        }
      },
    });
    screencastOn = true;
    await page.screencast.showActions(actionLook());
    mark('start', 'live start');
    stallWatchdog.start();
    await wait(900);
    const waited = await pauseIfPerson();
    if (waited && returnsHeadless) {
      console.log('» sign-in · Session saved. Closing the window; capture continues in the background.');
      await handOff();
      return await recordLive(video, { headed: false, flow, outFile, writeMeta, pace: paceArg, signInRound: signInRound + 1 });
    }

    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`flow exceeded ${config.record.timeoutMs / 1000}s`)),
        config.record.timeoutMs
      );
    });
    const stall = new Promise((_, reject) => {
      stallReject = reject;
    });
    const result = await Promise.race([flow(ctx), timeout, stall]).finally(() => {
      clearTimeout(timer);
      stallWatchdog.stop();
      stallReject = null;
    });
    await story.settle();
    await cursor.finish();

    mark('end', 'live end');
    await wait(900);
    // How much of the take was the voice, not the tour: holds before lines that were still playing.
    const narrationHoldSec = timeline.filter((m) => m.kind === 'hold').reduce((sum, m) => sum + (m.dur || 0), 0);
    const liveSec = (Date.now() - startedAt) / 1000;
    const paceSummary = {
      id: basePace.id,
      tempo: basePace.tempo,
      override: paceArg !== undefined,
      shifts: timeline.filter((m) => m.kind === 'pace').length,
      narrationHoldSec: Number(narrationHoldSec.toFixed(1)),
      narrationHoldShare: liveSec ? Number((narrationHoldSec / liveSec).toFixed(3)) : 0,
    };
    await page.screencast.hideActions();
    const endedAt = Date.now();
    await page.screencast.stop();
    screencastOn = false;
    const capture = await recorder.finish(endedAt);
    renameSync(outPath, finalOut);
    await context.storageState({ path: sessionFile(video) }).catch(() => {});

    if (writeMeta) {
      await Promise.all(frameJobs);
      writeFileSync(join(out, 'timeline.json'), JSON.stringify(timeline, null, 2));
      if (frameSamples.length) writeFileSync(join(out, 'frame-text.json'), JSON.stringify(frameSamples, null, 2));
      const meta = {
        slug: video.slug,
        flow: result ?? null,
        pace: paceSummary,
        timeline,
        overlays: { mode: overlaysMode, pipeline: 1 },
        capture: { ...capture, method: 'screencast JPEG q100, timestamp-placed, lossless x264' },
        startUrl,
        loginRequired: Boolean(config.record?.loginRequired ?? config.env?.email),
        createdAt: new Date().toISOString(),
      };
      writeFileSync(join(out, 'live-meta.json'), JSON.stringify(meta, null, 2));
    }
    console.log(
      `» save · ${(statSync(finalOut).size / 1024 / 1024).toFixed(1)} MB · ${capture.seconds.toFixed(0)}s`
    );
    console.log(
      `✓ ${finalOut} (${(statSync(finalOut).size / 1024 / 1024).toFixed(1)} MB, ${capture.seconds.toFixed(1)}s, ${timeline.length} marks)`
    );
    const c = capture.capture;
    const starved = c.distinctFps < 8 || c.p95GapMs > 400;
    console.log(
      `${starved ? '⚠' : '·'} capture health: ${c.distinctFps} distinct fps, frame gap median ${c.medianGapMs} ms, p95 ${c.p95GapMs} ms, max ${c.maxGapMs} ms${
        starved ? ' — the browser was starved (other recordings or heavy jobs running?); record again on a quiet machine' : ''
      }`
    );
    if (paceSummary.narrationHoldSec >= 3) {
      const pct = Math.round(paceSummary.narrationHoldShare * 100);
      console.log(
        `${pct >= 20 ? '⚠' : '·'} narration held the tour ${paceSummary.narrationHoldSec}s (${pct}% of the take)${
          pct >= 20 ? ' — a faster pace cannot shorten this; trim those lines or raise audio.voice.settings.speed' : ''
        }`
      );
    }
    // Successful take — drop any failure banner artefacts from an earlier aborted attempt.
    for (const name of ['error.png', 'error.txt']) {
      try {
        unlinkSync(join(out, name));
      } catch {
        /* none */
      }
    }
    return { outPath: finalOut, capture, timeline, pace: paceSummary, wallSec: (endedAt - startedAt) / 1000 };
  } catch (err) {
    stallWatchdog.stop();
    try {
      await page?.screencast?.stop();
    } catch {
      /* ignore */
    }
    recorder.kill();
    rmSync(outPath, { force: true });
    await page?.screenshot({ path: join(out, 'error.png'), fullPage: true }).catch(() => {});
    const stallReport = err instanceof CaptureStallError ? err.report : null;
    if (stallReport) writeStallReport(video, stallReport);
    const text = stallReport
      ? `${stallReport.summary}\n\n${(stallReport.hints || []).map((h) => `• ${h}`).join('\n')}\n\n${err.stack || err}`
      : String(err?.stack || err);
    writeFileSync(join(out, 'error.txt'), text);
    if (err?.overlayRetry) writeOverlayReport(video, err);
    if (err?.selectorRetry) writeSelectorReport(video, err);
    const described = describeRecordFailure(`${err?.message || ''}\n${err?.stack || ''}`);
    console.error(`✗ ${described.reason}`);
    if (described.url) console.error(`  ${described.url}`);
    console.error(`  Next: ${described.next}`);
    throw err;
  } finally {
    // A hand-off already tore this browser down and returned the next take's result; a `return`
    // here would replace that result with undefined.
    if (!handedOff) {
      stallWatchdog.stop();
      focus.uninstall();
      restoreKeys.forEach((fn) => fn());
      await context.close();
      await browser.close();
    }
  }
}

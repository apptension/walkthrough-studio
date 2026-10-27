#!/usr/bin/env node
/**
 * Capture README / marketing stills from a running Studio (http://127.0.0.1:4747).
 *
 * Writes JPEGs under docs/assets/ (desk, brief, plates) plus optional feature PNGs.
 * Then run: node scripts/render-readme-art.mjs
 *
 * Usage: ./studio --dev   # or ./studio
 *        node scripts/capture-readme-shots.mjs
 */
import { chromium } from '../kit/node_modules/playwright/index.mjs';
import { mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/assets');
const BASE = process.env.STUDIO_URL || 'http://127.0.0.1:4747';

/** Live product walkthrough — frames in the Program monitor and plates. */
const PRODUCT_SLUG = process.env.PRODUCT_SLUG || 'teamdeck-dla-agencji-designu';
/** Studio self-demo — New video brief only (English UI). */
const STUDIO_SLUG = process.env.STUDIO_SLUG || 'walkthrough-studio';

/** Seek times (seconds) on the product master (`tmp/videos/<slug>/*.mp4`). */
const PRODUCT_SEEK = {
  openPlate: 2.8,
  featuresPlate: 7.5,
  programLive: 36,
  deskHero: 38,
  editorLive: 46,
  closePlate: 152,
};

const PLATE_HTML = {
  open: 'open.html',
  features: 'pillars.html',
  close: 'close.html',
};

let platesDir = path.join(ROOT, 'tmp/videos', PRODUCT_SLUG, 'plates');

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

const settle = (ms = 700) => page.waitForTimeout(ms);
const join = (...p) => path.join(OUT, ...p);

async function open(slug = PRODUCT_SLUG) {
  platesDir = path.join(ROOT, 'tmp/videos', slug, 'plates');
  console.log('→ slug', slug);
  await page.goto(`${BASE}/?slug=${slug}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page
    .waitForFunction(
      () => {
        const boot = document.getElementById('bootLoader');
        if (!boot) return true;
        const s = getComputedStyle(boot);
        return s.display === 'none' || s.visibility === 'hidden' || boot.getAttribute('aria-busy') === 'false';
      },
      { timeout: 25000 },
    )
    .catch(() => {});
  await settle(1400);
}

async function dismiss() {
  await page.keyboard.press('Escape').catch(() => {});
  await settle(120);
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    document.querySelectorAll('dialog[open]').forEach((d) => {
      try {
        d.close();
      } catch {
        /* ignore */
      }
    });
  });
  await settle(200);
}

async function seekProgram(t) {
  await dismiss();
  await page.evaluate(() => document.querySelector('#modeProgram')?.click());
  await settle(500);
  await page.evaluate(async (sec) => {
    const v = document.getElementById('player');
    if (!v) return;
    await new Promise((r) => {
      if (v.readyState >= 2 && Number.isFinite(v.duration)) return r();
      v.addEventListener('loadeddata', r, { once: true });
      v.addEventListener('loadedmetadata', r, { once: true });
      setTimeout(r, 8000);
    });
    await new Promise((r) => {
      v.addEventListener('seeked', r, { once: true });
      try {
        v.currentTime = sec;
      } catch {
        r();
      }
      setTimeout(r, 3000);
    });
    try {
      v.pause();
    } catch {
      /* ignore */
    }
  }, t);
  await settle(900);
}

async function seekEditor(hint, frac = 0.4) {
  await dismiss();
  await page.evaluate(() => document.querySelector('#modePlate')?.click());
  await settle(1600);
  const hints = String(hint)
    .split('|')
    .map((h) => h.trim())
    .filter(Boolean);
  const info = await page.evaluate(
    ({ hints, frac }) => {
      const clips = [...document.querySelectorAll('#etlClips .etl-clip')];
      const text = (c) => `${c.title || ''} ${c.textContent || ''}`;
      const live = clips.filter((c) => c.classList.contains('live'));
      const pick =
        live.find((c) => hints.some((h) => new RegExp(h, 'i').test(text(c)))) ||
        live[0] ||
        clips.find((c) => hints.some((h) => new RegExp(h, 'i').test(text(c)))) ||
        clips.find((c) => !c.classList.contains('live')) ||
        clips[0];
      if (!pick) return null;
      pick.scrollIntoView({ inline: 'center', block: 'nearest' });
      pick.click();
      const rect = pick.getBoundingClientRect();
      const x = rect.left + rect.width * frac;
      const ruler = document.getElementById('etlRuler');
      if (ruler) {
        const y = ruler.getBoundingClientRect().top + 6;
        ruler.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1, buttons: 1 }),
        );
        ruler.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
      }
      return { title: pick.title || pick.textContent?.slice(0, 40) };
    },
    { hints, frac },
  );
  await settle(1400);
  return info;
}

async function openDirectionMotion() {
  await page.evaluate(() => document.querySelector('.ptab[data-right="motion"]')?.click());
  await settle(500);
  await page.evaluate(() => document.getElementById('dir-tab-motion')?.click());
  await settle(450);
}

async function openDirectionCamera() {
  await page.evaluate(() => document.querySelector('.ptab[data-right="motion"]')?.click());
  await settle(400);
  await page.evaluate(() => document.getElementById('dir-tab-camera')?.click());
  await settle(450);
}

async function shotJpg(name, clip) {
  await page.screenshot({
    path: join(name),
    type: 'jpeg',
    quality: 90,
    clip,
  });
  console.log('ok', name);
}

async function shotDeskJpg(name, { includeTimeline = false } = {}) {
  const box = await page.evaluate((inc) => {
    const chrome = document.querySelector('header.chrome');
    const ws = document.getElementById('workspace');
    const tl = document.querySelector('.timeline-shell');
    if (!chrome || !ws) return null;
    const y = chrome.getBoundingClientRect().top;
    let bottom = ws.getBoundingClientRect().bottom;
    if (inc && tl && !document.body.classList.contains('tl-collapsed')) {
      bottom = Math.max(bottom, tl.getBoundingClientRect().bottom);
    }
    const h = bottom - y;
    if (h < 200) return null;
    return { x: 0, y, width: window.innerWidth, height: h };
  }, includeTimeline);
  if (!box) {
    console.log('MISS desk', name);
    return false;
  }
  await shotJpg(name, box);
  return true;
}

async function shotStagePlateJpg(name) {
  const box = await page.evaluate(() => {
    const stage = document.querySelector('.stage-wrap') || document.getElementById('stage')?.parentElement;
    const el = stage || document.getElementById('stage');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 80) return null;
    const ratio = 16 / 9;
    let w = r.width;
    let h = r.height;
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
    const x = r.left + (r.width - w) / 2;
    const y = r.top + (r.height - h) / 2;
    return { x, y, width: w, height: h };
  });
  if (!box) {
    console.log('MISS stage', name);
    return false;
  }
  await shotJpg(name, box);
  return true;
}

async function shotEl(name, sel) {
  const el = await page.$(sel);
  if (!el) {
    console.log('MISS', name, sel);
    return false;
  }
  const vis = await el.isVisible().catch(() => false);
  if (!vis) {
    console.log('SKIP hidden', name, sel);
    return false;
  }
  try {
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await settle(180);
    await el.screenshot({ path: join(name), timeout: 10000 });
    console.log('ok', name);
    return true;
  } catch (e) {
    console.log('FAIL', name, e.message?.slice(0, 80));
    return false;
  }
}

async function shotClipPng(name, getBox) {
  const box = await page.evaluate(getBox);
  if (!box || box.width < 40 || box.height < 40) {
    console.log('MISS clip', name, box);
    return false;
  }
  await page.screenshot({
    path: join(name),
    clip: {
      x: Math.max(0, box.x),
      y: Math.max(0, box.y),
      width: Math.min(1600, box.width),
      height: Math.min(1000, box.height),
    },
  });
  console.log('ok', name, `${Math.round(box.width)}×${Math.round(box.height)}`);
  return true;
}

/** `#leftRender` is flex-stretched; clip to tabs + visible bay sections (no empty panel tail). */
async function shotRenderBayPng(name, { withStage = true } = {}) {
  const box = await page.evaluate((withStage) => {
    const panel = document.getElementById('projectPanel');
    const bay = document.getElementById('leftRender');
    if (!panel || !bay || bay.hidden) return null;
    const tabs = panel.querySelector('.panel-tabs');
    const top = (tabs || bay).getBoundingClientRect().top;
    const sections = [...bay.children].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 10 && r.width > 10;
    });
    if (!sections.length) return null;
    const bottom = Math.max(...sections.map((el) => el.getBoundingClientRect().bottom));
    const pr = panel.getBoundingClientRect();
    let right = pr.right;
    if (withStage) {
      const stage = document.querySelector('.stage-wrap');
      if (stage) right = Math.max(right, stage.getBoundingClientRect().right);
    }
    const height = bottom - top + 14;
    if (height < 80) return null;
    return {
      x: pr.left,
      y: top,
      width: right - pr.left,
      height: Math.min(height, withStage ? 620 : height),
    };
  }, withStage);
  if (!box) {
    console.log('MISS', name);
    return false;
  }
  await page.screenshot({
    path: join(name),
    clip: {
      x: Math.max(0, box.x),
      y: Math.max(0, box.y),
      width: Math.min(1600, box.width),
      height: Math.min(1000, box.height),
    },
  });
  console.log('ok', name, `${Math.round(box.width)}×${Math.round(box.height)}`);
  return true;
}

/** Baked plate HTML at 1920×1080 (2×) when Program seek is unavailable. */
async function shotPlateFromHtml(htmlFile, outJpg) {
  let ok = false;
  try {
    await access(path.join(platesDir, htmlFile));
  } catch {
    console.log('MISS plate html', htmlFile, platesDir);
    return false;
  }
  const platePage = await context.newPage();
  try {
    await platePage.goto(`file://${path.join(platesDir, htmlFile)}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await platePage.waitForTimeout(2800);
    await platePage.screenshot({
      path: join(outJpg),
      type: 'jpeg',
      quality: 90,
    });
    console.log('ok', outJpg, `(from ${htmlFile})`);
    ok = true;
  } catch (e) {
    console.log('FAIL plate html', htmlFile, e.message?.slice(0, 80));
  } finally {
    await platePage.close();
  }
  return ok;
}

async function captureProgramPlate(seekSec, outJpg, htmlFallback) {
  await seekProgram(seekSec);
  if (await shotStagePlateJpg(outJpg)) return true;
  return shotPlateFromHtml(htmlFallback, outJpg);
}

console.log('→ open', BASE, 'product', PRODUCT_SLUG);
await open(PRODUCT_SLUG);

// ── README: product frames (Teamdeck) ──
console.log('→ readme desk (product)');

await seekProgram(PRODUCT_SEEK.programLive);
await page.evaluate(() => document.querySelector('.ptab[data-right="feedback"]')?.click());
await settle(400);
await shotDeskJpg('desk-program.jpg');

await seekProgram(PRODUCT_SEEK.deskHero);
await dismiss();
await shotDeskJpg('desk-plate.jpg');

await openDirectionMotion();
await page.evaluate(() => {
  document.getElementById('transitionGrid')?.scrollIntoView({ block: 'center' });
  document.querySelector('#rightMotion .dir-ins')?.scrollTo?.(0, 200);
});
await settle(350);
await shotDeskJpg('desk-direction.jpg');

await seekProgram(PRODUCT_SEEK.editorLive);
console.log('editor', await seekEditor('projekt|obciąż|Plan|live|Teamdeck', 0.38));
await shotDeskJpg('desk-editor.jpg', { includeTimeline: true });

console.log('→ readme plates (product)');
if (!(await captureProgramPlate(PRODUCT_SEEK.openPlate, 'plate-open.jpg', PLATE_HTML.open))) {
  await shotPlateFromHtml(PLATE_HTML.open, 'plate-open.jpg');
}
if (!(await captureProgramPlate(PRODUCT_SEEK.featuresPlate, 'plate-features.jpg', PLATE_HTML.features))) {
  await shotPlateFromHtml(PLATE_HTML.features, 'plate-features.jpg');
}
if (!(await captureProgramPlate(PRODUCT_SEEK.closePlate, 'plate-close.jpg', PLATE_HTML.close))) {
  await shotPlateFromHtml(PLATE_HTML.close, 'plate-close.jpg');
}

// Brief wizard: English Studio chrome
console.log('→ readme brief (studio slug)');
await open(STUDIO_SLUG);
await dismiss();
await page.evaluate(() => document.querySelector('#modeProgram')?.click());
await settle(300);
await page.click('#btnNewVideo');
await settle(1100);
const dialog = (await page.$('#projectDialog[open]')) || (await page.$('dialog[open]'));
if (dialog) {
  await dialog.screenshot({ path: join('brief.jpg'), type: 'jpeg', quality: 90 });
  console.log('ok brief.jpg');
} else {
  console.log('MISS brief.jpg');
}
await dismiss();

// ── Optional feature PNGs (docs / future use) ──
console.log('→ feature pngs (product)');
await open(PRODUCT_SLUG);
await seekProgram(PRODUCT_SEEK.programLive);
await dismiss();
await page.screenshot({ path: join('studio-hero.png'), fullPage: false });
console.log('ok studio-hero.png');

await shotClipPng('feature-stages.png', () => {
  const bar = document.querySelector('#stageBar, .stage-bar');
  const wrap = document.querySelector('.stage-wrap');
  if (!bar || !wrap) return null;
  const b = bar.getBoundingClientRect();
  const w = wrap.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(b.left, w.left) - 4),
    y: Math.max(0, b.top - 6),
    width: Math.min(window.innerWidth - 8, Math.max(b.right, w.right) - Math.min(b.left, w.left) + 8),
    height: Math.min(460, w.top + w.height * 0.58 - (b.top - 6)),
  };
});

await seekProgram(PRODUCT_SEEK.programLive);
await page.evaluate(() => document.querySelector('.ptab[data-right="feedback"]')?.click());
await settle(400);
await shotEl('feature-director.png', '#rightFeedback');

await openDirectionMotion();
await shotEl('feature-motion-energy.png', '#rightMotion .ins-sec:has(#energyGrid)');
await page.evaluate(() => document.getElementById('atmosphereGrid')?.scrollIntoView({ block: 'center' }));
await settle(250);
await shotEl('feature-atmosphere.png', '#rightMotion .ins-sec:has(#atmosphereGrid)');
await page.evaluate(() => document.getElementById('transitionGrid')?.scrollIntoView({ block: 'center' }));
await settle(250);
await shotEl('feature-transitions.png', '#rightMotion .ins-sec:has(#transitionGrid)');
await page.evaluate(() => document.querySelector('.live-cards-field')?.scrollIntoView({ block: 'center' }));
await settle(250);
await shotEl('feature-live-cards.png', '#rightMotion .ins-sec.live-cards-field');

await openDirectionCamera();
await shotClipPng('feature-camera-cursor.png', () => {
  const pane = document.getElementById('rightMotion');
  if (!pane) return null;
  const r = pane.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: Math.min(r.height, 720) };
});

await seekEditor('projekt|obciąż|Plan|live', 0.45);
await shotClipPng('feature-editor-stage.png', () => {
  const wrap = document.querySelector('.stage-wrap');
  if (!wrap) return null;
  const r = wrap.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: Math.min(r.height, 500) };
});
await shotEl('feature-editor-timeline.png', '#edTimeline');
await page.evaluate(() => document.querySelector('.ptab[data-right="inspector"]')?.click());
await settle(450);
await shotEl('feature-inspector.png', '#rightInspector');

await open(STUDIO_SLUG);
await dismiss();
await page.evaluate(() => document.querySelector('#modeProgram')?.click());
await settle(300);
await page.click('#btnNewVideo');
await settle(1000);
const wiz = (await page.$('#projectDialog[open]')) || (await page.$('dialog[open]'));
if (wiz) {
  await wiz.screenshot({ path: join('feature-new-video.png') });
  console.log('ok feature-new-video.png');
}
await dismiss();

// Render bay — clip to content (full #leftRender element includes empty flex tail)
await open(PRODUCT_SLUG);
await seekProgram(PRODUCT_SEEK.programLive);
await page.evaluate(() => document.querySelector('.ptab[data-left="render"]')?.click());
await settle(500);
await shotRenderBayPng('feature-render-bay.png', { withStage: true });

await browser.close();
console.log('DONE — run: node scripts/render-readme-art.mjs');

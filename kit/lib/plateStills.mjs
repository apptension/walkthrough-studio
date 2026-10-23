/**
 * Frozen stills of every interstitial type, painted in a real brand pack, for the Studio
 * plate pickers. One JPEG per brand + type, rebuilt when the brand pack or templates change.
 * The frame is the settled moment (entrances done, before the fade out) with animations paused.
 *
 * Requests resolve per-type as each JPEG lands — the wizard does not wait for the full set.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DELIVERY } from './format.mjs';
import { brandReadiness, loadBrand, OUT_ROOT, TEMPLATES } from './project.mjs';
import { PLATE_TYPE_IDS, PLATE_TYPE_SET } from './plateTypes.mjs';
import { scaffoldPlate } from './script.mjs';
import { writePreviewPlate } from './plates.mjs';

/** Bump when the still's framing or sample copy changes. */
const STILL_REV = 1;

/** brandName → { dir, types: Map<type, Promise<string>>, all: Promise<string> } */
const inflight = new Map();

const mark = (letter, fill) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="18" fill="${fill}"/><text x="40" y="52" text-anchor="middle" font-family="sans-serif" font-size="34" font-weight="700" fill="#fff">${letter}</text></svg>`
  )}`;

const MARKS = [
  ['S', '#5b6cff'],
  ['N', '#0ca300'],
  ['Z', '#e0852f'],
  ['G', '#1aa6a6'],
].map(([letter, fill]) => ({ asset: mark(letter, fill), label: letter, bg: 'dark' }));

/** Sample copy so a still reads as the finished plate, not an empty scaffold. */
export function previewPlate(type) {
  const plate = scaffoldPlate(type, { before: 'Preview' });
  plate.id = type;
  if (type === 'stats') {
    plate.stats = [
      { value: '4.8', label: 'Rating', note: 'on G2' },
      { value: '12k', label: 'Teams', note: 'planning here' },
      { value: '3×', label: 'Faster', note: 'to first plan' },
    ];
  } else if (type === 'kpi') {
    plate.stats = [
      { value: '94%', label: 'Utilisation', delta: '+12%', note: 'vs last quarter' },
      { value: '98%', label: 'On time', delta: '+6%', note: 'across teams' },
      { value: '1,240', label: 'Hours saved', delta: '+310', note: 'this quarter' },
      { value: '3', label: 'Open requests', delta: '−11', note: 'down from 14' },
    ];
  } else if (type === 'metric') {
    Object.assign(plate, { value: '94%', unit: 'of teams', note: 'ship the week they planned', progress: 0.94, pills: ['On time', 'One plan'] });
  } else if (type === 'testimonials') {
    plate.quotes = [
      { quote: 'We stopped double-booking people.', author: 'Ana Ruiz', role: 'COO' },
      { quote: 'Monday planning takes minutes now.', author: 'Jon Hale', role: 'Lead' },
      { quote: 'Leaders get the number without asking.', author: 'Priya Shah', role: 'Ops' },
    ];
  } else if (type === 'quote') {
    Object.assign(plate, { quote: 'We stopped double-booking people in the first week.', author: 'Ana Ruiz', role: 'COO · Studio North' });
  } else if (type === 'logos' || type === 'orbit') {
    plate.logos = MARKS.slice(0, type === 'orbit' ? 4 : 4);
  }
  return plate;
}

function sourceStamp(brand) {
  const files = [...(brand.files || [])];
  if (existsSync(TEMPLATES)) {
    for (const name of readdirSync(TEMPLATES)) {
      if (/\.(html|css)$/.test(name)) files.push(join(TEMPLATES, name));
    }
  }
  const mtime = files.reduce((max, f) => Math.max(max, existsSync(f) ? statSync(f).mtimeMs : 0), 0);
  return createHash('sha1').update(`${STILL_REV}:${Math.round(mtime)}`).digest('hex').slice(0, 12);
}

function cacheDir(brandName, stamp) {
  return join(OUT_ROOT, '_plate-stills', brandName, stamp);
}

function waitForFile(file, { timeoutMs = 180000, everyMs = 120 } = {}) {
  if (existsSync(file)) return Promise.resolve(file);
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (existsSync(file)) {
        resolve(file);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for ${file}`));
        return;
      }
      setTimeout(tick, everyMs);
    };
    tick();
  });
}

async function captureOne(page, htmlPath, out) {
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.addStyleTag({ content: '.grain{animation:none!important}.black{display:none!important}' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = 0;
    }
    if (typeof window.__fitType === 'function') await window.__fitType();
    if (typeof window.__fitPlate === 'function') await window.__fitPlate();
    const dur = parseFloat(document.body.dataset.duration) || 6;
    const black = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--black-out')) || dur - 0.7;
    const ms = Math.max(0, black - 1.15) * 1000;
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = ms;
    }
    const runtime = window.__plateRuntime || window.__plateField;
    if (typeof runtime?.renderAt === 'function') runtime.renderAt(ms);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const full = `${out}.full.jpg`;
  await page.screenshot({ path: full, type: 'jpeg', quality: 70 });
  const scaled = spawnSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-i', full, '-vf', 'scale=720:-2', '-q:v', '4', out],
    { encoding: 'utf8' }
  );
  if (scaled.status !== 0 || !existsSync(out)) {
    writeFileSync(out, readFileSync(full));
  }
  rmSync(full, { force: true });
}

/**
 * Render every missing still for a brand. Each type is written as soon as it is captured so
 * concurrent plateStill(type) callers can unblock without waiting for the whole catalog.
 */
async function renderBrand(brandName, dir) {
  const brand = loadBrand(brandName);
  mkdirSync(dir, { recursive: true });
  const html = new Map();
  for (const type of PLATE_TYPE_IDS) {
    html.set(type, writePreviewPlate(brand, previewPlate(type), join(dir, 'build', type)));
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: DELIVERY.width, height: DELIVERY.height }, deviceScaleFactor: 1 });
    // Prefer types the wizard shows first so the first viewport fills quickly.
    const order = [
      'features',
      'journey',
      'stats',
      'testimonials',
      'logos',
      'callout',
      'compare',
      'quote',
      'metric',
      ...PLATE_TYPE_IDS.filter(
        (t) =>
          ![
            'features',
            'journey',
            'stats',
            'testimonials',
            'logos',
            'callout',
            'compare',
            'quote',
            'metric',
          ].includes(t)
      ),
    ];
    const seen = new Set();
    for (const type of order) {
      if (seen.has(type)) continue;
      seen.add(type);
      const out = join(dir, `${type}.jpg`);
      if (existsSync(out)) continue;
      await captureOne(page, html.get(type), out);
    }
  } finally {
    await browser.close();
  }
  rmSync(join(dir, 'build'), { recursive: true, force: true });
  return dir;
}

function startBrandJob(brandName) {
  const readiness = brandReadiness(brandName);
  if (!readiness.ready) throw new Error(`Brand "${brandName}" is not ready for plate stills`);
  const brand = loadBrand(brandName);
  const stamp = sourceStamp(brand);
  const dir = cacheDir(brandName, stamp);
  const done = PLATE_TYPE_IDS.every((type) => existsSync(join(dir, `${type}.jpg`)));
  if (done) {
    return { dir, all: Promise.resolve(dir), types: new Map() };
  }
  const all = renderBrand(brandName, dir).finally(() => {
    const cur = inflight.get(brandName);
    if (cur?.all === all) inflight.delete(brandName);
  });
  return { dir, all, types: new Map() };
}

/** Absolute path of the settled JPEG for one plate type in a brand pack. */
export function plateStill(brandName, type) {
  if (!PLATE_TYPE_SET.has(type)) throw new Error(`Unknown plate type "${type}"`);
  let job = inflight.get(brandName);
  if (!job) {
    job = startBrandJob(brandName);
    inflight.set(brandName, job);
  }
  const file = join(job.dir, `${type}.jpg`);
  if (existsSync(file)) return Promise.resolve(file);

  let pending = job.types.get(type);
  if (!pending) {
    pending = Promise.race([
      waitForFile(file),
      job.all.then(() => {
        if (!existsSync(file)) throw new Error(`No still for ${type}`);
        return file;
      }),
    ]);
    job.types.set(type, pending);
  }
  return pending;
}

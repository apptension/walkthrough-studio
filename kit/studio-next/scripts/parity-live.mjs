#!/usr/bin/env node
/**
 * Live 1:1 check: drive the legacy desk and studio-next through the same steps
 * against the same running studio, then diff their DOM and console.
 *
 *   ./studio --legacy                 # legacy desk + API on :4747
 *   npm run dev                       # studio-next on :4748
 *   node scripts/parity-live.mjs [slug …]
 *
 * Read-only by construction: every non-GET `/api` request is answered with a
 * 503 in both desks, so nothing is rendered, saved or queued on disk.
 * Per slug and step, `parity-report/<slug>/` gets the DOM diff, both screenshots
 * and a pixel diff (red = differs).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { chromium } from '@playwright/test';

const LEGACY = process.env.LEGACY_ORIGIN ?? 'http://127.0.0.1:4747';
const NEXT = process.env.NEXT_ORIGIN ?? 'http://127.0.0.1:4748';
const SLUGS = process.argv.length > 2 ? process.argv.slice(2) : ['how-walkthrough-studio-works'];
const OUT = join(process.cwd(), 'parity-report');
mkdirSync(OUT, { recursive: true });

/**
 * Hidden placeholders the legacy index.html keeps for retired scripts. No CSS,
 * script or test references them, so studio-next does not render them.
 */
const LEGACY_ONLY_IDS = new Set(
  `actionCard activityDock jobLog jobs jobPulse jobLiveCard jobLiveTitle jobLiveBadge jobLiveActivity
   jobLiveElapsed jobLivePhase btnActivityFollow btnClearLog assets plates statusPills freshnessBar nextSteps
   rebuildChecklist freshnessTitle freshnessReason nextStepsBadge nextStepsSummary btnRebuild btnRebuildFull
   btnApplyRebuild btnApplyRebuildFull btnDismissNext eyebrow contactSheet sheetEmpty suggestOut criticBox
   btnCaptions btnQc btnDeliver btnRefresh btnPlates btnSuggest btnSuggestApply btnCriticForce
   btnCompareSync btnComparePlay btnComparePause btnMakeSide`.split(/\s+/),
);

/** Runs in the page: one line per element, with the state a user could see or a selector could hit. */
function signature(legacyOnly) {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META']);
  const volatile = (v) =>
    v
      .replace(/([?&](t|v|_)=)\d{6,}/g, '$1#')
      .replace(/\b\d{1,2}:\d{2}:\d{2}\s?(AM|PM)?\b/g, '<time>')
      .replace(/\d{1,2}\/\d{1,2}\/\d{4},?/g, '<date>');
  // Legacy wiring markers ("this listener is attached"); React owns its listeners.
  const IGNORED_ATTRS = ['data-sprite', 'data-wired', 'data-drag-wired', 'data-sel-wired', 'data-url'];
  const style = (el) =>
    [...el.style]
      .map((p) => `${p}:${el.style.getPropertyValue(p).trim().replace(/-?\d*\.\d+/g, (n) => String(Math.round(Number(n) * 1000) / 1000))}`)
      .sort()
      .join(';');
  const lines = [];
  const walk = (el, depth) => {
    if (SKIP.has(el.tagName)) return;
    if (el.id && legacyOnly.includes(el.id)) return;
    if (el.id === 'root' && el.parentElement === document.body) {
      for (const c of el.children) walk(c, depth);
      return;
    }
    // Vite's dev client and the Playwright runtime are not part of either desk.
    if (el.tagName === 'VITE-ERROR-OVERLAY') {
      lines.push(`${'  '.repeat(depth)}!! VITE ERROR OVERLAY`);
      return;
    }
    const control = ['INPUT', 'SELECT', 'TEXTAREA', 'OPTION'].includes(el.tagName);
    const media = el.tagName === 'VIDEO' || el.tagName === 'AUDIO';
    const attrs = [...el.attributes]
      .filter((a) => a.name !== 'class' && a.name !== 'id' && !IGNORED_ATTRS.includes(a.name))
      .filter((a) => !(a.name === 'style' && !el.style.length))
      .filter((a) => !(control && ['value', 'selected', 'checked'].includes(a.name)) && !(media && a.name === 'muted'))
      .map((a) => (a.name === 'style' ? `style=${JSON.stringify(style(el))}` : `${a.name}=${JSON.stringify(volatile(a.value))}`))
      .sort();
    const cls = [...el.classList].sort().join('.');
    const props = [];
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && el.type !== 'file') props.push(`:value=${JSON.stringify(el.value)}`);
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) props.push(`:checked=${el.checked}`);
    if (el.tagName === 'OPTION' && el.selected) props.push(':selected');
    if (media) props.push(`:muted=${el.muted}`);
    if ('disabled' in el && el.disabled) props.push(':disabled');
    if (el.tagName === 'DIALOG') props.push(`:open=${el.open}`);
    const text = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    lines.push(
      `${'  '.repeat(depth)}<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}${attrs.length ? ` ${attrs.join(' ')}` : ''}${props.length ? ` ${props.join(' ')}` : ''}>${text ? ` ${JSON.stringify(volatile(text))}` : ''}`,
    );
    for (const c of el.children) walk(c, depth + 1);
  };
  walk(document.documentElement, 0);
  return lines.join('\n');
}

async function openDesk(browser, origin, slug) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const log = [];
  await page.route(/\/api\//, (route) => {
    const req = route.request();
    if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue();
    log.push(`blocked ${req.method()} ${new URL(req.url()).pathname}`);
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Blocked by the parity run' }) });
  });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') log.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? '';
    // Media elements abort range requests when they switch source; that is not a failure.
    if (/ERR_ABORTED/.test(why) && /\/(media|version-media)\//.test(r.url())) return;
    log.push(`requestfailed: ${r.method()} ${new URL(r.url()).pathname} ${why}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && r.status() !== 503) log.push(`http ${r.status()}: ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  await page.goto(`${origin}/?slug=${encodeURIComponent(slug)}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(() => !document.getElementById('bootLoader'), null, { timeout: 30_000 }).catch(() => log.push('boot loader still up after 30 s'));
  await page.waitForTimeout(2000);
  return { page, log };
}

const STEPS = [
  ['initial', async () => {}],
  ['left-versions', (p) => p.click('[data-left="versions"]')],
  ['left-deliver', (p) => p.click('[data-left="deliver"]')],
  ['left-render', (p) => p.click('[data-left="render"]')],
  ['right-inspector', (p) => p.click('[data-right="inspector"]')],
  ['right-motion', (p) => p.click('[data-right="motion"]')],
  ['right-review', (p) => p.click('[data-right="review"]')],
  ['right-feedback', (p) => p.click('[data-right="feedback"]')],
  ['command-open', (p) => p.click('#btnCommand')],
  ['command-filter', (p) => p.fill('#commandInput', 'deliver')],
  ['command-close', (p) => p.keyboard.press('Escape')],
  ['help-open', (p) => p.click('#btnHelp')],
  ['help-close', (p) => p.keyboard.press('Escape')],
  ['help-key-open', (p) => p.keyboard.press('Shift+Slash')],
  ['help-key-close', (p) => p.keyboard.press('Escape')],
  ['command-key-open', (p) => p.keyboard.press('Meta+k')],
  ['command-key-close', (p) => p.keyboard.press('Escape')],
  ['script-open', (p) => p.click('.pstage[data-stage="script"]')],
  ['script-close', (p) => p.keyboard.press('Escape')],
  ['cut-click', (p) => p.click('.pstage[data-stage="cut"]')],
  ['cut-close', (p) => p.keyboard.press('Escape')],
  ['settings-open', (p) => p.click('#btnProjectSettings')],
  ['settings-close', (p) => p.keyboard.press('Escape')],
  ['new-open', (p) => p.click('#btnNewVideo')],
  ['new-close', (p) => p.keyboard.press('Escape')],
  ['branch-open', (p) => p.click('#btnBranch')],
  ['branch-close', (p) => p.keyboard.press('Escape')],
  ['timeline-collapse', (p) => p.click('#tlLabel')],
  ['timeline-expand', (p) => p.click('#tlLabel')],
  ['captions-on', (p) => p.keyboard.press('c')],
  ['editor-open', (p) => p.click('#modePlate')],
  ['editor-plate-2-open', (p) => p.locator('.etl-clip.plate').nth(1).click()],
  ['editor-right-motion', (p) => p.click('[data-right="motion"]')],
  ['editor-right-inspector', (p) => p.click('[data-right="inspector"]')],
  ['editor-close', (p) => p.click('#modeProgram')],
];

/** Share of pixels that differ by more than a small tolerance, plus a red-on-grey diff image. */
async function pixelDiff(scratch, a, b, out) {
  const result = await scratch.evaluate(
    async ([x, y]) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${src}`;
        });
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      const w = Math.min(ia.width, ib.width);
      const h = Math.min(ia.height, ib.height);
      const read = (img) => {
        const c = new OffscreenCanvas(w, h);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, w, h);
      };
      const da = read(ia).data;
      const db = read(ib).data;
      const canvas = new OffscreenCanvas(w, h);
      const g = canvas.getContext('2d');
      const outImg = g.createImageData(w, h);
      let changed = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
        const grey = (da[i] + da[i + 1] + da[i + 2]) / 12;
        if (d > 40) changed += 1;
        outImg.data.set(d > 40 ? [255, 40, 40, 255] : [grey, grey, grey, 255], i);
      }
      g.putImageData(outImg, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { ratio: changed / (w * h), png: btoa(bin), sizeMatch: ia.width === ib.width && ia.height === ib.height };
    },
    [a.toString('base64'), b.toString('base64')],
  );
  writeFileSync(out, Buffer.from(result.png, 'base64'));
  return result;
}

// Moving pictures (players, WebGL atmospheres, iframes) differ frame to frame on their own.
// Only the ones actually on top are masked, so a sheet over the player is still compared.
async function shot(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('video, canvas, iframe, #livePreview, .tl-thumbs, #timeCur, .tl-playhead')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && (hit === el || el.contains(hit) || hit.contains(el))) el.setAttribute('data-parity-mask', '');
    }
  });
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide', mask: [page.locator('[data-parity-mask]')], maskColor: '#ff00ff' });
  await page.evaluate(() => document.querySelectorAll('[data-parity-mask]').forEach((el) => el.removeAttribute('data-parity-mask')));
  return png;
}

const browser = await chromium.launch();
const legacyOnly = [...LEGACY_ONLY_IDS];
const reports = [];

for (const slug of SLUGS) {
  const dir = join(OUT, slug);
  mkdirSync(dir, { recursive: true });
  const legacy = await openDesk(browser, LEGACY, slug);
  const next = await openDesk(browser, NEXT, slug);
  const scratch = await browser.newPage();
  const summary = [];

  for (const [step, act] of STEPS) {
    for (const desk of [legacy, next]) {
      try {
        await act(desk.page);
      } catch (err) {
        desk.log.push(`step ${step} failed: ${err.message.split('\n')[0]}`);
      }
      await desk.page.waitForTimeout(step.endsWith('-open') ? 2200 : 900);
    }
    const a = await legacy.page.evaluate(signature, legacyOnly);
    const b = await next.page.evaluate(signature, legacyOnly);
    const fa = join(dir, `${step}.legacy.txt`);
    const fb = join(dir, `${step}.next.txt`);
    writeFileSync(fa, `${a}\n`);
    writeFileSync(fb, `${b}\n`);
    let diff = '';
    try {
      execFileSync('diff', ['-u', fa, fb]);
    } catch (err) {
      diff = String(err.stdout);
    }
    writeFileSync(join(dir, `${step}.diff`), diff);
    const changed = diff.split('\n').filter((l) => /^[-+][^-+]/.test(l)).length;
    const pa = await shot(legacy.page);
    const pb = await shot(next.page);
    writeFileSync(join(dir, `${step}.legacy.png`), pa);
    writeFileSync(join(dir, `${step}.next.png`), pb);
    const px = await pixelDiff(scratch, pa, pb, join(dir, `${step}.pixels.png`));
    summary.push(
      `${changed === 0 ? '     same DOM' : `${String(changed).padStart(4)} DOM lines`}  ${(px.ratio * 100).toFixed(2).padStart(6)}% px${px.sizeMatch ? '' : ' (size!)'}  ${step}`,
    );
  }

  await Promise.all([legacy.page.context().close(), next.page.context().close(), scratch.close()]);
  reports.push(
    [
      `## ${slug}`,
      ...summary,
      `legacy console/network (${legacy.log.length}):`,
      ...legacy.log.map((l) => `  ${l}`),
      `next console/network (${next.log.length}):`,
      ...next.log.map((l) => `  ${l}`),
      '',
    ].join('\n'),
  );
  process.stdout.write(`${reports.at(-1)}\n`);
}

await browser.close();
writeFileSync(join(OUT, 'report.txt'), reports.join('\n'));

#!/usr/bin/env node
/**
 * Capture README screenshots from a running Studio (http://127.0.0.1:4747).
 * Usage: node scripts/capture-readme-shots.mjs
 */
import { chromium } from '../kit/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/assets');
const SLUG = 'walkthrough-studio';
const BASE = 'http://127.0.0.1:4747';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await (
  await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
).newPage();

const settle = (ms = 700) => page.waitForTimeout(ms);

async function open() {
  await page.goto(`${BASE}/?slug=${SLUG}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => {
    const boot = document.getElementById('bootLoader');
    if (!boot) return true;
    const s = getComputedStyle(boot);
    return s.display === 'none' || s.visibility === 'hidden' || boot.getAttribute('aria-busy') === 'false';
  }, { timeout: 25000 }).catch(() => {});
  await settle(1200);
}

async function dismiss() {
  await page.keyboard.press('Escape').catch(() => {});
  await settle(150);
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
  await settle(400);
  await page.evaluate(async (sec) => {
    const v = document.getElementById('player');
    if (!v) return;
    await new Promise((r) => {
      if (v.readyState >= 2) return r();
      v.addEventListener('loadeddata', r, { once: true });
      setTimeout(r, 2500);
    });
    await new Promise((r) => {
      v.addEventListener('seeked', r, { once: true });
      try {
        v.currentTime = sec;
      } catch {
        r();
      }
      setTimeout(r, 2000);
    });
    try {
      v.pause();
    } catch {
      /* ignore */
    }
  }, t);
  await settle(700);
}

async function seekEditor(hint, frac = 0.35) {
  await dismiss();
  await page.evaluate(() => document.querySelector('#modePlate')?.click());
  await settle(1400);
  const info = await page.evaluate(
    ({ hint, frac }) => {
      const clips = [...document.querySelectorAll('#etlClips .etl-clip')];
      const pick =
        clips.find((c) => new RegExp(hint, 'i').test(`${c.title || ''} ${c.textContent || ''}`)) ||
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
        ruler.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1, buttons: 1 }));
        ruler.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
      }
      return { title: pick.title };
    },
    { hint, frac }
  );
  await settle(1500);
  return info;
}

async function shotEl(sel, name, pad = 10) {
  const el = await page.$(sel);
  if (!el) {
    console.log('MISS', name, sel);
    return false;
  }
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await settle(200);
  await el.screenshot({ path: path.join(OUT, name) });
  console.log('ok', name);
  return true;
}

async function shotClip(name, getBox) {
  const box = await page.evaluate(getBox);
  if (!box || box.width < 40 || box.height < 40) {
    console.log('MISS clip', name, box);
    return false;
  }
  await page.screenshot({
    path: path.join(OUT, name),
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

async function openDirection() {
  await page.evaluate(() => document.querySelector('.ptab[data-right="motion"]')?.click());
  await settle(600);
  await page.evaluate(() => {
    const adv = document.querySelector('.direction-advanced');
    if (adv) adv.open = true;
  });
  await settle(300);
}

console.log('→ open');
await open();

// ── Hero + stages on bright Program frame ──
await seekProgram(12);
await dismiss();
await page.screenshot({ path: path.join(OUT, 'studio-hero.png'), fullPage: false });
console.log('ok studio-hero.png');

await shotClip('feature-stages.png', () => {
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

// ── Director ──
await seekProgram(12);
await page.evaluate(() => document.querySelector('.ptab[data-right="feedback"]')?.click());
await settle(400);
await shotEl('#rightFeedback', 'feature-director.png');

// ── Direction panel features ──
await openDirection();
await shotEl('.field:has(#energyGrid)', 'feature-motion-energy.png');
await page.evaluate(() => document.querySelector('#atmosphereGrid')?.scrollIntoView({ block: 'center' }));
await settle(250);
await shotEl('.field:has(#atmosphereGrid)', 'feature-atmosphere.png');
await page.evaluate(() => document.querySelector('.effects-field')?.scrollIntoView({ block: 'center' }));
await settle(250);
await shotEl('.effects-field', 'feature-effects.png');
await page.evaluate(() => document.querySelector('.live-cards-field')?.scrollIntoView({ block: 'center' }));
await settle(250);
await shotEl('.live-cards-field', 'feature-live-cards.png');
await page.evaluate(() => document.querySelector('.transitions-field, #transitionGrid')?.scrollIntoView({ block: 'center' }));
await settle(250);
await shotEl('.field:has(#transitionGrid), .transitions-field', 'feature-transitions.png');

await page.evaluate(() => {
  document.querySelector('[data-cursor="style"]')?.scrollIntoView({ block: 'center' });
});
await settle(350);
await shotClip('feature-camera-cursor.png', () => {
  const rows = [...document.querySelectorAll('#rightMotion .seg-row, #rightMotion .switch-row')].filter((el) =>
    /auto zoom|frame|background|padding|corners|shadow|cursor|size|glide|idle|loop|keystroke|live pace|focus ring/i.test(
      el.textContent || ''
    )
  );
  if (!rows.length) return null;
  const rects = rows.map((el) => el.getBoundingClientRect()).filter((r) => r.top < innerHeight && r.bottom > 0 && r.height > 0);
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.left));
  const y = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return {
    x: Math.max(0, x - 12),
    y: Math.max(0, y - 12),
    width: Math.min(480, right - x + 24),
    height: Math.min(720, bottom - y + 24),
  };
});

// ── Editor mid-cut ──
console.log('editor', await seekEditor('What Studio automates', 0.45));
await shotClip('feature-editor-stage.png', () => {
  const wrap = document.querySelector('.stage-wrap');
  if (!wrap) return null;
  const r = wrap.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: Math.min(r.height, 500) };
});
await shotEl('#edTimeline', 'feature-editor-timeline.png');
await page.evaluate(() => document.querySelector('.ptab[data-right="inspector"]')?.click());
await settle(450);
await shotEl('#rightInspector', 'feature-inspector.png');

// ── New video wizard ──
await dismiss();
await page.evaluate(() => document.querySelector('#modeProgram')?.click());
await settle(300);
await page.click('#btnNewVideo');
await settle(1000);
const dialog = (await page.$('#projectDialog[open]')) || (await page.$('dialog[open]'));
if (dialog) {
  await dialog.screenshot({ path: path.join(OUT, 'feature-new-video.png') });
  console.log('ok feature-new-video.png');
} else {
  console.log('MISS feature-new-video.png');
}
await dismiss();

// ── Live render bay (forced plates) ──
await seekProgram(12);
await page.evaluate(() => {
  document.body.classList.add('is-rendering');
  document.querySelector('.ptab[data-left="render"]')?.click();
  const pill = document.getElementById('renderStatusPill');
  if (pill) {
    pill.className = 'render-pill run';
    pill.textContent = 'Rendering';
  }
  const elapsed = document.getElementById('renderElapsed');
  if (elapsed) {
    elapsed.hidden = false;
    elapsed.textContent = '00:00:05';
  }
  const headline = document.getElementById('renderHeadline');
  if (headline) headline.textContent = 'Rendering sequence';
  const reason = document.getElementById('renderReason');
  if (reason) reason.textContent = 'Live log and pipeline update here. Program refreshes when the last step finishes.';
  const primary = document.getElementById('btnActionPrimary');
  if (primary) primary.hidden = true;
  const icons = {
    plates: `<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z"/></svg>`,
    produce: `<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>`,
    audio: `<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zm5 9a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12h-2z"/></svg>`,
    deliver: `<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg>`,
    preview: `<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/></svg>`,
  };
  const steps = [
    { id: 'plates', label: 'Render brand plates', status: 'run' },
    { id: 'produce', label: 'Produce master video', status: 'todo' },
    { id: 'audio', label: 'Add voice & music', status: 'todo' },
    { id: 'deliver', label: 'Export handoff pack', status: 'todo' },
    { id: 'preview', label: 'Show in player', status: 'todo' },
  ];
  const ol = document.getElementById('actionSteps');
  const idle = document.getElementById('pipelineIdle');
  if (ol) {
    ol.hidden = false;
    if (idle) idle.hidden = true;
    ol.innerHTML = steps
      .map(
        (s) => `<li class="${s.status}" data-step-id="${s.id}">
      <span class="pip-ico">${icons[s.id]}</span>
      <span class="pip-label">${s.label}</span>
      <span class="pip-mark">${s.status === 'run' ? '…' : '○'}</span>
    </li>`
      )
      .join('');
  }
});

await page.click('[data-enqueue="plates"]');
await page
  .waitForFunction(() => {
    const stages = document.getElementById('renderStages');
    if (!stages || stages.hidden) return false;
    return [...stages.querySelectorAll('li')].some((li) => {
      const m = (li.textContent || '').match(/frame (\d+) of (\d+)/i);
      return m && Number(m[1]) >= 15;
    });
  }, { timeout: 120000 })
  .catch(() => console.log('warn: frame wait timed out — capturing current bay'));

await settle(250);
await shotEl('#leftRender', 'feature-render-bay.png');
await shotEl('#renderLiveCard', 'feature-render-progress.png');
await shotClip('feature-render-context.png', () => {
  const left = document.querySelector('#projectPanel');
  const stage = document.querySelector('.stage-wrap');
  if (!left || !stage) return null;
  const a = left.getBoundingClientRect();
  const b = stage.getBoundingClientRect();
  return {
    x: a.left,
    y: Math.min(a.top, b.top),
    width: Math.min(1280, b.right - a.left),
    height: Math.min(620, Math.max(540, b.height + 48)),
  };
});

await page.click('#btnStopRender').catch(() => {});
await settle(800);

await browser.close();
console.log('DONE');

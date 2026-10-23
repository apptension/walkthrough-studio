import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { atmosphereSnippet } from './atmosphere.mjs';
import { plateBrowserArgs, writePreviewPlate } from './plates.mjs';
import { TITLE_REVEALS, resolveMotion } from './plateMotion.mjs';
import {
  TITLE_REVEAL_LABELS,
  WEBGL_REVEALS,
  revealMarkup,
  revealNeedsMarkup,
  titleRevealRuntimeSource,
  titleRevealShader,
} from './titleReveal.mjs';

const brand = (motion = {}) => ({
  colors: { ink: '#0a1f0a', surface: '#0f2a0f', gold: '#0ca300', amber: '#7ac943', teal: '#2dd4bf', text: '#f8fafc' },
  font: { family: 'Inter', css: '' },
  logoHtml: '<svg viewBox="0 0 10 10"></svg>',
  motion: { energy: 'clear', ...motion },
});

test('title reveal catalogue is one list, labelled, and accepted by motion', () => {
  assert.deepEqual(TITLE_REVEALS, ['rise', 'cascade', 'wipe', 'focus', 'veil', 'ink', 'slit', 'iris', 'embers']);
  assert.deepEqual(Object.keys(TITLE_REVEAL_LABELS), TITLE_REVEALS);
  for (const id of TITLE_REVEALS) assert.match(TITLE_REVEAL_LABELS[id], / · /);
  assert.equal(resolveMotion(brand({ titleReveal: 'iris' })).titleReveal, 'iris');
  assert.equal(resolveMotion(brand({ titleReveal: 'nope' })).titleReveal, 'rise');
  assert.equal(revealMarkup('cascade'), 'chars');
  assert.equal(revealMarkup('wipe'), 'wipe');
  assert.equal(revealMarkup('rise'), 'words');
  assert.equal(revealMarkup('ink'), 'plain');
  assert.equal(revealNeedsMarkup('features', 'rise', 'ink', 'callout'), false);
  assert.equal(revealNeedsMarkup('features', 'rise', 'cascade', 'callout'), true);
  assert.equal(revealNeedsMarkup('open', 'ink', 'iris', 'open'), false);
  assert.equal(revealNeedsMarkup('open', 'rise', 'ink', 'open'), true);
  assert.equal(revealNeedsMarkup('point', 'wipe', 'focus', 'statement'), true);
  assert.equal(revealNeedsMarkup('point', 'ink', 'ink', 'statement'), false);
});

test('every WebGL reveal compiles as a page script with the shared uniforms', () => {
  for (const id of WEBGL_REVEALS) {
    const src = titleRevealShader(id);
    for (const u of ['uRes', 'uP', 'uGold', 'uAmber', 'uPass']) assert.match(src, new RegExp(`uniform \\w+ ${u};`));
    assert.match(src, /void main\(\)/);
    assert.match(src, /gl_FragColor/);
  }
  const runtime = titleRevealRuntimeSource();
  assert.doesNotThrow(() => new Function(runtime));
  assert.match(runtime, /syncTitles/);
  assert.match(runtime, /destination-in|title-mask/);
  for (const id of WEBGL_REVEALS) assert.match(runtime, new RegExp(`"${id}"`));
  const snippet = atmosphereSnippet(brand({ atmosphere: 'none' }));
  assert.match(snippet.script, /syncTitles/);
});

test('a plain reveal is embedded on the plate; cascade still builds letters', () => {
  const root = mkdtempSync(join(tmpdir(), 'title-reveal-'));
  try {
    const pack = { ...brand({ titleReveal: 'cascade' }), dir: root };
    const ink = writePreviewPlate(pack, { id: 'line', type: 'callout', title: 'A *clear* line', body: 'Because.', motion: { titleReveal: 'ink', atmosphere: 'none' } }, root);
    const html = readFileSync(ink, 'utf8');
    assert.match(html, /data-reveal="ink"/);
    assert.match(html, /<span class="accent">clear<\/span>/);
    assert.doesNotMatch(html, /class="char/);
    assert.match(html, /syncTitles/);
    assert.match(html, /title-mask/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('WebGL masks stay closed at the open and fully open once the reveal has played', { timeout: 60_000 }, async () => {
  const html = `<!doctype html>
<html><head><style>
  :root { --gold: #e8b84a; --amber: #ff6a2a; --motion-enter: 1s; }
  body { margin: 0; }
  .title { position: absolute; left: 20px; top: 40px; width: 520px; height: 120px; margin: 0; font: 600 64px/120px sans-serif; color: #fff; }
</style></head>
<body data-duration="4"><div class="stage" style="position:relative;width:800px;height:240px"><div class="bg"></div>
<h1 class="title" data-reveal="ink" style="--t: 0.05s">Hello</h1>
</div></body></html>`;
  const { markup, script } = atmosphereSnippet(brand({ atmosphere: 'none', titleReveal: 'ink' }), { width: 800, height: 240 });
  const pageHtml = html.replace('<div class="bg"></div>', `<div class="bg"></div>${markup}`).replace('</body>', `${script}</body>`);
  const browser = await chromium.launch({ headless: true, args: plateBrowserArgs() });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 240 } });
    await page.setContent(pageHtml, { waitUntil: 'load' });
    const sample = async (ms, xFrac) =>
      page.evaluate(
        ({ ms, xFrac }) => {
          window.__plateRuntime.renderAt(ms);
          const canvas = document.querySelector('.title-mask');
          if (!canvas) return null;
          const gl = canvas.getContext('webgl');
          const x = Math.min(canvas.width - 1, Math.max(0, Math.floor(canvas.width * xFrac)));
          const y = Math.floor(canvas.height / 2);
          const px = new Uint8Array(4);
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          return { a: px[3], w: canvas.width, fx: document.querySelector('.title').classList.contains('title-fx') };
        },
        { ms, xFrac },
      );
    for (const id of WEBGL_REVEALS) {
      await page.evaluate((next) => {
        document.querySelector('.title').setAttribute('data-reveal', next);
        window.__plateRuntime.syncTitles();
      }, id);
      const closed = await sample(0, 0.5);
      const open = await sample(2200, 0.5);
      assert.ok(closed && closed.fx && closed.w > 20, `${id} binds a mask (${JSON.stringify(closed)})`);
      assert.ok(closed.a < 40, `${id} is hidden at the open (alpha ${closed.a})`);
      assert.ok(open.a > 200, `${id} is open after the reveal (alpha ${open.a})`);
    }
    await page.evaluate(() => document.querySelector('.title').setAttribute('data-reveal', 'slit'));
    const left = await sample(280, 0.08);
    const right = await sample(280, 0.96);
    assert.ok(left.a > 200, `slit has revealed the left edge (alpha ${left.a})`);
    assert.ok(right.a < 40, `slit has not reached the right edge yet (alpha ${right.a})`);
  } finally {
    await browser.close();
  }
});

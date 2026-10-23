import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { contextOptions, captureProfile } from './capturePresets.mjs';
import { jpegSize, startRasterCapture } from './rasterCapture.mjs';

test('a screenshot that never returns is dropped and capture continues on a fresh session', { timeout: 2000 }, async () => {
  const hung = { send: () => new Promise(() => {}), detached: false, detach: async () => { hung.detached = true; } };
  const live = { send: async () => ({ data: Buffer.from('frame').toString('base64') }), detach: async () => {} };
  let opened = 0;
  const frames = [];
  const page = { isClosed: () => false };
  const cap = await startRasterCapture(page, {
    css: { width: 8, height: 8 },
    raster: { width: 8, height: 8 },
    shotTimeoutMs: 40,
    sleep: () => Promise.resolve(),
    openSession: async () => {
      opened += 1;
      return opened === 1 ? hung : live;
    },
    onFrame: (frame) => frames.push(frame.data),
  });
  const deadline = Date.now() + 1000;
  while (frames.length < 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  await cap.stop();
  assert.equal(hung.detached, true, 'the wedged session is abandoned');
  assert.ok(frames.length >= 1, 'frames resume from the next session');
  assert.ok(opened >= 2, 'a new session is opened after the wedge');
});

test('raster capture writes frames at the stage size while the page is driven', { timeout: 30000 }, async () => {
  const browser = await chromium.launch();
  try {
    const profile = captureProfile({ record: { viewport: { width: 390, height: 844 }, device: { preset: 'iphone-15' } } });
    const context = await browser.newContext(contextOptions(profile));
    const page = await context.newPage();
    await page.setContent('<button id=b style="margin:300px 100px">Tap</button><script>b.onclick=()=>b.textContent="ok"</script>');
    const sizes = [];
    const cap = await startRasterCapture(page, { css: profile, raster: { width: 440, height: 950 }, quality: 95, onFrame: (f) => sizes.push(jpegSize(f.data)) });
    await page.locator('#b').tap();
    await page.waitForTimeout(600);
    await cap.stop();
    assert.equal(await page.locator('#b').textContent(), 'ok', 'the page stays drivable while frames are grabbed');
    assert.ok(sizes.length >= 8, `${sizes.length} frames`);
    const last = sizes.at(-1);
    assert.equal(last.w, 440);
    assert.ok(Math.abs(last.h - 950) <= 2, `one scale for both axes; the recorder lands it on the even stage size (${last.h})`);
  } finally {
    await browser.close();
  }
});

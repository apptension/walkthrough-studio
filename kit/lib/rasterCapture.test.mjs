import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { contextOptions, captureProfile } from './capturePresets.mjs';
import { jpegSize, startRasterCapture } from './rasterCapture.mjs';

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

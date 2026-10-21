import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { installOverlayRetry, isPointerIntercept } from './overlayRetry.mjs';
import { usesStallRepair } from './selectorRetry.mjs';

test('a click blocked by #scriptDialog retries the same target once it is clear', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(`
    <button id="go">Continue</button>
    <dialog id="scriptDialog" open style="position:fixed;inset:0;width:100%;height:100%;margin:0">
      <p>Scenario</p>
    </dialog>
  `);
  installOverlayRetry(page);
  let clicks = 0;
  await page.exposeFunction('counted', () => {
    clicks += 1;
  });
  await page.locator('#go').evaluate((el) => el.addEventListener('click', () => window.counted()));
  await page.locator('#go').click({ timeout: 3000 });
  assert.equal(clicks, 1);
  assert.equal(await page.locator('#scriptDialog').evaluate((el) => el.open), false);
  await browser.close();
});

test('a failed overlay retry is a repair, not a bare exit', async () => {
  assert.equal(isPointerIntercept({ message: 'locator.click: <div> intercepts pointer events' }), true);
  assert.equal(usesStallRepair({ stall: null, overlay: true, selectorRetry: false }), true);
  assert.equal(usesStallRepair({ stall: null, overlay: false, selectorRetry: false }), false);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(`
    <button id="go">Continue</button>
    <div id="cover" style="position:fixed;inset:0;background:#000"></div>
  `);
  installOverlayRetry(page);
  await assert.rejects(page.locator('#go').click({ timeout: 2000 }), (err) => err.overlayRetry === true && /error\.png/.test(err.message));
  await browser.close();
});

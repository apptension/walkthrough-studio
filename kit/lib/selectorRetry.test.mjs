import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { chromium } from 'playwright';
import {
  installSelectorRetry,
  isSelectorTimeout,
  pickSelector,
  usesStallRepair,
} from './selectorRetry.mjs';

test('a stale placeholder picks a selector from the live DOM or the product map', () => {
  const fromDom = pickSelector({
    failed: { method: 'getByPlaceholder', text: 'Work email' },
    dom: [{ role: 'textbox', name: 'Email', id: 'email', nameAttr: 'email', placeholder: '' }],
    productMap: [],
  });
  assert.equal(fromDom.method, 'locator');
  assert.equal(fromDom.selector, '[name="email"]');
  assert.equal(fromDom.source, 'dom');

  const fromMap = pickSelector({
    failed: { method: 'getByPlaceholder', text: 'Work email' },
    dom: [],
    productMap: [{ name: 'Email', playwright: "page.getByRole('textbox', { name: /Email/i })" }],
  });
  assert.equal(fromMap.method, 'getByRole');
  assert.equal(fromMap.role, 'textbox');
  assert.equal(fromMap.name, 'Email');
  assert.equal(fromMap.source, 'map');
});

test('a stall that is not a selector miss still uses the repair path', () => {
  assert.equal(isSelectorTimeout({ name: 'TimeoutError', message: 'locator.click: Timeout 30000ms exceeded' }), true);
  assert.equal(isSelectorTimeout({ name: 'CaptureStallError', message: 'capture stalled' }), false);
  assert.equal(usesStallRepair({ stall: { kind: 'idle' }, selectorRetry: false }), true);
  assert.equal(usesStallRepair({ stall: null, selectorRetry: true }), false);
  assert.equal(usesStallRepair({ stall: null, selectorRetry: false }), false);
});

test('a test flow with a stale placeholder passes after the DOM retry', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(400);
  await page.setContent(`<label for="email">Email</label><input id="email" name="email" />`);
  installSelectorRetry(page, { productMap: [] });
  const started = Date.now();
  await page.getByPlaceholder('Work email').fill('a@b.co');
  assert.ok(Date.now() - started < 5000);
  assert.equal(await page.locator('[name="email"]').inputValue(), 'a@b.co');
  await browser.close();
});

test('a failed retry ends the take and names the screenshot', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(300);
  await page.setContent('<h1>Empty</h1>');
  installSelectorRetry(page, { productMap: [] });
  await assert.rejects(() => page.getByPlaceholder('Work email').click(), (err) => {
    assert.equal(err.selectorRetry, true);
    assert.match(err.message, /error\.png/);
    return true;
  });
  await browser.close();
});

after(() => {});

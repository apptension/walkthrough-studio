import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium } from 'playwright';
import { createFocus, stableSelectorFrom, stabilizeLocator } from './focus.mjs';
import { typeInto } from './form.mjs';

describe('stableSelectorFrom', () => {
  it('prefers name over id so placeholder-based locators can rebind after focus', () => {
    assert.equal(
      stableSelectorFrom({ tagName: 'TEXTAREA', name: 'description', id: 'x' }),
      'textarea[name="description"]'
    );
    assert.equal(stableSelectorFrom({ tagName: 'INPUT', name: '', id: 'email' }), 'input#email');
    assert.equal(stableSelectorFrom({ tagName: 'DIV' }), null);
  });

  it('escapes quotes in attribute values', () => {
    assert.equal(
      stableSelectorFrom({ tagName: 'INPUT', name: 'a"b', id: '' }),
      'input[name="a\\"b"]'
    );
  });
});

describe('placeholder clears on focus', () => {
  /** Reproduces the Apptension get-in-touch hang: click clears placeholder, then fill waits forever. */
  let browser;
  let page;

  before(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    page.setDefaultTimeout(8000);
  });

  after(async () => {
    await browser?.close();
  });

  async function mountClearingPlaceholder() {
    await page.setContent(`
      <label>Project
        <textarea name="description" placeholder="Tell us about your project..."></textarea>
      </label>
      <script>
        const ta = document.querySelector('textarea');
        ta.addEventListener('focus', () => { ta.placeholder = ''; });
      </script>
    `);
  }

  it('stabilizeLocator rebinds to name before focus clears the placeholder', async () => {
    await mountClearingPlaceholder();
    const loc = page.getByPlaceholder(/project/i);
    const stable = await stabilizeLocator(loc);
    await loc.click();
    assert.equal(await page.getByPlaceholder(/project/i).count(), 0);
    assert.equal(await stable.count(), 1);
    await stable.fill('ok');
    assert.equal(await page.locator('textarea[name="description"]').inputValue(), 'ok');
  });

  it('typeInto click+fill via getByPlaceholder finishes without hanging', async () => {
    await mountClearingPlaceholder();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const focus = createFocus({ brand: { colors: { gold: '#fc0' } }, wait, scroll: {} });
    const proto = Object.getPrototypeOf(page.locator('html'));
    focus.install(proto);

    const typed = 'Ship a multi-tenant SaaS MVP';
    const t0 = Date.now();
    assert.equal(await typeInto(page.getByPlaceholder(/project/i), typed), true);
    assert.ok(Date.now() - t0 < 3000, `typeInto took ${Date.now() - t0}ms`);
    assert.equal(await page.locator('textarea[name="description"]').inputValue(), typed);

    focus.uninstall();
  });

  it('patched fill alone rebinds when the locator still matches', async () => {
    await mountClearingPlaceholder();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const focus = createFocus({ brand: { colors: { gold: '#fc0' } }, wait, scroll: {} });
    const proto = Object.getPrototypeOf(page.locator('html'));
    focus.install(proto);

    const t0 = Date.now();
    await page.getByPlaceholder(/project/i).fill('direct fill');
    assert.ok(Date.now() - t0 < 3000);
    assert.equal(await page.locator('textarea[name="description"]').inputValue(), 'direct fill');

    focus.uninstall();
  });
});

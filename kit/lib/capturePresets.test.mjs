import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAPTURE_PRESETS, captureProfile, configPatch, contextOptions, suggestCaptures, validateCapture } from './capturePresets.mjs';

test('an existing project resolves to the desktop default it always had', () => {
  const p = captureProfile({ record: { viewport: { width: 1920, height: 1080 } } });
  assert.deepEqual([p.id, p.width, p.height, p.dpr, p.mobile, p.touch], ['desktop-fhd', 1920, 1080, 2, false, false]);
  assert.equal(captureProfile({ record: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 } }).dpr, 1, 'record.deviceScaleFactor still wins');
  assert.equal(captureProfile({}).id, 'desktop-fhd');
});

test('a phone preset carries mobile traits into the browser context', () => {
  const p = captureProfile({ record: { viewport: { width: 390, height: 844 }, device: { preset: 'iphone-15' } } });
  assert.equal(p.mobile, true);
  const o = contextOptions(p);
  assert.deepEqual(o.viewport, { width: 390, height: 844 });
  assert.equal(o.isMobile, true);
  assert.equal(o.hasTouch, true);
  assert.equal(o.deviceScaleFactor, 3);
  assert.match(o.userAgent, /iPhone/);
  assert.equal(contextOptions(captureProfile({})).userAgent, undefined, 'desktop keeps the stock UA');
  assert.equal(captureProfile({ record: { device: { preset: 'iphone-15' } } }).width, 390, 'a preset alone sets the size');
});

test('custom sizes are validated and round-trip through config', () => {
  assert.equal(validateCapture({ width: 1366, height: 768, dpr: 2 }), null);
  assert.match(validateCapture({ width: 200, height: 768 }), /between 320 and 3840/);
  assert.match(validateCapture({ width: 1367, height: 768 }), /even/);
  assert.match(validateCapture({ width: 1366, height: 768, dpr: 4 }), /density/);
  const patch = configPatch({ id: 'custom', width: 1366, height: 768, dpr: 2, mobile: false, touch: false, userAgent: null });
  assert.deepEqual(patch, { viewport: { width: 1366, height: 768 }, device: { preset: 'custom', dpr: 2 } });
  assert.equal(captureProfile({ record: patch }).width, 1366);
  assert.equal(captureProfile({ record: patch }).id, 'custom');
  assert.deepEqual(configPatch(captureProfile({})), { viewport: { width: 1920, height: 1080 } }, 'the default writes no device block');
  const phone = configPatch(captureProfile({ record: { device: { preset: 'iphone-15' } } }));
  assert.deepEqual(phone, { viewport: { width: 390, height: 844 }, device: { preset: 'iphone-15' } });
});

test('the suggestion fits the reviewer screen and the brief', () => {
  const screen = { width: 1728, height: 1117, availWidth: 1728, availHeight: 1079, dpr: 2 };
  const guided = suggestCaptures({ screen, mode: 'guided', brief: {} });
  assert.equal(guided[0].preset.id, 'laptop-1536', 'a guided tour on a 1728 px screen is shown at 100%');
  assert.match(guided[0].reason, /your 1728×1117 screen/);
  assert.ok(guided.some((s) => s.preset.id === 'screen'), '“Match my screen” is always offered');
  const agent = suggestCaptures({ screen, mode: 'agent', brief: {} });
  assert.equal(agent[0].preset.id, 'desktop-fhd', 'the bot alone is not limited by the screen');
  const phone = suggestCaptures({ screen, mode: 'agent', brief: { audience: 'field technicians on their phones', app: { notes: 'mobile web app' } } });
  assert.equal(phone[0].preset.group, 'phone');
  assert.match(phone[0].reason, /phone users/);
});

test('every preset is a valid capture', () => {
  for (const p of Object.values(CAPTURE_PRESETS)) assert.equal(validateCapture(p), null, p.id);
});

test('analysis contexts keep the device but cap the pixel density', async () => {
  const { analysisContextOptions, describeCapture, captureProfile } = await import('./capturePresets.mjs');
  const phone = { record: { viewport: { width: 390, height: 844 }, device: { preset: 'iphone-15' } } };
  const o = analysisContextOptions(phone);
  assert.deepEqual(o.viewport, { width: 390, height: 844 });
  assert.equal(o.isMobile, true);
  assert.equal(o.hasTouch, true);
  assert.equal(o.deviceScaleFactor, 2);
  assert.equal(analysisContextOptions(phone, { maxDpr: 1 }).deviceScaleFactor, 1);
  assert.match(describeCapture(captureProfile(phone)), /390×844 CSS px @3x, mobile, touch/);
});

test('a product named "… Mobile App" in the demo scenario does not make the suggestion a phone', async () => {
  const { suggestCaptures } = await import('./capturePresets.mjs');
  const rows = suggestCaptures({
    brief: { audience: 'resource managers at agencies', product: 'Teamdeck', story: { mustShow: ['Book Orion Mobile App — eight hours daily'] } },
  });
  assert.equal(rows[0].preset.group, 'desktop');
});

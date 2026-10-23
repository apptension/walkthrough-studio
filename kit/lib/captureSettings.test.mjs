import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCaptureSettings, captureSettings, parseScreen } from './captureSettings.mjs';
import { captureProfile } from './capturePresets.mjs';
import { outputFrame } from './format.mjs';

test('parseScreen reads the browser screen and falls back to null', () => {
  assert.deepEqual(parseScreen(new URLSearchParams('screen=1512x982&avail=1512x944&dpr=2')), {
    width: 1512,
    height: 982,
    availWidth: 1512,
    availHeight: 944,
    dpr: 2,
  });
  assert.equal(parseScreen(new URLSearchParams('screen=wide')), null);
  assert.equal(parseScreen(new URLSearchParams('')), null);
});

test('a preset choice writes viewport + device and keeps a density tip until a density is chosen', () => {
  const cfg = applyCaptureSettings({ record: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, startUrl: 'x' } }, { preset: 'iphone-15' });
  assert.deepEqual(cfg.record.viewport, { width: 390, height: 844 });
  assert.equal(cfg.record.device.preset, 'iphone-15');
  assert.equal(cfg.record.deviceScaleFactor, 1);
  assert.equal(captureProfile(cfg).dpr, 1);
  const chosen = applyCaptureSettings(cfg, { preset: 'iphone-15', dpr: 3 });
  assert.equal(chosen.record.deviceScaleFactor, undefined);
  assert.equal(captureProfile(chosen).dpr, 3);
  assert.equal(cfg.record.startUrl, 'x');
  const p = captureProfile(cfg);
  assert.equal(p.mobile, true);
  assert.equal(p.touch, true);
});

test('back to the default leaves no device block', () => {
  const cfg = applyCaptureSettings({ record: { device: { preset: 'iphone-15' } } }, { preset: 'desktop-fhd' });
  assert.deepEqual(cfg.record, { viewport: { width: 1920, height: 1080 } });
});

test('custom and screen sizes are validated', () => {
  const cfg = applyCaptureSettings({}, { preset: 'screen', width: 1512, height: 862, dpr: 2 });
  assert.equal(captureProfile(cfg).id, 'screen');
  assert.equal(captureProfile(cfg).width, 1512);
  const mob = applyCaptureSettings({}, { preset: 'custom', width: 360, height: 780, dpr: 3, mobile: true, touch: true });
  assert.equal(captureProfile(mob).mobile, true);
  assert.throws(() => applyCaptureSettings({}, { preset: 'custom', width: 1001, height: 700 }), /even/);
  assert.throws(() => applyCaptureSettings({}, { preset: 'custom', width: 100, height: 700 }), /between/);
  assert.throws(() => applyCaptureSettings({}, { preset: 'tv' }), /Unknown/);
});

test('video shape sets output.format; landscape is the default and leaves nothing behind', () => {
  const v = applyCaptureSettings({}, { output: 'portrait' });
  assert.equal(outputFrame(v).height, 1920);
  assert.equal(applyCaptureSettings(v, { output: 'landscape' }).output, undefined);
  assert.throws(() => applyCaptureSettings({}, { output: 'square' }), /Video shape/);
});

test('captureSettings ranks phones first for a phone brief and suggests a vertical video', () => {
  const video = { config: {}, brand: { direction: {} } };
  const s = captureSettings(video, { brief: { audience: 'field technicians on their phones' } });
  assert.equal(s.current.id, 'desktop-fhd');
  assert.equal(s.output.format, 'landscape');
  assert.equal(s.options[0].group, 'phone');
  assert.equal(s.suggested.output, 'portrait');
  assert.equal(s.space.takeMatches, true);
  assert.equal(s.outputs.length, 2);
});

test('captureSettings offers "My screen" from the reviewer screen at its density', () => {
  const screen = parseScreen(new URLSearchParams('screen=1512x982&avail=1512x944&dpr=2'));
  const s = captureSettings({ config: {}, brand: {} }, { screen, mode: 'guided' });
  const own = s.options.find((o) => o.id === 'screen');
  assert.ok(own);
  assert.equal(own.dpr, 2);
  assert.ok(own.width <= 1512 && own.height <= 944);
});

test('a vertical video suggests a phone', () => {
  const s = captureSettings({ config: { output: { format: 'portrait' } }, brand: {} }, {});
  assert.equal(s.options[0].group, 'phone');
  assert.match(s.options[0].reason, /vertical/);
});

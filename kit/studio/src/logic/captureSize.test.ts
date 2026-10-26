import assert from 'node:assert/strict';

import { test } from 'vitest';

import { customBody, guidedFitWarning, pickerOptions, screenQuery, shapeHint, sizeLine, stageBox, stageText, takeNote } from './captureSize';

const desktop = { id: 'desktop-fhd', label: 'Desktop · 1920×1080', group: 'desktop', width: 1920, height: 1080, dpr: 2, mobile: false, touch: false };
const phone = { id: 'iphone-15', label: 'iPhone · 390×844', group: 'phone', width: 390, height: 844, dpr: 3, mobile: true, touch: true };
const land = { format: 'landscape', width: 1920, height: 1080 };

test('screenQuery carries screen, available area and density', () => {
  const q = new URLSearchParams(screenQuery({ width: 1512, height: 982, availWidth: 1512, availHeight: 944 }, 2));
  assert.equal(q.get('screen'), '1512x982');
  assert.equal(q.get('avail'), '1512x944');
  assert.equal(q.get('dpr'), '2');
  assert.equal(screenQuery(null), '');
});

test('sizeLine names density and touch', () => {
  assert.equal(sizeLine(desktop), '1920×1080 · @2x');
  assert.equal(sizeLine(phone), '390×844 · @3x · touch');
});

test('pickerOptions marks the current and suggested choices and groups desktop → phone', () => {
  const rows = pickerOptions({ current: phone, suggested: { id: 'desktop-fhd' }, options: [phone, desktop] });
  assert.deepEqual(rows.map((r) => r.id), ['desktop-fhd', 'iphone-15']);
  assert.equal(rows[0]!.suggested, true);
  assert.equal(rows[1]!.selected, true);
  assert.equal(rows[1]!.title, 'iPhone');
  const lowDpr = pickerOptions({ current: { ...desktop, dpr: 1 }, options: [desktop] });
  assert.equal(lowDpr[0]!.line, '1920×1080 · @1x');
});

test('a custom size not in the list still shows as selected', () => {
  const custom = { id: 'custom', label: 'Custom · 1000×700', width: 1000, height: 700, dpr: 2 };
  const rows = pickerOptions({ current: custom, options: [desktop] });
  assert.equal(rows.find((r) => r.selected)!.title, 'Custom');
});

test('stage copy and box follow the planned stage', () => {
  const fill = { output: land, capture: desktop, plannedStage: { mode: 'fill', x: 0, y: 0, w: 1920, h: 1080, radius: 0 } };
  assert.match(stageText(fill), /edge to edge/);
  const dev = { output: land, capture: phone, plannedStage: { mode: 'device', x: 760, y: 64, w: 400, h: 950, radius: 44 } };
  assert.match(stageText(dev), /as a phone/);
  const box = stageBox(dev)!;
  assert.equal(box.aspect, '1920 / 1080');
  assert.equal(box.left, '39.6%');
  assert.equal(box.mode, 'device');
});

test('takeNote asks for a sharper take when a shape change upscales it', () => {
  assert.match(takeNote({ takeMatches: true, upscale: 1.77, take: { width: 390, height: 844 } }), /177% — re-record for full sharpness/);
  assert.equal(takeNote({ takeMatches: true, upscale: 1, take: { width: 390, height: 844 } }), '');
});

test('takeNote warns only when the take differs', () => {
  assert.equal(takeNote({ takeMatches: true, take: { width: 1920, height: 1080 } }), '');
  assert.equal(takeNote({ takeMatches: false, take: null }), '');
  assert.match(takeNote({ takeMatches: false, take: { width: 1920, height: 1080 }, capture: phone }), /recorded at 1920×1080.*390×844 \(mobile\)/);
});

test('shapeHint suggests vertical for tall recordings and back for wide ones', () => {
  assert.equal(shapeHint({ current: phone, output: land })!.output, 'portrait');
  assert.equal(shapeHint({ current: desktop, output: { format: 'portrait' } })!.output, 'landscape');
  assert.equal(shapeHint({ current: desktop, output: land }), null);
});

test('guidedFitWarning is null when the screen is unknown or the size already fits', () => {
  assert.equal(guidedFitWarning({ guidedFit: null, current: desktop, options: [desktop] }), null);
  assert.equal(guidedFitWarning({ guidedFit: { scale: 1, fits: true }, current: desktop, options: [desktop] }), null);
});

test('guidedFitWarning suggests up to 3 fitting sizes, smallest first, and excludes the current one', () => {
  const laptop = { ...phone, id: 'laptop-13', label: 'Laptop · 1366×768', group: 'laptop', width: 1366, height: 768, fits: true };
  const tablet = { id: 'ipad', label: 'iPad · 834×1194', group: 'tablet', width: 834, height: 1194, dpr: 2, fits: true };
  const tooBig = { ...desktop, id: 'desktop-4k', width: 3840, height: 2160, fits: false };
  const settings = {
    guidedFit: { scale: 0.72, fits: false },
    current: { ...desktop, fits: false },
    options: [tooBig, laptop, { ...phone, fits: true }, tablet, { ...desktop, fits: false }],
  };
  const warn = guidedFitWarning(settings)!;
  assert.equal(warn.scale, 0.72);
  assert.deepEqual(warn.current, settings.current);
  // smallest-area-first, the too-big and non-fitting duplicate-of-current options excluded
  assert.deepEqual(warn.suggestions.map((o) => o.id), ['iphone-15', 'ipad', 'laptop-13']);
});

test('guidedFitWarning never suggests the exact current size even if it happens to be marked fit', () => {
  const settings = {
    guidedFit: { scale: 0.9, fits: false },
    current: desktop,
    options: [{ ...desktop, fits: true }, { ...phone, fits: true }],
  };
  const warn = guidedFitWarning(settings)!;
  assert.deepEqual(warn.suggestions.map((o) => o.id), ['iphone-15']);
});

test('customBody validates like the server', () => {
  assert.deepEqual(customBody({ width: '1440', height: '900', dpr: '2' }).body, { preset: 'custom', width: 1440, height: 900, dpr: 2, mobile: false, touch: false });
  assert.match(customBody({ width: 1441, height: 900 }).error!, /even/);
  assert.match(customBody({ width: 100, height: 900 }).error!, /between/);
});

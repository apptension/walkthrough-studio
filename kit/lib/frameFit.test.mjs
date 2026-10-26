import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameFitRuntimeSource, planFrameFit, safeInsets } from './frameFit.mjs';

const LAND = { w: 1920, h: 1080 };
const PORT = { w: 1080, h: 1920 };

test('safeInsets: vertical masters keep more room top and bottom', () => {
  assert.deepEqual(safeInsets(1920, 1080), { x: 72, y: 60 });
  assert.ok(safeInsets(1080, 1920).y > safeInsets(1920, 1080).y);
});

test('planFrameFit: a centred, under-filled composition grows without moving', () => {
  const plan = planFrameFit({ content: { l: 560, r: 1360, t: 340, b: 740 }, frame: LAND });
  assert.equal(plan.s, 1.16);
  assert.equal(plan.dx, 0);
  assert.equal(plan.dy, 0);
});

test('planFrameFit: growth stops where the nearest edge meets the safe area', () => {
  const plan = planFrameFit({ content: { l: 100, r: 1500, t: 400, b: 700 }, frame: LAND });
  assert.equal(plan.s, 1.032);
  assert.equal(plan.dx, 0);
});

test('planFrameFit: oversized content shrinks into the safe area and recentres', () => {
  const plan = planFrameFit({ content: { l: -40, r: 1960, t: 200, b: 900 }, frame: LAND });
  assert.ok(plan.s < 1);
  const at = (v, o) => o + plan.s * (v - o);
  assert.ok(at(-40, 960) + plan.dx >= 72 - 0.5);
  assert.ok(at(1960, 960) + plan.dx <= 1920 - 72 + 0.5);
});

test('planFrameFit: content that fits but sits off-frame is nudged back in', () => {
  const plan = planFrameFit({ content: { l: 200, r: 900, t: 30, b: 1500 }, frame: PORT, mode: 'shrink' });
  assert.equal(plan.s, 1);
  assert.ok(plan.dy > 0);
});

test('planFrameFit: none mode and empty boxes leave the plate alone', () => {
  assert.deepEqual(planFrameFit({ content: { l: 0, r: 4000, t: 0, b: 2000 }, frame: LAND, mode: 'none' }), { s: 1, dx: 0, dy: 0 });
  assert.deepEqual(planFrameFit({ content: null, frame: LAND }), { s: 1, dx: 0, dy: 0 });
});

test('planFrameFit: shrink mode never grows', () => {
  const plan = planFrameFit({ content: { l: 760, r: 1160, t: 440, b: 640 }, frame: LAND, mode: 'shrink' });
  assert.equal(plan.s, 1);
});

test('frameFitRuntimeSource: compiles and registers window.__fitFrame', () => {
  const src = frameFitRuntimeSource();
  const win = {};
  new Function('window', 'document', 'getComputedStyle', src)(win, {}, () => ({}));
  assert.equal(typeof win.__fitFrame, 'function');
});

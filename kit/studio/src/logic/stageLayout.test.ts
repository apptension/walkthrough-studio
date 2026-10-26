import assert from 'node:assert/strict';

import { test } from 'vitest';

import { cardOnStage, stageLayout } from './stageLayout';

const landscape = { width: 1920, height: 1080 };
const portrait = { width: 1080, height: 1920 };

test('no space known leaves the stage unframed', () => {
  assert.equal(stageLayout(null), null);
  assert.equal(stageLayout({ output: landscape }), null);
});

test('a fill stage covers the whole output frame', () => {
  const l = stageLayout({ output: landscape, stage: { mode: 'fill', x: 0, y: 0, w: 1920, h: 1080, radius: 0 } });
  assert.ok(l);
  assert.equal(l.aspect, 1920 / 1080);
  assert.equal(l.placed, false);
  assert.deepEqual(l.viewport, { left: '0%', top: '0%', width: '100%', height: '100%', rx: '0%', ry: '0%' });
  assert.equal(l.cardsOnStage, true);
});

test('an inset window of the same shape carries the cards on the take', () => {
  const l = stageLayout({ output: landscape, stage: { mode: 'inset', x: 96, y: 50, w: 1728, h: 972, radius: 24 } });
  assert.ok(l);
  assert.equal(l.placed, true);
  assert.equal(l.viewport.left, '5%');
  assert.equal(l.viewport.width, '90%');
  assert.equal(l.cardsOnStage, true);
});

test('a phone take in a vertical video keeps cards over the whole output', () => {
  // stageFor(390×844 mobile, 1080×1920): device box, centred.
  const l = stageLayout({ output: portrait, stage: { mode: 'device', x: 98, y: 116, w: 884, h: 1688, radius: 97 } });
  assert.ok(l);
  assert.equal(l.aspect, 1080 / 1920);
  assert.equal(l.placed, true);
  assert.equal(l.cardsOnStage, false);
  assert.equal(l.viewport.top, `${(116 / 1920) * 100}%`);
  assert.equal(l.viewport.rx, `${(97 / 884) * 100}%`);
});

test('a card on an inset stage shrinks into the window, measured from the frame centre', () => {
  const stage = { mode: 'inset', x: 96, y: 50, w: 1728, h: 972, radius: 24 };
  const fit = cardOnStage(landscape, stage, 0.5);
  assert.equal(fit.scale, 0.5 * 0.9);
  // Window centre (960, 536) vs frame centre (960, 540), at 0.5 preview scale.
  assert.equal(fit.dx, 0);
  assert.equal(fit.dy, -2);
  assert.equal(Math.round(fit.radius * 100) / 100, Math.round((24 / 0.9) * 100) / 100);
});

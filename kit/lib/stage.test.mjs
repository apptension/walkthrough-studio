import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DELIVERY, outputFrame } from './format.mjs';
import { reelSpace, stageFor, toReel } from './stage.mjs';

const OUT = { width: 1920, height: 1080 };
const TALL = { width: 1080, height: 1920 };
const cap = (width, height, mobile = false) => ({ width, height, dpr: 2, mobile, touch: mobile });

test('the output frame is landscape 1080p unless the video asks for vertical', () => {
  assert.deepEqual(outputFrame({}), DELIVERY);
  assert.deepEqual(outputFrame({ output: { format: 'portrait' } }), { format: 'portrait', width: 1080, height: 1920, label: '1080×1920 vertical' });
  assert.equal(outputFrame({ output: { format: 'nonsense' } }).format, 'landscape');
});

test('a 16:9 capture fills the frame at any size — the reel is written at 1920×1080', () => {
  assert.deepEqual(stageFor(cap(1920, 1080), OUT), { mode: 'fill', x: 0, y: 0, w: 1920, h: 1080, radius: 0 });
  assert.deepEqual(stageFor(cap(1440, 810), OUT), { mode: 'fill', x: 0, y: 0, w: 1920, h: 1080, radius: 0 });
  const inset = stageFor(cap(1920, 1080), OUT, { frame: 'inset', padding: 'balanced', corners: 'soft' });
  assert.equal(inset.mode, 'inset');
  assert.ok(inset.w < 1920 && inset.x > 0);
});

test('other desktop aspects sit centred, a phone stands as a device', () => {
  const laptop = stageFor(cap(1440, 900), OUT);
  assert.equal(laptop.mode, 'inset');
  assert.deepEqual([laptop.w, laptop.h, laptop.x], [1590, 994, 164]);
  const phone = stageFor(cap(390, 844, true), OUT);
  assert.equal(phone.mode, 'device');
  assert.deepEqual([phone.w, phone.h, phone.x, phone.y], [440, 950, 740, 64]);
  assert.ok(phone.radius > 40);
});

test('in a vertical master a phone nearly fills the frame and a desktop sits on top', () => {
  const phone = stageFor(cap(390, 844, true), TALL);
  assert.equal(phone.mode, 'device');
  assert.deepEqual([phone.w, phone.h], [780, 1690]);
  const desk = stageFor(cap(1920, 1080), TALL);
  assert.equal(desk.mode, 'inset');
  assert.equal(desk.w, 994);
  assert.ok(desk.y > 0 && desk.y + desk.h < 1920);
});

test('reel space maps capture CSS px to reel px', () => {
  const s = reelSpace({ capture: { viewport: { width: 1440, height: 810 }, raster: { width: 1920, height: 1080 } } }, {});
  assert.deepEqual(s, { cssW: 1440, cssH: 810, reelW: 1920, reelH: 1080, k: 1920 / 1440 });
  assert.equal(reelSpace({}, { record: { viewport: { width: 1920, height: 1080 } } }).k, 1, 'old takes: reel = CSS');
  assert.equal(reelSpace(null, {}).cssW, 1920, 'no config: the default capture');
  const [m] = toReel([{ t: 1, x: 100, y: 50, rect: { x: 10, y: 20, w: 30, h: 40 } }], 2);
  assert.deepEqual(m, { t: 1, x: 200, y: 100, rect: { x: 20, y: 40, w: 60, h: 80 } });
  const same = [{ x: 1 }];
  assert.equal(toReel(same, 1), same);
});

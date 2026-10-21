import test from 'node:test';
import assert from 'node:assert/strict';
import { lensGeometry, lensGraph, loupeOrigin } from './lens.mjs';

const frame = { width: 1920, height: 1080 };
const centreInCrop = (geo) => [Number(geo.cropX) + geo.cropW / 2 - geo.pad, Number(geo.cropY) + geo.cropW / 2 - geo.pad];

test('lens keeps a target at the top edge centred instead of pinning the crop to the border', () => {
  const geo = lensGeometry({ t: 1, dur: 2, rect: { x: 900, y: 0, w: 120, h: 24 } }, frame);
  assert.deepEqual(centreInCrop(geo), [960, 12]);
});

test('lens keeps targets in every corner centred', () => {
  for (const rect of [
    { x: 0, y: 0, w: 40, h: 40 },
    { x: 1880, y: 1040, w: 40, h: 40 },
    { x: 1880, y: 0, w: 40, h: 40 },
    { x: 0, y: 1040, w: 40, h: 40 },
  ]) {
    const geo = lensGeometry({ t: 0, dur: 2, rect }, frame);
    const [x, y] = centreInCrop(geo);
    assert.ok(Math.abs(x - (rect.x + 20)) <= 1 && Math.abs(y - (rect.y + 20)) <= 1, JSON.stringify(rect));
  }
});

test('lens graph pads and smears the source before cropping', () => {
  const mark = { t: 1, dur: 2, rect: { x: 0, y: 0, w: 40, h: 40 } };
  const geo = lensGeometry(mark, frame);
  const graph = lensGraph(1, 0, mark, geo);
  assert.match(graph, new RegExp(`pad=w=iw\\+${2 * geo.pad}:h=ih\\+${2 * geo.pad}:x=${geo.pad}:y=${geo.pad}`));
  assert.match(graph, /fillborders=.*mode=smear,crop=/);
});

test('loupe stays centred on the target even when that puts the circle off-screen', () => {
  for (const rect of [
    { x: 0, y: 0, w: 40, h: 40 },
    { x: 1880, y: 0, w: 40, h: 40 },
    { x: 0, y: 1040, w: 40, h: 40 },
    { x: 1880, y: 1040, w: 40, h: 40 },
    { x: 900, y: 0, w: 120, h: 24 },
  ]) {
    const geo = lensGeometry({ t: 0, dur: 2, rect }, frame);
    const ox = Number(geo.ox);
    const oy = Number(geo.oy);
    const tx = rect.x + rect.w / 2;
    const ty = rect.y + rect.h / 2;
    assert.equal(ox + geo.S / 2, Math.round(tx), `cx ${JSON.stringify(rect)}`);
    assert.equal(oy + geo.S / 2, Math.round(ty), `cy ${JSON.stringify(rect)}`);
    // Corner targets must be allowed to hang off the frame (no inward pin).
    if (tx < geo.S / 2) assert.ok(ox < 0, `left overhang ${JSON.stringify(rect)}`);
    if (ty < geo.S / 2) assert.ok(oy < 0, `top overhang ${JSON.stringify(rect)}`);
    if (tx > frame.width - geo.S / 2) assert.ok(ox + geo.S > frame.width, `right overhang ${JSON.stringify(rect)}`);
    if (ty > frame.height - geo.S / 2) assert.ok(oy + geo.S > frame.height, `bottom overhang ${JSON.stringify(rect)}`);
  }
});

test('loupeOrigin centres on the target without clamping into the frame', () => {
  const { ox, oy } = loupeOrigin(20, 20, 372, 1920, 1080);
  assert.deepEqual({ ox, oy }, { ox: 20 - 186, oy: 20 - 186 });
  const right = loupeOrigin(1900, 1060, 372, 1920, 1080);
  assert.equal(right.ox, 1900 - 186);
  assert.equal(right.oy, 1060 - 186);
});

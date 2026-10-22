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
    { x: 901, y: 3, w: 121, h: 24 },
  ]) {
    const geo = lensGeometry({ t: 0, dur: 2, rect }, frame);
    const ox = Number(geo.ox);
    const oy = Number(geo.oy);
    const tx = rect.x + rect.w / 2;
    const ty = rect.y + rect.h / 2;
    // The overlay lands on even pixels (yuv420); the glass centre inside the canvas makes up the rest exactly.
    assert.equal(Math.abs(ox % 2), 0, `even ox ${JSON.stringify(rect)}`);
    assert.ok(Math.abs(ox + geo.S / 2 - tx) < 2, `cx ${JSON.stringify(rect)}`);
    assert.ok(Math.abs(oy + geo.S / 2 - ty) < 2, `cy ${JSON.stringify(rect)}`);
    assert.ok(Math.abs(ox + geo.cxs - geo.over - tx) < 1e-3, `sub-pixel cx ${JSON.stringify(rect)}`);
    assert.ok(Math.abs(oy + geo.cys - geo.over - ty) < 1e-3, `sub-pixel cy ${JSON.stringify(rect)}`);
    // Corner targets must be allowed to hang off the frame (no inward pin).
    if (tx < geo.S / 2) assert.ok(ox < 0, `left overhang ${JSON.stringify(rect)}`);
    if (ty < geo.S / 2) assert.ok(oy < 0, `top overhang ${JSON.stringify(rect)}`);
    if (tx > frame.width - geo.S / 2) assert.ok(ox + geo.S > frame.width, `right overhang ${JSON.stringify(rect)}`);
    if (ty > frame.height - geo.S / 2) assert.ok(oy + geo.S > frame.height, `bottom overhang ${JSON.stringify(rect)}`);
  }
});

test('a pointer-follow lens travels on a minimum-jerk path with sub-pixel compensation', () => {
  const mark = {
    t: 4,
    dur: 3,
    rect: { x: 100, y: 100, w: 60, h: 20 },
    path: [
      { at: 0, rect: { x: 100, y: 100, w: 60, h: 20 } },
      { at: 1, rect: { x: 100, y: 100, w: 60, h: 20 } },
      { at: 1.5, rect: { x: 700, y: 400, w: 60, h: 20 } },
    ],
  };
  const geo = lensGeometry(mark, frame);
  assert.equal(geo.moving, true);
  // Overlay (live clock, offset by the mark) lands on even pixels; crop takes whole pixels.
  assert.match(geo.ox, /^2\*floor\(\(if\(lt\(t,5\.000\)/);
  assert.match(geo.cropX, /^round\(if\(lt\(t,1\.000\)/);
  // The travel segment is the min-jerk polynomial, not a straight lerp.
  assert.match(geo.cropX, /ld\(2\)\*ld\(2\)\*ld\(2\)\*\(ld\(2\)\*\(ld\(2\)\*6-15\)\+10\)/);
  // The glass centre and the sample origin fold the rounding remainder back in (lens clock, T).
  assert.match(geo.cxs, /-2\*floor\(/);
  assert.match(geo.axs, /-round\(/);
  assert.ok(geo.cxs.includes('T') && !geo.cxs.includes('(t-'), 'canvas-side expressions run on the lens clock');
  const graph = lensGraph(2, 1, mark, geo, '#F6AA1E', { in: 0.55, out: 0.42, curve: 'glide' });
  assert.match(graph, /format=rgba,pad=/, 'crop runs on rgba so it can land on any whole pixel');
  assert.match(graph, new RegExp(`scale=${geo.W}:${geo.W}:flags=lanczos,geq=`));
  assert.match(graph, new RegExp(`crop=${geo.S}:${geo.S}:${geo.over}:${geo.over},`), 'the working canvas is cropped back to the loupe');
  assert.match(graph, /setpts=PTS\+4\.000\/TB\[lens1\]/);
});

test('the glass needs a working canvas wider than the loupe and keeps the nominal zoom for Studio sizing', () => {
  const geo = lensGeometry({ t: 0, dur: 2, rect: { x: 500, y: 500, w: 80, h: 30 }, zoom: 1.8 }, frame);
  assert.equal(geo.zoom, 1.8);
  assert.ok(Math.abs(geo.zoomExact - 1.8) < 0.02);
  assert.ok(geo.W > geo.S && geo.W % 2 === 0 && geo.over * 2 + geo.S === geo.W);
  assert.ok(geo.W / 2 >= (geo.diameter / 2) * 1.6, 'room for the bevel to sample past the rim');
});

test('entrance curve and timing come from the camera direction', () => {
  const mark = { t: 1, dur: 2, rect: { x: 300, y: 300, w: 40, h: 40 } };
  const geo = lensGeometry(mark, frame);
  const glide = lensGraph(1, 0, mark, geo, '#F6AA1E', { in: 0.55, out: 0.42, curve: 'glide' });
  const cinematic = lensGraph(1, 0, mark, geo, '#F6AA1E', { in: 0.715, out: 0.546, curve: 'cinematic' });
  assert.match(glide, /st\(3,\(1-pow\(1-clip\(\(T-0\.000\)\/0\.550,0,1\),4\)\)\)/);
  assert.match(cinematic, /st\(3,if\(lt\(clip\(\(T-0\.000\)\/0\.715,0,1\),0\.5\)/);
  assert.match(glide, /exp\(-\(pow\(/, 'specular highlight');
  assert.match(glide, /ld\(6\)\+\(X-ld\(3\)\)\*ld\(9\)\*\(1\+0\.012\*ld\(8\)\*ld\(8\)\)/, 'red samples further out (aberration)');
  assert.match(glide, /b=.*\*\(1-0\.012\*ld\(8\)\*ld\(8\)\)/, 'blue samples further in');
});

test('loupeOrigin centres on the target without clamping into the frame', () => {
  const { ox, oy } = loupeOrigin(20, 20, 372, 1920, 1080);
  assert.deepEqual({ ox, oy }, { ox: 20 - 186, oy: 20 - 186 });
  const right = loupeOrigin(1900, 1060, 372, 1920, 1080);
  assert.equal(right.ox, 1900 - 186);
  assert.equal(right.oy, 1060 - 186);
});

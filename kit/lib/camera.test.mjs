import assert from 'node:assert/strict';
import { test } from 'node:test';
import { insetGeometry, planZooms, zoomFilter, zoomTiming } from './camera.mjs';
import { glidePath, keyLabel } from './cursor.mjs';
import { CURVE_IDS, curveOf } from './shared/easing.js';
import { patchDirection, resolveDirection } from './direction.mjs';
import { assertX264Args } from './encode.mjs';
import { socialGeometry, teaserWindow, variantArgs } from './exports.mjs';

const size = { width: 1920, height: 1080 };
const click = (t, x = 960, y = 540) => ({ kind: 'click', t, x, y });

test('auto zoom stays off by default and with no pointer marks', () => {
  assert.deepEqual(planZooms([click(4)], size).shots, []);
  assert.deepEqual(planZooms([], { ...size, level: 'bold' }).shots, []);
  assert.equal(zoomFilter([], size), null);
});

test('clicks close together share one shot that pans between them', () => {
  const { shots } = planZooms([click(4, 300, 200), click(5.5, 1500, 900), click(12)], { ...size, level: 'subtle', duration: 30 });
  assert.equal(shots.length, 2);
  assert.equal(shots[0].points.length, 2);
  assert.equal(shots[0].zoom, 1.3);
  const halfW = 1920 / (2 * 1.3);
  assert.ok(shots[0].points[0].cx >= Math.round(halfW), 'center is clamped so the crop stays inside the frame');
  const vf = zoomFilter(shots, size);
  assert.match(vf, /^scale=.*eval=frame.*,crop=1920:1080:.*exact=1,setsar=1$/);
  assert.match(vf, /out_color_matrix=bt709/);
});

test('camera curve and move length shape the push-in expression and the Studio timing', () => {
  const glide = zoomTiming({ curve: 'glide', motion: 'natural' });
  assert.deepEqual(glide, { in: 0.9, out: 1.05, pan: 0.7, curve: 'glide', motion: 'natural' });
  const slow = zoomTiming({ curve: 'cinematic', motion: 'unhurried' });
  assert.ok(slow.in > glide.in && slow.pan > glide.pan);
  assert.deepEqual(zoomTiming({ curve: 'nope', motion: 'nope' }), glide, 'unknown ids fall back to the defaults');
  const { shots } = planZooms([click(4, 300, 200)], { ...size, level: 'bold', duration: 30 });
  const g = zoomFilter(shots, { ...size, timing: glide });
  const c = zoomFilter(shots, { ...size, timing: zoomTiming({ curve: 'cinematic' }) });
  const s = zoomFilter(shots, { ...size, timing: zoomTiming({ curve: 'snappy' }) });
  assert.match(g, /\(1-pow\(1-clip\(\(t-[\d.]+\)\/0\.900,0,1\),4\)\)/);
  assert.match(c, /if\(lt\(clip\(\(t-[\d.]+\)\/0\.900,0,1\),0\.5\),4\*/);
  assert.match(s, /pow\(2,-10\*clip/);
  // Every curve starts at rest and ends fully in.
  for (const id of CURVE_IDS) {
    const fn = curveOf(id).fn;
    assert.ok(Math.abs(fn(0)) < 1e-9 && Math.abs(fn(1) - 1) < 1e-9, id);
    assert.ok(fn(0.25) < fn(0.5) && fn(0.5) < fn(0.75), `${id} rises monotonically`);
  }
  // A longer move length pushes the shot's start earlier so the attack still lands on the click.
  const quick = planZooms([click(6, 300, 200)], { ...size, level: 'bold', duration: 30, timing: zoomTiming({ motion: 'swift' }) });
  const long = planZooms([click(6, 300, 200)], { ...size, level: 'bold', duration: 30, timing: zoomTiming({ motion: 'unhurried' }) });
  assert.ok(long.shots[0].start < quick.shots[0].start);
});

test('chapter cards and captions keep the frame whole', () => {
  const timeline = [{ kind: 'chapter', t: 3.5, dur: 2.8 }, click(4), click(18), { kind: 'caption', t: 21.4, dur: 2.4 }];
  const { shots, skipped } = planZooms(timeline, { ...size, level: 'bold', duration: 40 });
  assert.equal(skipped, 1);
  assert.equal(shots.length, 1);
  assert.ok(shots[0].end <= 21.1, 'the shot eases out before the caption window');
});

test('manual zoom works with auto zoom off and blocks nearby click zooms', () => {
  const timeline = [
    { kind: 'zoom', t: 5, dur: 3, rect: { x: 1200, y: 300, w: 200, h: 100 }, level: 'bold' },
    click(6, 1300, 350),
    click(14, 400, 700),
  ];
  const off = planZooms(timeline, { ...size, level: 'off', duration: 20 });
  assert.equal(off.shots.length, 1);
  assert.equal(off.manual, 1);
  assert.equal(off.shots[0].source, 'manual');
  assert.equal(off.shots[0].zoom, 1.65);
  const on = planZooms(timeline, { ...size, level: 'subtle', duration: 20 });
  assert.equal(on.manual, 1);
  assert.equal(on.shots.filter((shot) => shot.source === 'auto').length, 1);
  assert.equal(on.skipped, 1);
});

test('inset and social windows are even and centered', () => {
  const geo = insetGeometry(size);
  assert.equal(geo.w % 2, 0);
  assert.ok(Math.abs(geo.x * 2 + geo.w - 1920) <= 2);
  const social = socialGeometry({ width: 1080, height: 1920 });
  assert.equal(social.w, 1000);
  assert.equal(social.y % 2, 0);
  assert.ok(Math.abs(social.y * 2 + social.h - 1920) <= 2);
  const roomy = insetGeometry({ ...size, padding: 'roomy', corners: 'round' });
  assert.ok(roomy.w < geo.w);
  assert.equal(roomy.radius, 42);
});

test('keystroke labels and glide timing', () => {
  assert.deepEqual(keyLabel('Meta+K'), ['⌘', 'K']);
  assert.deepEqual(keyLabel('Control+Shift+KeyP'), ['Ctrl', '⇧', 'P']);
  assert.equal(keyLabel('a'), null, 'plain typing is not a shortcut');
  const short = glidePath({ x: 0, y: 0 }, { x: 40, y: 0 });
  const long = glidePath({ x: 0, y: 0 }, { x: 1800, y: 1000 });
  assert.ok(short.duration >= 260 && long.duration <= 760 && long.duration > short.duration);
  const end = long.points.at(-1);
  assert.deepEqual([Math.round(end.x), Math.round(end.y)], [1800, 1000]);
  assert.equal(glidePath({ x: 5, y: 5 }, { x: 6, y: 5 }).points.length, 0);
  // Minimum-jerk: the route starts at the seat, leaves softly and arrives softly (small end steps).
  assert.deepEqual([long.points[0].x, long.points[0].y, long.points[0].at], [0, 0, 0]);
  const step = (i) => Math.hypot(long.points[i].x - long.points[i - 1].x, long.points[i].y - long.points[i - 1].y);
  const mid = Math.floor(long.points.length / 2);
  assert.ok(step(1) < step(mid) / 6 && step(long.points.length - 1) < step(mid) / 6, 'bell-shaped velocity');
});

test('direction accepts a motion curve and move length and look presets carry them', () => {
  const next = patchDirection({}, { camera: { curve: 'cinematic', motion: 'unhurried' } });
  assert.deepEqual(next.camera, { curve: 'cinematic', motion: 'unhurried' });
  assert.throws(() => patchDirection({}, { camera: { curve: 'bouncy' } }), /Unknown camera.curve/);
  const resolved = resolveDirection({ direction: {} }, {});
  assert.deepEqual([resolved.camera.curve, resolved.camera.motion], ['glide', 'natural']);
  assert.deepEqual([patchDirection({}, { look: 'social' }).camera.curve, patchDirection({}, { look: 'cinematic' }).camera.motion], ['snappy', 'unhurried']);
});

test('direction patches validate camera, cursor and keys and drop approval', () => {
  const next = patchDirection({ approvedAt: 'x' }, { camera: { zoom: 'bold', frame: 'inset' }, cursor: { style: 'dot', glide: false }, keys: true });
  assert.equal(next.approvedAt, undefined);
  assert.deepEqual(next.camera, { zoom: 'bold', frame: 'inset' });
  assert.equal(next.cursor.glide, false);
  assert.throws(() => patchDirection({}, { camera: { zoom: 'huge' } }), /Unknown camera.zoom/);
  assert.throws(() => patchDirection({}, { cursor: { glide: 'yes' } }), /glide/);
  const resolved = resolveDirection({ direction: next }, {});
  assert.equal(resolved.camera.background, 'brand');
  assert.equal(resolved.keys, true);
  const legacy = resolveDirection({}, {});
  assert.deepEqual([legacy.camera.zoom, legacy.camera.frame, legacy.cursor.style, legacy.keys], ['off', 'full', 'classic', false]);
});

test('look presets apply one coherent video-local direction and can be customized', () => {
  const social = patchDirection({}, { look: 'social' });
  assert.equal(social.camera.background, 'accent');
  assert.equal(social.camera.padding, 'balanced');
  assert.equal(social.cursor.loop, true);
  assert.equal(social.keys, true);
  const custom = patchDirection(social, { camera: { shadow: 'off' }, cursor: { hideIdle: false } });
  assert.equal(custom.look, undefined);
  assert.equal(custom.camera.shadow, 'off');
  assert.equal(custom.cursor.hideIdle, false);
  assert.throws(() => patchDirection({}, { look: 'neon' }), /Unknown look preset/);
});

test('format exports hold the variant quality floor and copy the audio', () => {
  const { args } = variantArgs({ slug: 'demo', out: '/tmp/wt-demo' }, 'lite', '/tmp/wt-demo/demo.mp4');
  assert.doesNotThrow(() => assertX264Args('variant', args));
  assert.deepEqual(args.slice(args.indexOf('-c:a'), args.indexOf('-c:a') + 2), ['-c:a', 'copy']);
  const teaser = teaserWindow({ chapters: [{ start: 0, title: 'Intro' }, { start: 6, title: 'Schedule' }] }, 60);
  assert.equal(teaser.start, 6.8);
  assert.equal(teaser.dur, 10);
});

test('exports follow the master shape: a vertical master scales to 9:16 and sits as a window on 1:1', async () => {
  const { variantPlan } = await import('./exports.mjs');
  const tall = { width: 1080, height: 1920 };
  assert.deepEqual(variantPlan('vertical', tall), { kind: 'scale', width: 1080, height: 1920 });
  assert.deepEqual(variantPlan('lite', tall), { kind: 'scale', width: 720, height: 1280 });
  assert.equal(variantPlan('gif', tall).height, 960);
  assert.equal(variantPlan('square', tall).kind, 'social');
  const onSquare = socialGeometry({ width: 1080, height: 1080 }, tall);
  assert.ok(onSquare.h > onSquare.w);
  assert.ok(onSquare.h <= 1000);
  const wide = { width: 1920, height: 1080 };
  assert.equal(variantPlan('vertical', wide).kind, 'social');
  assert.deepEqual(variantPlan('lite', wide), { kind: 'scale', width: 1280, height: 720 });
  const { args } = variantArgs({ slug: 'demo', out: '/tmp/wt-demo', config: { output: { format: 'portrait' } } }, 'vertical', '/tmp/wt-demo/none.mp4');
  assert.ok(args.join(' ').includes('scale=1080:1920'));
});

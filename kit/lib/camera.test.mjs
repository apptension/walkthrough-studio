import assert from 'node:assert/strict';
import { test } from 'node:test';
import { insetGeometry, planZooms, zoomFilter } from './camera.mjs';
import { glidePath, keyLabel } from './cursor.mjs';
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
  assert.match(vf, /^scale=.*eval=frame.*,crop=1920:1080:.*exact=1$/);
  assert.match(vf, /out_color_matrix=bt709/);
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

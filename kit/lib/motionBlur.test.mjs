import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CROSS_ZOOM, cameraAt, crossZoomAt, crossZoomGraph, planZooms, zoomGraph } from './camera.mjs';
import { TRANSITION_STYLES, xfadeArgs } from './edit.mjs';
import { MAX_GAP_PX, MAX_SAMPLES, MIN_SAMPLES, MIN_TRAVEL_PX, blurWindows, blurredGraph, frameTravel, mergeWindows, shutterSamples } from './motionBlur.mjs';

const size = { width: 1920, height: 1080 };
const fps = 30;

test('frame travel is zero at rest and grows with zoom speed and pan speed', () => {
  const rest = { z: 1.3, cx: 900, cy: 500 };
  assert.equal(frameTravel(rest, rest, size), 0);
  const slow = frameTravel({ z: 1, cx: 960, cy: 540 }, { z: 1.002, cx: 960, cy: 540 }, size);
  const fast = frameTravel({ z: 1, cx: 960, cy: 540 }, { z: 1.03, cx: 960, cy: 540 }, size);
  assert.ok(slow < MIN_TRAVEL_PX && fast > 20, `${slow} / ${fast}`);
  const pan = frameTravel({ z: 1.3, cx: 900, cy: 500 }, { z: 1.3, cx: 920, cy: 500 }, size);
  assert.ok(Math.abs(pan - 26) < 0.01, 'a pan moves every pixel by Δc·z');
});

test('blur runs only while an auto zoom moves, never on the hold or outside the shot', () => {
  const click = (t, x, y) => ({ kind: 'click', t, x, y });
  const { shots } = planZooms([click(4, 400, 300), click(5.6, 1500, 800)], { ...size, level: 'bold', duration: 20 });
  const camera = (t) => cameraAt(shots, t, size);
  assert.equal(camera(1).z, 1, 'before the shot the frame is whole');
  assert.ok(Math.abs(camera(4.5).z - shots[0].zoom) < 1e-6, 'held at the shot zoom between moves');
  const windows = blurWindows(camera, { from: shots[0].start, to: shots[0].end, fps, ...size });
  assert.ok(windows.length >= 2, 'push-in, pan and pull-back each get a window');
  const inBlur = (t) => windows.some(([a, b]) => t * fps >= a && t * fps < b);
  assert.ok(inBlur(shots[0].start + 0.2), 'the fast start of the push-in is blurred');
  assert.ok(inBlur(5.6 - 0.35), 'the middle of the pan is blurred');
  assert.ok(!inBlur(6.6), 'the hold after the last click stays crisp');
  assert.ok(!inBlur(1) && !inBlur(shots[0].end + 1), 'nothing outside the shot');
  for (const [a, b] of windows) assert.ok(Number.isInteger(a) && Number.isInteger(b) && b > a);
});

test('windows merge when close and the graph supersamples only moving pieces', () => {
  assert.deepEqual(mergeWindows([[10, 20, 5], [24, 30, 40], [60, 70]], 6), [[10, 30, 40], [60, 70]]);
  const lines = blurredGraph({
    src: '[in]',
    out: '[out]',
    totalFrames: 300,
    fps,
    windows: [[30, 60, 9]],
    active: [[20, 100]],
    transform: (clock) => `scale=w='iw*(1+${clock})':h=ih:eval=frame`,
  });
  const g = lines.join(';');
  assert.match(g, /^\[in\]split=5/, 'still, hold-in, moving, hold, still');
  assert.equal((g.match(/fps=240,/g) || []).length, 1, 'one supersampled piece (4 samples at 9 px/frame)');
  // 4 samples straddle the frame time: t − 1.5/240 … t + 1.5/240 around each frame.
  assert.match(g, /trim=start_frame=30:end_frame=60,setpts=PTS-STARTPTS,fps=240,select='lt\(mod\(n\\,8\)\\,4\)',scale=w='iw\*\(1\+\(t\+0\.993750\)\)'/);
  assert.equal((g.match(/tmix=frames=2,select='mod\(n\\,2\)'/g) || []).length, 2, 'log2(4) averaging stages');
  assert.match(g, /trim=start_frame=20:end_frame=30,setpts=PTS-STARTPTS,scale=w='iw\*\(1\+\(t\+0\.666667\)\)'/, 'held zoom: transform, no blur');
  assert.match(g, /trim=start_frame=0:end_frame=20,setpts=PTS-STARTPTS,null/, 'before the move: untouched');
  assert.match(g, /trim=start_frame=100,setpts/, 'the last piece runs to the end of the stream');
  assert.match(g, /concat=n=5:v=1:a=0,setpts=N\/\(30\*TB\),fps=30\[out\]$/);
  assert.doesNotMatch(g, /\bst\(|\bld\(/, 'no shared expression registers');
  const still = blurredGraph({ src: '[in]', out: '[out]', totalFrames: 90, fps, windows: [], transform: () => 'hflip' });
  assert.deepEqual(still, ['[in]hflip[out]']);
});

test('faster moves get more shutter samples so the streak stays continuous', () => {
  assert.equal(shutterSamples(3), MIN_SAMPLES);
  assert.equal(shutterSamples(20), 8);
  assert.equal(shutterSamples(49), MAX_SAMPLES, 'a 49 px/frame push-in needs ≤1.25 px between samples');
  assert.equal(shutterSamples(500), MAX_SAMPLES, 'capped');
  for (const p of [3, 10, 20, 40, 79]) assert.ok(p / 2 / shutterSamples(p) <= MAX_GAP_PX || shutterSamples(p) === MAX_SAMPLES);
});

test('the zoom transition is a lanczos cross zoom under the smooth dissolve, not ffmpeg zoomin', () => {
  assert.equal(TRANSITION_STYLES.zoom.xfade, 'fade');
  assert.equal(TRANSITION_STYLES.zoom.motion, 'crosszoom');
  assert.match(xfadeArgs(TRANSITION_STYLES.zoom.xfade), /transition=custom/);
  const geo = { dur: 6, head: 0.6, tail: 0.6 };
  assert.ok(Math.abs(crossZoomAt(0, geo) - (1 + CROSS_ZOOM.in)) < 1e-9, 'lands from a slight magnification');
  assert.equal(crossZoomAt(3, geo), 1);
  assert.ok(Math.abs(crossZoomAt(6, geo) - (1 + CROSS_ZOOM.out)) < 1e-9, 'leaves on a push-in');
  assert.ok(1 + Math.max(CROSS_ZOOM.in, CROSS_ZOOM.out) <= 1.35, 'magnification stays where lanczos is clean');
  const g = crossZoomGraph({ src: '[a]', out: '[b]', ...geo, ...size, fps }).join(';');
  assert.match(g, /flags=lanczos/);
  assert.equal((g.match(/,tmix=frames=2/g) || []).length > 0, true);
  assert.equal((g.match(/select='lt\(mod/g) || []).length, 2, 'both moves are shutter-blurred');
});

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
const md5s = (file) =>
  ff(['-i', file, '-f', 'framemd5', '-'])
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(',').at(-1).trim());

test('rendered: frame count holds, still frames are bit-identical, moving frames are blurred', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-blur-'));
  try {
    const w = 320;
    const h = 180;
    const src = join(dir, 'src.mkv');
    ff(['-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:r=${fps}:d=3`, '-vf', 'format=yuv420p', '-c:v', 'ffv1', src]);
    const render = (blur, name) => {
      const lines = crossZoomGraph({ src: '[0:v]', out: '[v]', dur: 3, head: 0, tail: 0.6, width: w, height: h, fps });
      const graph = blur
        ? lines
        : [lines.join(';').replace(/fps=\d+,select='lt[^']+',|,tmix=frames=2,select='mod\(n\\,2\)'|,setpts=N\/\(30\*TB\),fps=30(?=\[\w+_p)/g, '')];
      const out = join(dir, name);
      ff(['-i', src, '-filter_complex', graph.join(';'), '-map', '[v]', '-c:v', 'ffv1', out]);
      return md5s(out);
    };
    const original = md5s(src);
    const blurred = render(true, 'blur.mkv');
    assert.equal(blurred.length, original.length, 'no frame dropped or added');
    assert.deepEqual(blurred.slice(0, 60), original.slice(0, 60), 'frames before the move are untouched');
    const sharp = render(false, 'sharp.mkv');
    const late = blurred.length - 3;
    assert.notEqual(blurred[late], sharp[late], 'the fast end of the push-in is integrated over the shutter');
    assert.notEqual(blurred[late], original[late]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

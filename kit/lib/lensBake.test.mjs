import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { lensGeometry, lensOpticsChain, lensPlaceChain } from './lens.mjs';
import { assertLensBakeArgs, lensBakeArgs, lensBakeKey, prepareLensBakes } from './lensBake.mjs';

const frame = { width: 1920, height: 1080 };
const mark = { t: 0.2, dur: 0.6, label: 'Zoom in', rect: { x: 700, y: 400, w: 240, h: 60 } };
const geo = lensGeometry(mark, frame);
const take = { t: '1:1', mark, geo, rimHex: '#F6AA1E', timing: undefined };

test('the cache key follows the take and everything that shapes the glass', () => {
  const base = lensBakeKey({ ...take, take: 'a' });
  assert.equal(lensBakeKey({ ...take, take: 'a' }), base);
  assert.notEqual(lensBakeKey({ ...take, take: 'b' }), base, 'a re-record must re-render');
  assert.notEqual(lensBakeKey({ ...take, take: 'a', mark: { ...mark, t: 5 } }), base, 'moving the mark must re-render');
  assert.notEqual(lensBakeKey({ ...take, take: 'a', rimHex: '#ff0000' }), base, 'a new rim colour must re-render');
});

test('the glass is only ever stored lossless with alpha', () => {
  const args = lensBakeArgs('take.mp4', mark, geo, '#F6AA1E', undefined, 'out.mov');
  assertLensBakeArgs(args);
  assert.throws(() => assertLensBakeArgs(['-c:v', 'libx264', '-pix_fmt', 'rgba']), /lossless/);
  assert.throws(() => assertLensBakeArgs(['-c:v', 'png', '-pix_fmt', 'yuv420p']), /alpha/);
});

const ffmpeg = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
};

test('a baked lens composites to exactly the same pixels as rendering it inline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lensbake-'));
  try {
    const takeFile = join(dir, 'live.mp4');
    ffmpeg([
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=1.2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'yuv420p', takeFile,
    ]);

    const optics = lensOpticsChain(mark, geo, '#F6AA1E', undefined);
    const place = lensPlaceChain(mark);
    const overlay = `overlay=x='${geo.ox}':y='${geo.oy}':eval=frame:eof_action=pass:format=auto`;

    // Inline: the glass is rendered inside the compositing graph, as produce used to do.
    const inlineMd5 = join(dir, 'inline.md5');
    ffmpeg([
      '-i', takeFile, '-ss', mark.t.toFixed(3), '-t', mark.dur.toFixed(3), '-i', takeFile,
      '-filter_complex', `[0:v]fps=30,format=yuv420p[base];[1:v]${optics},${place}[glass];[base][glass]${overlay}[v]`,
      '-map', '[v]', '-f', 'framemd5', inlineMd5,
    ]);

    // Baked: the same glass, rendered once to a clip and overlaid from there.
    const video = { out: dir, slug: 'lensbake' };
    const baked = await prepareLensBakes(video, takeFile, [{ mark, geo }], { rimHex: '#F6AA1E' });
    assert.equal(baked.rendered, 1);
    const bakedMd5 = join(dir, 'baked.md5');
    ffmpeg([
      '-i', takeFile, '-i', baked.files[0],
      '-filter_complex', `[0:v]fps=30,format=yuv420p[base];[1:v]format=rgba,${place}[glass];[base][glass]${overlay}[v]`,
      '-map', '[v]', '-f', 'framemd5', bakedMd5,
    ]);

    const frames = (file) =>
      spawnSync('sh', ['-c', `grep -v '^#' "${file}" | awk '{print $NF}'`], { encoding: 'utf8' }).stdout.trim().split('\n');
    const inline = frames(inlineMd5);
    const bakedFrames = frames(bakedMd5);
    assert.ok(inline.length > 30, `expected a full second of frames, got ${inline.length}`);
    assert.deepEqual(bakedFrames, inline, 'the baked glass must be the same picture, frame for frame');

    // Second call reuses the cached clip instead of paying for geq again.
    const again = await prepareLensBakes(video, takeFile, [{ mark, geo }], { rimHex: '#F6AA1E' });
    assert.equal(again.rendered, 0);
    assert.equal(again.stamp, baked.stamp);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

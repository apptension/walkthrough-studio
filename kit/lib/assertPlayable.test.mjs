import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertPlayable } from './media.mjs';

const ffmpeg = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
};

const dir = mkdtempSync(join(tmpdir(), 'playable-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const clip = (name, sec) => {
  const file = join(dir, name);
  ffmpeg(['-f', 'lavfi', '-i', `testsrc=size=320x180:rate=30:duration=${sec}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  return file;
};

test('a complete render passes', () => {
  assert.equal(Math.round(assertPlayable(clip('good.mp4', 3), { expectedSec: 3 })), 3);
});

test('a short render is rejected against the plan', () => {
  assert.throws(() => assertPlayable(clip('short.mp4', 1), { expectedSec: 3 }), /cut short/);
});

test('a master whose picture stops early is rejected even though the container is full length', () => {
  // The black-render shape: 1s of video muxed with 4s of audio reports 4s at container level.
  const picture = clip('picture.mp4', 1);
  const short = join(dir, 'short-picture.mp4');
  ffmpeg([
    '-i', picture,
    '-f', 'lavfi', '-i', 'anoisesrc=d=4:c=pink:r=48000',
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', short,
  ]);
  assert.equal(Math.round(parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', short], { encoding: 'utf8' }).stdout)), 4);
  assert.throws(() => assertPlayable(short, { expectedSec: 4 }), /picture|cut short/);
});

test('a truncated file is rejected', () => {
  const good = clip('trunc-src.mp4', 3);
  const broken = join(dir, 'broken.mp4');
  const r = spawnSync('sh', ['-c', `head -c $(( $(wc -c < "${good}") / 3 )) "${good}" > "${broken}"`]);
  assert.equal(r.status, 0);
  assert.throws(() => assertPlayable(broken, { expectedSec: 3 }));
});

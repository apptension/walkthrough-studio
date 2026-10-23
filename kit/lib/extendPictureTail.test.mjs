import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertPlayable, duration, extendPictureTail } from './media.mjs';

const ffmpeg = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
};

const dir = mkdtempSync(join(tmpdir(), 'extend-tail-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const clip = (name, sec) => {
  const file = join(dir, name);
  ffmpeg(['-f', 'lavfi', '-i', `testsrc=size=320x180:rate=30:duration=${sec}`, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  return file;
};

test('extendPictureTail holds the last frame for the requested pad, in place', () => {
  const file = clip('master.mp4', 3);
  extendPictureTail(file, 2, { label: 'test master' });
  const sec = assertPlayable(file, { expectedSec: 5, toleranceSec: 0.3, label: 'test master' });
  assert.ok(Math.abs(sec - 5) < 0.3, `expected ~5s of picture, got ${sec}`);
});

test('extendPictureTail is a no-op for a zero or negative pad', () => {
  const file = clip('untouched.mp4', 2);
  const before = duration(file);
  extendPictureTail(file, 0, { label: 'test master' });
  extendPictureTail(file, -1, { label: 'test master' });
  assert.ok(Math.abs(duration(file) - before) < 0.05);
});

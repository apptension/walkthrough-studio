import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { duration } from './media.mjs';

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

/** A black clip of `sec` seconds, written straight to `file`. */
const clip = (file, sec) =>
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=black:s=64x64:d=${sec}`,
    '-pix_fmt', 'yuv420p',
    file,
  ]);

test('a clip is probed once and re-probed when its bytes change', { skip: hasFfmpeg ? false : 'ffmpeg not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-media-'));
  try {
    const file = join(dir, 'take.mp4');
    clip(file, 2);
    assert.equal(duration(file), 2);

    // Repeat reads come off the probe already taken: the deck asks for one per plate on every
    // refresh, and each spawn blocks the server.
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 20; i++) assert.equal(duration(file), 2);
    const perCall = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
    assert.ok(perCall < 1, `cached reads should cost well under a millisecond, got ${perCall.toFixed(3)}ms`);

    // A re-render at the same path must not keep serving the old length.
    clip(file, 5);
    assert.equal(duration(file), 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a clip rewritten back to its original timestamp is still re-probed', { skip: hasFfmpeg ? false : 'ffmpeg not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-media-'));
  try {
    const file = join(dir, 'take.mp4');
    clip(file, 2);
    assert.equal(duration(file), 2);
    // Size guards the case a filesystem or a restore hands back the mtime the probe was taken at.
    clip(file, 7);
    utimesSync(file, new Date(0), new Date(0));
    assert.equal(duration(file), 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

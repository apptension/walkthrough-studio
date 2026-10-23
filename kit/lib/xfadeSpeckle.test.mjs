import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { deflashGraph } from './deflash.mjs';
import { xfadeArgs } from './edit.mjs';

/** Brightest luma of every frame of a dissolve between two flat dark colours. */
function dissolvePeaks(transition) {
  const src = (c) => `color=c=${c}:s=640x360:r=30:d=1.2,format=yuv420p`;
  const r = spawnSync(
    'ffmpeg',
    [
      '-v', 'error', '-f', 'lavfi', '-i', src('0x0c1a0c'), '-f', 'lavfi', '-i', src('0x020302'),
      '-filter_complex', `[0][1]xfade=${transition}:duration=1:offset=0.1,signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=/dev/stdout`,
      '-f', 'null', '-',
    ],
    { encoding: 'utf8' }
  );
  assert.equal(r.status, 0, r.stderr);
  return [...r.stdout.matchAll(/YMAX=(\d+)/g)].map((m) => Number(m[1]));
}

test('the dissolve never lights pixels brighter than either shot', () => {
  const peaks = dissolvePeaks(xfadeArgs('fade'));
  assert.ok(peaks.length > 20, 'expected per-frame stats');
  // The brighter input peaks at luma 33. Shared st()/ld() registers across slice threads
  // used to push stray pixels to 255 — white speckle over dark plates and chapter cards.
  assert.ok(Math.max(...peaks) <= 34, `speckle: peak luma ${Math.max(...peaks)}`);
});

test('per-pixel expressions do not use registers shared across threads', () => {
  assert.doesNotMatch(xfadeArgs('fade'), /\b(st|ld)\(/);
  const graph = deflashGraph([{ first: 10, last: 12 }], 60, '[in]', '[out]');
  assert.doesNotMatch(graph, /\b(st|ld)\(/);
});

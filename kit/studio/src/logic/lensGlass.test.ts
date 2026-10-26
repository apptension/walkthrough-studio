import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { GLASS_REACH, LENS_TIMING, glassCanvas, glassProfile, glassShade, lensOpenState, lensTiming, rimWidth } from './lensGlass';

describe('lensGlass', () => {
  test('timing scales with motion and keeps only known curves', () => {
    assert.deepEqual(lensTiming(), { in: 0.55, out: 0.42, curve: 'glide' });
    assert.equal(lensTiming({ curve: 'snappy' }).curve, 'snappy');
    assert.equal(lensTiming({ curve: 'nope' }).curve, 'glide');
    assert.ok(lensTiming({ motion: 'swift' }).in < LENS_TIMING.in);
  });

  test('profile is flat at the centre and squeezes across the bevel', () => {
    assert.equal(glassProfile(0), 1);
    assert.ok(Math.abs(glassProfile(1) - (1 + 0.12 + 0.55)) < 1e-12);
    assert.equal(glassShade(0), 1);
    assert.ok(glassShade(1) < glassShade(0.5));
    assert.equal(rimWidth(400), 5);
  });

  test('the lens opens, holds and closes', () => {
    const start = lensOpenState(0, 4);
    assert.equal(start.alpha, 0);
    assert.equal(start.scale, 0.72);
    const mid = lensOpenState(2, 4);
    assert.deepEqual(mid, { open: 1, scale: 1, alpha: 1, swell: 1 });
    assert.equal(lensOpenState(4, 4).alpha, 0);
  });

  test('working canvas is wide enough for the rim reach', () => {
    const { S, W, over } = glassCanvas(200, 10);
    assert.equal(S, 220);
    assert.ok(W >= 2 * Math.ceil(100 * GLASS_REACH + 6));
    assert.equal(over, (W - S) / 2);
  });
});

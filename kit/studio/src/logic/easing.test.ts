import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import {
  CURVE_IDS,
  CURVES,
  DEFAULT_CURVE,
  DEFAULT_MOTION,
  MOTION_IDS,
  curveOf,
  easeAt,
  minJerk,
  minJerkExpr,
  motionScale,
  unitExpr,
} from './easing';

describe('easing', () => {
  test('curve and motion ids are stable', () => {
    assert.deepEqual(CURVE_IDS, ['glide', 'smooth', 'cinematic', 'snappy']);
    assert.deepEqual(MOTION_IDS, ['unhurried', 'natural', 'swift']);
    assert.equal(DEFAULT_CURVE, 'glide');
    assert.equal(DEFAULT_MOTION, 'natural');
  });

  test('every curve runs 0 → 1 and clamps outside the unit range', () => {
    for (const id of CURVE_IDS) {
      const c = CURVES[id];
      assert.equal(c.fn(0), 0, id);
      assert.ok(Math.abs(c.fn(1) - 1) < 1e-12, id);
      assert.equal(c.fn(-1), c.fn(0), id);
      assert.equal(c.fn(2), c.fn(1), id);
    }
    assert.equal(CURVES.cinematic.fn(0.5), 0.5);
  });

  test('unknown ids fall back to the defaults', () => {
    assert.equal(curveOf('nope'), CURVES.glide);
    assert.equal(curveOf(undefined), CURVES.glide);
    assert.equal(motionScale('swift'), 0.75);
    assert.equal(motionScale('nope'), 1);
  });

  test('easeAt and minJerk', () => {
    assert.equal(easeAt('smooth', 1.5, 1, 1), CURVES.smooth.fn(0.5));
    assert.equal(easeAt('glide', 1, 1, 0), 0);
    assert.equal(minJerk(0.5), 0.5);
    assert.equal(minJerkExpr('U'), '(U*U*U*(U*(U*6-15)+10))');
  });

  test('ffmpeg expressions', () => {
    assert.equal(unitExpr('t', 1.23456, 2), 'clip((t-1.235)/2.000,0,1)');
    assert.equal(unitExpr('T', 0, 0), 'clip((T-0.000)/0.001,0,1)');
    assert.equal(CURVES.glide.expr('u'), '(1-pow(1-u,4))');
    assert.equal(CURVES.snappy.expr('u'), '((1-pow(2,-10*u))/0.9990234375)');
    assert.equal(CURVES.cinematic.expr('u'), 'if(lt(u,0.5),4*u*u*u,1-pow(-2*u+2,3)/2)');
  });
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFitSpec, typeFitRuntimeSource } from './typeFit.mjs';

test('parseFitSpec: shrink-only by default, floor at 62% of the stylesheet size', () => {
  assert.deepEqual(parseFitSpec({ fit: '2' }, 60), { lines: 2, min: 37, max: 60, box: '' });
});

test('parseFitSpec: explicit floor/ceiling/box; empty ceiling falls back to the base', () => {
  assert.deepEqual(parseFitSpec({ fit: '1', fitMin: '44', fitMax: '80', fitBox: '.card' }, 58), {
    lines: 1,
    min: 44,
    max: 80,
    box: '.card',
  });
  assert.equal(parseFitSpec({ fit: '', fitMax: '' }, 52).max, 52);
  assert.equal(parseFitSpec({ fit: '' }, 52).lines, 0);
});

test('parseFitSpec: floor never exceeds the ceiling', () => {
  assert.equal(parseFitSpec({ fitMin: '90' }, 60).min, 60);
});

test('runtime source is a self-contained script that registers __fitType', () => {
  const src = typeFitRuntimeSource();
  assert.match(src, /window\.__fitType = async function/);
  assert.doesNotMatch(src, /\bexport\b|\bimport\b/);
  assert.doesNotThrow(() => new Function(src));
});

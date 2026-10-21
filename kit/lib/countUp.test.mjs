import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countProgress, countUpRuntimeSource, formatCount, parseCountTarget } from './countUp.mjs';

const roundTrip = (text) => {
  const t = parseCountTarget(text);
  return t && { mid: formatCount(t, t.number * 0.5), end: formatCount(t, t.number) };
};

test('count targets keep their own typography (prefix, suffix, grouping, decimals)', () => {
  assert.deepEqual(roundTrip('4.8★'), { mid: '2.4★', end: '4.8★' });
  assert.deepEqual(roundTrip('+30%'), { mid: '+15%', end: '+30%' });
  assert.deepEqual(roundTrip('12,000'), { mid: '6,000', end: '12,000' });
  assert.deepEqual(roundTrip('€1.2M'), { mid: '€0.6M', end: '€1.2M' });
  assert.deepEqual(roundTrip('$10,000'), { mid: '$5,000', end: '$10,000' });
  assert.deepEqual(roundTrip('1 000'), { mid: '500', end: '1 000' });
  assert.deepEqual(roundTrip('98 %'), { mid: '49 %', end: '98 %' });
});

test('text without digits never counts', () => {
  assert.equal(parseCountTarget('—'), null);
  assert.equal(parseCountTarget('Free'), null);
  assert.equal(parseCountTarget(''), null);
});

test('count progress eases out and clamps', () => {
  assert.equal(countProgress(0, 1, 1), 0);
  assert.equal(countProgress(2, 1, 1), 1);
  const half = countProgress(1.5, 1, 1);
  assert.ok(half > 0.9 && half < 1, `ease-out should be most of the way at the midpoint (${half})`);
});

test('runtime source inlines the shared functions and attaches to the plate runtime', () => {
  const src = countUpRuntimeSource();
  assert.match(src, /function parseCountTarget/);
  assert.match(src, /function formatCount/);
  assert.match(src, /\[data-count\]/);
  assert.match(src, /__plateRuntime/);
  // Must be plain script: no ESM syntax survives the inlining.
  assert.doesNotMatch(src, /^\s*export /m);
});

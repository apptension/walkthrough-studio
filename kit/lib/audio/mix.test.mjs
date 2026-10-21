import assert from 'node:assert/strict';
import { test } from 'node:test';
import { musicLoopRepeats } from './mix.mjs';

test('musicLoopRepeats covers a short bed without looping a long one', () => {
  assert.equal(musicLoopRepeats(60, 60), 0);
  assert.equal(musicLoopRepeats(60, 60.2), 0);
  assert.equal(musicLoopRepeats(60, 90), 1);
  assert.equal(musicLoopRepeats(60, 180), 2);
  assert.equal(musicLoopRepeats(60, 181), 3);
  assert.equal(musicLoopRepeats(0, 90), 0);
});

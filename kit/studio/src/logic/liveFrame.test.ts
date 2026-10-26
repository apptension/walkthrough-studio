import assert from 'node:assert/strict';

import { test } from 'vitest';

import { createPreviewPump } from './liveFrame';

test('a live frame load is never started while the previous one is still in flight', () => {
  const pump = createPreviewPump();
  const url = (stamp: number) => `/media/demo/live-preview.jpg?t=${stamp}`;

  assert.equal(pump.take(url), null);

  pump.markDirty();
  assert.equal(pump.take(url), '/media/demo/live-preview.jpg?t=1');
  pump.markDirty();
  assert.equal(pump.take(url), null);

  assert.equal(pump.finish(), true);
  assert.equal(pump.take(url), '/media/demo/live-preview.jpg?t=2');
  assert.equal(pump.finish(), false);
  assert.equal(pump.take(url), null);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { liveTabVisible, normalizeMonitorMode } from './monitorMode.js';

test('normalizeMonitorMode maps editor aliases and accepts live', () => {
  assert.equal(normalizeMonitorMode('editor'), 'plate');
  assert.equal(normalizeMonitorMode('live'), 'live');
  assert.equal(normalizeMonitorMode('nope'), 'program');
});

test('liveTabVisible while recording, repairing, or showing a last frame', () => {
  assert.equal(liveTabVisible({ recording: true }), true);
  assert.equal(liveTabVisible({ repairing: true }), true);
  assert.equal(liveTabVisible({ badge: 'Live' }), true);
  assert.equal(liveTabVisible({ badge: 'Last frame' }), true);
  assert.equal(liveTabVisible({ hasPreview: true }), true);
  assert.equal(liveTabVisible({ badge: '' }), false);
});

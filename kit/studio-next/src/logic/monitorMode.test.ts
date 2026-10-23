import assert from 'node:assert/strict';

import { test } from 'vitest';

import { liveTabVisible, normalizeMonitorMode, type CaptureState } from './monitorMode';

test('normalizeMonitorMode maps editor aliases and accepts live', () => {
  assert.equal(normalizeMonitorMode('editor'), 'plate');
  assert.equal(normalizeMonitorMode('live'), 'live');
  assert.equal(normalizeMonitorMode('nope'), 'program');
});

test('liveTabVisible only while recording or repairing', () => {
  assert.equal(liveTabVisible({ recording: true }), true);
  assert.equal(liveTabVisible({ repairing: true }), true);
  assert.equal(liveTabVisible({ recording: true, repairing: false }), true);
  assert.equal(liveTabVisible({}), false);
  assert.equal(liveTabVisible({ recording: false, repairing: false }), false);
});

test('liveTabVisible ignores last-frame / badge leftovers', () => {
  assert.equal(
    liveTabVisible({
      recording: false,
      repairing: false,
      badge: 'Last frame',
      hasPreview: true,
    } as CaptureState),
    false
  );
  assert.equal(liveTabVisible({ badge: 'Live', hasPreview: true } as CaptureState), false);
});

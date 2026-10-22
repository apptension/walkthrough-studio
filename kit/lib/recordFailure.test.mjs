import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordFailureView } from './recordFailure.mjs';

test('a failed retry shows the screenshot only when no live take exists', () => {
  const shown = recordFailureView({
    shotMtime: 20,
    liveMtime: null,
    note: 'Selector retry failed for Work email. Screenshot: error.png',
    screenshot: '/media/demo/error.png',
  });
  assert.equal(shown.screenshot, '/media/demo/error.png');
  assert.match(shown.reason, /did not match|control/i);
  assert.equal(recordFailureView({ shotMtime: 20, liveMtime: 30, note: 'failed' }), null);
  assert.equal(recordFailureView({ shotMtime: 40, liveMtime: 10, note: 'failed' }), null);
  assert.equal(recordFailureView({ shotMtime: null }), null);
});

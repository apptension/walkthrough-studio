import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureRepairDecision, captureRepairLimit } from './captureRepairLoop.mjs';

test('a repairable capture can cycle through three repairs before failing', () => {
  const first = captureRepairDecision({ captureAttempt: 1, maxRepairs: 3, repairable: true });
  const second = captureRepairDecision({ captureAttempt: 2, maxRepairs: 3, repairable: true });
  const third = captureRepairDecision({ captureAttempt: 3, maxRepairs: 3, repairable: true });
  const exhausted = captureRepairDecision({ captureAttempt: 4, maxRepairs: 3, repairable: true });

  assert.deepEqual(first, { action: 'repair', repairAttempt: 1, nextCaptureAttempt: 2, remaining: 2 });
  assert.deepEqual(second, { action: 'repair', repairAttempt: 2, nextCaptureAttempt: 3, remaining: 1 });
  assert.deepEqual(third, { action: 'repair', repairAttempt: 3, nextCaptureAttempt: 4, remaining: 0 });
  assert.deepEqual(exhausted, { action: 'fail', reason: 'exhausted', repairs: 3 });
});

test('a non-repairable error fails immediately', () => {
  assert.deepEqual(captureRepairDecision({ captureAttempt: 1, maxRepairs: 3, repairable: false }), {
    action: 'fail',
    reason: 'not-repairable',
    repairs: 0,
  });
});

test('each recording job starts with a fresh bounded repair limit', () => {
  assert.equal(captureRepairLimit({ WALKTHROUGH_CAPTURE_REPAIRS: '2' }), 2);
  assert.equal(captureRepairLimit({ WALKTHROUGH_CAPTURE_REPAIRS: '99' }), 5);
  assert.equal(captureRepairLimit({ WALKTHROUGH_CAPTURE_REPAIRS: 'bad' }), 3);

  const newJob = captureRepairDecision({ captureAttempt: 1, maxRepairs: 2, repairable: true });
  assert.equal(newJob.repairAttempt, 1);
});

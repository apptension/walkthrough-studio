import test from 'node:test';
import assert from 'node:assert/strict';
import { qcGrabArgs } from './validate.mjs';

test('qc grab seeks on the input', () => {
  const args = qcGrabArgs('/tmp/master.mp4', 140, '/tmp/a.jpg');
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'));
  assert.equal(args[args.indexOf('-ss') + 1], '140.000');
  assert.equal(args[args.indexOf('-i') + 1], '/tmp/master.mp4');
});

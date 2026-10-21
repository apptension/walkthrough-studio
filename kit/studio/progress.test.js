import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeJob } from './progress.js';

function recordJob(phase, attempts) {
  return {
    kind: 'kit',
    step: 'record',
    status: 'running',
    phase,
    activity: phase === 'repairing' ? `Repairing capture ${attempts}/3…` : `Capturing again after repair ${attempts}/3…`,
    repair: { attempts, max: 3 },
    log: [],
  };
}

test('record progress cycles from repair back to capture with an attempt count', () => {
  const repairing = describeJob(recordJob('repairing', 2));
  assert.match(repairing.title, /Repairing capture 2\/3/);
  assert.equal(repairing.stages.find((stage) => stage.id === 'repair').state, 'run');

  const capturing = describeJob(recordJob('re-recording', 2));
  assert.match(capturing.title, /Capturing again 3\/4/);
  assert.equal(capturing.stages.find((stage) => stage.id === 'capture').state, 'run');
  assert.equal(capturing.stages.find((stage) => stage.id === 'repair').state, 'done');
});

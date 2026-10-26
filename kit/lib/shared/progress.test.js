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

test('guide progress follows the session lines from ready to recording', () => {
  const job = (lines) => ({ kind: 'kit', step: 'guide', status: 'running', log: lines.map((line) => ({ line })) });
  const stateOf = (d, id) => d.stages.find((s) => s.id === id).state;

  const ready = describeJob(job(['» guide · opening http://127.0.0.1:4791/', '» guide · ready — go to the first screen, then press Start recording in the Recorder window']));
  assert.equal(stateOf(ready, 'open'), 'done');
  assert.equal(stateOf(ready, 'ready'), 'run');

  const recording = describeJob(job(['» guide · opening http://x/', '» guide · ready — go', '» guide · recording in 3 s', '» guide · chapter “Plan the week”']));
  assert.equal(stateOf(recording, 'ready'), 'done');
  assert.equal(stateOf(recording, 'capture'), 'run');

  const saving = describeJob(job(['» guide · ready — go', '» guide · recording', '» guide · saving (finish)']));
  assert.equal(stateOf(saving, 'save'), 'run');
});

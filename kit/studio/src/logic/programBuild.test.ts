import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test } from 'vitest';

import { marksForProgram, pipelineOverlay, programSourceForStep } from './programBuild';

test('each finished step publishes the artifact that already exists', () => {
  const recorded = programSourceForStep({ step: 'record', hasLive: true, liveUrl: '/media/demo/live.mp4', hasDelivery: false });
  assert.equal(recorded.play, true);
  assert.match(recorded.src, /live\.mp4/);
  const produced = programSourceForStep({
    step: 'produce',
    hasLive: true,
    liveUrl: '/media/demo/live.mp4',
    hasDelivery: true,
    deliveryUrl: '/media/demo/demo.mp4',
  });
  assert.match(produced.src!, /demo\.mp4/);
  const audio = programSourceForStep({ step: 'audio', hasDelivery: true, deliveryUrl: '/media/demo/demo.mp4' });
  assert.equal(audio.preserveTime, true);
  const marks = marksForProgram({ chapters: [], captureMarks: [{ t: 1.2, label: 'Invite' }] });
  assert.equal(marks[0]!.title, 'Invite');
  assert.equal(marks[0]!.start, 1.2);
});

test('a failed step keeps an overlay and a running step leaves the previous preview', () => {
  const running = pipelineOverlay({ running: true, label: 'Produce master video' });
  assert.equal(running.show, true);
  assert.equal(running.tone, 'run');
  const failed = pipelineOverlay({ failed: true, label: 'Record', error: 'The page did not load', screenshot: '/media/demo/error.png', log: 'activity' });
  assert.equal(failed.tone, 'fail');
  assert.match(failed.screenshot, /error\.png/);
  assert.equal(failed.log, 'activity');
  const html = requireSource();
  assert.match(html, /id="programBuild"/);
});

function requireSource() {
  return readHtml();
}

function readHtml() {
  return readFileSync(join(import.meta.dirname, '../features/monitor/StageOverlays.tsx'), 'utf8');
}

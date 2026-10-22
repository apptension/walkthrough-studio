import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  effectiveResumeStep,
  improveGoalForStep,
  logExcerpt,
  pipelineFixNote,
  shouldRunStep,
  statusesForResume,
  statusMark,
  stepRowHtml,
} from './pipelineUi.js';

test('status marks use filled badges for done/fail and a rotating loader for run', () => {
  assert.match(statusMark('done'), /pip-badge-done/);
  assert.match(statusMark('fail'), /pip-badge-fail/);
  assert.match(statusMark('run'), /pip-badge-run/);
  assert.match(statusMark('run'), /pip-arc/);
  assert.match(statusMark('todo'), /pip-badge-todo/);
});

test('failed rows expose Retry and Fix actions, running rows caption Working', () => {
  const html = stepRowHtml({ id: 'audio', label: 'Add voice & music', status: 'fail' }, { actions: true });
  assert.match(html, /data-pipe-retry="audio"/);
  assert.match(html, /data-pipe-fix="audio"/);
  assert.match(html, /pip-actions/);
  assert.match(html, /Failed/);
  assert.doesNotMatch(stepRowHtml({ id: 'audio', label: 'Add voice & music', status: 'done' }, { actions: true }), /pip-actions/);
  assert.match(stepRowHtml({ id: 'produce', label: 'Produce', status: 'run' }), /Working/);
});

test('resume keeps earlier steps done and resets from the failure point', () => {
  const steps = [
    { id: 'plates', label: 'Plates' },
    { id: 'produce', label: 'Produce' },
    { id: 'audio', label: 'Audio' },
    { id: 'deliver', label: 'Deliver' },
    { id: 'preview', label: 'Preview' },
  ];
  const next = statusesForResume(steps, 'audio');
  assert.deepEqual(
    next.map((s) => s.status),
    ['done', 'done', 'todo', 'todo', 'todo']
  );
  assert.equal(shouldRunStep('plates', steps.map((s) => s.id), 'audio'), false);
  assert.equal(shouldRunStep('audio', steps.map((s) => s.id), 'audio'), true);
  assert.equal(shouldRunStep('deliver', steps.map((s) => s.id), 'audio'), true);
});

test('a plates failure beside record/produce resumes the host step', () => {
  assert.equal(effectiveResumeStep('plates', ['record', 'plates', 'produce', 'audio']), 'record');
  assert.equal(effectiveResumeStep('plates', ['plates', 'produce', 'audio']), 'produce');
  assert.equal(effectiveResumeStep('audio', ['plates', 'produce', 'audio']), 'audio');
});

test('fix note packs the error and a trimmed log for the Director', () => {
  const note = pipelineFixNote({
    label: 'Add voice & music',
    stepId: 'audio',
    error: 'ElevenLabs 401',
    log: ['ok', 'synth line 1', 'Error: ElevenLabs 401'],
  });
  assert.match(note, /Add voice & music/);
  assert.match(note, /ElevenLabs 401/);
  assert.match(note, /Recent log/);
  assert.equal(improveGoalForStep('audio'), 'voice');
  assert.equal(improveGoalForStep('plates'), 'plates');
  assert.equal(improveGoalForStep('record'), 'full');
});

test('log excerpt keeps the tail when the buffer is huge', () => {
  const big = Array.from({ length: 200 }, (_, i) => `line-${i}-xxxxxxxx`).join('\n');
  const out = logExcerpt(big, 200);
  assert.ok(out.startsWith('…\n'));
  assert.ok(out.length <= 210);
  assert.match(out, /line-199/);
});

test('pipeline CSS spins the run badge a full turn and pops settle badges', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  assert.match(css, /@keyframes pip-spin[\s\S]*rotate\(360deg\)/);
  assert.match(css, /@keyframes pip-badge-pop/);
  assert.match(css, /\.pip-badge-run[\s\S]*animation:\s*pip-spin/);
  assert.match(css, /\.pip-badge-done/);
  assert.match(css, /\.pip-badge-fail/);
  assert.match(css, /\.pip-actions/);
  assert.match(css, /\.pip-act\.primary/);
});

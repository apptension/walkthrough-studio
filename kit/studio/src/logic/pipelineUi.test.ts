import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test } from 'vitest';

import {
  effectiveResumeStep,
  improveGoalForStep,
  logExcerpt,
  pipelineFixNote,
  shouldRunStep,
  statusesForResume,
  statusMark,
  stepRowHtml,
  type GuidedBranch,
} from './pipelineUi';

const deskCss = () => readFileSync(join(import.meta.dirname, '../styles/studio.css'), 'utf8');
const deskFile = (rel: string) => readFileSync(join(import.meta.dirname, '..', rel), 'utf8');

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
  assert.match(html, /Fix with AI/);
  assert.match(html, /pip-actions/);
  assert.match(html, /Failed/);
  assert.doesNotMatch(stepRowHtml({ id: 'audio', label: 'Add voice & music', status: 'done' }, { actions: true }), /pip-actions/);
  assert.match(stepRowHtml({ id: 'produce', label: 'Produce', status: 'run' }), /Working/);
});

test('voice picture overrun failures offer Auto fix and Manual fix', () => {
  const err = 'narration runs 24.0s past the picture — too long to freeze automatically.';
  const html = stepRowHtml({ id: 'audio', label: 'Add voice & music', status: 'fail' }, { actions: true, failureError: err });
  assert.match(html, /data-pipe-autofix="audio"/);
  assert.match(html, /data-pipe-manual="audio"/);
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
  const css = deskCss();
  assert.match(css, /@keyframes pip-spin[\s\S]*rotate\(360deg\)/);
  assert.match(css, /@keyframes pip-badge-pop/);
  assert.match(css, /\.pip-badge-run[\s\S]*animation:\s*pip-spin/);
  assert.match(css, /\.pip-badge-done/);
  assert.match(css, /\.pip-badge-fail/);
  assert.match(css, /\.pip-actions/);
  assert.match(css, /\.pip-act\.primary/);
});

test('the running step reads as alive: ring, drawing arc and a row sweep', () => {
  const css = deskCss();
  // The arc grows and shrinks around the ring instead of a fixed dash chasing its tail.
  assert.match(css, /@keyframes pip-arc-draw[\s\S]*stroke-dasharray[\s\S]*stroke-dashoffset/);
  assert.match(css, /\.pip-badge-run \.pip-arc\s*\{[\s\S]*animation:\s*pip-arc-draw/);
  assert.match(css, /\.pip-badge-run \.pip-arc\s*\{[\s\S]*stroke-linecap:\s*round/);
  // The quiet track has to stay visible, or the badge reads as a stray comma.
  assert.match(css, /\.pip-badge-run \.pip-track\s*\{[\s\S]*opacity:\s*0\.3/);
  assert.match(css, /@keyframes pip-row-sweep/);
  assert.match(css, /\.render-pipeline li\.run::after\s*\{[\s\S]*animation:\s*pip-row-sweep/);
  // Rotation and arc periods must differ, so the ring never looks stalled.
  const spin = css.match(/\.pip-badge-run\s*\{[\s\S]*?animation:\s*pip-spin\s+([\d.]+)s/)?.[1];
  const draw = css.match(/animation:\s*pip-arc-draw\s+([\d.]+)s/)?.[1];
  assert.ok(spin && draw && spin !== draw, `spin ${spin}s and arc ${draw}s must differ`);
});

test('activity stages use the ring badge, not a gapped border spinner', () => {
  const css = deskCss();
  const stages = deskFile('features/feedback/WorkStages.tsx');
  assert.match(stages, /statusMark\(s\.state\)/);
  assert.match(css, /\.work-stages \.pip-badge/);
  assert.doesNotMatch(css, /\.work-stages li\.run \.work-mark\s*\{[^}]*border-top-color/);
});

test('polled lists patch rows in place so spinners do not restart', () => {
  const stages = deskFile('features/feedback/WorkStages.tsx');
  assert.match(stages, /key=\{key\}/);
  assert.match(stages, /data-state=\{s\.state\}/);
  assert.match(stages, /statusMark\(s\.state\)/);
  assert.doesNotMatch(stages, /innerHTML\s*=/);
});

test('stop closes the Program overlay and the pipeline unless a failure is kept', () => {
  const jobs = deskFile('desk/jobs.ts');
  const stop = jobs.match(/export async function stopAllWork[\s\S]*?\n}\n/)?.[0] || '';
  assert.match(stop, /if \(!desk\.get\(\)\.pipelineFailure\)/);
  assert.match(stop, /pipeline: null/);
  assert.match(stop, /paintProgramBuild\(pipelineOverlay\(\{ running: false \}\)\)/);
  assert.match(stop, /hideActivityDock\(\)/);
});

test('reduced motion leaves a calm ring, not a frozen spinner', () => {
  const css = deskCss();
  const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(block, /\.pip-badge-run \.pip-arc/);
  assert.match(block, /stroke-dasharray:\s*none/);
  assert.match(block, /\.render-pipeline li\.run::after\s*\{\s*opacity:\s*0/);
});

test('a guided run branches on the take choice and resumes on the right branch', async () => {
  const { guidedSteps, guidedBranchFor } = await import('./pipelineUi');
  const ids = (b: GuidedBranch) => guidedSteps(b).map((s) => s.id);
  assert.deepEqual(ids('own'), ['guide', 'decide', 'adopt', 'own-script', 'plates', 'produce', 'audio', 'deliver', 'preview']);
  assert.deepEqual(ids('bot'), ['guide', 'decide', 'retake', 'record', 'plates', 'recraft', 'produce', 'audio', 'deliver', 'preview']);
  assert.deepEqual(ids('own').slice(0, 2), ids('bot').slice(0, 2), 'both branches share the record-and-choose head');
  assert.equal(guidedBranchFor('own-script', 'bot'), 'own');
  assert.equal(guidedBranchFor('record', 'own'), 'bot');
  assert.equal(guidedBranchFor('produce', 'bot'), 'bot');
  assert.equal(guidedBranchFor(null, null), 'own');
  assert.equal(effectiveResumeStep('plates', ids('own')), 'produce', 'own plates are drawn by produce');
});

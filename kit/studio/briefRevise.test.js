import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  FORCE_REPLAN_STAGES,
  hasStoredCredentials,
  maskCredentials,
  nextBrief,
  revisePlan,
  scrubSecrets,
  stagesForReplan,
} from './briefRevise.js';
import { applyBriefRevision, saveSourceRevision } from '../lib/briefRevise.mjs';

const before = {
  title: 'Invite',
  audience: 'Admins',
  purpose: 'overview',
  lengthSec: 120,
  brand: { id: 'walkthrough-studio', mode: 'existing' },
  app: { startUrl: 'https://app.example/home', loginRequired: false, password: 'old-secret' },
  story: { mustShow: ['Home'], keyMessages: [], mustSay: [], avoid: [] },
  proof: { plates: ['features'], stats: [], quotes: [], logos: [] },
};

test('project settings masks credentials and a story change does not rediscover the brand', () => {
  const masked = maskCredentials(before);
  assert.equal(masked.app.password, '');
  const story = revisePlan(before, { ...before, audience: 'New admins', app: { ...before.app, password: '' } });
  assert.deepEqual(story.stages, ['planner']);
  assert.equal(story.needsRecord, false);
  assert.equal(story.changed.some((item) => item.field === 'password'), false);
});

test('settings form does not echo stored email and blank fields keep the saved credentials', () => {
  const signedIn = {
    ...before,
    app: {
      startUrl: 'https://app.example/home',
      loginRequired: true,
      email: 'demo@acme.com',
      envVars: ['INVITE_ADMIN_EMAIL', 'INVITE_ADMIN_PASSWORD'],
    },
  };
  assert.equal(hasStoredCredentials(signedIn), true);
  const masked = maskCredentials(signedIn);
  assert.equal(masked.app.loginRequired, true);
  assert.equal(masked.app.credentialsOnFile, true);
  assert.equal(masked.app.email, '');
  assert.equal(masked.app.password || '', '');
  const keep = revisePlan(signedIn, {
    ...signedIn,
    audience: 'New admins',
    app: { startUrl: signedIn.app.startUrl, loginRequired: true },
  });
  assert.equal(keep.changed.some((item) => item.field === 'email' || item.field === 'password'), false);
  const kept = nextBrief(signedIn, {
    ...signedIn,
    audience: 'New admins',
    story: signedIn.story,
    app: { startUrl: signedIn.app.startUrl, loginRequired: true },
  });
  assert.equal(kept.app.email, 'demo@acme.com');
  assert.equal(kept.app.loginRequired, true);
  const replaced = nextBrief(signedIn, {
    ...signedIn,
    story: signedIn.story,
    app: { startUrl: signedIn.app.startUrl, loginRequired: true, email: 'new@acme.com' },
  });
  assert.equal(replaced.app.email, 'new@acme.com');
});

test('a language change replans the script and keeps the current take', () => {
  const untouched = revisePlan(before, { ...before, app: { ...before.app, password: '' } });
  assert.equal(untouched.changed.some((item) => item.field === 'language'), false);
  const plan = revisePlan(before, { ...before, language: 'pl', app: { ...before.app, password: '' } });
  assert.deepEqual(plan.stages, ['planner']);
  assert.equal(plan.needsRecord, false);
  assert.equal(plan.changed.some((item) => item.label === 'Language'), true);
  assert.equal(nextBrief(before, { ...before, language: 'PL', story: before.story, app: before.app }).language, 'pl');
  assert.throws(() => nextBrief(before, { ...before, language: 'xx', story: before.story }), /Eleven v4/);
});

test('Save and replan with no edits still forces explore + planner', () => {
  const untouched = revisePlan(before, { ...before, app: { ...before.app, password: '' } });
  assert.deepEqual(untouched.stages, []);
  assert.deepEqual(stagesForReplan(untouched), [...FORCE_REPLAN_STAGES]);
  assert.deepEqual(stagesForReplan(untouched, { force: false }), []);
  const story = revisePlan(before, { ...before, audience: 'New admins', app: { ...before.app, password: '' } });
  assert.deepEqual(stagesForReplan(story), ['planner']);
});

test('chapter list changes re-explore before the planner rewrites the script', () => {
  const plan = revisePlan(before, {
    ...before,
    story: { ...before.story, mustShow: ['Dashboard', 'Invite'] },
    app: { ...before.app, password: '' },
  });
  assert.ok(plan.stages.includes('analyze'));
  assert.ok(plan.stages.includes('planner'));
  assert.equal(plan.stages.indexOf('analyze') < plan.stages.indexOf('planner'), true);
});

test('access changes re-record and brand changes discover, without writing the password into the revision', () => {
  const access = revisePlan(before, { ...before, app: { ...before.app, startUrl: 'https://app.example/team', password: '' } });
  assert.ok(access.stages.includes('analyze'));
  assert.equal(access.stages.includes('discover'), false);
  assert.equal(access.needsRecord, true);
  const brand = revisePlan(before, { ...before, brand: { id: 'acme' }, app: { ...before.app, password: '' } });
  assert.deepEqual(brand.stages, ['discover']);

  const dir = mkdtempSync(join(tmpdir(), 'ws-brief-'));
  const video = { dir, slug: 'invite-admin', out: dir };
  writeFileSync(join(dir, 'brief.json'), JSON.stringify({ ...before, app: { ...before.app, password: 's3cret-value' } }));
  writeFileSync(join(dir, 'video.config.json'), JSON.stringify({ title: 'Invite', record: { startUrl: before.app.startUrl } }));
  const revision = saveSourceRevision(video, { secrets: ['s3cret-value'] });
  const copied = readFileSync(join(revision.dir, 'brief.json'), 'utf8');
  assert.equal(copied.includes('s3cret-value'), false);
  const written = applyBriefRevision(video, nextBrief(before, { ...before, audience: 'New admins', app: { ...before.app, password: 's3cret-value' } }), {
    secrets: ['s3cret-value'],
  });
  assert.equal(JSON.stringify(written).includes('s3cret-value'), false);
  assert.equal(written.language, 'en');
  assert.equal(JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8')).language, 'en');
  assert.equal(scrubSecrets('keep s3cret-value out', ['s3cret-value']).includes('s3cret-value'), false);
  rmSync(dir, { recursive: true, force: true });
});

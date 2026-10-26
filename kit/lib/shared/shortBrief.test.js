import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draftFromDescription, applyDraftToConfig } from './shortBrief.js';

test('one description and a start URL draft an editable video and do not record', () => {
  const draft = draftFromDescription({
    description:
      'Show a new admin how to invite a teammate in about a minute, then the settings that decide who can change it.',
    startUrl: 'https://app.example.com/team',
  });
  assert.equal(draft.records, false);
  assert.equal(draft.startUrl, 'https://app.example.com/team');
  assert.equal(draft.purpose, 'onboarding');
  assert.equal(draft.lengthSec, 60);
  assert.ok(draft.title.split(/\s+/).length <= 8);
  assert.ok(draft.chapters.length >= 2);
  assert.ok(draft.chapters.some((chapter) => /settings/i.test(chapter)));
  assert.equal(draft.audience, 'new admin');
  assert.deepEqual(draft.proof, ['features']);
  const config = applyDraftToConfig(
    { title: 'Old', audience: 'Old audience', purpose: 'overview', record: { startUrl: 'http://localhost:3000' } },
    draft
  );
  assert.equal(config.record.startUrl, 'https://app.example.com/team');
  assert.equal(config.purpose, 'onboarding');
  assert.equal(config.story.lengthSec, 60);
  assert.equal(config.story.mustShow.length >= 2, true);
});

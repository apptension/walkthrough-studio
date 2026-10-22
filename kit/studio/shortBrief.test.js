import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('the short brief is the opening, and the five-step form stays available', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /data-step="short"/);
  assert.match(html, /name="description"/);
  assert.match(html, /data-full-brief/);
  // The agent's progress and live feed sit under the description while it drafts the brief.
  assert.match(html, /id="shortDraft"/);
  assert.match(html, /id="shortDraftStream"/);
  for (const step of ['0', '1', '2', '3', '4']) {
    assert.match(html, new RegExp(`data-step="${step}"`));
  }
});

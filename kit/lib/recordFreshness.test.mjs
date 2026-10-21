import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordNeedsRerecord, recordRerecordReason, recordTakeNote } from './recordFreshness.mjs';

test('changing only the start URL sets needsRecord when the flow is unchanged', () => {
  const needs = recordNeedsRerecord({
    hasLive: true,
    flowNewer: false,
    recordedUrl: 'http://localhost:3000/old',
    startUrl: 'http://localhost:3000/new',
    recordedLogin: false,
    loginRequired: false,
  });
  assert.equal(needs, true);
  assert.match(recordRerecordReason({ urlChanged: true }), /Start URL/);
});

test('the same URL does not ask for a re-record', () => {
  assert.equal(
    recordNeedsRerecord({
      hasLive: true,
      flowNewer: false,
      recordedUrl: 'https://app.example/home',
      startUrl: 'https://app.example/home',
    }),
    false
  );
  assert.equal(recordTakeNote({ hasLive: true, urlChanged: false }), '');
  assert.match(recordTakeNote({ hasLive: true, urlChanged: true }), /replaces the old capture/);
});

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { narratorKeyNote } from './narratorNote';

test('a live key clears the notice', () => {
  assert.equal(narratorKeyNote('live'), '');
});

test('stub mode explains the missing account list', () => {
  assert.equal(narratorKeyNote('stub'), 'Voice runs in stub mode, so the account list is not available.');
});

test('a missing key points at kit/.env and the take fallbacks', () => {
  assert.equal(
    narratorKeyNote('missing'),
    'Add ELEVENLABS_API_KEY in kit/.env to speak lines, or upload / record a take instead.',
  );
  assert.equal(narratorKeyNote(undefined), narratorKeyNote('missing'));
});

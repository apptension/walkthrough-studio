import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guideJourney, guideStatusLine } from './guideCard.js';
import { takeFacts } from './takeChoice.js';

const now = (status) => guideJourney(status).find((s) => s.state === 'now')?.id;

test('the guide card says where the reviewer is in the journey', () => {
  assert.equal(now({ state: 'connecting' }), 'screen');
  assert.equal(now({ state: 'ready', needsSignIn: true }), 'signin');
  assert.equal(now({ state: 'ready' }), 'screen');
  assert.equal(now({ state: 'countdown' }), 'start');
  assert.equal(now({ state: 'capturing' }), 'show');
  assert.equal(now({ state: 'paused' }), 'show');
  assert.equal(now({ state: 'done' }), 'choose');
  const rec = guideJourney({ state: 'capturing' });
  assert.deepEqual(rec.map((s) => s.state), ['done', 'done', 'now', 'next', 'next']);
  assert.match(rec.find((s) => s.id === 'finish').html, /Finish recording/);
  assert.equal(guideStatusLine({ steps: 1, marks: 2, cuts: 1 }), '1 step · 2 chapters · 1 pause cut');
});

test('the take choice sums up the recording', () => {
  const tour = { steps: 23, take: { seconds: 75.4, chapters: [{ title: 'A', t: 0 }, { title: 'B', t: 20 }], cuts: 2, cutSec: 6.4 } };
  assert.equal(takeFacts(tour), '1:15 · 2 chapters · 23 steps · 2 pauses cut (6s)');
  assert.equal(takeFacts({ steps: 3 }), '');
});

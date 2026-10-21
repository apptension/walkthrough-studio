import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { captureSummary, shouldEnqueue } from './queueUx.js';

test('the capture line is one host, and sign-in is a suffix', () => {
  assert.equal(captureSummary('http://localhost:4747', false), 'localhost:4747');
  assert.equal(captureSummary('https://app.example.com/team/', true), 'app.example.com/team · signs in');
  assert.equal(captureSummary('', false), 'No start URL yet');
});

test('the same step is not queued twice, and an improve note can repeat', () => {
  const waiting = [{ slug: 'demo', kind: 'step', step: 'plates', mode: '', goal: '' }];
  assert.equal(shouldEnqueue(waiting, { slug: 'demo', kind: 'step', step: 'plates' }), false);
  assert.equal(shouldEnqueue(waiting, { slug: 'demo', kind: 'step', step: 'audio' }), true);
  assert.equal(shouldEnqueue(waiting, { slug: 'other', kind: 'step', step: 'plates' }), true);
  assert.equal(shouldEnqueue(waiting, { slug: 'demo', kind: 'improve', goal: 'full' }), true);
});

test('the rail keeps capture closed and the queue behind one Add step', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /<details id="recordTarget"/);
  assert.equal(html.includes('>Save target<'), false);
  assert.match(html, /id="btnQueueAdd"/);
  assert.match(html, /id="queueMenu"/);
  assert.match(html, /id="cleanupDisclosure"/);
});

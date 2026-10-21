import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { capturedTour, recordFailureAction, recordFailureNote, recordFailureView } from './recordFailure.js';

test('a failed record shows the reason, the URL, and the screenshot', () => {
  const view = recordFailureView({
    shotMtime: 20,
    liveMtime: null,
    note: 'page.goto: Timeout 30000ms exceeded.\nnavigating to "http://localhost:3000/app", waiting until "domcontentloaded"',
    screenshot: '/media/demo/error.png',
  });
  assert.match(view.reason, /did not load/);
  assert.doesNotMatch(view.reason, /Timeout/);
  assert.match(view.technical, /Timeout 30000ms/);
  assert.match(view.url, /http:\/\/localhost:3000\/app/);
  assert.match(view.next, /re-record/i);
  assert.equal(view.screenshot, '/media/demo/error.png');
  const note = recordFailureNote(view);
  assert.match(note, /localhost:3000/);
  assert.match(note, /re-record/i);
});

test('a refused connection names what failed and what to try next', () => {
  const view = recordFailureView({
    shotMtime: 5,
    note: 'net::ERR_CONNECTION_REFUSED at http://127.0.0.1:3000/',
    screenshot: '/media/demo/error.png',
  });
  assert.match(view.reason, /could not open/);
  assert.doesNotMatch(view.reason, /ERR_CONNECTION_REFUSED/);
  assert.match(view.next, /Start the app/);
});

test('a playwright line stays off the headline', () => {
  const view = recordFailureView({
    shotMtime: 9,
    note: 'locator.waitFor: Target page, context or browser has been closed',
  });
  assert.match(view.reason, /stopped before the walkthrough finished/);
  assert.match(view.technical, /browser has been closed/);
});

test('a newer take hides the failure, and plates alone are not a captured tour', () => {
  assert.equal(recordFailureView({ shotMtime: 20, liveMtime: 30, note: 'failed' }), null);
  assert.equal(capturedTour({ hasLive: false, recordFailed: true }), false);
  assert.equal(capturedTour({ hasLive: true, recordFailed: false }), true);
  assert.equal(recordFailureAction().label, 'Re-record');
});

test('the failure panel sits on Program with Fix with AI', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const stage = html.indexOf('id="stage"');
  const panel = html.indexOf('id="recordFailure"');
  const shot = html.indexOf('id="recordFailureShot"');
  const fix = html.indexOf('id="recordFailureFix"');
  assert.ok(stage > 0 && panel > stage && shot > panel && fix > panel);
  const stream = readFileSync(new URL('./agentStream.js', import.meta.url), 'utf8');
  assert.match(stream, /class="as-shot"/);
  assert.match(stream, /error\.png/);
});

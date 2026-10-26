import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test } from 'vitest';

import { capturedTour, recordFailureAction, recordFailureNote, recordFailureView } from './recordFailure';

test('a failed record shows the reason, the URL, and the screenshot', () => {
  const view = recordFailureView({
    shotMtime: 20,
    liveMtime: null,
    note: 'page.goto: Timeout 30000ms exceeded.\nnavigating to "http://localhost:3000/app", waiting until "domcontentloaded"',
    screenshot: '/media/demo/error.png',
  })!;
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

test('a networkidle timeout on a marketing URL does not leave junk on the parsed URL', () => {
  const note =
    'page.goto: Timeout 15000ms exceeded.\nCall log:\n  - navigating to "https://teamdeck.io/", waiting until "networkidle"\n';
  const view = recordFailureView({ shotMtime: 1, liveMtime: null, note });
  assert.equal(view?.url, 'https://teamdeck.io/');
});

test('a refused connection names what failed and what to try next', () => {
  const view = recordFailureView({
    shotMtime: 5,
    note: 'net::ERR_CONNECTION_REFUSED at http://127.0.0.1:3000/',
    screenshot: '/media/demo/error.png',
  })!;
  assert.match(view.reason, /could not open/);
  assert.doesNotMatch(view.reason, /ERR_CONNECTION_REFUSED/);
  assert.match(view.next, /Start the app/);
});

test('a playwright line stays off the headline', () => {
  const view = recordFailureView({
    shotMtime: 9,
    note: 'locator.waitFor: Target page, context or browser has been closed',
  })!;
  assert.match(view.reason, /stopped before the walkthrough finished/);
  assert.match(view.technical, /browser has been closed/);
});

test('a good live take hides the failure banner, even if a later retry left a newer error.png', () => {
  assert.equal(recordFailureView({ shotMtime: 20, liveMtime: 30, note: 'failed' }), null);
  assert.equal(recordFailureView({ shotMtime: 40, liveMtime: 20, note: 'failed' }), null);
  assert.ok(recordFailureView({ shotMtime: 20, liveMtime: null, note: 'page.goto: Timeout 30000ms exceeded.\nnavigating to "http://localhost:3000"' }));
  assert.equal(capturedTour({ hasLive: false, recordFailed: true }), false);
  assert.equal(capturedTour({ hasLive: true, recordFailed: false }), true);
  assert.equal(recordFailureAction().label, 'Re-record');
});

test('a disabled Approve click is not reported as a start-URL timeout', () => {
  const view = recordFailureView({
    shotMtime: 5,
    note: 'proxy.click: Timeout 30000ms exceeded.\nwaiting for locator(\'button#btnScriptApprove\')\nelement is not enabled',
  })!;
  assert.match(view.reason, /already approved/i);
  assert.doesNotMatch(view.reason, /start URL/i);
});

test('the failure panel sits on Program with Fix with AI and a dismiss control', () => {
  const monitor = readFileSync(join(import.meta.dirname, '../features/monitor/Monitor.tsx'), 'utf8');
  const stage = monitor.indexOf('id="stage"');
  const overlays = monitor.indexOf('<StageOverlays />');
  assert.ok(stage > 0 && overlays > stage, 'the failure overlay is inside the stage');
  const panel = readFileSync(join(import.meta.dirname, '../features/monitor/StageOverlays.tsx'), 'utf8');
  const panelAt = panel.indexOf('id="recordFailure"');
  assert.ok(panelAt > 0 && panel.indexOf('id="recordFailureShot"') > panelAt);
  assert.ok(panel.indexOf('id="recordFailureFix"') > panelAt);
  assert.ok(panel.indexOf('id="recordFailureDismiss"') > panelAt, 'dismiss control sits on the failure panel');
  assert.match(panel, /Recording failed/);
  const stream = readFileSync(join(import.meta.dirname, '../features/project-panel/agentStream.ts'), 'utf8');
  assert.match(stream, /class="as-shot"/);
  assert.match(stream, /error\.png/);
});

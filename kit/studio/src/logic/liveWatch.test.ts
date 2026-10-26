import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test } from 'vitest';

import { activityThumbVisible, programPreview } from './liveWatch';
import { liveTabVisible } from './monitorMode';

test('during record, Program shows the page and not an empty stage', () => {
  const view = programPreview({
    recording: true,
    previewUrl: '/media/demo/live-preview.jpg',
    hasLive: false,
    hasDelivery: false,
  });
  assert.equal(view.show, true);
  assert.equal(view.badge, 'Live');
  assert.equal(view.empty, false);
  assert.match(view.url!, /live-preview\.jpg/);
  assert.equal(liveTabVisible({ recording: true }), true);
});

test('a record that stops keeps the last frame URL but hides the Live tab', () => {
  const during = programPreview({
    recording: true,
    previewUrl: '/media/demo/live-preview.jpg',
    hasLive: false,
  });
  const after = programPreview({
    recording: false,
    previewUrl: '/media/demo/live-preview.jpg',
    hasLive: false,
  });
  assert.equal(after.show, true);
  assert.equal(after.badge, 'Last frame');
  assert.equal(after.url, during.url);
  assert.equal(after.empty, false);
  assert.equal(liveTabVisible({ recording: false }), false);
});

test('a finished master keeps a last-frame URL without offering the Live tab', () => {
  const view = programPreview({
    recording: false,
    previewUrl: '/media/demo/live-preview.jpg',
    hasLive: true,
    hasDelivery: true,
  });
  assert.equal(view.show, true);
  assert.equal(view.badge, 'Last frame');
  assert.match(view.url!, /live-preview\.jpg/);
  assert.equal(liveTabVisible({ recording: false, repairing: false }), false);
});

test('repair keeps the last frame visible and labels it as repairing', () => {
  const view = programPreview({
    repairing: true,
    previewUrl: '/media/demo/live-preview.jpg',
    hasLive: false,
  });
  assert.equal(view.show, true);
  assert.equal(view.badge, 'Repairing');
  assert.equal(liveTabVisible({ repairing: true }), true);
});

test('the live frame element is on the stage and the Live tab has an on-air dot', () => {
  const monitor = readFileSync(join(import.meta.dirname, '../features/monitor/Monitor.tsx'), 'utf8');
  const stage = monitor.indexOf('id="stage"');
  const overlays = monitor.indexOf('<StageOverlays />');
  assert.ok(stage > 0 && overlays > stage);
  const frame = readFileSync(join(import.meta.dirname, '../features/monitor/StageOverlays.tsx'), 'utf8');
  assert.match(frame, /id="livePreview"/);
  assert.match(frame, /id="liveBadge"/);
  const head = readFileSync(join(import.meta.dirname, '../features/monitor/MonitorHead.tsx'), 'utf8');
  assert.match(head, /id="modeLive"[\s\S]*?live-dot/);
});

test('Activity bay thumb is only on during capture or repair', () => {
  assert.equal(activityThumbVisible({ recording: true }), true);
  assert.equal(activityThumbVisible({ repairing: true }), true);
  assert.equal(activityThumbVisible({ recording: false, repairing: false }), false);
  assert.equal(activityThumbVisible({}), false);
});

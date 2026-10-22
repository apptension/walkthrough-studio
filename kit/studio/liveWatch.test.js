import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { programPreview } from './liveWatch.js';

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
  assert.match(view.url, /live-preview\.jpg/);
});

test('a record that stops on a login page keeps that frame', () => {
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
});

test('a finished master still offers the last frame on the Live tab', () => {
  const view = programPreview({
    recording: false,
    previewUrl: '/media/demo/live-preview.jpg',
    hasLive: true,
    hasDelivery: true,
  });
  assert.equal(view.show, true);
  assert.equal(view.badge, 'Last frame');
  assert.match(view.url, /live-preview\.jpg/);
});

test('repair keeps the last frame visible and labels it as repairing', () => {
  const view = programPreview({
    repairing: true,
    previewUrl: '/media/demo/live-preview.jpg',
    hasLive: false,
  });
  assert.equal(view.show, true);
  assert.equal(view.badge, 'Repairing');
});

test('the live frame element is on Program', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const stage = html.indexOf('id="stage"');
  const frame = html.indexOf('id="livePreview"');
  assert.ok(stage > 0 && frame > stage);
});

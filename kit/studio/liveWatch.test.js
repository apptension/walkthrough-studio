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
  assert.equal(after.url, during.url);
  assert.equal(after.empty, false);
});

test('the live frame element is on Program', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const stage = html.indexOf('id="stage"');
  const frame = html.indexOf('id="livePreview"');
  assert.ok(stage > 0 && frame > stage);
});

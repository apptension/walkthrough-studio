import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeliverySrc, needsProgramRestore, normalizeMonitorMode } from './monitorMode.js';

test('normalizeMonitorMode: html/editor → plate, junk → program', () => {
  assert.equal(normalizeMonitorMode('html'), 'plate');
  assert.equal(normalizeMonitorMode('editor'), 'plate');
  assert.equal(normalizeMonitorMode('plate'), 'plate');
  assert.equal(normalizeMonitorMode('compare'), 'compare');
  assert.equal(normalizeMonitorMode('program'), 'program');
  assert.equal(normalizeMonitorMode('nope'), 'program');
  assert.equal(normalizeMonitorMode(undefined), 'program');
});

test('isDeliverySrc: ignores cache busters and absolute origins', () => {
  const url = '/media/demo/demo.mp4';
  assert.equal(isDeliverySrc('/media/demo/demo.mp4?t=1', url), true);
  assert.equal(isDeliverySrc('http://127.0.0.1:4747/media/demo/demo.mp4?t=9', url), true);
  assert.equal(isDeliverySrc('/media/demo/plate-open.mp4?t=1', url), false);
  assert.equal(isDeliverySrc('', url), false);
});

test('needsProgramRestore: plate preview and wrong src reload the master', () => {
  const deliveryUrl = '/media/demo/demo.mp4';
  assert.equal(
    needsProgramRestore({
      monitorMode: 'program',
      previewingPlate: '/media/demo/plate-open.mp4',
      playerSrc: '/media/demo/plate-open.mp4',
      deliveryUrl,
    }),
    true
  );
  assert.equal(
    needsProgramRestore({
      monitorMode: 'program',
      playerSrc: '/media/demo/demo.mp4?t=1',
      deliveryUrl,
    }),
    false
  );
  assert.equal(
    needsProgramRestore({
      monitorMode: 'plate',
      playerSrc: '',
      deliveryUrl,
      force: true,
    }),
    false,
    'never restore while the Editor pane is up'
  );
  assert.equal(
    needsProgramRestore({
      monitorMode: 'html',
      playerSrc: '/media/demo/plate-open.mp4',
      deliveryUrl,
    }),
    false,
    'legacy html normalizes to plate — not program'
  );
});

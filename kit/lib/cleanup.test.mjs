import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyCleanup, formatBytes, planCleanup } from './cleanup.mjs';

test('formatBytes uses readable units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});

test('a stale premaster wav is the only file removed', () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-clean-'));
  writeFileSync(join(root, 'demo.mp4'), 'master');
  writeFileSync(join(root, 'live.mp4'), 'live');
  writeFileSync(join(root, 'audio-premaster.wav'), 'wav-bytes');
  writeFileSync(join(root, 'video.config.json'), '{}');
  writeFileSync(join(root, 'flow.mjs'), 'export {}');
  writeFileSync(join(root, 'narration.mjs'), 'export default {}');
  mkdirSync(join(root, 'versions', 'v1'), { recursive: true });
  writeFileSync(join(root, 'versions', 'v1', 'demo.mp4'), 'old');

  const plan = planCleanup(root, { slug: 'demo' });
  assert.deepEqual(plan.files.map((file) => file.name), ['audio-premaster.wav']);
  assert.equal(plan.files[0].bytes, Buffer.byteLength('wav-bytes'));
  assert.equal(plan.totalLabel, formatBytes(plan.totalBytes));
  applyCleanup(plan);

  assert.equal(existsSync(join(root, 'audio-premaster.wav')), false);
  assert.equal(existsSync(join(root, 'demo.mp4')), true);
  assert.equal(existsSync(join(root, 'live.mp4')), true);
  assert.equal(existsSync(join(root, 'video.config.json')), true);
  assert.equal(existsSync(join(root, 'flow.mjs')), true);
  assert.equal(existsSync(join(root, 'narration.mjs')), true);
  assert.equal(existsSync(join(root, 'versions', 'v1', 'demo.mp4')), true);
});

test('version folders are never part of intermediate cleanup', () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-clean-'));
  mkdirSync(join(root, 'versions', 'v1'), { recursive: true });
  mkdirSync(join(root, 'slices'), { recursive: true });
  writeFileSync(join(root, 'versions', 'v1', 'demo.mp4'), 'one');
  writeFileSync(join(root, 'slices', 'a.mp4'), 'slice');
  writeFileSync(join(root, 'demo.mp4'), 'master');
  const plan = planCleanup(root, { slug: 'demo', selectedVersions: ['v1'] });
  assert.deepEqual(plan.files.map((file) => file.name), ['slices/a.mp4']);
  assert.equal(existsSync(join(root, 'versions', 'v1', 'demo.mp4')), true);
});

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyCleanup, formatBytes, isRegenerableRel, planCleanup } from './cleanup.mjs';

test('formatBytes uses readable units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});

test('keeps master, live take, sources and versions; drops bake and plate mp4s', () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-clean-'));
  writeFileSync(join(root, 'demo.mp4'), 'master');
  writeFileSync(join(root, 'live.mp4'), 'live');
  writeFileSync(join(root, 'timeline.json'), '[]');
  writeFileSync(join(root, 'live-meta.json'), '{}');
  writeFileSync(join(root, 'audio-premaster.wav'), 'wav-bytes');
  writeFileSync(join(root, 'live-clean.mp4'), 'clean');
  writeFileSync(join(root, 'demo.silent.mp4'), 'silent');
  writeFileSync(join(root, 'brand-open.mp4'), 'plate');
  writeFileSync(join(root, 'plate-capabilities.mp4'), 'plate');
  mkdirSync(join(root, 'overlays', 'bake'), { recursive: true });
  writeFileSync(join(root, 'overlays', 'bake', 'x.mov'), 'huge');
  mkdirSync(join(root, 'plates'), { recursive: true });
  writeFileSync(join(root, 'plates', 'open.html'), '<html>');
  mkdirSync(join(root, 'versions', 'v1'), { recursive: true });
  writeFileSync(join(root, 'versions', 'v1', 'demo.mp4'), 'old');
  writeFileSync(join(root, 'video.config.json'), '{}');

  assert.equal(isRegenerableRel('overlays/bake/x.mov', { slug: 'demo' }), true);
  assert.equal(isRegenerableRel('live.mp4', { slug: 'demo' }), false);
  assert.equal(isRegenerableRel('versions/v1/demo.mp4', { slug: 'demo' }), false);

  const plan = planCleanup(root, { slug: 'demo' });
  const names = plan.files.map((file) => file.name).sort();
  assert.ok(names.includes('audio-premaster.wav'));
  assert.ok(names.includes('live-clean.mp4'));
  assert.ok(names.includes('demo.silent.mp4'));
  assert.ok(names.includes('brand-open.mp4'));
  assert.ok(names.includes('plate-capabilities.mp4'));
  assert.ok(names.includes('overlays/bake/x.mov'));
  assert.ok(names.includes('plates/open.html'));
  assert.ok(!names.includes('demo.mp4'));
  assert.ok(!names.includes('live.mp4'));
  assert.ok(!names.some((n) => n.startsWith('versions/')));

  const auto = planCleanup(root, { slug: 'demo', keepPipeline: true }).files.map((file) => file.name);
  for (const kept of ['brand-open.mp4', 'plate-capabilities.mp4', 'plates/open.html', 'demo.silent.mp4', 'live-clean.mp4', 'overlays/bake/x.mov']) {
    assert.ok(!auto.includes(kept), `post-produce cleanup must keep ${kept}`);
  }

  applyCleanup(plan);
  assert.equal(existsSync(join(root, 'audio-premaster.wav')), false);
  assert.equal(existsSync(join(root, 'overlays', 'bake', 'x.mov')), false);
  assert.equal(existsSync(join(root, 'demo.mp4')), true);
  assert.equal(existsSync(join(root, 'live.mp4')), true);
  assert.equal(existsSync(join(root, 'versions', 'v1', 'demo.mp4')), true);
});

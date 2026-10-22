import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { listVersions, snapshotVersion } from './versions.mjs';

test('version snapshots keep the master and sources, not plate/silent/deliverable copies', () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-ver-'));
  const dir = join(root, 'project');
  const out = join(root, 'out');
  mkdirSync(dir, { recursive: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(dir, 'video.config.json'), JSON.stringify({ brand: 'demo', title: 'Demo' }));
  writeFileSync(join(dir, 'flow.mjs'), 'export default async () => {}');
  writeFileSync(join(dir, 'narration.mjs'), 'export default {}');
  writeFileSync(join(out, 'demo.mp4'), 'master-bytes');
  writeFileSync(join(out, 'demo.silent.mp4'), 'silent');
  writeFileSync(join(out, 'brand-open.mp4'), 'plate');
  writeFileSync(join(out, 'produce-meta.json'), JSON.stringify({ durationSec: 12, sizeMB: 1 }));
  mkdirSync(join(out, 'deliverables'), { recursive: true });
  writeFileSync(join(out, 'deliverables', 'x.mp4'), 'deliver');

  const video = {
    slug: 'demo',
    dir,
    out,
    config: { brand: 'demo' },
    brand: { dir: join(root, 'brand'), motion: { energy: 'clear' } },
  };
  mkdirSync(video.brand.dir, { recursive: true });
  writeFileSync(join(video.brand.dir, 'brand.json'), JSON.stringify({ name: 'Demo', motion: {} }));

  const entry = snapshotVersion(video, { trigger: 'produce', title: 'Picture lock' });
  assert.ok(entry.id);
  const snapOut = join(out, 'versions', entry.id, 'out');
  assert.equal(existsSync(join(snapOut, 'demo.mp4')), true);
  assert.equal(existsSync(join(snapOut, 'produce-meta.json')), true);
  assert.equal(existsSync(join(snapOut, 'demo.silent.mp4')), false);
  assert.equal(existsSync(join(snapOut, 'brand-open.mp4')), false);
  assert.equal(existsSync(join(snapOut, 'deliverables')), false);
  assert.equal(existsSync(join(out, 'versions', entry.id, 'source', 'flow.mjs')), true);
  assert.equal(listVersions(video).length, 1);
  assert.equal(JSON.parse(readFileSync(join(out, 'versions', 'index.json'), 'utf8')).versions[0].name, 'v1');
});

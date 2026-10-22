import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { deleteVersions, listVersions, planDeleteVersions } from './versions.mjs';

function fakeVideo(root, slug = 'demo') {
  const out = join(root, 'out');
  mkdirSync(out, { recursive: true });
  mkdirSync(join(root, 'brand'), { recursive: true });
  return {
    slug,
    dir: root,
    out,
    brand: { dir: join(root, 'brand') },
    config: {},
  };
}

function seedVersion(video, id, { name = id, title = 'Shot', kind = 'release', body = 'mp4' } = {}) {
  const dir = join(video.out, 'versions', id);
  mkdirSync(join(dir, 'out'), { recursive: true });
  writeFileSync(join(dir, 'out', `${video.slug}.mp4`), body);
  const indexPath = join(video.out, 'versions', 'index.json');
  const index = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, 'utf8'))
    : { slug: video.slug, nextNumber: 1, versions: [] };
  index.versions = [
    { id, name, title, kind, createdAt: new Date().toISOString(), number: index.nextNumber },
    ...index.versions.filter((v) => v.id !== id),
  ];
  index.nextNumber = (index.nextNumber || 1) + 1;
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

test('planDeleteVersions totals folder bytes and skips unknown ids', () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-ver-'));
  const video = fakeVideo(root);
  seedVersion(video, 'a', { name: 'v1', body: 'one' });
  seedVersion(video, 'b', { name: 'v2', body: 'two!' });

  const plan = planDeleteVersions(video, ['a', 'missing', 'a']);
  assert.equal(plan.versions.length, 1);
  assert.equal(plan.versions[0].id, 'a');
  assert.equal(plan.versions[0].bytes, 3);
  assert.deepEqual(plan.missing, ['missing']);
  assert.equal(plan.totalBytes, 3);
});

test('deleteVersions removes folders and index entries; others stay', () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-ver-'));
  const video = fakeVideo(root);
  seedVersion(video, 'keep', { name: 'v1', body: 'keep-me' });
  seedVersion(video, 'drop', { name: 'v2', body: 'gone' });

  const done = deleteVersions(video, ['drop']);
  assert.equal(done.versions.length, 1);
  assert.equal(existsSync(join(video.out, 'versions', 'drop')), false);
  assert.equal(existsSync(join(video.out, 'versions', 'keep', 'out', 'demo.mp4')), true);
  const left = listVersions(video);
  assert.equal(left.length, 1);
  assert.equal(left[0].id, 'keep');
});

test('deleteVersions with empty selection is a no-op', () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-ver-'));
  const video = fakeVideo(root);
  seedVersion(video, 'only', { name: 'v1' });
  const done = deleteVersions(video, []);
  assert.equal(done.versions.length, 0);
  assert.equal(listVersions(video).length, 1);
});

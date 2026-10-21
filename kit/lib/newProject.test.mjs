import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'walkthrough-project-'));
process.env.WALKTHROUGH_BRANDS = join(root, 'brands');
process.env.WALKTHROUGH_VIDEOS = join(root, 'videos');
process.env.WALKTHROUGH_OUT = join(root, 'out');

const { createProject } = await import('./newProject.mjs');
const { brandReadiness, loadVideo } = await import('./project.mjs');
const { buildPlates } = await import('./plates.mjs');

test.after(() => rmSync(root, { recursive: true, force: true }));

test('new projects use an unrenderable neutral brand until discovery completes', () => {
  const result = createProject({
    title: 'Acme overview',
    audience: 'New customers',
    brand: { mode: 'new', name: 'Acme', url: 'https://example.com' },
    app: { startUrl: 'https://example.com' },
    story: { mustShow: ['Overview'] },
  });

  assert.equal(result.needsDiscovery, true);
  const brand = JSON.parse(readFileSync(join(root, 'brands', 'acme', 'brand.json'), 'utf8'));
  assert.equal(brand.placeholder, true);
  assert.equal(brand.discovery.status, 'pending');
  assert.equal(brand.colors.gold, '#94a3b8');
  assert.equal(brandReadiness('acme').ready, false);
  assert.throws(() => buildPlates(loadVideo(result.slug)), /Brand pack "acme" is not ready/);
});

test('placeholder packs cannot be selected as an existing brand', () => {
  assert.throws(
    () =>
      createProject({
        title: 'Second overview',
        audience: 'New customers',
        brand: { mode: 'existing', id: 'acme' },
        app: { startUrl: 'https://example.com' },
        story: { mustShow: ['Overview'] },
      }),
    /not ready/
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'walkthrough-project-'));
process.env.WALKTHROUGH_BRANDS = join(root, 'brands');
process.env.WALKTHROUGH_VIDEOS = join(root, 'videos');
process.env.WALKTHROUGH_OUT = join(root, 'out');

const { createProject, draftNote } = await import('./newProject.mjs');
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

test('a new brand with no marketing site is discovered from the app start URL', () => {
  const result = createProject({
    title: 'Local app tour',
    audience: 'Developers',
    brand: { mode: 'new', name: 'Local App' },
    app: { startUrl: 'http://localhost:4747/desk' },
    story: { mustShow: ['Desk'] },
  });
  assert.equal(result.needsDiscovery, true);
  const brief = JSON.parse(readFileSync(join(root, 'videos', result.slug, 'brief.json'), 'utf8'));
  assert.equal(brief.brand.url, 'http://localhost:4747/desk');
  assert.equal(brief.brand.appUrl, 'http://localhost:4747/desk');
  const brand = JSON.parse(readFileSync(join(root, 'brands', 'local-app', 'brand.json'), 'utf8'));
  assert.equal(brand.sources.marketing, 'http://localhost:4747/desk');
  assert.equal(brand.sources.app, 'http://localhost:4747/desk');
});

test('video language is stored, and the brief wins when the config copy disagrees', () => {
  const result = createProject({
    title: 'Polish tour',
    language: 'pl',
    audience: 'Admins',
    brand: { mode: 'new', name: 'Polski', url: 'https://example.com' },
    app: { startUrl: 'https://example.com' },
    story: { mustShow: ['Home'] },
  });
  const dir = join(root, 'videos', result.slug);
  const brief = JSON.parse(readFileSync(join(dir, 'brief.json'), 'utf8'));
  const cfg = JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8'));
  assert.equal(brief.language, 'pl');
  assert.equal(cfg.language, 'pl');
  assert.match(draftNote(brief), /Video language: Polish \(pl\)/);
  assert.match(draftNote(brief), /in Polish/);
  cfg.language = 'en';
  writeFileSync(join(dir, 'video.config.json'), JSON.stringify(cfg));
  assert.equal(loadVideo(result.slug).config.language, 'pl');
});

test('a missing video language is English and an unknown code is rejected', () => {
  const result = createProject({
    title: 'English tour',
    audience: 'Admins',
    brand: { mode: 'new', name: 'Angielski', url: 'https://example.com' },
    app: { startUrl: 'https://example.com' },
    story: { mustShow: ['Home'] },
  });
  const brief = JSON.parse(readFileSync(join(root, 'videos', result.slug, 'brief.json'), 'utf8'));
  assert.equal(brief.language, 'en');
  assert.equal(loadVideo(result.slug).config.language, 'en');
  assert.throws(
    () =>
      createProject({
        title: 'Unknown language',
        language: 'xx',
        brand: { mode: 'new', name: 'Nope', url: 'https://example.com' },
        app: { startUrl: 'https://example.com' },
        story: { mustShow: ['Home'] },
      }),
    /Eleven v4/,
  );
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

test('the wizard recording size and video shape land in the config and brief', async () => {
  const { captureProfile } = await import('./capturePresets.mjs');
  const { outputFrame } = await import('./format.mjs');
  const result = createProject({
    title: 'Phone tour',
    audience: 'Field staff',
    brand: { mode: 'new', name: 'Phoney', url: 'https://example.com' },
    app: { startUrl: 'https://example.com' },
    capture: { mode: 'agent', size: { preset: 'iphone-15' } },
    output: { format: 'portrait' },
    story: { mustShow: ['Home'] },
  });
  const cfg = JSON.parse(readFileSync(join(root, 'videos', result.slug, 'video.config.json'), 'utf8'));
  assert.equal(captureProfile(cfg).id, 'iphone-15');
  assert.equal(captureProfile(cfg).mobile, true);
  assert.equal(outputFrame(cfg).format, 'portrait');
  assert.equal(cfg.record.startUrl, 'https://example.com');
  const brief = JSON.parse(readFileSync(join(root, 'videos', result.slug, 'brief.json'), 'utf8'));
  assert.equal(brief.capture.size, 'iphone-15');
});

test('a bad recording size is refused before any project files are written', async () => {
  const { existsSync } = await import('node:fs');
  assert.throws(
    () =>
      createProject({
        title: 'Odd size',
        brand: { mode: 'new', name: 'Odd', url: 'https://example.com' },
        app: { startUrl: 'https://example.com' },
        capture: { size: { preset: 'custom', width: 1001, height: 700 } },
        story: { mustShow: ['Home'] },
      }),
    /even/,
  );
  assert.equal(existsSync(join(root, 'videos', 'odd-size')), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'walkthrough-plates-'));
process.env.WALKTHROUGH_BRANDS = join(root, 'brands');
process.env.WALKTHROUGH_VIDEOS = join(root, 'videos');
process.env.WALKTHROUGH_OUT = join(root, 'out');

const { loadVideo } = await import('./project.mjs');
const { INTERSTITIAL_TYPES, buildPlates, compareType, logoColumns, platePaths } = await import('./plates.mjs');

// A ready brand pack: palette, font, lockup and three logo assets.
const brandDir = join(root, 'brands', 'acme');
mkdirSync(join(brandDir, 'assets'), { recursive: true });
writeFileSync(
  join(brandDir, 'brand.json'),
  JSON.stringify({
    name: 'Acme',
    colors: { ink: '#0a1f0a', surface: '#0f2a0f', gold: '#0ca300', amber: '#7ac943', teal: '#2dd4bf' },
    font: { family: 'Inter', css: 'body{font-family:Inter}' },
    motion: { energy: 'clear', atmosphere: 'aurora', titleReveal: 'cascade', depth: 'deep' },
  })
);
writeFileSync(join(brandDir, 'logo.html'), '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
for (const f of ['a.png', 'b.png', 'c.png']) writeFileSync(join(brandDir, 'assets', f), png);

const videoDir = join(root, 'videos', 'probe');
mkdirSync(videoDir, { recursive: true });
const config = {
  title: 'Probe',
  brand: 'acme',
  open: { eyebrow: 'Eyebrow', title: ['Team planning', '*enhanced*'], sub: 'Sub' },
  close: { title: ['Done.'], steps: [{ label: 'A' }, { label: 'B' }] },
  interstitials: [
    {
      id: 'shift',
      type: 'compare',
      before: 'x',
      title: 'From *scattered* to settled',
      motion: { atmosphere: 'grid', titleReveal: 'wipe' },
      left: { items: ['One', 'Two'] },
      right: { label: 'After', items: ['Three', 'Four', 'Five'] },
    },
    { id: 'hero', type: 'quote', before: 'x', quote: 'A quote *long enough* to pass validation.', author: 'Ana Ruiz', role: 'COO', stars: 4 },
    { id: 'number', type: 'metric', before: 'x', title: 'Saved', value: '$10,000', unit: 'per *month*', pills: ['One', '*Two*'] },
    { id: 'ring', type: 'orbit', before: 'x', title: 'Works with', logos: [{ asset: 'a.png', label: 'A' }, { asset: 'b.png' }, { asset: 'c.png', label: 'C' }] },
    { id: 'proof', type: 'stats', before: 'x', title: 'Proof', stats: [{ value: '4.7', label: 'G2' }, { value: '—', label: 'None', count: false }] },
  ],
};
writeFileSync(join(videoDir, 'video.config.json'), JSON.stringify(config));

test.after(() => rmSync(root, { recursive: true, force: true }));

const html = (id) => readFileSync(platePaths(loadVideo('probe')).interstitial[id].html, 'utf8');

test('all plate types build; new types fill every placeholder', () => {
  assert.deepEqual(
    [...INTERSTITIAL_TYPES],
    ['features', 'stats', 'callout', 'testimonials', 'logos', 'journey', 'compare', 'quote', 'metric', 'orbit']
  );
  buildPlates(loadVideo('probe'));
  for (const id of ['shift', 'hero', 'number', 'ring', 'proof']) {
    assert.doesNotMatch(html(id), /\{\{[A-Z_]+\}\}/, `${id} has no unfilled placeholders`);
  }
});

test('per-plate motion overrides reach the atmosphere and title reveal', () => {
  const shift = html('shift');
  assert.match(shift, /data-field="grid"/, 'plate override beats the brand atmosphere');
  assert.match(shift, /data-reveal="wipe"/);
  assert.match(shift, /class="cmp-col before"/);
  assert.equal((shift.match(/class="item"/g) || []).length, 5);
  assert.match(shift, /pathLength="1"/, 'marks draw along the path');

  const paths = platePaths(loadVideo('probe'));
  const open = readFileSync(paths.open.html, 'utf8');
  assert.match(open, /data-field="aurora"/, 'brand atmosphere applies when a plate has no override');
  assert.match(open, /class="title-cascade"/, 'brand title reveal applies to the open plate');
  assert.match(open, /<span class="cw"><span class="char accent" style="--c: \d+">e<\/span>/, 'emphasis survives per character');
  assert.match(open, /--card-tilt: 17deg/, 'deep depth token');
});

test('quote, metric and orbit builders shape their content', () => {
  const hero = html('hero');
  assert.equal((hero.match(/class="star"/g) || []).length, 4);
  assert.match(hero, /class="avatar"[^>]*>AR</, 'initials when no logo is given');
  assert.match(hero, /class="qw"/);
  assert.match(
    hero,
    /<span class="qw"[^>]*><span class="accent">long<\/span><\/span><span class="qw"[^>]*><span class="accent">enough<\/span><\/span>/,
    'a quote accent spanning words paints each word, keeping the per-word stagger'
  );
  assert.match(hero, /data-edit-raw="A quote \*long enough\* to pass validation\."/, 'the raw source keeps the markers for the editor');

  const number = html('number');
  assert.match(number, /data-count data-count-start="0.9"/);
  assert.match(number, /data-edit="unit"[^>]*>per <span class="accent">month<\/span></, 'every editable field renders *accents*');
  assert.match(number, /data-edit="pills\.1"[^>]*><span class="accent">Two<\/span></);
  assert.match(number, /--progress: 0\.760/, 'default ring progress');
  assert.equal((number.match(/class="pill"/g) || []).length, 2);
  assert.equal((number.match(/class="tick"/g) || []).length, 60);

  const ring = html('ring');
  assert.equal((ring.match(/class="o-seat near"/g) || []).length, 3);
  assert.equal((ring.match(/class="o-seat far"/g) || []).length, 0);
  assert.equal((ring.match(/data-edit="logos\.\d\.label"/g) || []).length, 2, 'legend lists only labelled logos');

  const proof = html('proof');
  assert.match(proof, /class="value" data-fit="1"[^>]* data-count data-count-start="1\.00" data-count-dur="1\.3"/);
  assert.match(proof, /<div class="value" data-fit="1" data-fit-min="48" data-fit-group="stat-value" data-edit="items\.1\.value"/, 'count: false opts a stat out');
});

test('new builders validate their inputs', () => {
  const bad = (plate) => {
    writeFileSync(join(videoDir, 'video.config.json'), JSON.stringify({ ...config, interstitials: [plate] }));
    return () => buildPlates(loadVideo('probe'));
  };
  assert.throws(bad({ id: 'c', type: 'compare', before: 'x', left: { items: ['One'] }, right: { items: ['A', 'B'] } }), /2–5 items/);
  assert.throws(bad({ id: 'q', type: 'quote', before: 'x', quote: 'Short', author: 'A' }), /12–260/);
  assert.throws(bad({ id: 'm', type: 'metric', before: 'x', title: 'T' }), /needs a value/);
  assert.throws(bad({ id: 'o', type: 'orbit', before: 'x', logos: [{ asset: 'a.png' }] }), /3–8 logos/);
  assert.throws(bad({ id: 'z', type: 'hologram', before: 'x' }), /Unknown interstitial type "hologram" \(use features\|/);
  writeFileSync(join(videoDir, 'video.config.json'), JSON.stringify(config));
});

test('logo walls balance rows: one row up to 5, never a lone last tile', () => {
  assert.deepEqual([3, 4, 5, 6, 7, 8, 9, 10].map(logoColumns), [3, 4, 5, 3, 4, 4, 5, 5]);
});

test('compare type steps down with item count and line length', () => {
  assert.deepEqual(compareType(['Manual', 'Slow'], ['Live', 'Fast']), { ITEM_SIZE: 30, COL_TITLE_SIZE: 38 });
  const long = 'x'.repeat(95);
  assert.deepEqual(compareType([long, 'a', 'b', 'c', 'd'], ['a', 'b']), { ITEM_SIZE: 20, COL_TITLE_SIZE: 34 });
  assert.equal(compareType([{ label: 'y'.repeat(70) }, 'a', 'b'], ['a', 'b']).ITEM_SIZE, 24);
});

test('built plates carry the fit runtime and line budgets', () => {
  const video = loadVideo('probe');
  const paths = buildPlates(video);
  const open = readFileSync(paths.open.html, 'utf8');
  assert.match(open, /window\.__fitType/);
  assert.match(open, /<h1 class="title" data-fit="\d"/);
  assert.match(readFileSync(paths.close.html, 'utf8'), /<h2 class="title" data-fit="\d"/);
});

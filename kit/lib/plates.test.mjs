import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PLATE_CATALOG } from './plateTypes.mjs';

const root = mkdtempSync(join(tmpdir(), 'walkthrough-plates-'));
process.env.WALKTHROUGH_BRANDS = join(root, 'brands');
process.env.WALKTHROUGH_VIDEOS = join(root, 'videos');
process.env.WALKTHROUGH_OUT = join(root, 'out');

const { TEMPLATES, loadVideo } = await import('./project.mjs');
const { INTERSTITIAL_TYPES, buildPlates, compareType, logoColumns, platePaths, pricingFeatured } = await import('./plates.mjs');

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
    { id: 'point', type: 'statement', before: 'x', title: ['One plan the team', '*actually* follows.'], sub: 'Supporting line' },
    { id: 'how', type: 'process', before: 'x', title: 'How it works', sub: 'Three moves', steps: [{ label: 'Connect', note: 'Link tools' }, { label: 'Set up' }, { label: 'Run' }] },
    { id: 'road', type: 'timeline', before: 'x', title: 'Built in the open', steps: [{ label: 'Launch', date: 'Q1' }, { label: 'Reports', date: 'Q2', note: 'n' }, { label: 'Now', date: 'Today' }] },
    { id: 'done', type: 'checklist', before: 'x', title: 'Done', items: [{ label: 'One plan' }, 'Changes land', { label: 'Leaders get it', note: 'no asking' }] },
    { id: 'board', type: 'kpi', before: 'x', title: 'Board', stats: [{ value: '94%', label: 'Util', delta: '+12%' }, { value: '3', label: 'Late', delta: '−2' }, { value: '120', label: 'Hours' }, { value: '8', label: 'Teams', count: false }] },
    { id: 'plans', type: 'pricing', before: 'x', title: 'Plans', tiers: [{ label: 'Starter', value: '$0', items: ['Core'] }, { label: 'Team', value: '$12', period: 'per user', badge: 'Popular', items: ['A', '*B*'] }, { label: 'Business', value: 'Custom' }] },
    { id: 'ask', type: 'faq', before: 'x', title: 'Before you ask', items: [{ label: 'Does it import?', note: 'Yes.' }, { label: 'How long?', note: 'An afternoon.' }] },
    { id: 'people', type: 'team', before: 'x', title: 'Who it is for', items: [{ label: 'Ana Ruiz', note: 'Lead' }, { label: 'Ops', asset: 'a.png' }, { label: 'Leadership' }] },
    { id: 'show', type: 'showcase', before: 'x', title: 'See the *board*', shot: 'a.png', focus: 'right', caption: 'The planning board', callouts: [{ label: 'Capacity', x: 30, y: 34 }, { label: 'Rebalance', x: 70, y: 62 }] },
    { id: 'glance', type: 'bento', before: 'x', title: 'At a glance', value: '94%', label: 'on plan', quote: 'We stopped double-booking.', author: 'Ana', logos: [{ asset: 'a.png', label: 'A' }, { label: 'Soon' }] },
  ],
};
writeFileSync(join(videoDir, 'video.config.json'), JSON.stringify(config));

test.after(() => rmSync(root, { recursive: true, force: true }));

const html = (id) => readFileSync(platePaths(loadVideo('probe')).interstitial[id].html, 'utf8');

test('all plate types build; new types fill every placeholder', () => {
  assert.deepEqual(
    [...INTERSTITIAL_TYPES],
    ['features', 'journey', 'process', 'timeline', 'checklist', 'logos', 'orbit', 'testimonials', 'quote', 'stats', 'kpi', 'metric', 'callout', 'statement', 'compare', 'faq', 'pricing', 'team', 'showcase', 'bento']
  );
  assert.deepEqual([...INTERSTITIAL_TYPES], PLATE_CATALOG.map((p) => p.type), 'builder and Studio catalog agree');
  for (const type of INTERSTITIAL_TYPES) {
    assert.ok(existsSync(join(TEMPLATES, `${type}.html`)), `template for ${type}`);
  }
  buildPlates(loadVideo('probe'));
  for (const id of ['shift', 'hero', 'number', 'ring', 'proof', 'point', 'how', 'road', 'done', 'board', 'plans', 'ask', 'people', 'show', 'glance']) {
    assert.doesNotMatch(html(id), /\{\{[A-Z_]+\}\}/, `${id} has no unfilled placeholders`);
  }
});

test('statement, process, timeline and checklist builders shape their content', () => {
  const point = html('point');
  assert.equal((point.match(/class="s-line"/g) || []).length, 2, 'one shell per title line');
  assert.match(point, /class="title-cascade"/, 'brand cascade reveal reaches the statement');
  assert.match(point, /data-edit="title" data-edit-kind="lines" data-edit-raw="One plan the team&#10;\*actually\* follows\."/);
  assert.match(point, /--title-size: 100px/, 'type scale follows the longest line');
  assert.match(point, /data-edit="sub"[^>]*>Supporting line</);

  const how = html('how');
  assert.equal((how.match(/class="p-step"/g) || []).length, 3);
  assert.equal((how.match(/class="p-rail"/g) || []).length, 2, 'rail between steps, none after the last');
  assert.match(how, /<span class="p-ghost">03<\/span>/);
  assert.match(how, /data-edit="steps\.0\.note"[^>]*>Link tools</);

  const road = html('road');
  assert.match(road, /class="tl-stop up"/);
  assert.match(road, /class="tl-stop down"/);
  assert.match(road, /class="tl-stop up now"[^>]*--x: 1\.0000/, 'last stop is "now" and sits at the end of the rail');
  assert.match(road, /data-edit="steps\.1\.date"[^>]*>Q2</);
  assert.match(road, /class="ink"[^>]*pathLength="1"/, 'the rail draws');

  const done = html('done');
  assert.equal((done.match(/class="ck-row"/g) || []).length, 3);
  assert.match(done, /data-edit="items\.1\.label"[^>]*>Changes land</, 'string items become rows');
  assert.match(done, /--ck-start: 1\.25s/);
  assert.match(done, /<i style="--in: 0\.00s; --out: 1\.45s">0<\/i><i style="--in: 1\.45s; --out: 1\.87s">1<\/i>/, 'counter digits step with the checks');
  assert.match(done, /<i style="--in: 2\.29s; --out: 999\.00s">3<\/i>/, 'the last digit stays');
});

test('kpi, pricing, faq and team builders shape their content', () => {
  const board = html('board');
  assert.equal((board.match(/class="k-tile"/g) || []).length, 4);
  assert.match(board, /class="k-delta up"[^>]*>.*?data-edit="stats\.0\.delta"[^>]*>\+12%</s);
  assert.match(board, /class="k-delta down"/);
  assert.equal((board.match(/class="k-spark"/g) || []).length, 4);
  assert.match(board, /class="k-value" data-fit="1"[^>]* data-count data-count-start="1\.00" data-count-dur="1\.1"/);
  assert.match(board, /class="k-value" data-fit="1" data-fit-min="40" data-fit-group="kpi-value" data-edit="stats\.3\.value"/, 'count: false opts a tile out');

  const plans = html('plans');
  assert.equal((plans.match(/class="pr-card"/g) || []).length, 2);
  assert.equal((plans.match(/class="pr-card featured"/g) || []).length, 1);
  assert.match(plans, /class="pr-card featured" data-slot="tiers\.1" style="--s: 1\.18s"/, 'featured tier lands last');
  assert.match(plans, /data-edit="tiers\.1\.badge"[^>]*>Popular</);
  assert.match(plans, /data-edit="tiers\.1\.items\.1"[^>]*><span class="accent">B<\/span></);
  assert.match(plans, /data-edit="tiers\.1\.period"[^>]*>per user</);
  assert.equal(pricingFeatured([{}, {}]), 1);
  assert.equal(pricingFeatured([{ featured: true }, {}, {}]), 0);

  const ask = html('ask');
  assert.equal((ask.match(/class="fq"/g) || []).length, 2);
  assert.match(ask, /data-edit="items\.0\.label"[^>]*>Does it import\?</);
  assert.match(ask, /data-edit="items\.0\.note"[^>]*>Yes\.</);

  const people = html('people');
  assert.equal((people.match(/class="tm-card"/g) || []).length, 3);
  assert.match(people, /class="tm-avatar"[^>]*><span>AR<\/span>/, 'initials when no photo');
  assert.match(people, /class="tm-avatar photo"[^>]*><img src="data:image\/png;base64,/, 'asset becomes the photo');
  assert.match(people, /data-edit="items\.0\.note"[^>]*>Lead</);
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
  assert.throws(bad({ id: 's', type: 'statement', before: 'x', title: 'Hi' }), /1–3 title lines, 4–140/);
  assert.throws(bad({ id: 's', type: 'statement', before: 'x', title: ['a b c', 'd e f', 'g h i', 'j k l'] }), /1–3 title lines/);
  assert.throws(bad({ id: 'p', type: 'process', before: 'x', steps: [{ label: 'A' }, { label: 'B' }] }), /3–5 steps/);
  assert.throws(bad({ id: 't', type: 'timeline', before: 'x', steps: [{ label: 'A' }] }), /3–6 stops/);
  assert.throws(bad({ id: 'c', type: 'checklist', before: 'x', items: ['A', 'B'] }), /3–6 items/);
  assert.throws(bad({ id: 'k', type: 'kpi', before: 'x', stats: [{ value: '1', label: 'A' }, { value: '2' }, { value: '3', label: 'C' }] }), /value and a label/);
  assert.throws(bad({ id: 'pr', type: 'pricing', before: 'x', tiers: [{ label: 'A', value: '$1' }] }), /2–3 tiers/);
  assert.throws(bad({ id: 'pr', type: 'pricing', before: 'x', tiers: [{ label: 'A', value: '$1', items: ['1', '2', '3', '4', '5', '6'] }, { label: 'B', value: '$2' }] }), /at most 5 lines/);
  assert.throws(bad({ id: 'f', type: 'faq', before: 'x', items: [{ label: 'Q?' }, { label: 'Q2?', note: 'A' }] }), /question \(label\) and an answer/);
  assert.throws(bad({ id: 'tm', type: 'team', before: 'x', items: [{ label: 'A' }, { label: 'B' }] }), /3–6 people/);
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

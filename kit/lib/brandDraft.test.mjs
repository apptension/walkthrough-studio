import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const root = mkdtempSync(join(tmpdir(), 'brand-draft-'));
process.env.WALKTHROUGH_BRANDS = root;
const { applyBrandChoices, brandDraftState, candidateName, lockupImage, saveBrandChoices } = await import('./brandDraft.mjs');

const SVG = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

function pack(id, brand, files = {}) {
  const dir = join(root, id);
  mkdirSync(join(dir, 'candidates'), { recursive: true });
  writeFileSync(join(dir, 'brand.json'), JSON.stringify(brand));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

const harvested = {
  name: 'Acme',
  placeholder: true,
  colors: {},
  font: { family: '', css: '' },
  logo: 'logo.html',
  discovery: { status: 'harvested' },
};
const report = JSON.stringify({
  pages: [{ url: 'https://acme.test/', h1: 'Ship faster', sub: 'Plans that hold', colors: { theme: '#FF5500', accentSamples: [{ hex: '#ff5500' }, { hex: '#2244aa' }] } }],
  saved: [
    { file: 'candidates/00-img.svg', kind: 'img', alt: 'Acme', w: 120, h: 30, href: 'https://acme.test/logo.svg' },
    { file: 'candidates/01-icon.png', kind: 'icon', href: 'https://acme.test/favicon.png' },
    { file: 'candidates/../../etc.svg', kind: 'img' },
  ],
});

test('candidate names stay inside candidates/', () => {
  assert.equal(candidateName('candidates/00-img.svg'), '00-img.svg');
  assert.equal(candidateName('../brand.json'), null);
  assert.equal(candidateName('candidates/notes.txt'), null);
});

test('a pending placeholder exposes no colours, font or lockup', () => {
  pack('pending', { ...harvested, discovery: { status: 'pending' }, colors: { ink: '#111827' }, font: { family: 'system-ui', css: 'data:text/css,' } }, {
    'logo.html': '<div class="wordmark">Preparing brand…</div>',
  });
  const s = brandDraftState('pending');
  assert.equal(s.harvested, false);
  assert.deepEqual(s.colors, {});
  assert.equal(s.font, null);
  assert.equal(s.lockup, null);
});

test('after harvest: site, safe candidates and palette hints', () => {
  pack('acme', harvested, { 'discover-report.json': report, 'candidates/00-img.svg': SVG, 'candidates/01-icon.png': 'png' });
  const s = brandDraftState('acme');
  assert.equal(s.harvested, true);
  assert.deepEqual(s.site, { url: 'https://acme.test/', headline: 'Ship faster', sub: 'Plans that hold' });
  assert.deepEqual(s.candidates.map((c) => c.file), ['00-img.svg', '01-icon.png']);
  assert.deepEqual(s.hints, ['#ff5500', '#2244aa']);
});

test('picks wait in studio-choices.json until the agent authors the pack, then apply', () => {
  const dir = pack('later', harvested, { 'discover-report.json': report, 'candidates/00-img.svg': SVG });
  const saved = saveBrandChoices('later', { colors: { gold: '#ABCDEF' }, logo: '00-img.svg' });
  assert.equal(saved.applied, false);
  assert.deepEqual(saved.state.choices, { colors: { gold: '#abcdef' }, logo: 'candidates/00-img.svg' });
  assert.throws(() => saveBrandChoices('later', { colors: { gold: 'red' } }), /#RRGGBB/);
  assert.throws(() => saveBrandChoices('later', { logo: 'nope.svg' }), /not found/);

  writeFileSync(
    join(dir, 'brand.json'),
    JSON.stringify({ ...harvested, placeholder: false, discovery: { status: 'ready' }, colors: { ink: '#000000', surface: '#111111', gold: '#222222', amber: '#333333', teal: '#444444' } }),
  );
  writeFileSync(join(dir, 'logo.html'), '<svg class="logo-svg"><circle r="4"/></svg>');
  assert.equal(applyBrandChoices('later'), true);
  const brand = JSON.parse(readFileSync(join(dir, 'brand.json'), 'utf8'));
  assert.equal(brand.colors.gold, '#abcdef');
  assert.equal(brand.discovery.logoPick, 'candidates/00-img.svg');
  assert.match(readFileSync(join(dir, 'logo.html'), 'utf8'), /Picked in Studio[\s\S]*<rect/);
  assert.equal(applyBrandChoices('later'), false);
  assert.equal(lockupImage('later').mime, 'image/svg+xml');

  const picked = readFileSync(join(dir, 'logo.html'), 'utf8');
  writeFileSync(join(dir, 'logo.html'), '<svg class="logo-svg" style="color: var(--gold)"><path fill="currentColor" stroke="var(--unknown)"/></svg>');
  const painted = lockupImage('later').body.toString();
  assert.match(painted, /color: #abcdef/);
  assert.match(painted, /stroke="var\(--unknown\)"/);
  writeFileSync(join(dir, 'logo.html'), picked);

  saveBrandChoices('later', { logo: 'logo.html' });
  assert.match(readFileSync(join(dir, 'logo.html'), 'utf8'), /<circle/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'brand.json'), 'utf8')).discovery.logoPick, undefined);
});

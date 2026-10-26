import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  contrast,
  mergePlateColors,
  normalizePlateColor,
  patchPlateColors,
  PLATE_COLOR_PRESETS,
  plateColorOptions,
  resolvePlateColors,
  sanitizePlateColors,
  withPlateColors,
} from './plateColors.mjs';

const BRAND = { ink: '#0a1f0a', surface: '#0f2a0f', gold: '#0ca300', amber: '#7ac943', teal: '#2dd4bf', text: '#f8fafc', muted: '#94a3b8' };

test('values normalise to a role, brand or #rrggbb; auto clears', () => {
  assert.equal(normalizePlateColor('GOLD'), 'gold');
  assert.equal(normalizePlateColor('#ABC'), '#aabbcc');
  assert.equal(normalizePlateColor('#112233'), '#112233');
  assert.equal(normalizePlateColor('brand'), 'brand');
  assert.equal(normalizePlateColor('auto'), null);
  assert.equal(normalizePlateColor('rgb(1,2,3)'), null);
  assert.equal(normalizePlateColor('#12'), null);
  assert.deepEqual(sanitizePlateColors({ background: '#FFF', accent: 'nope', glow: 'gold' }), { background: '#ffffff' });
  assert.equal(sanitizePlateColors({ background: 'brand' }, { plate: false }), undefined, 'brand pins only on a plate');
  assert.equal(sanitizePlateColors(null), undefined);
});

test('patches merge, clear and reject typos; presets replace the map', () => {
  assert.deepEqual(patchPlateColors({ background: '#000000' }, { accent: 'teal' }), { background: '#000000', accent: 'teal' });
  assert.equal(patchPlateColors({ background: '#000000' }, { background: null }), undefined);
  assert.deepEqual(patchPlateColors({ background: '#000000', text: '#ffffff' }, { text: 'auto' }), { background: '#000000' });
  assert.throws(() => patchPlateColors({}, { glow: 'gold' }), /Unknown plate colour "glow"/);
  assert.throws(() => patchPlateColors({}, { background: 'purple' }), /#rrggbb/);
  assert.throws(() => patchPlateColors({}, { background: 'brand' }, { plate: false }), /#rrggbb/);
  assert.deepEqual(patchPlateColors({ accent: 'teal' }, { preset: 'paper' }, { plate: false }), PLATE_COLOR_PRESETS.paper.colors);
  assert.equal(patchPlateColors({ accent: 'teal' }, { preset: 'brand' }, { plate: false }), undefined);
  assert.deepEqual(patchPlateColors({}, { preset: 'paper' }), { ...PLATE_COLOR_PRESETS.paper.colors, text: 'brand' }, 'a slide preset pins what it leaves out');
  assert.deepEqual(mergePlateColors({ background: '#070b14', text: '#ff0000' }, patchPlateColors({}, { preset: 'brand' })), {}, 'Brand on a slide ignores the video default');
  assert.throws(() => patchPlateColors({}, { preset: 'neon' }), /Unknown colour preset/);
});

test('a plate overrides the video default key by key; brand pins the pack colour', () => {
  assert.deepEqual(mergePlateColors({ background: '#070b14', accent: 'teal' }, { accent: 'amber' }), { background: '#070b14', accent: 'amber' });
  assert.deepEqual(mergePlateColors({ background: '#070b14' }, { background: 'brand' }), {});
});

test('nothing picked leaves the brand untouched', () => {
  const r = resolvePlateColors(BRAND, undefined, {});
  assert.equal(r.set, false);
  assert.equal(r.vars['--ink'], BRAND.ink);
  assert.equal(r.vars['--gold'], BRAND.gold);
  const brand = { colors: BRAND };
  assert.equal(withPlateColors(brand, null, null), brand);
});

test('roles resolve against the brand; a background lifts its own surface', () => {
  const r = resolvePlateColors(BRAND, { background: 'amber', accent: '#ff00aa', accent2: 'gold' }, null);
  assert.equal(r.colors.ink, '#7ac943');
  assert.notEqual(r.colors.surface, BRAND.surface, 'surface follows the new background');
  assert.equal(r.colors.gold, '#ff00aa');
  assert.equal(r.colors.amber, BRAND.gold);
  assert.equal(r.colors.teal, BRAND.gold, 'support glow follows the second glow');
});

test('a light background flips the copy dark; an explicit text colour wins', () => {
  const paper = resolvePlateColors(BRAND, { background: '#f5f1e8' }, null);
  assert.ok(contrast(paper.colors.text, paper.colors.ink) >= 4.5, `text ${paper.colors.text} reads on paper`);
  assert.ok(contrast(paper.colors.muted, paper.colors.ink) >= 3, `muted ${paper.colors.muted} reads on paper`);
  assert.equal(paper.vars['--shade'], '#0a0a0a', 'shadows stay dark on a light plate');
  const dark = resolvePlateColors(BRAND, { background: '#070b14' }, null);
  assert.equal(dark.colors.text, BRAND.text, 'brand text already reads on a dark plate');
  const own = resolvePlateColors(BRAND, { background: '#f5f1e8', text: '#ff0000' }, null);
  assert.equal(own.colors.text, '#ff0000');
  const onAccent = resolvePlateColors(BRAND, { accent: '#fde047' }, null);
  assert.ok(contrast(onAccent.colors.onAccent, '#fde047') >= 4.5, 'text on the accent stays readable');
});

test('options list every slot, role and preset for the Studio', () => {
  const o = plateColorOptions();
  assert.deepEqual(o.slots.map((s) => s.id), ['background', 'accent', 'accent2', 'text']);
  assert.ok(o.roles.some((r) => r.id === 'gold' && r.label === 'Accent'));
  assert.deepEqual(o.presets.map((p) => p.id), ['brand', 'midnight', 'paper', 'inverted', 'mono']);
});

// ─── Built plates ──────────────────────────────────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'walkthrough-plate-colors-'));
process.env.WALKTHROUGH_BRANDS = join(root, 'brands');
process.env.WALKTHROUGH_VIDEOS = join(root, 'videos');
process.env.WALKTHROUGH_OUT = join(root, 'out');
test.after(() => rmSync(root, { recursive: true, force: true }));

test('colours reach the built plate CSS and the atmosphere uniforms', async () => {
  const { loadVideo } = await import('./project.mjs');
  const { buildPlates } = await import('./plates.mjs');
  const brandDir = join(root, 'brands', 'acme');
  mkdirSync(brandDir, { recursive: true });
  writeFileSync(
    join(brandDir, 'brand.json'),
    JSON.stringify({ name: 'Acme', colors: BRAND, font: { family: 'Inter', css: 'body{font-family:Inter}' }, motion: { energy: 'clear', atmosphere: 'mesh' } })
  );
  writeFileSync(join(brandDir, 'logo.html'), '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
  const videoDir = join(root, 'videos', 'tint');
  mkdirSync(videoDir, { recursive: true });
  writeFileSync(
    join(videoDir, 'video.config.json'),
    JSON.stringify({
      title: 'Tint',
      brand: 'acme',
      plateColors: { background: '#101820', accent: '#ff3366' },
      open: { title: ['Hello'], colors: { background: '#f5f1e8' } },
      close: { title: ['Done.'], steps: [{ label: 'A' }, { label: 'B' }], colors: { background: 'brand', accent: 'brand' } },
      interstitials: [{ id: 'point', type: 'statement', before: 'x', title: ['One plan the team'], colors: { accent2: 'teal' } }],
    })
  );
  const paths = buildPlates(loadVideo('tint'));
  const open = readFileSync(paths.open.html, 'utf8');
  const close = readFileSync(paths.close.html, 'utf8');
  const point = readFileSync(paths.interstitial.point.html, 'utf8');

  assert.match(open, /--ink: #f5f1e8;/, 'plate background wins over the video default');
  assert.match(open, /--gold: #ff3366;/, 'video accent still applies where the plate is silent');
  assert.match(open, /--text: #11141a;/, 'copy flips dark on the paper plate');
  assert.match(open, /gl\.uniform3fv\(U\.uInk, tint\('--ink', \[0\.9608, 0\.9451, 0\.9098\]\)\)/, 'the field bakes the new backdrop');

  assert.match(close, new RegExp(`--ink: ${BRAND.ink};`), 'brand pins the pack colour over the video default');
  assert.match(close, new RegExp(`--gold: ${BRAND.gold};`));

  assert.match(point, /--ink: #101820;/);
  assert.match(point, new RegExp(`--amber: ${BRAND.teal};`), 'a role names the brand colour');
  assert.match(point, /tint\('--gold'/, 'the field reads the live CSS variable');
});

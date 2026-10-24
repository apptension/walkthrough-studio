/**
 * Lockup style coverage: every template that draws the brand mark wires the
 * matching CSS variables, and style groups resolve by plate id / type.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { injectStyle, LOCKUP_STYLE_TYPES, patchStyle, styleGroupsFor, STYLE_GROUPS } from './editDeck.mjs';

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '../templates');

const LOCKUP_TEMPLATES = Object.freeze({
  open: { file: 'open.html', vars: ['--open-logo', '--open-logo-top', '--open-logo-width', '--open-lift-scale', '--open-lift-y'] },
  close: { file: 'close.html', vars: ['--close-logo', '--close-logo-top', '--close-logo-width', '--close-lift-scale', '--close-lift-y'] },
  features: { file: 'features.html', vars: ['--mark-logo', '--mark-logo-size', '--mark-logo-width', '--mark-logo-x', '--mark-logo-y'] },
  quote: { file: 'quote.html', vars: ['--mark-logo', '--mark-logo-size', '--mark-logo-width', '--mark-logo-x', '--mark-logo-y'] },
  statement: { file: 'statement.html', vars: ['--mark-logo', '--mark-logo-size', '--mark-logo-width', '--mark-logo-x', '--mark-logo-y'] },
  orbit: { file: 'orbit.html', vars: ['--orbit-logo', '--orbit-logo-size', '--orbit-center-scale'] },
});

test('LOCKUP_STYLE_TYPES lists every plate that owns a brand lockup seat', () => {
  assert.deepEqual([...LOCKUP_STYLE_TYPES].sort(), Object.keys(LOCKUP_TEMPLATES).sort());
});

test('each lockup template declares and uses its CSS variables', () => {
  for (const [type, { file, vars }] of Object.entries(LOCKUP_TEMPLATES)) {
    const html = readFileSync(join(TEMPLATES, file), 'utf8');
    for (const name of vars) {
      assert.match(html, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${type} (${file}) missing ${name}`);
    }
    if (type === 'open' || type === 'close') {
      assert.match(html, /class="lockup-exit"/, `${type} needs .lockup-exit`);
    } else if (type === 'orbit') {
      assert.match(html, /class="o-center"/, 'orbit needs .o-center');
    } else {
      assert.match(html, /class="corner-logo"/, `${type} needs .corner-logo`);
    }
  }
});

test('plates.css ships the shared markIn keyframes for corner seats', () => {
  const css = readFileSync(join(TEMPLATES, 'plates.css'), 'utf8');
  assert.match(css, /@keyframes markIn/);
  assert.match(css, /\.corner-logo/);
  assert.match(css, /--mark-logo-size/);
});

test('style groups expose lockup controls only for the matching plate', () => {
  const byId = Object.fromEntries(STYLE_GROUPS.map((g) => [g.id, g]));
  assert.ok(byId.open.only.includes('open'));
  assert.ok(byId.close.only.includes('close'));
  assert.deepEqual(byId.mark.onlyTypes.sort(), ['features', 'quote', 'statement']);
  assert.deepEqual(byId.orbit.onlyTypes, ['orbit']);

  assert.ok(styleGroupsFor('open').some((g) => g.id === 'open'));
  assert.ok(styleGroupsFor('close').some((g) => g.id === 'close'));
  for (const type of ['features', 'quote', 'statement']) {
    assert.ok(styleGroupsFor(`id-${type}`, type).some((g) => g.id === 'mark'), type);
  }
  assert.ok(styleGroupsFor('integrations', 'orbit').some((g) => g.id === 'orbit'));

  // Types without a brand lockup seat must not see mark/orbit groups.
  for (const type of ['stats', 'journey', 'process', 'logos', 'faq', 'pricing']) {
    const groups = styleGroupsFor(`x-${type}`, type).map((g) => g.id);
    assert.ok(!groups.includes('mark'), type);
    assert.ok(!groups.includes('orbit'), type);
    assert.ok(!groups.includes('open'), type);
    assert.ok(!groups.includes('close'), type);
  }
});

test('injectStyle writes lockup vars into rebuilt plate HTML', () => {
  const base = '<html><head><style>:root{--gold:#000}</style></head><body><div class="corner-logo"></div></body></html>';
  const style = patchStyle(
    {},
    { '--mark-logo': 'off', '--mark-logo-size': 44 },
    { plateId: 'hero', plateType: 'quote' }
  );
  const html = injectStyle(base, style);
  assert.match(html, /data-plate-style>:root\{--mark-logo:0;--mark-logo-size:44px\}/);
});

test('no stray brand LOGO seat outside the lockup catalog (except logos wall / open/close)', () => {
  const files = readdirSync(TEMPLATES).filter((f) => f.endsWith('.html'));
  const allowed = new Set(['open.html', 'close.html', 'features.html', 'quote.html', 'statement.html', 'orbit.html', 'logos.html']);
  for (const file of files) {
    const html = readFileSync(join(TEMPLATES, file), 'utf8');
    if (!html.includes('{{LOGO}}')) continue;
    assert.ok(allowed.has(file) || /^(open|close)-[a-z]+\.html$/.test(file), `${file} injects {{LOGO}} but is not in the lockup catalog`);
  }
});

test('open/close layout variants keep the lockup seat and its visibility var', () => {
  for (const file of readdirSync(TEMPLATES).filter((f) => /^(open|close)-[a-z]+\.html$/.test(f))) {
    const html = readFileSync(join(TEMPLATES, file), 'utf8');
    const kind = file.split('-')[0];
    assert.match(html, /class="lockup-exit"/, `${file} needs .lockup-exit`);
    assert.match(html, new RegExp(`--${kind}-logo\\b`), `${file} must honour --${kind}-logo`);
    assert.match(html, new RegExp(`--${kind}-logo-width`), `${file} must honour --${kind}-logo-width`);
  }
});

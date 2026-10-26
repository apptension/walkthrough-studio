import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  CLOSE_LAYOUTS,
  OPEN_LAYOUTS,
  PLATE_LAYOUTS,
  defaultLayout,
  layoutGuide,
  layoutIssues,
  layoutOptions,
  normalizeLayout,
  plateKind,
  resolveLayout,
} from './plateLayouts.mjs';

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '../templates');

test('defaults are the classic compositions', () => {
  assert.equal(defaultLayout('open'), 'classic');
  assert.equal(defaultLayout('close'), 'classic');
  assert.equal(defaultLayout('features'), 'grid');
  assert.equal(defaultLayout('stats'), 'row');
  assert.equal(defaultLayout('statement'), 'editorial');
  assert.equal(defaultLayout('quote'), null);
});

test('resolveLayout falls back to the default for missing or unknown ids', () => {
  assert.equal(resolveLayout('open', undefined), 'classic');
  assert.equal(resolveLayout('open', 'nope'), 'classic');
  assert.equal(resolveLayout('open', 'kinetic'), 'kinetic');
  assert.equal(resolveLayout('quote', 'grid'), null);
});

test('normalizeLayout clears empties and rejects unknown ids with the valid list', () => {
  assert.equal(normalizeLayout('close', ''), undefined);
  assert.equal(normalizeLayout('close', null), undefined);
  assert.equal(normalizeLayout('close', ' cards '), 'cards');
  assert.throws(() => normalizeLayout('close', 'bento'), /close layout must be one of classic, split, cards, finale/);
  assert.throws(() => normalizeLayout('quote', 'grid'), /quote plates have one layout/);
});

test('plateKind maps open/close ids and interstitial types', () => {
  assert.equal(plateKind('open'), 'open');
  assert.equal(plateKind('close', { type: 'features' }), 'close');
  assert.equal(plateKind('modes', { type: 'features' }), 'features');
  assert.equal(plateKind('x'), null);
});

test('layoutIssues reports every invalid layout by path', () => {
  const issues = layoutIssues({
    open: { layout: 'mesh' },
    close: { layout: 'wat' },
    interstitials: [
      { id: 'a', type: 'features', layout: 'bento' },
      { id: 'b', type: 'quote', layout: 'grid' },
    ],
  });
  assert.equal(issues.length, 2);
  assert.match(issues[0], /^close\.layout:/);
  assert.match(issues[1], /^interstitials\.b\.layout:/);
  assert.deepEqual(layoutIssues({}), []);
});

test('every open/close layout ships a template; interstitial templates carry data-layout', () => {
  for (const id of Object.keys(OPEN_LAYOUTS)) {
    assert.ok(existsSync(join(TEMPLATES, id === 'classic' ? 'open.html' : `open-${id}.html`)), `open ${id}`);
  }
  for (const id of Object.keys(CLOSE_LAYOUTS)) {
    assert.ok(existsSync(join(TEMPLATES, id === 'classic' ? 'close.html' : `close-${id}.html`)), `close ${id}`);
  }
  for (const [type, table] of Object.entries(PLATE_LAYOUTS)) {
    const html = readFileSync(join(TEMPLATES, `${type}.html`), 'utf8');
    assert.match(html, /data-layout="\{\{LAYOUT\}\}"/, `${type}.html needs data-layout`);
    for (const id of Object.keys(table).slice(1)) {
      assert.match(html, new RegExp(`data-layout='${id}'`), `${type}.html has no CSS for ${id}`);
    }
  }
});

test('variant templates follow the hard rules: no backdrop-filter, explicit exits, palette vars only', () => {
  const files = [
    ...Object.keys(OPEN_LAYOUTS).filter((id) => id !== 'classic').map((id) => `open-${id}.html`),
    ...Object.keys(CLOSE_LAYOUTS).filter((id) => id !== 'classic').map((id) => `close-${id}.html`),
  ];
  for (const file of files) {
    const html = readFileSync(join(TEMPLATES, file), 'utf8');
    assert.doesNotMatch(html, /backdrop-filter/, `${file} uses backdrop-filter`);
    assert.match(html, /exitScale|exitUp|copyLineOut|line-exit|Out /, `${file} has no exit`);
    assert.match(html, /\{\{LOGO\}\}/, `${file} must use the official logo`);
    const css = html
      .split('</style>')[0]
      .split('\n')
      .filter((line) => !/mask-image/.test(line))
      .join('\n');
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, `${file} hard-codes a colour outside an alpha mask`);
    assert.doesNotMatch(css, /Math\.random|Date\.now/, `${file} is not deterministic`);
    assert.match(html, /data-edit="title"/, `${file} keeps the title editable`);
  }
});

test('layoutOptions and layoutGuide cover every kind', () => {
  const opts = layoutOptions();
  assert.deepEqual(Object.keys(opts).sort(), ['bento', 'callout', 'close', 'features', 'kpi', 'logos', 'open', 'showcase', 'statement', 'stats']);
  assert.ok(opts.open.every((o) => o.id && o.label && o.hint));
  const guide = layoutGuide();
  for (const kind of ['open.layout', 'close.layout', 'features interstitial.layout', 'statement interstitial.layout']) {
    assert.ok(guide.includes(kind), kind);
  }
});

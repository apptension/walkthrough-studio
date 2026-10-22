import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { modKeyGlyph, paintGuideMods } from './help.js';

test('mod key is ⌘ on Apple platforms and Ctrl elsewhere', () => {
  assert.equal(modKeyGlyph('MacIntel'), '⌘');
  assert.equal(modKeyGlyph('iPhone'), '⌘');
  assert.equal(modKeyGlyph('iPad'), '⌘');
  assert.equal(modKeyGlyph('Win32'), 'Ctrl');
  assert.equal(modKeyGlyph('Linux x86_64'), 'Ctrl');
});

test('paintGuideMods fills every data-mod keycap', () => {
  const root = {
    nodes: [
      { dataset: { mod: '' }, textContent: '⌘' },
      { dataset: { mod: '' }, textContent: '⌘' },
    ],
    querySelectorAll(sel) {
      assert.equal(sel, '[data-mod]');
      return this.nodes;
    },
  };
  assert.equal(paintGuideMods(root, 'Win32'), 'Ctrl');
  assert.equal(root.nodes[0].textContent, 'Ctrl');
  assert.equal(root.nodes[1].textContent, 'Ctrl');
  assert.equal(paintGuideMods(root, 'MacIntel'), '⌘');
  assert.equal(root.nodes[0].textContent, '⌘');
});

test('Studio guide markup covers stages, desk panes and grouped shortcuts', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const start = html.indexOf('id="helpDialog"');
  const end = html.indexOf('id="scriptDialog"');
  assert.ok(start > 0 && end > start);
  const guide = html.slice(start, end);

  for (const stage of ['brief', 'script', 'direction', 'record', 'cut', 'deliver']) {
    assert.match(guide, new RegExp(`data-guide-stage="${stage}"`));
  }
  for (const jump of ['guideHow', 'guideDesk', 'guideWords', 'guideKeys']) {
    assert.match(guide, new RegExp(`data-guide-jump="${jump}"`));
  }
  assert.match(guide, /guide-desk/);
  assert.match(guide, /Inspector/);
  assert.match(guide, /Media/);
  assert.match(guide, /Smart scope/);
  assert.match(guide, /guide-keys-group/);
  assert.match(guide, /data-mod/);
  assert.doesNotMatch(guide, /Right · Motion/);
});

test('Studio guide CSS keeps a single help dialog width and sticky section nav', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  const widths = [...css.matchAll(/\.sheet-dialog\.help\s*\{[^}]*width:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.equal(widths.length, 1, `expected one help width, got ${widths.join(' | ')}`);
  assert.match(widths[0], /640px/);
  assert.match(css, /\.guide-nav\s*\{/);
  assert.match(css, /\.guide-stage\s*\{/);
  assert.match(css, /\.guide-desk\s*\{/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.guide-body/);
});

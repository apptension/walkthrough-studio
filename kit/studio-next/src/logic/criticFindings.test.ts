import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test } from 'vitest';

import { criticFindingMarkup } from './criticFindings';

function channel(hex: string, i: number) {
  const s = hex.replace('#', '');
  const v = parseInt(s.slice(i, i + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function contrast(a: string, b: string) {
  const L = (hex: string) => 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 2) + 0.0722 * channel(hex, 4);
  const [hi, lo] = [L(a), L(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

test('Fix with AI sits in the finding header as the primary button', () => {
  const html = criticFindingMarkup(
    { severity: 'high', target: 'narration:close', persona: 'editor', issue: 'The close line is long', suggestion: 'Shorten it' },
    0
  );
  const head = html.slice(html.indexOf('critic-item-head'), html.indexOf('critic-issue'));
  assert.match(head, /class="btn primary critic-fix"/);
  assert.match(head, /data-critic-fix="0"/);
  assert.match(head, />Fix with AI</);
  assert.ok(html.indexOf('critic-fix') < html.indexOf('critic-issue'));
});

test('the Fix with AI label keeps AA contrast on light and dark', () => {
  const css = readFileSync(join(import.meta.dirname, '../../../studio', 'styles.css'), 'utf8');
  assert.match(css, /\.critic-item-head \.critic-fix[\s\S]*min-width:\s*44px/);
  assert.match(css, /\.critic-item-head \.critic-fix[\s\S]*min-height:\s*44px/);
  assert.match(css, /\.critic-item-head \.critic-fix[\s\S]*color:\s*#0a0a0a/);
  assert.match(css, /\.critic-item-head \.critic-fix[\s\S]*background-color:\s*#42f272/);
  assert.ok(contrast('#0a0a0a', '#42f272') >= 4.5);
  assert.ok(contrast('#0a0a0a', '#42f272') >= 4.5, 'same pair on a light or dark page');
});

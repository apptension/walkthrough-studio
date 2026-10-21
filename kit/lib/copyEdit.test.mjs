import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accentState,
  fieldSource,
  fromElement,
  parseSource,
  positionAt,
  toHtml,
  toSource,
  toggleAccent,
  wordAt,
} from '../studio/copyEdit.js';

// ——— a DOM small enough to walk: text(), el(tag, class, ...kids) ———
const text = (s) => ({ nodeType: 3, nodeValue: s });
const el = (tagName, className, ...kids) => {
  const classes = new Set((className || '').split(/\s+/).filter(Boolean));
  const node = { nodeType: 1, tagName, classList: { contains: (c) => classes.has(c) }, childNodes: kids };
  return node;
};

test('source and chars round-trip, accents only on words', () => {
  const chars = parseSource('Plan the *week*, measure *delivery speed*');
  assert.equal(chars.filter((c) => c.accent).map((c) => c.ch).join(''), 'weekdelivery speed');
  assert.equal(toSource(chars), 'Plan the *week*, measure *delivery speed*');
  assert.equal(toSource(parseSource('a * b')), 'a * b', 'a lone asterisk stays literal');
  assert.equal(toSource(parseSource('one\n*two*')), 'one\n*two*', 'lines keep their breaks');
});

test('normalisation keeps accent markers off the spaces', () => {
  const chars = parseSource('Plan the week').map((c, i) => (i >= 4 && i <= 8 ? { ...c, accent: true } : c));
  // " the " marked including both spaces → the spaces drop out of the run
  assert.equal(toSource(chars), 'Plan *the* week');
});

test('html paints the accent with the field tag and keeps lines as blocks', () => {
  assert.equal(toHtml(parseSource('Plan the *week*')), 'Plan the <span class="accent">week</span>');
  assert.equal(toHtml(parseSource('fast · *simple*'), { tag: 'b', sep: true }), 'fast <span class="sep">·</span> <b>simple</b>');
  assert.equal(toHtml(parseSource('one\n\n*two*'), { lines: true }), '<div>one</div><div><br></div><div><span class="accent">two</span></div>');
  assert.equal(toHtml(parseSource('a <b>')), 'a &lt;b&gt;', 'text is escaped');
});

test('fromElement reads accents from <b> and .accent, blocks and <br> as line breaks', () => {
  const root = el(
    'H1',
    'title',
    el('DIV', '', text('Plan the '), el('SPAN', 'accent', text('week'))),
    el('DIV', '', text('and '), el('B', '', text('ship')), text('\u00a0it'))
  );
  const { chars } = fromElement(root);
  assert.equal(toSource(chars), 'Plan the *week*\nand *ship* it');
  const flat = el('P', 'sub', text('fast'), el('BR', ''), text('simple'));
  assert.equal(toSource(fromElement(flat).chars), 'fast\nsimple');
});

test('selection offsets survive a re-render through fromElement marks and positionAt', () => {
  const week = text('week');
  const root = el('H1', 'title', el('DIV', '', text('Plan the '), el('SPAN', 'accent', week)), el('DIV', '', text('and ship')));
  const { chars, offsets } = fromElement(root, { marks: [[week, 1], [root.childNodes[1], 1]] });
  assert.deepEqual(offsets, [10, 22], 'char offsets: inside "week", end of line two');
  const pos = positionAt(root, 10);
  assert.equal(pos.node, week);
  assert.equal(pos.offset, 1);
  const end = positionAt(root, chars.length);
  assert.equal(end.node, root.childNodes[1].childNodes[0]);
  assert.equal(end.offset, 'and ship'.length);
  const lineStart = positionAt(root, 14);
  assert.equal(lineStart.node, root.childNodes[1].childNodes[0], 'the offset after the break is the start of the next line');
  assert.equal(lineStart.offset, 0);
});

test('toggleAccent marks a selection, clears an accented one, and takes the word under a caret', () => {
  const chars = parseSource('Plan the week');
  const on = toggleAccent(chars, 5, 8);
  assert.equal(toSource(on.chars), 'Plan *the* week');
  assert.equal(accentState(on.chars, 5, 8), 'on');
  assert.equal(accentState(on.chars, 0, 13), 'mixed');
  const off = toggleAccent(on.chars, 5, 8);
  assert.equal(toSource(off.chars), 'Plan the week');
  const caret = toggleAccent(chars, 11, 11);
  assert.equal(toSource(caret.chars), 'Plan the *week*');
  assert.deepEqual([caret.start, caret.end], [9, 13]);
  assert.deepEqual(wordAt(chars, 4), [0, 4], 'a caret right after a word belongs to it');
  assert.equal(toggleAccent(chars, 4, 5), null, 'a selection of only a space has nothing to mark');
  const mixed = toggleAccent(on.chars, 0, 13);
  assert.equal(toSource(mixed.chars), '*Plan the week*', 'mixed → everything on');
});

test('fieldSource shapes the config value per kind', () => {
  assert.equal(fieldSource(parseSource('  Plan   the *week*  ')), 'Plan the *week*');
  assert.equal(fieldSource(parseSource('one \n\n two '), { kind: 'lines' }), 'one\ntwo');
  assert.equal(fieldSource(parseSource('fast·*simple*·done'), { beats: true }), 'fast · *simple* · done');
});

import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

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
} from './copyEdit';

describe('copyEdit', () => {
  test('source round-trips through chars, with lone asterisks literal', () => {
    const chars = parseSource('Plan the *week*\nShip *it* · now *');
    assert.equal(chars.filter((c) => c.accent).map((c) => c.ch).join(''), 'weekit');
    assert.equal(toSource(chars), 'Plan the *week*\nShip *it* · now *');
  });

  test('a run never opens or closes on a space, and spaced accents stay one run', () => {
    assert.equal(toSource(parseSource('Plan* week*')), 'Plan *week*');
    assert.equal(toSource(parseSource('*one* *two*')), '*one two*');
  });

  test('html uses accent spans or <b>, one <div> per line, and wraps beat separators', () => {
    const chars = parseSource('A *b* <c>\n\nD · E');
    assert.equal(toHtml(chars), 'A <span class="accent">b</span> &lt;c&gt;  D · E');
    assert.equal(
      toHtml(chars, { tag: 'b', lines: true, sep: true }),
      '<div class="title-line">A <b>b</b> &lt;c&gt;</div><div class="title-line"><br></div><div class="title-line">D <span class="sep">·</span> E</div>',
    );
  });

  test('a caret reads and toggles its word', () => {
    const chars = parseSource('Plan the *week*');
    assert.deepEqual(wordAt(chars, 6), [5, 8]);
    assert.equal(accentState(chars, 6, 6), 'off');
    assert.equal(accentState(chars, 0, chars.length), 'mixed');
    const flipped = toggleAccent(chars, 6, 6)!;
    assert.deepEqual([flipped.start, flipped.end], [5, 8]);
    assert.equal(toSource(flipped.chars), 'Plan *the week*');
    assert.equal(toggleAccent(parseSource('a  b'), 2, 2), null);
  });

  test('field source collapses whitespace per kind and spaces beats', () => {
    const chars = parseSource('  One   two \n\n  three  ');
    assert.equal(fieldSource(chars), 'One two three');
    assert.equal(fieldSource(chars, { kind: 'lines' }), 'One two\nthree');
    assert.equal(fieldSource(parseSource('Plan·Ship  ·Win'), { beats: true }), 'Plan · Ship · Win');
  });

  test('colons and URL-like copy round-trip in field source', () => {
    for (const s of ['Time: 12:30', 'https://x.com:8080/p', 'Step 1: Go', 'Plan · Ship: fast']) {
      assert.equal(fieldSource(parseSource(s)), s.replace(/\s+/g, ' ').trim());
      assert.equal(toSource(parseSource(s)), s);
    }
  });

  test('contenteditable → chars keeps accents, lines and the selection marks', () => {
    const el = document.createElement('div');
    el.innerHTML = '<div>Plan <span class="accent">week</span></div><div>Go<br>now</div>';
    const week = el.querySelector('.accent')!.firstChild!;
    const { chars, offsets } = fromElement(el, { marks: [[week, 2], [el, 99]] });
    assert.equal(toSource(chars), 'Plan *week*\nGo\nnow');
    assert.equal(offsets[0], 7);
    assert.equal(offsets[1], chars.length);
    const pos = positionAt(el, 7);
    assert.equal(pos.node, week);
    assert.equal(pos.offset, 2);
    assert.deepEqual(positionAt(el, 999), { node: el.querySelectorAll('div')[1]!.lastChild!, offset: 3 });
  });
});

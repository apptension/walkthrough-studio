import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { cardMarkKey as libKey } from './editDeck.mjs';
import { cardMarkKey as studioKey, cardMarkDuration as studioDur } from '../studio/liveCardStage.js';
import { cardMarkDuration as bakeDur } from './liveCardBake.mjs';
import { isCardMark, loadCardMarks, pairCallsToMarks } from './cardMarks.mjs';

describe('lib ↔ studio card identity', () => {
  test('cardMarkKey agrees across editDeck and liveCardStage', () => {
    for (const m of [
      { kind: 'chapter', t: 7.2, label: 'Meet Apptension' },
      { kind: 'caption', t: 0, label: '' },
      { kind: 'caption', t: 12.3456, label: 'Ünïcode · dots' },
    ]) {
      assert.equal(studioKey(m), libKey(m));
    }
  });
  test('cardMarkDuration is one function for bake and preview', () => {
    assert.equal(bakeDur, studioDur);
  });
});

describe('loadCardMarks', () => {
  test('keys cards, applies edit.cards, sorts, falls back to live-meta', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-cardmarks-'));
    try {
      const out = join(dir, 'out');
      mkdirSync(out);
      const chap = { kind: 'chapter', t: 7.2, dur: 2.8, label: 'Meet' };
      const cap = { kind: 'caption', t: 2.0, dur: 2.4, label: 'Hi' };
      writeFileSync(join(out, 'timeline.json'), JSON.stringify([chap, cap, { kind: 'click', t: 3 }]));
      const video = { out, config: { edit: { cards: [{ key: libKey(chap), dur: 1.5 }] } } };
      const marks = loadCardMarks(video);
      assert.deepEqual(
        marks.map((m) => m.kind),
        ['caption', 'click', 'chapter']
      );
      const edited = marks.find((m) => m.kind === 'chapter');
      assert.equal(edited.dur, 1.5);
      assert.equal(edited.key, libKey(chap));
      assert.equal(marks.find((m) => m.kind === 'caption').key, libKey(cap));
      assert.equal(marks.find((m) => m.kind === 'click').key, undefined);

      rmSync(join(out, 'timeline.json'));
      writeFileSync(join(out, 'live-meta.json'), JSON.stringify({ timeline: [cap] }));
      assert.equal(loadCardMarks({ out, config: {} }).length, 1);

      rmSync(join(out, 'live-meta.json'));
      assert.deepEqual(loadCardMarks({ out, config: {} }), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('tolerates a corrupt timeline file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-cardmarks-'));
    try {
      const out = join(dir, 'out');
      mkdirSync(out);
      writeFileSync(join(out, 'timeline.json'), '{not json');
      assert.deepEqual(loadCardMarks({ out, config: {} }), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('pairCallsToMarks', () => {
  const marks = [
    { kind: 'chapter', t: 1, label: 'Intro' },
    { kind: 'caption', t: 2, label: 'Scan the map' },
    { kind: 'chapter', t: 7, label: 'Meet Apptension' },
    { kind: 'caption', t: 9, label: 'Scan the map' },
    { kind: 'click', t: 3 },
  ];

  test('exact title wins, then containment, then order', () => {
    const calls = [
      { kind: 'chapter', index: 0, title: 'Intro' },
      { kind: 'step', index: 1, title: 'Scan' },
      { kind: 'chapter', index: 2, title: 'Renamed later in Studio' },
    ];
    const got = pairCallsToMarks(calls, marks);
    assert.equal(got.get(0), marks[0]);
    assert.equal(got.get(1), marks[1]);
    assert.equal(got.get(2), marks[2]);
  });

  test('consumes marks so duplicate titles map to distinct marks', () => {
    const calls = [
      { kind: 'step', index: 1, title: 'Scan the map' },
      { kind: 'step', index: 4, title: 'Scan the map' },
      { kind: 'step', index: 6, title: 'Scan the map' },
    ];
    const got = pairCallsToMarks(calls, marks);
    assert.equal(got.get(1), marks[1]);
    assert.equal(got.get(4), marks[3]);
    assert.equal(got.has(6), false);
  });

  test('never crosses kinds and survives empty input', () => {
    const got = pairCallsToMarks([{ kind: 'chapter', index: 0, title: 'Scan the map' }], marks);
    assert.equal(got.get(0).kind, 'chapter');
    assert.equal(pairCallsToMarks([], []).size, 0);
    assert.equal(pairCallsToMarks(null, null).size, 0);
  });

  test('isCardMark', () => {
    assert.equal(isCardMark({ kind: 'chapter' }), true);
    assert.equal(isCardMark({ kind: 'caption' }), true);
    assert.equal(isCardMark({ kind: 'click' }), false);
    assert.equal(isCardMark(null), false);
  });
});

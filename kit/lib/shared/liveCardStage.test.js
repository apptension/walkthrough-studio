import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  cardEditLandingEd,
  cardElapsedMs,
  cardMarkDuration,
  cardMarkInClip,
  cardMarkKey,
  liveMarksAtRecTime,
  resolveLiveCardFromPlates,
} from './liveCardStage.js';

describe('cardMarkDuration', () => {
  test('uses mark.dur when set', () => {
    assert.equal(cardMarkDuration({ kind: 'chapter', dur: 3.5 }), 3.5);
  });
  test('defaults by kind', () => {
    assert.equal(cardMarkDuration({ kind: 'chapter' }), 2.8);
    assert.equal(cardMarkDuration({ kind: 'caption' }), 2.4);
  });
});

describe('liveMarksAtRecTime', () => {
  const marks = [
    { kind: 'chapter', t: 10, dur: 2.8, label: 'Services' },
    { kind: 'caption', t: 11, dur: 2, label: 'Scan' },
    { kind: 'click', t: 12 },
  ];
  test('returns covering chapter/caption, newest first', () => {
    const hits = liveMarksAtRecTime(marks, 11.2, { recFrom: 0, recTo: 60 });
    assert.equal(hits.length, 2);
    assert.equal(hits[0].kind, 'caption');
    assert.equal(hits[1].kind, 'chapter');
  });
  test('respects clip bounds', () => {
    assert.equal(liveMarksAtRecTime(marks, 11.2, { recFrom: 20, recTo: 60 }).length, 0);
  });
  test('keeps a chapter whose slice opens after the mark (plate→card cut)', () => {
    // edit.mjs starts the slice ~0.5s into the card so the backdrop already covers the UI.
    const chapter = [{ kind: 'chapter', t: 19.408, dur: 5.205, label: 'Our services' }];
    const clip = { recFrom: 19.9, recTo: 37.5 };
    assert.equal(liveMarksAtRecTime(chapter, 19.9, clip).length, 1);
    assert.equal(liveMarksAtRecTime(chapter, 24.0, clip).length, 1);
    assert.equal(liveMarksAtRecTime(chapter, 24.7, clip).length, 0);
  });
});

describe('cardMarkInClip', () => {
  const clip = { recFrom: 19.9, recTo: 37.5 };
  test('overlap, not start, decides membership', () => {
    assert.equal(cardMarkInClip({ kind: 'chapter', t: 19.408, dur: 5.2 }, clip), true);
    assert.equal(cardMarkInClip({ kind: 'caption', t: 37.4, dur: 2 }, clip), true);
    assert.equal(cardMarkInClip({ kind: 'caption', t: 37.5, dur: 2 }, clip), false);
    assert.equal(cardMarkInClip({ kind: 'caption', t: 10, dur: 2 }, clip), false);
    // A card that ends a hair after the slice starts is noise, not a member.
    assert.equal(cardMarkInClip({ kind: 'caption', t: 17.93, dur: 2 }, clip), false);
  });
  test('ignores non-card marks and bad input', () => {
    assert.equal(cardMarkInClip({ kind: 'click', t: 20 }, clip), false);
    assert.equal(cardMarkInClip({ kind: 'caption', t: 'x' }, clip), false);
    assert.equal(cardMarkInClip(null, clip), false);
  });
});

describe('resolveLiveCardFromPlates', () => {
  const plates = [
    { id: 'overlay:chapter:2', liveCard: true, kind: 'chapter', label: 'Ch 02 · Our services', flowIndex: 2 },
    { id: 'overlay:caption:5', liveCard: true, kind: 'caption', label: 'Caption · Scan the map', flowIndex: 5 },
  ];
  test('matches by title suffix', () => {
    const card = resolveLiveCardFromPlates({ kind: 'chapter', t: 10, label: 'Our services' }, plates, []);
    assert.equal(card?.id, 'overlay:chapter:2');
  });
  test('falls back to mark order', () => {
    const more = [
      { id: 'overlay:chapter:0', liveCard: true, kind: 'chapter', label: 'Ch 01 · Intro', flowIndex: 0 },
      ...plates,
    ];
    const all = [
      { kind: 'chapter', t: 1, label: 'Intro' },
      { kind: 'chapter', t: 10, label: 'Mystery' },
    ];
    const card = resolveLiveCardFromPlates(all[1], more, all);
    assert.equal(card?.id, 'overlay:chapter:2');
  });
  test('markKey wins over label when the server paired the rows', () => {
    const a = { kind: 'caption', t: 2, label: 'Scan the map' };
    const b = { kind: 'caption', t: 9, label: 'Scan the map' };
    const keyed = [
      { id: 'overlay:caption:1', liveCard: true, kind: 'caption', label: 'Caption · Scan the map', flowIndex: 1, markKey: cardMarkKey(a) },
      { id: 'overlay:caption:4', liveCard: true, kind: 'caption', label: 'Caption · Scan the map', flowIndex: 4, markKey: cardMarkKey(b) },
    ];
    assert.equal(resolveLiveCardFromPlates(a, keyed, [a, b])?.id, 'overlay:caption:1');
    assert.equal(resolveLiveCardFromPlates(b, keyed, [a, b])?.id, 'overlay:caption:4');
    // A mark the server did not pair must not steal another mark's card.
    assert.equal(resolveLiveCardFromPlates({ kind: 'caption', t: 30, label: 'Scan the map' }, keyed, [a, b]), null);
  });
  test('mixed keyed/unkeyed rows still allow the heuristic for unkeyed ones', () => {
    const a = { kind: 'caption', t: 2, label: 'Scan the map' };
    const rows = [
      { id: 'overlay:caption:1', liveCard: true, kind: 'caption', label: 'Caption · Scan the map', flowIndex: 1, markKey: cardMarkKey(a) },
      { id: 'overlay:caption:4', liveCard: true, kind: 'caption', label: 'Caption · Elsewhere', flowIndex: 4, markKey: null },
    ];
    assert.equal(resolveLiveCardFromPlates({ kind: 'caption', t: 30, label: 'Elsewhere' }, rows, [])?.id, 'overlay:caption:4');
  });
});

describe('cardEditLandingEd', () => {
  const toEd = (clip) => (rec) => clip.at + (rec - clip.recFrom);
  const meet = { kind: 'live', at: 6.1, recFrom: 2.372, recTo: 19.3, overlap: 0.433 };
  const services = { kind: 'live', at: 29.967, recFrom: 19.9, recTo: 37.5, overlap: 0.6 };

  test('steps past the plate-owned half of a plate→live join', () => {
    const mark = { kind: 'chapter', t: 2.372, dur: 4.935 };
    const edT = cardEditLandingEd(mark, meet, { prevKind: 'plate', overlap: meet.overlap, toEd: toEd(meet) });
    assert.ok(edT >= meet.at + meet.overlap * 0.5);
    assert.ok(edT < meet.at + mark.dur);
  });

  test('lands inside a slice that opens after the chapter mark', () => {
    const mark = { kind: 'chapter', t: 19.408, dur: 5.205 };
    const edT = cardEditLandingEd(mark, services, { prevKind: 'plate', overlap: services.overlap, toEd: toEd(services) });
    assert.ok(edT >= services.at + services.overlap * 0.5);
    assert.ok(edT < toEd(services)(mark.t + mark.dur));
  });

  test('stays a beat into the card when no plate precedes the slice', () => {
    const mark = { kind: 'caption', t: 7.22, dur: 5.6 };
    const edT = cardEditLandingEd(mark, meet, { prevKind: 'live', overlap: 0.4, toEd: toEd(meet) });
    assert.equal(edT, toEd(meet)(7.34));
  });

  test('rejects a landing it cannot place', () => {
    assert.equal(cardEditLandingEd(null, meet, { toEd: toEd(meet) }), null);
    assert.equal(cardEditLandingEd({ kind: 'chapter', t: 1, dur: 2 }, { kind: 'plate', at: 0 }, { toEd: () => 0 }), null);
  });
});

describe('cardElapsedMs', () => {
  test('clamps into the card window', () => {
    const mark = { kind: 'chapter', t: 10, dur: 2 };
    assert.equal(cardElapsedMs(mark, 10), 0);
    assert.equal(cardElapsedMs(mark, 11), 1000);
    assert.equal(cardElapsedMs(mark, 14), 2000);
  });
});

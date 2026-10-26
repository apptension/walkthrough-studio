import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHAPTER_HOLD, chapterCoverage, chapterPlateId, chapterPlateRows, coveredChapterKeys } from './chapterPlates.mjs';
import { cardMarkKey } from './editDeck.mjs';
import { plateMarks } from './plateFx.mjs';

const mark = (t, label, extra = {}) => ({ kind: 'chapter', t, label, dur: 4, ...extra });
const keyOf = (m) => cardMarkKey(m);

test('a chapter becomes an interstitial-shaped plate row', () => {
  const marks = [mark(1.5, 'Front page feed', { id: 'chapter-1', body: 'What the crowd ranks' })];
  const [row] = chapterPlateRows({}, marks);
  assert.equal(row.id, 'ch1-front-page-feed');
  assert.equal(row.type, 'statement');
  assert.equal(row.title, 'Front page feed');
  assert.equal(row.eyebrow, 'Chapter 1');
  assert.equal(row.sub, 'What the crowd ranks');
  assert.equal(row.chapter, keyOf(marks[0]));
  assert.equal(row.liveAt, 1.5);
  assert.equal(row.hold, 4);
});

test('a chapter with no recorded hold falls back to the card default', () => {
  const [row] = chapterPlateRows({}, [{ kind: 'chapter', t: 2, label: 'Ask HN' }]);
  assert.equal(row.hold, CHAPTER_HOLD);
});

test('plate ids are filename-safe and never collide', () => {
  assert.equal(chapterPlateId({ id: 'chapter-3', label: 'Show HN / Ask HN!' }), 'ch3-show-hn-ask-hn');
  const rows = chapterPlateRows({}, [mark(1, 'Same'), mark(5, 'Same')]);
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
  for (const r of rows) assert.match(r.id, /^[a-z0-9][a-z0-9._-]*$/);
});

test('a saved row wins, so restyling a chapter plate sticks', () => {
  const config = { interstitials: [{ id: 'ch1-ask-hn', type: 'quote', title: 'Renamed', chapter: 'x', style: { energy: 'bold' } }] };
  const [row] = chapterPlateRows(config, [mark(1, 'Ask HN', { id: 'chapter-1' })]);
  assert.equal(row.type, 'quote');
  assert.equal(row.title, 'Renamed');
  assert.deepEqual(row.style, { energy: 'bold' });
  // Derived facts still come from the recording.
  assert.equal(row.liveAt, 1);
  assert.equal(row.hold, 4);
});

test('a hand-authored plate id is never stolen by a chapter', () => {
  const config = { interstitials: [{ id: 'ch1-ask-hn', type: 'statement', before: 'Something else' }] };
  const [row] = chapterPlateRows(config, [mark(1, 'Ask HN', { id: 'chapter-1' })]);
  assert.notEqual(row.id, 'ch1-ask-hn');
});

test('edit.chapterCards sends a chapter back to being an overlay card', () => {
  const marks = [mark(1, 'Keep'), mark(9, 'Drop')];
  const rows = chapterPlateRows({}, marks, { chapterCards: [keyOf(marks[1])] });
  assert.deepEqual(
    rows.map((r) => r.title),
    ['Keep'],
  );
});

test('a plate placed before a chapter absorbs it rather than doubling up', () => {
  const config = { interstitials: [{ id: 'map', type: 'statement', before: 'Front page feed' }] };
  const marks = [mark(1.5, 'Front page feed', { id: 'chapter-1' }), mark(20, 'Ask HN', { id: 'chapter-2' })];
  const { rows, absorbed } = chapterCoverage(config, marks);
  assert.deepEqual(
    rows.map((r) => r.title),
    ['Ask HN'],
  );
  const a = absorbed.get(keyOf(marks[0]));
  assert.equal(a.by, 'map');
  assert.equal(a.hold, 4);
  assert.equal(a.label, 'Front page feed');
});

test('coveredChapterKeys names every chapter a plate speaks for', () => {
  const config = { interstitials: [{ id: 'map', type: 'statement', before: 'One' }] };
  const marks = [mark(1, 'One', { id: 'chapter-1' }), mark(9, 'Two', { id: 'chapter-2' })];
  const keys = coveredChapterKeys({ config }, { marks });
  assert.equal(keys.size, 2);
  for (const m of marks) assert.ok(keys.has(keyOf(m)));
});

test('a chapter mark copied forward by the recorder never gets a second plate', () => {
  const marks = [mark(1, 'One', { id: 'chapter-1' }), { ...mark(6, 'One', { id: 'chapter-1' }), copyOf: 1 }];
  assert.equal(chapterPlateRows({}, marks).length, 1);
});

test('plate marks resolve to output pixels, so they survive a resolution change', () => {
  const deck = {
    zooms: [{ id: 'z1', clip: 'ch1', t: 1, dur: 2, zoom: 1.8, nx: 0.25, ny: 0.5 }, { id: 'z2', t: 4, dur: 2, zoom: 1.6, x: 10, y: 10 }],
    lenses: [{ id: 'm1', clip: 'ch1', t: 1, dur: 2, nx: 0.5, ny: 0.25, nw: 0.2, nh: 0.1, label: 'Here' }],
  };
  const { zooms, lenses } = plateMarks(deck, 'ch1', { width: 1920, height: 1080 });
  assert.equal(zooms.length, 1, 'a recording zoom is not a plate zoom');
  assert.equal(zooms[0].x, 480);
  assert.equal(zooms[0].y, 540);
  assert.deepEqual(lenses[0].rect, { x: 768, y: 216, w: 384, h: 108 });
  assert.equal(lenses[0].label, 'Here');
  const wide = plateMarks(deck, 'ch1', { width: 3840, height: 2160 });
  assert.equal(wide.zooms[0].x, 960);
  assert.deepEqual(wide.lenses[0].rect, { x: 1536, y: 432, w: 768, h: 216 });
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyCardEdits,
  applySegmentCuts,
  applySegmentOmit,
  applySegmentOrder,
  applySegmentTrims,
  cardMarkKey,
  compactEdit,
  describeDeck,
  editCameraMarks,
  injectStyle,
  joinKey,
  liveTimeMap,
  normalizeCards,
  normalizeEdit,
  patchEdit,
  patchStyle,
  rampConflicts,
  remapTimeline,
  resolveLenses,
  withEditLenses,
  speedFilter,
  styleGroupsFor,
} from './editDeck.mjs';
import { blockedWindows, planZooms } from './camera.mjs';
import { lensGeometry } from './lens.mjs';
import { TRANSITION_STYLES } from './edit.mjs';

test('patchStyle validates against the catalog and formats units', () => {
  const style = patchStyle({}, { '--gold': '#E9B949', '--motion-enter': '0.731', '--card-tilt': 40, '--sheen': 'off' });
  assert.deepEqual(style, { '--gold': '#e9b949', '--motion-enter': '0.73s', '--card-tilt': '24deg', '--sheen': '0' });
  assert.throws(() => patchStyle({}, { '--nope': '1' }), /Unknown plate variable/);
  assert.throws(() => patchStyle({}, { '--gold': 'url(x)' }), /CSS colour/);
  assert.throws(() => patchStyle({}, { '--open-logo-top': 40 }, 'features'), /only applies/);
  assert.equal(patchStyle({ '--gold': '#fff' }, { '--gold': null }), undefined);
  assert.ok(styleGroupsFor('open').some((g) => g.id === 'open'));
  assert.ok(!styleGroupsFor('stats-1').some((g) => g.id === 'open'));
  assert.ok(styleGroupsFor('close').some((g) => g.id === 'close'));
  assert.ok(!styleGroupsFor('open').some((g) => g.id === 'close'));
  const close = patchStyle({}, { '--close-logo': 'off', '--close-logo-top': 82, '--close-logo-width': 360, '--close-lift-scale': 1.1, '--close-lift-y': -8 }, 'close');
  assert.deepEqual(close, {
    '--close-logo': '0',
    '--close-logo-top': '82%',
    '--close-logo-width': '360px',
    '--close-lift-scale': '1.1',
    '--close-lift-y': '-8%',
  });
  assert.throws(() => patchStyle({}, { '--close-logo-top': 70 }, 'open'), /only applies/);

  // Type-gated brand mark / orbit groups (interstitial ids are arbitrary; type decides).
  assert.ok(styleGroupsFor('real-browser', 'statement').some((g) => g.id === 'mark'));
  assert.ok(styleGroupsFor('caps', 'features').some((g) => g.id === 'mark'));
  assert.ok(styleGroupsFor('hero-q', 'quote').some((g) => g.id === 'mark'));
  assert.ok(!styleGroupsFor('stats-1', 'stats').some((g) => g.id === 'mark'));
  assert.ok(styleGroupsFor('ring', 'orbit').some((g) => g.id === 'orbit'));
  assert.ok(!styleGroupsFor('wall', 'logos').some((g) => g.id === 'orbit'));

  const mark = patchStyle(
    {},
    { '--mark-logo': 'off', '--mark-logo-size': 40, '--mark-logo-width': 200, '--mark-logo-x': 80, '--mark-logo-y': 40 },
    { plateId: 'real-browser', plateType: 'statement' }
  );
  assert.deepEqual(mark, {
    '--mark-logo': '0',
    '--mark-logo-size': '40px',
    '--mark-logo-width': '200px',
    '--mark-logo-x': '80px',
    '--mark-logo-y': '40px',
  });
  assert.throws(
    () => patchStyle({}, { '--mark-logo-size': 40 }, { plateId: 'stats-1', plateType: 'stats' }),
    /only applies/
  );

  const orbit = patchStyle(
    {},
    { '--orbit-logo': 'on', '--orbit-logo-size': 72, '--orbit-center-scale': 1.15 },
    { plateId: 'integrations', plateType: 'orbit' }
  );
  assert.deepEqual(orbit, {
    '--orbit-logo': '1',
    '--orbit-logo-size': '72px',
    '--orbit-center-scale': '1.15',
  });

  const openHide = patchStyle({}, { '--open-logo': 'off' }, 'open');
  assert.equal(openHide['--open-logo'], '0');
});

test('injectStyle appends one late style block and is idempotent', () => {
  const html = '<html><head><style>:root{--gold:#000}</style></head><body></body></html>';
  const once = injectStyle(html, { '--gold': '#fff', '--sheen': '0' });
  assert.match(once, /<style data-plate-style>:root\{--gold:#fff;--sheen:0\}<\/style>\n<\/head>/);
  const twice = injectStyle(once, { '--gold': '#abc' });
  assert.equal((twice.match(/data-plate-style/g) || []).length, 1);
  assert.match(twice, /--gold:#abc/);
  assert.equal(injectStyle(once, undefined), html);
});

test('normalizeEdit sorts ramps, rejects overlaps and out-of-range rates', () => {
  const deck = normalizeEdit(
    { speed: [{ from: 20, to: 30, rate: 2 }, { from: 5, to: 9, rate: 1.5 }], zooms: [{ t: 3, dur: 4, zoom: 9, x: -5, y: 5000 }] },
    { liveDur: 60, width: 1920, height: 1080, styles: TRANSITION_STYLES }
  );
  assert.deepEqual(deck.speed.map((r) => r.from), [5, 20]);
  assert.deepEqual(deck.zooms[0], { id: 'z30', t: 3, dur: 4, zoom: 2.2, x: 0, y: 1080 });
  assert.throws(() => normalizeEdit({ speed: [{ from: 0, to: 5, rate: 2 }, { from: 4, to: 8, rate: 2 }] }), /overlap/);
  assert.throws(() => normalizeEdit({ speed: [{ from: 0, to: 5, rate: 9 }] }), /between/);
  assert.throws(() => normalizeEdit({ transitions: { 'live>x': { style: 'nope' } } }, { styles: TRANSITION_STYLES }), /Unknown transition/);
  const pinned = normalizeEdit({ transitions: { 'live>features': { style: 'push', duration: 5 } } }, { styles: TRANSITION_STYLES });
  assert.deepEqual(pinned.transitions, { 'live>features': { style: 'push', duration: 1.2 } });
});

test('a sequence order permutes the slices and stores only when it differs', () => {
  const segs = ['open', 'live-0.00', 'capabilities', 'live-12.40', 'close'].map((id) => ({ id }));
  const swapped = applySegmentOrder(segs, ['open', 'capabilities', 'live-0.00', 'live-12.40', 'close']);
  assert.deepEqual(swapped.map((s) => s.id), ['open', 'capabilities', 'live-0.00', 'live-12.40', 'close']);
  const grown = applySegmentOrder(
    [...segs.slice(0, 3), { id: 'proof' }, ...segs.slice(3)],
    ['open', 'capabilities', 'live-0.00', 'live-12.40', 'close']
  );
  assert.deepEqual(grown.map((s) => s.id), ['open', 'capabilities', 'proof', 'live-0.00', 'live-12.40', 'close']);
  assert.equal(applySegmentOrder(segs, ['missing']), segs);
  const deck = normalizeEdit({ order: ['open', 'open', 'nope id', 'close'] });
  assert.deepEqual(deck.order, ['open', 'close']);
  assert.deepEqual(compactEdit(deck).order, ['open', 'close']);
  assert.equal(compactEdit(patchEdit(deck, { order: [] })), undefined);
});

test('omit drops sections from the cut but never empties it', () => {
  const segs = ['open', 'live-0.00', 'capabilities', 'close'].map((id) => ({ id }));
  assert.deepEqual(
    applySegmentOmit(segs, ['capabilities', 'live-0.00']).map((s) => s.id),
    ['open', 'close']
  );
  assert.deepEqual(applySegmentOmit(segs, segs.map((s) => s.id)).map((s) => s.id), segs.map((s) => s.id));
  const deck = normalizeEdit({ omit: ['capabilities', 'capabilities', 'nope id'] });
  assert.deepEqual(deck.omit, ['capabilities']);
  assert.deepEqual(compactEdit(deck).omit, ['capabilities']);
});

test('cuts punch a hole in a live slice and close up', () => {
  const live = { kind: 'live', id: 'live-0.00', recFrom: 0, recTo: 10, start: 0, end: 10, dur: 10, opensOnCard: true };
  const mid = applySegmentCuts([live], [{ from: 4, to: 6 }]);
  assert.equal(mid.length, 2);
  assert.equal(mid[0].id, 'live-0.00');
  assert.equal(mid[0].recFrom, 0);
  assert.equal(mid[0].recTo, 4);
  assert.equal(mid[0].hardCut, undefined);
  assert.equal(mid[0].opensOnCard, true);
  assert.equal(mid[1].id, 'live-6.00');
  assert.equal(mid[1].recFrom, 6);
  assert.equal(mid[1].recTo, 10);
  assert.equal(mid[1].hardCut, true);
  assert.equal(mid[1].opensOnCard, undefined);
  const head = applySegmentCuts([live], [{ from: 0, to: 1 }]);
  assert.equal(head.length, 1);
  assert.equal(head[0].recFrom, 1);
  assert.equal(head[0].hardCut, undefined);
  assert.equal(head[0].opensOnCard, undefined);
  const tail = applySegmentCuts([live], [{ from: 9.8, to: 10 }]);
  assert.equal(tail.length, 1);
  assert.equal(tail[0].recTo, 9.8);
  assert.equal(tail[0].hardCut, undefined);
  // A 0.3s cut is kept; the 0.2s of footage after it is under the keep floor, so that sliver is absorbed.
  const sliver = applySegmentCuts([live], [{ from: 9.5, to: 9.8 }]);
  assert.equal(sliver.length, 1);
  assert.equal(sliver[0].recTo, 9.5);
});

test('a cut that covers a slice drops it, and never empties the cut', () => {
  const plate = { kind: 'plate', id: 'open', start: 0, end: 3, dur: 3 };
  const live = { kind: 'live', id: 'live-0.00', recFrom: 0, recTo: 10, start: 0, end: 10, dur: 10 };
  const punched = applySegmentCuts([plate, live], [{ from: 0, to: 10 }]);
  assert.deepEqual(punched.map((s) => s.id), ['open']);
  const only = [live];
  assert.equal(applySegmentCuts(only, [{ from: 0, to: 10 }]), only);
});

test('cuts merge, drop slivers, and round-trip through the deck', () => {
  const deck = normalizeEdit({ cuts: [{ from: 2, to: 5 }, { from: 4, to: 7 }, { from: 1, to: 1.1 }, { to: 9, from: 12 }] }, { liveDur: 20 });
  assert.deepEqual(deck.cuts, [
    { from: 2, to: 7 },
    { from: 9, to: 12 },
  ]);
  assert.equal(describeDeck(deck), '2 cuts · 8.0s removed');
  assert.deepEqual(compactEdit(deck).cuts, deck.cuts);
  const cleared = patchEdit(deck, { cuts: [] }, { liveDur: 20 });
  assert.deepEqual(cleared.cuts, []);
  assert.equal(compactEdit(cleared), undefined);
});

test('cuts follow the recording clock through a speed ramp', () => {
  const map = liveTimeMap([{ from: 0, to: 10, rate: 2 }], 10);
  const seg = { kind: 'live', id: 'live', start: 0, end: 5, dur: 5 };
  const pieces = applySegmentCuts([seg], [{ from: 2, to: 4 }], map);
  assert.equal(pieces.length, 2);
  assert.deepEqual([pieces[0].recFrom, pieces[0].recTo, pieces[0].start, pieces[0].end], [0, 2, 0, 1]);
  assert.equal(pieces[0].hardCut, undefined);
  assert.deepEqual([pieces[1].recFrom, pieces[1].recTo, pieces[1].start, pieces[1].end], [4, 10, 2, 5]);
  assert.equal(pieces[1].hardCut, true);
});

test('live trims cut head and tail and keep a minimum duration', () => {
  const segs = [
    { kind: 'plate', id: 'open', start: 0, end: 3, dur: 3 },
    { kind: 'live', id: 'live-0.00', recFrom: 0, recTo: 10, start: 0, end: 10, dur: 10 },
  ];
  const trimmed = applySegmentTrims(segs, [{ id: 'live-0.00', trimStart: 2, trimEnd: 1 }]);
  assert.equal(trimmed[1].recFrom, 2);
  assert.equal(trimmed[1].recTo, 9);
  assert.equal(trimmed[1].dur, 7);
  const deck = normalizeEdit({ trims: [{ id: 'live-0.00', trimStart: 2, trimEnd: 0 }] });
  assert.deepEqual(deck.trims, [{ id: 'live-0.00', trimStart: 2 }]);
  assert.deepEqual(compactEdit(deck).trims, [{ id: 'live-0.00', trimStart: 2 }]);
});

test('patchEdit replaces lists wholesale, reset clears, compactEdit drops empties', () => {
  const cur = { speed: [{ from: 1, to: 3, rate: 2 }], zooms: [{ t: 1, dur: 2, zoom: 1.5 }] };
  const next = patchEdit(cur, { speed: [] }, { liveDur: 10 });
  assert.equal(next.speed.length, 0);
  assert.equal(next.zooms.length, 1);
  assert.equal(compactEdit(patchEdit(cur, { reset: true })), undefined);
  assert.deepEqual(Object.keys(compactEdit(next)), ['zooms']);
});

test('liveTimeMap is a monotonic bijection with a 1× identity', () => {
  const map = liveTimeMap([{ from: 10, to: 20, rate: 2 }, { from: 30, to: 34, rate: 0.5 }], 40);
  assert.equal(map.cleanDur, 10 + 5 + 10 + 8 + 6);
  assert.equal(map.toClean(10), 10);
  assert.equal(map.toClean(15), 12.5);
  assert.equal(map.toClean(20), 15);
  assert.equal(map.toClean(32), 25 + 4);
  assert.equal(map.toClean(40), 39);
  for (const t of [0, 3, 10, 14.2, 20, 25, 31, 34, 40]) {
    assert.ok(Math.abs(map.fromClean(map.toClean(t)) - t) < 0.002, `round trip ${t}`);
  }
  assert.equal(map.rateAt(12), 2);
  assert.equal(map.rateAt(5), 1);
  const id = liveTimeMap([], 12);
  assert.ok(id.identity);
  assert.equal(id.toClean(7.25), 7.25);
  assert.equal(speedFilter(id, 30), null);
});

test('speedFilter builds a nested setpts over T and remapTimeline scales durations', () => {
  const map = liveTimeMap([{ from: 2, to: 6, rate: 2 }], 10);
  const f = speedFilter(map, 30);
  assert.match(f, /^setpts='\(if\(lt\(T,2\.000\),0\.000\+\(T-0\.000\)\/1\.000,if\(lt\(T,6\.000\),2\.000\+\(T-2\.000\)\/2\.000,4\.000\+\(T-6\.000\)\/1\.000\)\)\)\/TB',fps=30$/);
  const marks = remapTimeline([{ kind: 'chapter', t: 3, dur: 2 }, { kind: 'click', t: 8 }], map);
  assert.equal(marks[0].t, 2.5);
  assert.equal(marks[0].dur, 1);
  assert.equal(marks[0].liveT, 3);
  assert.equal(marks[1].t, 6);
});

test('editCameraMarks feed planZooms: edit zooms land, skips keep auto zoom out', () => {
  const deck = normalizeEdit({ zooms: [{ id: 'hero', t: 10, dur: 3, zoom: 1.8, x: 400, y: 300 }], zoomSkips: [{ from: 20, to: 25 }] });
  const timeline = [
    { kind: 'click', t: 22, x: 900, y: 500 },
    { kind: 'click', t: 40, x: 900, y: 500 },
    ...editCameraMarks(deck),
  ];
  const plan = planZooms(timeline, { width: 1920, height: 1080, level: 'subtle', duration: 60 });
  const edit = plan.shots.find((s) => s.source === 'edit');
  assert.ok(edit, 'edit zoom planned');
  assert.equal(edit.id, 'hero');
  assert.equal(edit.zoom, 1.8);
  assert.equal(plan.shots.filter((s) => s.source === 'auto').length, 1, 'click inside the skip window is not zoomed');
  assert.equal(plan.skipped, 1);
});

test('normalizeSkips drops windows that collapse past the end of a shorter reel', () => {
  const deck = normalizeEdit(
    {
      zoomSkips: [
        { from: 10, to: 12 },
        { from: 20, to: 25 },
        { from: 24, to: 30 },
      ],
    },
    { liveDur: 22 }
  );
  assert.deepEqual(deck.zoomSkips, [
    { from: 10, to: 12 },
    { from: 20, to: 22 },
  ]);
  assert.throws(() => normalizeEdit({ zoomSkips: [{ from: 5, to: 5 }] }), /from < to/);
});

test('applyCardEdits / normalizeCards keep start + on-screen duration for produce', () => {
  const mark = { kind: 'chapter', t: 1.303, dur: 5.765, label: 'Meet Apptension' };
  const key = cardMarkKey(mark);
  const deck = normalizeEdit({ cards: [{ key, t: 2, dur: 3.5 }] }, { liveDur: 120 });
  assert.deepEqual(deck.cards, [{ key, t: 2, dur: 3.5 }]);
  const next = applyCardEdits([{ ...mark, key }], deck.cards);
  assert.equal(next[0].t, 2);
  assert.equal(next[0].dur, 3.5);
  assert.equal(normalizeCards([{ key, dur: 0.1 }], {})[0].dur, 0.4, 'clamp up to minimum hold');
  assert.equal(normalizeCards([{ key, dur: 40 }], {})[0].dur, 30, 'cap at 30s');
});

test('joinKey collapses live slices; rampConflicts reports covered cards', () => {
  assert.equal(joinKey({ kind: 'live', id: 'live-1.20' }, { kind: 'plate', id: 'features' }), 'live>features');
  assert.equal(joinKey({ kind: 'plate', id: 'open' }, { kind: 'live', id: 'live-0.00' }), 'open>live');
  const deck = normalizeEdit({ speed: [{ from: 10, to: 20, rate: 2 }] });
  const conflicts = rampConflicts(deck, [{ kind: 'chapter', t: 12, dur: 2.8, label: 'Schedule' }, { kind: 'click', t: 15 }]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].marks[0].label, 'Schedule');
});

test('lenses: recorded marks switch off by time, deck lenses render as magnify marks', () => {
  const timeline = [
    { kind: 'magnify', t: 9.676, dur: 2.4, label: 'Total', rect: { x: 100, y: 200, w: 120, h: 30 } },
    { kind: 'click', t: 12, x: 400, y: 400 },
  ];
  const deck = normalizeEdit(
    { lenses: [{ t: 20, dur: 2, x: 600, y: 300, w: 200, h: 40, zoom: 9 }], lensOff: [9.6761] },
    { liveDur: 60 }
  );
  assert.equal(deck.lenses[0].zoom, 2.4, 'zoom clamps to the lens range');
  assert.deepEqual(deck.lensOff, [9.676]);
  const lenses = resolveLenses(timeline, deck);
  assert.equal(lenses.length, 1);
  assert.deepEqual(lenses[0].rect, { x: 500, y: 280, w: 200, h: 40 });
  assert.equal(lenses[0].source, 'edit');
  assert.equal(lensGeometry(lenses[0], { width: 1920, height: 1080 }).zoom, 2.25, 'big targets cap the lens size');
  const windows = blockedWindows(withEditLenses(timeline, deck));
  assert.ok(windows.some(([from, to]) => from < 20 && to > 22), 'auto zoom keeps clear of a deck lens');
  assert.ok(!windows.some(([from, to]) => from < 9.7 && to > 9.7), 'a switched-off lens no longer blocks zoom');
  assert.throws(() => normalizeEdit({ lenses: [{ t: 1, dur: 0.4, x: 1, y: 1 }] }), /at least/);
  assert.equal(compactEdit(patchEdit(deck, { lenses: [], lensOff: [] })), undefined);
  assert.equal(resolveLenses(timeline, normalizeEdit({})).length, 1);
});

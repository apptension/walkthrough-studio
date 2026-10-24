import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, test } from 'node:test';
import { applyCardEdits, cardMarkKey } from './editDeck.mjs';
import {
  alphaPipeArgs,
  bakeClipKey,
  bakeClipName,
  bakeStamp,
  cardBakeOverlayGraph,
  overlaysModeFromLiveMeta,
  planCardBakes,
} from './liveCardBake.mjs';

describe('bakeStamp', () => {
  test('changes when a card’s baked content changes, even at the same path and time', () => {
    const live = { size: 10, mtimeMs: 1 };
    const plan = { cardId: 'overlay:chapter:0', t: 1, dur: 2, htmlPath: '/x/overlay-chapter-0.html', key: 'aaaa' };
    const a = bakeStamp(live, [plan], { preset: 'editorial' });
    const b = bakeStamp(live, [{ ...plan, key: 'bbbb' }], { preset: 'editorial' });
    assert.notEqual(a, b, 'a per-chapter backdrop edit rewrites the card html → new key → clean pass re-runs');
    assert.equal(a, bakeStamp(live, [{ ...plan }], { preset: 'editorial' }));
  });
});

describe('overlaysModeFromLiveMeta', () => {
  test('defaults to burned for legacy takes', () => {
    assert.equal(overlaysModeFromLiveMeta(null), 'burned');
    assert.equal(overlaysModeFromLiveMeta({}), 'burned');
  });
  test('reads clean', () => {
    assert.equal(overlaysModeFromLiveMeta({ overlays: { mode: 'clean' } }), 'clean');
  });
});

describe('planCardBakes', () => {
  test('pairs marks to cards by label then order', () => {
    const cards = [
      { id: 'overlay:chapter:1', kind: 'chapter', label: 'Open', htmlPath: '/a.html', flowIndex: 1 },
      { id: 'overlay:caption:2', kind: 'caption', label: 'Scan', htmlPath: '/b.html', flowIndex: 2 },
    ];
    const plans = planCardBakes(
      [
        { kind: 'chapter', t: 5, dur: 2.5, label: 'Open' },
        { kind: 'caption', t: 8, dur: 2, label: 'Scan' },
        { kind: 'click', t: 9 },
      ],
      cards
    );
    assert.equal(plans.length, 2);
    assert.equal(plans[0].cardId, 'overlay:chapter:1');
    assert.equal(plans[0].dur, 2.5);
    assert.equal(plans[1].cardId, 'overlay:caption:2');
  });

  test('honours edit.cards duration trims for produce bake', () => {
    const mark = { kind: 'caption', t: 7.22, dur: 5.692, label: 'The promise' };
    const key = cardMarkKey(mark);
    const edited = applyCardEdits([{ ...mark, key }], [{ key, t: 8.0, dur: 1.6 }]);
    const plans = planCardBakes(edited, [
      { id: 'overlay:caption:1', kind: 'caption', label: 'The promise', htmlPath: '/c.html', flowIndex: 1 },
    ]);
    assert.equal(plans.length, 1);
    assert.equal(plans[0].t, 8.0);
    assert.equal(plans[0].dur, 1.6);
    assert.equal(bakeClipName(plans[0], 0), '000-caption-t8.00-d1.60.mov');
  });

  test('a duplicated card bakes the source card again at its own time', () => {
    const mark = { kind: 'chapter', t: 3, dur: 2, label: 'Meet the feed' };
    const key = cardMarkKey(mark);
    const marks = applyCardEdits([{ ...mark, key }], [{ key: `${key}#2`, copyOf: key, t: 20, dur: 1.5 }]);
    const plans = planCardBakes(marks, [{ id: 'overlay:chapter:0', kind: 'chapter', label: 'Meet the feed', htmlPath: '/m.html', flowIndex: 0, markKey: key }]);
    assert.deepEqual(
      plans.map((p) => [p.cardId, p.t, p.dur]),
      [
        ['overlay:chapter:0', 3, 2],
        ['overlay:chapter:0', 20, 1.5],
      ]
    );
  });

  test('keyed cards pair by markKey and ignore label collisions', () => {
    const a = { kind: 'caption', t: 2, dur: 2, label: 'Scan the map' };
    const b = { kind: 'caption', t: 9, dur: 3, label: 'Scan the map' };
    const orphan = { kind: 'caption', t: 20, dur: 1, label: 'No card recorded' };
    const timeline = [a, b, orphan].map((m) => ({ ...m, key: cardMarkKey(m) }));
    const cards = [
      // Deliberately reversed flow order and wrong-looking labels: the key must decide.
      { id: 'overlay:caption:4', kind: 'caption', label: 'Caption · Scan the map', htmlPath: '/b.html', flowIndex: 4, markKey: cardMarkKey(b) },
      { id: 'overlay:caption:1', kind: 'caption', label: 'Caption · Scan the map', htmlPath: '/a.html', flowIndex: 1, markKey: cardMarkKey(a) },
    ];
    const plans = planCardBakes(timeline, cards);
    assert.deepEqual(
      plans.map((p) => [p.cardId, p.dur]),
      [
        ['overlay:caption:1', 2],
        ['overlay:caption:4', 3],
      ]
    );
  });
});

describe('cardBakeOverlayGraph', () => {
  test('builds alpha overlay chain for chapter + caption', () => {
    const dir = join(tmpdir(), `wt-bake-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const a = join(dir, 'a.mov');
    const b = join(dir, 'b.mov');
    writeFileSync(a, 'x');
    writeFileSync(b, 'x');
    try {
      const graph = cardBakeOverlayGraph(
        [
          { kind: 'chapter', t: 1, dur: 2 },
          { kind: 'caption', t: 4, dur: 1.5 },
        ],
        [a, b],
        { srcLabel: '[lraw]', outLabel: '[lbake]', startInputIndex: 1 }
      );
      assert.equal(graph.inputCount, 2);
      assert.equal(graph.inputs.length, 4);
      assert.ok(graph.filter.every((f) => !f.includes('colorkey')));
      assert.ok(graph.filter.some((f) => f.includes('format=rgba,setpts=PTS+1.000/TB')));
      assert.ok(graph.filter.some((f) => f.includes('format=rgba,setpts=PTS+4.000/TB')));
      assert.ok(graph.filter.some((f) => f.includes("between(t\\,1.000\\,3.000)")));
      assert.ok(graph.filter.some((f) => f.includes('repeatlast=0')));
      assert.ok(graph.filter.some((f) => f.includes('eof_action=pass')));
      assert.equal(graph.outLabel, '[lbake]');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('places a cropped caption at its measured origin', () => {
    const dir = join(tmpdir(), `wt-bake-crop-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'cap.mov');
    writeFileSync(file, 'x');
    try {
      const graph = cardBakeOverlayGraph(
        [{ kind: 'caption', t: 11.73, dur: 4.36, ox: 624, oy: 884 }],
        [file]
      );
      assert.ok(graph.filter.some((f) => f.includes('overlay=x=624:y=884:')));
      assert.ok(!graph.filter.some((f) => f.includes('overlay=x=0:y=0:')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('bakeClipKey', () => {
  test('ignores mtime and changes when the card html changes', () => {
    const base = { html: '<p>A</p>', css: 'body{}', motion: 'rise', t: 1, dur: 2, pipeline: 7, raster: 'metal' };
    const a = bakeClipKey(base);
    assert.equal(bakeClipKey({ ...base }), a);
    assert.notEqual(bakeClipKey({ ...base, html: '<p>B</p>' }), a);
    assert.equal(bakeClipKey({ ...base, ox: 10, oy: 20, w: 100, h: 40 }), a);
  });
});

describe('alphaPipeArgs', () => {
  test('muxes png frames without decoding them', () => {
    const args = alphaPipeArgs('/tmp/card.mov', { fps: 30 });
    assert.ok(args.includes('-c:v') && args[args.indexOf('-c:v') + 1] === 'copy');
    assert.ok(!args.some((a) => String(a).includes('scale=')));
    const chapter = alphaPipeArgs('/tmp/chapter.mov', { fps: 30, copy: false });
    assert.equal(chapter[chapter.indexOf('-c:v') + 1], 'png');
  });
});

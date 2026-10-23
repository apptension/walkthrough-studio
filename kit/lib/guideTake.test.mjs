import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { adoptGuidedTake, createTakeClock, createTakeFeed, takeFiles, takeTimeline, tourChapters } from './guideTake.mjs';
import { compileGuidedFlow } from './guidedTour.mjs';
import { parseFlowCalls } from './script.mjs';

const T0 = 1_800_000_000_000;

test('the take clock cuts paused stretches instead of freezing them', () => {
  const c = createTakeClock();
  c.begin(T0);
  assert.equal(c.toTake(T0 + 4000), 4000);
  c.pause(T0 + 5000);
  assert.equal(c.toTake(T0 + 9000), 5000, 'a time inside the pause lands on the cut');
  c.resume(T0 + 12000);
  assert.equal(c.toTake(T0 + 12000), 5000, 'resume continues from the cut');
  assert.equal(c.toTake(T0 + 13000), 6000);
  c.pause(T0 + 15000);
  c.resume(T0 + 16000);
  assert.equal(c.toTake(T0 + 20000), 12000, 'every pause is removed');
  assert.deepEqual(c.cuts(), [
    { at: 5, dur: 7 },
    { at: 8, dur: 1 },
  ]);
  assert.equal(c.toTake(T0 + 10000), 5000, 'a past pause still maps onto its cut');
});

test('frames painted while paused are held back; Resume shows the screen as it is now', () => {
  const got = [];
  const clock = createTakeClock();
  const feed = createTakeFeed({ onFrame: (f) => got.push([f.data, f.timestamp - T0]) }, clock);
  feed.onFrame({ data: 'early', timestamp: T0 - 50 });
  clock.begin(T0);
  feed.onFrame({ data: 'a', timestamp: T0 + 100 });
  feed.pause(T0 + 1000);
  feed.onFrame({ data: 'late-a', timestamp: T0 + 990 });
  feed.onFrame({ data: 'setup-1', timestamp: T0 + 2000 });
  feed.onFrame({ data: 'setup-2', timestamp: T0 + 3000 });
  feed.resume(T0 + 6000);
  feed.onFrame({ data: 'b', timestamp: T0 + 6500 });
  assert.deepEqual(got, [
    ['a', 100],
    ['late-a', 990],
    ['setup-2', 1000],
    ['b', 1500],
  ]);
});

const tour = {
  slug: 'fixture',
  finishedAt: '2026-10-23T10:00:00.000Z',
  recordViewport: { width: 1280, height: 720 },
  window: { w: 1280, h: 720 },
  stats: { steps: 3, marks: 1 },
  steps: [
    { id: 's1', type: 'start', url: 'http://x/', title: 'Team board — Acme', at: 0 },
    { id: 's2', type: 'click', at: 2000, target: { role: 'button', name: 'Add', box: { x: 100, y: 40, w: 80, h: 30 }, point: { x: 130, y: 52 } } },
    { id: 's3', type: 'mark', title: 'Plan the week', at: 9000 },
    { id: 's4', type: 'fill', value: 'Ana', at: 11000, target: { role: 'textbox', name: 'Name', tag: 'input', box: { x: 300, y: 200, w: 200, h: 32 } } },
  ],
};

test('take chapters are exactly the chapter() titles of the compiled replay', () => {
  const chapters = tourChapters(tour).map((c) => c.title);
  assert.deepEqual(chapters, ['Team board', 'Plan the week']);
  const calls = parseFlowCalls(compileGuidedFlow(tour, { startUrl: 'http://x/' }))
    .filter((c) => c.kind === 'chapter')
    .map((c) => c.title);
  assert.deepEqual(calls, chapters);
});

test('the take timeline puts chapters, clicks and typing on the take clock', () => {
  const clock = createTakeClock();
  const tourT0 = T0 - 500;
  clock.begin(T0);
  clock.pause(T0 + 4000);
  clock.resume(T0 + 7000);
  const tl = takeTimeline(tour, { clock, tourT0, seconds: 9 });
  const by = (kind) => tl.filter((m) => m.kind === kind);
  assert.equal(tl[0].id, 'start');
  assert.equal(tl.at(-1).id, 'end');
  assert.deepEqual(
    by('chapter').map((m) => [m.label, m.t, m.dur]),
    [
      ['Team board', 0.001],
      ['Plan the week', 5.5],
    ].map(([l, t]) => [l, t, 2.6])
  );
  const [click] = by('click');
  assert.deepEqual([click.t, click.x, click.y, click.rect], [1.5, 130, 52, { x: 100, y: 40, w: 80, h: 30 }]);
  const [type] = by('type');
  assert.equal(type.t, 7.5);
  assert.deepEqual([type.x, type.y], [400, 216], 'no captured point: the centre of the box');
});

test('adoptGuidedTake promotes the take, its timeline and the replay as the script of record', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-take-'));
  const video = { slug: 'fixture', dir: join(root, 'v'), out: join(root, 'o'), config: { record: { startUrl: 'http://x/' } } };
  mkdirSync(join(video.out, 'guide'), { recursive: true });
  mkdirSync(video.dir, { recursive: true });
  try {
    assert.throws(() => adoptGuidedTake(video), /No recording from the last guided session/);
    const f = takeFiles(video);
    writeFileSync(f.take, 'MP4');
    writeFileSync(f.poster, 'JPG');
    const timeline = [
      { id: 'start', kind: 'mark', label: 'live start', t: 0.001 },
      { id: 'chapter-1', kind: 'chapter', label: 'Team board', t: 0 },
      { id: 'end', kind: 'mark', label: 'live end', t: 8.6 },
    ];
    writeFileSync(f.meta, JSON.stringify({ seconds: 9, frames: 270, timeline, viewport: { width: 1280, height: 720 }, cuts: [{ at: 3.5, dur: 3 }], tourFinishedAt: tour.finishedAt }));
    writeFileSync(join(video.dir, 'guided-tour.json'), JSON.stringify(tour));
    writeFileSync(join(video.dir, 'guided-flow.mjs'), '// replay\n');
    writeFileSync(join(video.dir, 'flow.mjs'), '// bot script\n');
    writeFileSync(join(video.out, 'frame-text.json'), '[]');
    let checked = null;
    const r = adoptGuidedTake(video, { assertPlayable: (file, opts) => (checked = [file, opts.expectedSec]) });
    assert.deepEqual(checked, [f.take, 9]);
    assert.equal(readFileSync(join(video.out, 'live.mp4'), 'utf8'), 'MP4');
    assert.deepEqual(JSON.parse(readFileSync(join(video.out, 'timeline.json'), 'utf8')), timeline);
    const meta = JSON.parse(readFileSync(join(video.out, 'live-meta.json'), 'utf8'));
    assert.equal(meta.source, 'reviewer');
    assert.deepEqual(meta.capture.viewport, { width: 1280, height: 720 });
    assert.deepEqual(meta.capture.raster, meta.capture.viewport, 'reel space reads the take 1:1');
    assert.equal(readFileSync(join(video.dir, 'flow.mjs'), 'utf8'), '// replay\n');
    assert.equal(readFileSync(join(video.dir, 'flow.before-take.mjs'), 'utf8'), '// bot script\n', 'the old script is kept');
    assert.equal(readFileSync(join(video.out, 'live-preview.jpg'), 'utf8'), 'JPG');
    assert.equal(existsSync(join(video.out, 'frame-text.json')), false, 'screen text from the old take is dropped');
    assert.deepEqual(r.chapters, ['Team board']);

    writeFileSync(join(video.dir, 'guided-tour.json'), JSON.stringify({ ...tour, finishedAt: '2026-10-24T00:00:00.000Z' }));
    assert.throws(() => adoptGuidedTake(video), /different sessions/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

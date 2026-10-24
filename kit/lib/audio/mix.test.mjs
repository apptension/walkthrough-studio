import assert from 'node:assert/strict';
import { test } from 'node:test';
import { musicEditFilters, musicFit } from './mix.mjs';

const BED = { bedStart: 6, bedLen: 45 };
const fmt = 'aresample=48000';

test('musicFit trims a longer composed bed mid-demo so the outro lands on the close plate', () => {
  // 70 s bed, outro at 62 s; 60 s picture with a 5 s close → outro due at 53.5 s.
  const fit = musicFit({ musicDur: 70, total: 60, anchorAt: 62, anchorTo: 53.5, ...BED });
  assert.equal(fit.kind, 'trim');
  assert.equal(fit.joins, 1);
  assert.equal(fit.cut, 26.25);
  assert.equal(fit.from, 32.75);
  assert.equal(fit.shortfallSec, 0);
  assert.equal(fit.warning, null);
});

test('musicFit snaps a trim to whole bars, rounding toward coverage', () => {
  const fit = musicFit({ musicDur: 70, total: 60, anchorAt: 62, anchorTo: 53.5, ...BED, barSec: 2 });
  assert.equal(fit.from - fit.cut, 6);
  assert.equal(fit.shortfallSec, 0);
});

test('musicFit leaves a bed that already fits alone', () => {
  const fit = musicFit({ musicDur: 61, total: 60, anchorAt: 54.5, anchorTo: 53.5, ...BED });
  assert.equal(fit.kind, 'fit');
  assert.equal(fit.joins, 0);
  assert.deepEqual(musicEditFilters(fit, { input: '[1:a]', fmt }), []);
});

test('musicFit extends a slightly short bed with one long crossfaded repeat and warns', () => {
  const fit = musicFit({ musicDur: 50, total: 60, ...BED });
  assert.equal(fit.kind, 'extend');
  assert.equal(fit.joins, 1);
  assert.equal(fit.xfade, 4);
  assert.equal(fit.shortfallSec, 0);
  assert.match(fit.warning, /^⚠ music is 10\.0s short/);
});

test('musicFit never loops without the desk switch: a far-short bed is reported silent', () => {
  const fit = musicFit({ musicDur: 30, total: 90, ...BED });
  assert.equal(fit.kind, 'short');
  assert.equal(fit.joins, 0);
  assert.equal(fit.shortfallSec, 60);
  assert.match(fit.warning, /^⚠ music ends 60\.0s before the picture/);
});

test('musicFit loops with equal-power crossfades when Loop to fill is on, and warns', () => {
  const fit = musicFit({ musicDur: 30, total: 90, ...BED, loop: true });
  assert.equal(fit.kind, 'loop');
  assert.ok(fit.joins >= 2);
  assert.equal(fit.shortfallSec, 0);
  assert.match(fit.warning, /^⚠ music looped/);
  const filters = musicEditFilters(fit, { input: '[1:a]', fmt });
  const graph = filters.join(';');
  assert.ok(!/aloop|stream_loop|concat/.test(graph), graph);
  assert.equal((graph.match(/acrossfade=d=4:c1=qsin:c2=qsin/g) || []).length, fit.joins);
  assert.ok(graph.startsWith(`[1:a]${fmt},asplit=${fit.joins + 1}`));
  assert.ok(graph.endsWith('[medit]'));
  // Head, repeats and the tail that carries the ending.
  assert.ok(graph.includes(`atrim=0:${fit.cut.toFixed(3)}`));
  assert.ok(graph.includes(`atrim=${fit.from.toFixed(3)}:${fit.cut.toFixed(3)}`));
  assert.ok(graph.includes(`atrim=start=${fit.from.toFixed(3)}`));
});

test('musicEditFilters for a trim is one forward jump', () => {
  const fit = musicFit({ musicDur: 70, total: 60, anchorAt: 62, anchorTo: 53.5, ...BED });
  const filters = musicEditFilters(fit, { input: '[2:a]', fmt });
  assert.deepEqual(filters, [
    `[2:a]${fmt},asplit=2[mp0][mp1]`,
    '[mp0]atrim=0:26.250,asetpts=PTS-STARTPTS[mq0]',
    '[mp1]atrim=start=32.750,asetpts=PTS-STARTPTS[mq1]',
    '[mq0][mq1]acrossfade=d=2:c1=qsin:c2=qsin[medit]',
  ]);
});

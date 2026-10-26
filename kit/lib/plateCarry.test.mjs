import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { atmosphereSnippet } from './atmosphere.mjs';
import { platePlayback } from './editDeck.mjs';
import { TRANSITION_STYLES } from './edit.mjs';
import { CARRY_STYLE, carryCheck, carryFrameClock, markCarryRuns, plateBackdrop, plateCarryRuntimeSource, plateHasFx } from './plateCarry.mjs';

const brand = (motion = {}, colors = {}) => ({
  colors: { ink: '#0a1f0a', surface: '#0f2a0f', gold: '#0ca300', amber: '#7ac943', teal: '#2dd4bf', ...colors },
  motion: { atmosphere: 'aurora', ...motion },
});

const plate = (id, extra = {}) => ({ kind: 'plate', id, ...extra });

test('plates with the same atmosphere, tuning and colours share a backdrop key', () => {
  const a = plateBackdrop(brand());
  const b = plateBackdrop(brand());
  assert.equal(a.key, b.key);
  assert.equal(a.atmosphere.id, 'aurora');
  assert.equal(a.colors['--gold'], '#0ca300');
});

test('a different field, its tuning, a colour or a style override changes the key', () => {
  const base = plateBackdrop(brand()).key;
  assert.notEqual(plateBackdrop(brand({ atmosphere: 'mesh' })).key, base);
  assert.notEqual(plateBackdrop(brand({ atmosphereSpeed: 1.6 })).key, base);
  assert.notEqual(plateBackdrop(brand({}, { ink: '#000000' })).key, base);
  assert.notEqual(plateBackdrop(brand(), { '--surface': '#123456' }).key, base);
  // Style variables that do not paint the backdrop leave it alone.
  assert.equal(plateBackdrop(brand(), { '--text': '#ffffff', '--motion-push': '1.06' }).key, base);
});

test('carryCheck explains every join that cannot carry its background', () => {
  const same = plateBackdrop(brand());
  const backdrops = { a: same, b: same, c: plateBackdrop(brand({ atmosphere: 'mesh' })), d: plateBackdrop(brand({}, { gold: '#ff0000' })) };
  assert.deepEqual(carryCheck(plate('a'), plate('b'), { backdrops }), { ok: true, why: 'same background' });
  assert.equal(carryCheck(plate('a'), { kind: 'live', id: 'live-1' }, { backdrops }).ok, false);
  assert.equal(carryCheck(plate('a'), plate('c'), { backdrops }).why, 'different atmospheres');
  assert.equal(carryCheck(plate('a'), plate('d'), { backdrops }).why, 'different background colours');
  assert.equal(carryCheck(plate('a'), plate('b'), { backdrops, style: 'dip' }).why, 'set to dip');
  assert.equal(carryCheck(plate('a'), plate('b'), { backdrops, style: 'dissolve' }).ok, true);
  assert.equal(carryCheck(plate('a'), plate('b'), { backdrops, style: CARRY_STYLE }).ok, true);
  const deck = { zooms: [{ clip: 'b', t: 1, dur: 2 }] };
  assert.equal(carryCheck(plate('a'), plate('b'), { backdrops, deck }).why, 'a zoom or magnifier moves the background');
  assert.equal(carryCheck(plate('a'), plate('b', { hardCut: true }), { backdrops }).ok, false);
  // A replay looks its source up; Editor scenes name the plate directly.
  assert.equal(carryCheck(plate('a'), plate('b~2', { repeatOf: 'b' }), { backdrops }).ok, true);
  assert.equal(carryCheck({ kind: 'plate', id: 'x', plateId: 'a' }, { kind: 'plate', id: 'y', plateId: 'b' }, { backdrops }).ok, true);
});

test('plateHasFx sees zooms and magnifiers by clip', () => {
  assert.equal(plateHasFx({ lenses: [{ clip: 'map' }] }, 'map'), true);
  assert.equal(plateHasFx({ zooms: [{ clip: 'open' }] }, 'map'), false);
  assert.equal(plateHasFx(null, 'map'), false);
});

test('markCarryRuns gives each carried plate its edges and its place on the run clock', () => {
  const join = (type) => ({ type, dur: 0.6 });
  const segs = [
    { kind: 'plate', id: 'open', at: 0, dur: 6, transitionIn: null },
    { kind: 'plate', id: 'a', at: 5.4, dur: 6, transitionIn: join(CARRY_STYLE) },
    { kind: 'plate', id: 'b', at: 10.8, dur: 5, transitionIn: join(CARRY_STYLE) },
    { kind: 'live', id: 'live-1', at: 15.2, dur: 20, transitionIn: join('dissolve') },
    { kind: 'plate', id: 'c', at: 34.6, dur: 6, transitionIn: join('wipe') },
    { kind: 'plate', id: 'close', at: 40, dur: 7, transitionIn: join(CARRY_STYLE) },
  ];
  markCarryRuns(segs);
  assert.deepEqual(segs[0].carry, { in: false, out: true, bgAt: 0, run: 0 });
  assert.deepEqual(segs[1].carry, { in: true, out: true, bgAt: 5.4, run: 0 });
  assert.deepEqual(segs[2].carry, { in: true, out: false, bgAt: 10.8, run: 0 });
  assert.equal(segs[3].carry, undefined);
  assert.deepEqual(segs[4].carry, { in: false, out: true, bgAt: 0, run: 1 });
  assert.deepEqual(segs[5].carry, { in: true, out: false, bgAt: 5.4, run: 1 });
});

test('carryFrameClock: copy on the plate clock (hold, speed, pad), backdrop straight through', () => {
  const plain = carryFrameClock({ dur: 1, bgAt: 2, fps: 10, baseDur: 0.5 });
  assert.equal(plain.length, 10);
  assert.deepEqual(plain[3], [300, 2300]);
  // Past the plate's own end the copy holds its clear tail; the backdrop keeps going.
  assert.deepEqual(plain[9], [500, 2900]);

  const pb = platePlayback({ hold: 1, rate: 2 }, 4, 2);
  const timed = carryFrameClock({ dur: pb.dur, bgAt: 0, fps: 10, playback: pb, baseDur: 4 });
  assert.equal(timed.length, Math.round(pb.dur * 10));
  assert.deepEqual(timed[5], [1000, 500]);
  // Inside the hold the copy stands still while the backdrop moves.
  const held = timed.filter(([c]) => c === 2000);
  assert.ok(held.length >= 10);
  assert.ok(held.at(-1)[1] - held[0][1] >= 900);
});

test('Continuous is a transition style that renders as a dissolve', () => {
  assert.equal(TRANSITION_STYLES[CARRY_STYLE].xfade, 'fade');
  assert.equal(TRANSITION_STYLES[CARRY_STYLE].label, 'Continuous');
});

test('every plate page ships the carry runtime and a two-clock renderAt', () => {
  const { script } = atmosphereSnippet(brand());
  assert.match(script, /installPlateCarry\(window\)/);
  assert.match(script, /renderAt\(ms, bgMs\)/);
  assert.match(script, /carry\.in \? 1/);
  for (const body of script.split('<script>').slice(1).map((x) => x.split('</script>')[0])) {
    assert.doesNotThrow(() => new vm.Script(body));
  }
  // Local (embedded) fields stay without it — they live inside another page.
  assert.doesNotMatch(atmosphereSnippet(brand(), { local: true }).script, /installPlateCarry/);
  assert.doesNotThrow(() => new vm.Script(plateCarryRuntimeSource()));
});

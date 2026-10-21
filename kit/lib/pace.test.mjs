import assert from 'node:assert/strict';
import { test } from 'node:test';
import { glidePath } from './cursor.mjs';
import { PACE_PRESETS, normalizePace, patchDirection, resolveDirection, resolvePace } from './direction.mjs';
import { createStory } from './motion.mjs';

test('pace: presets and multipliers resolve, junk falls back to steady', () => {
  assert.equal(resolvePace('brisk').tempo, 1.25);
  assert.equal(resolvePace(undefined).id, 'steady');
  assert.equal(resolvePace('warp').id, 'steady');
  assert.deepEqual(resolvePace(1.4), { id: 'custom', tempo: 1.4, label: '1.4×', hint: 'Custom multiplier on every authored hold', custom: true });
  assert.equal(normalizePace('1.25'), 'brisk', 'a multiplier equal to a preset snaps to it');
  assert.equal(normalizePace(' '), undefined);
  assert.throws(() => normalizePace(3), /pace must be one of/);
  assert.throws(() => normalizePace('fast'), /pace must be one of/);
  assert.equal(resolveDirection({ direction: { pace: 'quick' } }, {}).pace.tempo, PACE_PRESETS.quick.tempo);
});

test('pace: patchDirection stores presets and numbers, steady clears the key', () => {
  const brisk = patchDirection({}, { pace: 'brisk' });
  assert.equal(brisk.pace, 'brisk');
  assert.equal(patchDirection(brisk, { pace: 'steady' }).pace, undefined);
  assert.equal(patchDirection(brisk, { pace: '0.9' }).pace, 0.9);
  assert.throws(() => patchDirection({}, { pace: 'turbo' }), /pace must be one of/);
  assert.equal(patchDirection({ pace: 'calm', approvedAt: 'x' }, { pace: 'calm' }).approvedAt, undefined, 'a change drops approval');
});

test('pace: story minimums scale with tempo but keep the card motion floors', async () => {
  const marks = [];
  const brand = { colors: { ink: '#000', surface: '#111', gold: '#fc0', amber: '#f90', teal: '#0cc', muted: '#999' }, font: { family: 'Inter' } };
  const page = { evaluate: async () => {} };
  let tempo = 1;
  const story = createStory({ wait: async () => {}, mark: (id, label, kind, extra) => marks.push({ id, label, kind, ...extra }), brand, tempo: () => tempo });
  // Overlays are created lazily against the page stub; the mark is written before they draw.
  await story.chapter(page, 'Steady', 'body').catch(() => {});
  tempo = 1.5;
  await story.chapter(page, 'Quick', 'body').catch(() => {});
  const [steady, quick] = marks.filter((m) => m.kind === 'chapter');
  assert.ok(steady && quick, 'both chapter marks recorded');
  assert.equal(Math.round(steady.dur * 1000), 2800);
  assert.equal(Math.round(quick.dur * 1000), Math.round(2800 / 1.5));
  tempo = 2;
  await story.chapter(page, 'Floor', 'body', 1000).catch(() => {});
  const floor = marks.filter((m) => m.kind === 'chapter').at(-1);
  assert.equal(Math.round(floor.dur * 1000), 1500, 'chapter card never shorter than its motion floor');
});

test('pace: pointer glide gets faster with tempo, never below 160 ms', () => {
  const steady = glidePath({ x: 0, y: 0 }, { x: 900, y: 300 });
  const brisk = glidePath({ x: 0, y: 0 }, { x: 900, y: 300 }, { speed: 1.25 });
  assert.equal(brisk.duration, Math.round(steady.duration / 1.25));
  assert.equal(glidePath({ x: 0, y: 0 }, { x: 60, y: 0 }, { speed: 2 }).duration, 160);
  assert.equal(glidePath({ x: 0, y: 0 }, { x: 900, y: 300 }, { ms: 500, speed: 2 }).duration, 250, 'explicit travel time scales too');
});

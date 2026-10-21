import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ATMOSPHERE_IDS, ATMOSPHERE_LABELS, motionOverrides, patchMotion } from './plateMotion.mjs';

test('patchMotion: enums, ranges and booleans are validated and merged', () => {
  const next = patchMotion({ energy: 'clear' }, { atmosphere: 'mesh', atmosphereOpacity: '1.4', sheen: 'off', titleReveal: 'wipe', enterMs: '800' });
  assert.deepEqual(next, { energy: 'clear', atmosphere: 'mesh', atmosphereOpacity: 1, sheen: false, titleReveal: 'wipe', enterMs: 800 });
  assert.throws(() => patchMotion({}, { atmosphere: 'lava' }), /atmosphere must be one of/);
  assert.throws(() => patchMotion({}, { depth: 'huge' }), /depth must be one of/);
  assert.throws(() => patchMotion({}, { sheen: 'maybe' }), /sheen must be on or off/);
});

test('patchMotion: null clears a key, empty string leaves it alone, unknown keys are ignored', () => {
  const cur = { atmosphere: 'aurora', depth: 'deep', sheen: true };
  assert.deepEqual(patchMotion(cur, { atmosphere: null, depth: '', bogus: 1 }), { depth: 'deep', sheen: true });
  assert.deepEqual(patchMotion(cur, { sheen: null }), { atmosphere: 'aurora', depth: 'deep' });
});

test('motionOverrides lists only the accent keys; every atmosphere has a label', () => {
  assert.deepEqual(motionOverrides({ atmosphere: 'grid', enterMs: 700, sheen: false }), ['atmosphere', 'sheen']);
  assert.deepEqual(motionOverrides(undefined), []);
  for (const id of ATMOSPHERE_IDS) assert.ok(ATMOSPHERE_LABELS[id], id);
});

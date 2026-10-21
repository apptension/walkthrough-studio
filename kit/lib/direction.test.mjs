import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDirection, resolveDirection } from './direction.mjs';
import { TRANSITION_STYLES, transitionFor } from './edit.mjs';
import { lensGeometry } from './lens.mjs';

const brand = {
  colors: {
    ink: '#0a1f0a',
    surface: '#0f2a0f',
    gold: '#0ca300',
    amber: '#7ac943',
    teal: '#2dd4bf',
    muted: '#a3b8a3',
  },
  motion: { energy: 'clear', enterMs: 900 },
};

test('five-color scales stay brand-derived and video-local', () => {
  const official = resolveDirection({}, brand);
  assert.equal(official.scale, 'official');
  assert.deepEqual(official.swatches, ['#0a1f0a', '#0f2a0f', '#0ca300', '#7ac943', '#2dd4bf']);
  assert.equal(official.scales.find((scale) => scale.recommended).id, 'official');

  const custom = applyDirection(brand, {
    direction: {
      scale: 'custom',
      focus: 'ring',
      colors: { ink: '#111111', surface: '#222222', gold: '#e86824', amber: '#ebae3d', teal: '#2f6fed' },
      motion: { energy: 'calm' },
    },
  });
  assert.equal(custom.colors.gold, '#e86824');
  assert.equal(custom.colors.teal, '#2f6fed');
  assert.equal(custom.foundationColors.gold, '#0ca300');
  assert.equal(custom.direction.focus, 'ring');
  assert.equal(brand.colors.gold, '#0ca300', 'shared brand object is not mutated');
  assert.equal(brand.motion.energy, 'clear');
});

test('light plate ink derives dark type and on-accent', () => {
  const light = applyDirection(brand, {
    direction: {
      scale: 'custom',
      colors: {
        ink: '#ffffff',
        surface: '#f4f5f4',
        gold: '#fffe25',
        amber: '#42f272',
        teal: '#42f272',
      },
    },
  });
  assert.equal(light.colors.ink, '#ffffff');
  assert.equal(light.colors.text, '#0a0a0a');
  assert.equal(light.colors.onAccent, '#0a0a0a');
  assert.ok(light.colors.muted);
  assert.notEqual(light.colors.muted, brand.colors.muted);
});

test('directed transitions choose by editing intent', () => {
  assert.equal(transitionFor('directed', { id: 'open', kind: 'plate' }, { kind: 'live' }), 'zoom');
  assert.equal(transitionFor('directed', { kind: 'live' }, { id: 'proof', kind: 'plate' }), 'wipe');
  assert.equal(transitionFor('directed', { kind: 'plate' }, { kind: 'live' }), 'dissolve');
  assert.equal(transitionFor('directed', { kind: 'live' }, { id: 'close', kind: 'plate' }), 'dip');
  assert.equal(transitionFor('iris', { kind: 'live' }, { kind: 'plate' }), 'iris');
  for (const [id, style] of Object.entries(TRANSITION_STYLES)) {
    if (id !== 'directed') assert.ok(style.xfade, `${id} needs an ffmpeg xfade`);
  }
});

test('guided lens produces frame-evaluated crop and overlay paths', () => {
  const mark = {
    t: 4,
    dur: 3,
    rect: { x: 100, y: 100, w: 80, h: 30 },
    path: [
      { at: 0, rect: { x: 100, y: 100, w: 80, h: 30 } },
      { at: 1.2, rect: { x: 900, y: 420, w: 120, h: 60 } },
    ],
  };
  const geo = lensGeometry(mark, { width: 1920, height: 1080 });
  assert.equal(geo.moving, true);
  assert.match(geo.cropX, /clip\(\(t-/);
  assert.match(geo.ox, /t-4\.000/);
});

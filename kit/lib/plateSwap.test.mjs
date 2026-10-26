import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertPlate, plateLibrary, revertPlate, swapPlate, swapSummary, trackLayout } from './plateSwap.mjs';
import { checkPlate } from './plates.mjs';
import { PLATE_TYPE_IDS } from './plateTypes.mjs';
import { scaffoldPlate } from './script.mjs';

const callout = () => ({
  id: 'why',
  type: 'callout',
  before: 'Discussion',
  eyebrow: 'Why it matters',
  title: 'Read the thread, not the noise',
  body: 'Comments fold so the best reply leads.',
  bullets: ['Fold long threads', 'Jump to top replies', 'Skip the flame wars'],
  layout: 'split',
  colors: { background: '#111111' },
  motion: { energy: 'punchy' },
});

test('convertPlate: headline, eyebrow and points carry into the new type', () => {
  const out = convertPlate(callout(), 'checklist');
  assert.equal(out.type, 'checklist');
  assert.equal(out.title, 'Read the thread, not the noise');
  assert.equal(out.eyebrow, 'Why it matters');
  assert.deepEqual(
    out.items.map((i) => i.label),
    ['Fold long threads', 'Jump to top replies', 'Skip the flame wars'],
  );
  assert.equal(out.before, undefined, 'the slot keeps its own chapter');
});

test('convertPlate: never invents numbers — stats from words keep the starter figures', () => {
  const out = convertPlate(callout(), 'stats');
  assert.ok(out.stats.every((s) => s.value === '—'));
});

test('convertPlate: a short list is topped up to the type minimum from the starter', () => {
  const out = convertPlate({ id: 'x', type: 'callout', title: 'T', bullets: ['One', 'Two'] }, 'features');
  assert.equal(out.items.length, 3);
  assert.deepEqual(out.items.slice(0, 2).map((i) => i.label), ['One', 'Two']);
  assert.ok(out.items.every((i) => i.icon), 'features keep an icon per card');
});

const brand = {
  colors: { ink: '#0a1f0a', surface: '#0f2a0f', gold: '#0ca300', amber: '#7ac943', teal: '#2dd4bf', text: '#f8fafc' },
  font: { family: 'Inter', css: '' },
  logoHtml: '<svg viewBox="0 0 10 10"></svg>',
  motion: { energy: 'clear' },
};

test('convertPlate: every type built from every other passes the plate builder', () => {
  const sources = [
    ...PLATE_TYPE_IDS.map((type) => ({ id: 'p', ...scaffoldPlate(type, { before: 'Intro' }) })),
    { ...callout(), title: 'A very long headline that keeps going well past what a kinetic statement can carry on screen in three lines or fewer, honestly' },
  ];
  for (const src of sources) {
    checkPlate(brand, src);
    for (const to of PLATE_TYPE_IDS) {
      const out = { id: 'p', ...convertPlate(src, to) };
      assert.equal(out.type, to);
      assert.doesNotThrow(() => checkPlate(brand, out), `${src.type} → ${to}`);
    }
  }
});

test('scaffoldPlate: every starter plate is a valid plate (the library adds these as they are)', () => {
  for (const type of PLATE_TYPE_IDS) assert.doesNotThrow(() => checkPlate(brand, { id: type, ...scaffoldPlate(type, { before: 'Intro' }) }), type);
});

test('swapPlate: keeps the slot, records the original, drops a layout the new type lacks', () => {
  const out = swapPlate(callout(), 'stats');
  assert.equal(out.id, 'why');
  assert.equal(out.before, 'Discussion');
  assert.deepEqual(out.colors, { background: '#111111' });
  assert.deepEqual(out.motion, { energy: 'punchy' });
  assert.equal(out.layout, undefined);
  assert.equal(out.swap.from.type, 'callout');
  assert.equal(out.swap.from.layout, 'split');
  assert.deepEqual(swapSummary(out), { type: 'callout', label: 'Callout', layout: 'split' });
});

test('swapPlate: flicking back restores the exact words and clears the record', () => {
  const a = swapPlate(callout(), 'stats');
  a.stats[0].value = '4.8';
  const b = swapPlate(a, 'faq');
  const c = swapPlate(b, 'stats');
  assert.equal(c.stats[0].value, '4.8', 'edits made on a swapped type come back with it');
  const d = swapPlate(c, 'callout');
  assert.deepEqual(d, callout(), 'back on the original — nothing left to revert');
});

test('revertPlate: a type swap gets the original copy back, keeping slot edits made since', () => {
  const swapped = swapPlate(callout(), 'process');
  swapped.colors = { background: '#222222' };
  swapped.title = 'Edited after the swap';
  const back = revertPlate(swapped);
  assert.equal(back.type, 'callout');
  assert.equal(back.title, 'Read the thread, not the noise');
  assert.deepEqual(back.colors, { background: '#222222' });
  assert.equal(back.swap, undefined);
});

test('trackLayout + revertPlate: a composition change keeps the words written since', () => {
  const prev = { title: 'Find the right stories', layout: 'classic' };
  const next = trackLayout(prev, { ...prev, layout: 'kinetic' }, 'open');
  assert.deepEqual(next.swap.from, { layout: 'classic' });
  const edited = { ...next, title: 'New words' };
  const back = revertPlate(edited, 'open');
  assert.equal(back.layout, 'classic');
  assert.equal(back.title, 'New words');
  assert.equal(back.swap, undefined);
});

test('trackLayout: returning to the original composition forgets it (missing = default)', () => {
  const prev = { title: 'T' };
  const moved = trackLayout(prev, { ...prev, layout: 'split' }, 'close');
  assert.ok(moved.swap);
  const home = trackLayout(moved, { ...moved, layout: 'classic' }, 'close');
  assert.equal(home.swap, undefined);
});

test('swapPlate: refuses the ends and chapter plates', () => {
  assert.throws(() => swapPlate({ id: 'open' }, 'stats'), /composition/);
  assert.throws(() => swapPlate({ id: 'ch', type: 'statement', chapter: 2 }, 'stats'), /chapter/);
  assert.throws(() => swapPlate(callout(), 'nope'), /Unknown/);
});

test('plateLibrary: every catalog type sits on exactly one shelf', () => {
  const lib = plateLibrary();
  assert.deepEqual(lib.types.map((t) => t.type).sort(), [...PLATE_TYPE_IDS].sort());
  assert.ok(lib.types.every((t) => lib.shelves.some((s) => s.id === t.shelf)));
});

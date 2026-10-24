import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ATMOSPHERE_IDS, TITLE_REVEALS } from './plateMotion.mjs';
import { layoutIds } from './plateLayouts.mjs';
import { TRANSITION_STYLES } from './edit.mjs';
import { applyVariety, hashSeed, layoutFamily, pickVariety, seededRandom } from './variety.mjs';

const MIDS = [
  { id: 'proof', type: 'features' },
  { id: 'line', type: 'statement' },
  { id: 'nums', type: 'stats' },
  { id: 'deck', type: 'features' },
  { id: 'why', type: 'callout' },
];

test('hashSeed and seededRandom are stable', () => {
  assert.equal(hashSeed('a', 'b'), hashSeed('a', 'b'));
  assert.notEqual(hashSeed('a', 'b'), hashSeed('ab', ''));
  const r1 = seededRandom(42);
  const r2 = seededRandom(42);
  const xs = Array.from({ length: 5 }, () => r1());
  assert.deepEqual(xs, Array.from({ length: 5 }, () => r2()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test('pickVariety is deterministic per slug + title', () => {
  const a = pickVariety({ slug: 'acme-tour', title: 'Acme in 90s', interstitials: MIDS });
  const b = pickVariety({ slug: 'acme-tour', title: 'Acme in 90s', interstitials: MIDS });
  assert.deepEqual(a, b);
});

test('different videos draw distinct combinations', () => {
  const combos = new Set();
  for (let i = 0; i < 60; i++) {
    const p = pickVariety({ slug: `video-${i}`, title: `Video ${i}`, interstitials: MIDS });
    combos.add(`${p.open}|${p.close}|${Object.values(p.layouts).join(',')}|${p.motion.atmosphere}|${p.motion.titleReveal}`);
  }
  assert.ok(combos.size >= 55, `only ${combos.size} distinct combos of 60`);
  const opens = new Set();
  for (let i = 0; i < 60; i++) opens.add(pickVariety({ slug: `v${i}`, interstitials: MIDS }).open);
  assert.ok(opens.size >= 4, 'openers should spread across the catalog');
});

test('every pick is valid and never repeats a layout family back to back', () => {
  for (let i = 0; i < 120; i++) {
    const p = pickVariety({ slug: `s-${i}`, title: 't', purpose: ['overview', 'launch', 'onboarding'][i % 3], interstitials: MIDS });
    assert.ok(layoutIds('open').includes(p.open));
    assert.ok(layoutIds('close').includes(p.close));
    assert.ok(ATMOSPHERE_IDS.includes(p.motion.atmosphere));
    assert.ok(TITLE_REVEALS.includes(p.motion.titleReveal));
    const chain = [layoutFamily('open', p.open), ...MIDS.map((m) => layoutFamily(m.type, p.layouts[m.id])), layoutFamily('close', p.close)];
    for (let k = 1; k < chain.length; k++) assert.notEqual(chain[k], chain[k - 1], `${p.seed}: ${chain.join(' → ')}`);
    const styles = MIDS.map((m) => p.joins[`live>${m.id}`].style);
    for (const s of styles) assert.ok(TRANSITION_STYLES[s], s);
    for (let k = 1; k < styles.length; k++) assert.notEqual(styles[k], styles[k - 1]);
    if (p.open === 'mesh') assert.notEqual(p.motion.atmosphere, 'mesh');
    if (p.open === 'kinetic') assert.ok(['rise', 'cascade'].includes(p.motion.titleReveal));
  }
});

test('an explicit energy steers the mood; explicit layouts are kept', () => {
  const p = pickVariety({ slug: 'x', energy: 'calm', open: 'device', close: 'cards', interstitials: [{ id: 'a', type: 'features', layout: 'stack' }] });
  assert.equal(p.mood, 'calm');
  assert.equal(p.open, 'device');
  assert.equal(p.close, 'cards');
  assert.equal(p.layouts.a, 'stack');
});

test('applyVariety fills only open choices and never overwrites explicit values', () => {
  const config = {
    title: 'Acme',
    open: { title: ['Hi'], layout: 'mesh' },
    close: { steps: [{ label: 'a' }, { label: 'b' }] },
    interstitials: [
      { id: 'proof', type: 'features', layout: 'grid' },
      { id: 'line', type: 'statement' },
      { id: 'q', type: 'quote' },
    ],
    direction: { motion: { atmosphere: 'silk' }, approvedAt: '2026-01-01' },
    edit: { transitions: { 'live>proof': { style: 'iris' } } },
  };
  const { config: next, applied } = applyVariety(config, { slug: 'acme' });
  assert.equal(next.open.layout, 'mesh');
  assert.equal(next.interstitials[0].layout, 'grid');
  assert.ok(next.interstitials[1].layout);
  assert.equal(next.interstitials[2].layout, undefined);
  assert.ok(next.close.layout);
  assert.equal(next.direction.motion.atmosphere, 'silk');
  assert.ok(next.direction.motion.titleReveal);
  assert.deepEqual(next.edit.transitions, { 'live>proof': { style: 'iris' } });
  assert.ok(!applied.some((a) => a.startsWith('joins')));
  assert.equal(next.direction.approvedAt, undefined, 'motion changes reopen direction approval');
  assert.equal(config.close.layout, undefined, 'input is not mutated');

  const again = applyVariety(next, { slug: 'acme' });
  assert.deepEqual(again.applied, [], 'a second pass changes nothing');
});

test('applyVariety pins live → plate joins only when none are pinned', () => {
  const { config: next } = applyVariety({ title: 'T', interstitials: MIDS.slice(0, 3).map((m) => ({ ...m })) }, { slug: 'joins' });
  assert.deepEqual(Object.keys(next.edit.transitions).sort(), ['live>line', 'live>nums', 'live>proof']);
  assert.equal(next.transitions.style, 'directed');
});

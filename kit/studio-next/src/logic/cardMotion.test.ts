import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import {
  applyCardMotionToDocument,
  captionMotionTiming,
  cardMotionCss,
  clampCardHoldMs,
  defaultCardHoldMs,
} from './cardMotion';

describe('cardMotion', () => {
  test('defaults and clamp', () => {
    assert.equal(defaultCardHoldMs('caption'), 2400);
    assert.equal(defaultCardHoldMs('chapter'), 2800);
    assert.equal(clampCardHoldMs(100, 'caption'), 400);
    assert.equal(clampCardHoldMs(5000, 'caption'), 5000);
  });

  test('longer hold pushes caption exit later', () => {
    const short = captionMotionTiming(2000);
    const long = captionMotionTiming(5000);
    assert.ok(Number(long.X_OUT) > Number(short.X_OUT));
    assert.ok(Number(long.HOLD) > Number(short.HOLD));
  });

  test('a minimum hold never schedules a negative exit delay', () => {
    for (const ms of [0, 100, 400, 500, NaN, undefined]) {
      const t = captionMotionTiming(ms);
      assert.ok(Number(t.X_OUT) > 0, `X_OUT for ${ms}`);
      assert.ok(Number(t.HOLD) > 0, `HOLD for ${ms}`);
    }
  });

  test('cardMotionCss exposes vars for the root', () => {
    const cap = cardMotionCss('caption', 4000);
    assert.equal(cap.selector, '.wt-cap');
    assert.equal(cap.durationSec, '4.00');
    assert.match(cap.vars['--x-out']!, /s$/);
    const ch = cardMotionCss('chapter', 3500);
    assert.equal(ch.selector, '.wt-ch');
    assert.ok(ch.vars['--x-atm']);
  });

  test('applyCardMotionToDocument sets data-duration and CSS vars', () => {
    const root = { style: { props: {} as Record<string, string>, setProperty(k: string, v: string) { this.props[k] = v; } } };
    const doc = {
      body: { dataset: {} as Record<string, string | undefined> },
      querySelector: (sel: string) => (sel === '.wt-cap' ? root : null),
    };
    const motion = applyCardMotionToDocument(doc, 'caption', 4500)!;
    assert.equal(doc.body.dataset.duration, '4.50');
    assert.equal(root.style.props['--x-out'], motion.vars['--x-out']);
  });
});

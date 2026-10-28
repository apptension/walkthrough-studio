import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { VOICE_GAP, placeVoice, slotRoom, voiceSlots, type VoiceCut } from './voicePlace';

const cut: VoiceCut = {
  open: { at: 0, dur: 3 },
  close: { at: 20, dur: 4 },
  total: 24,
  plates: [{ id: 'p1', at: 10, dur: 3, inDur: 0.6 }],
  marks: [
    { kind: 'chapter', label: 'Plan', at: 5 },
    { kind: 'caption', label: 'Ship', at: 14 },
  ],
  liveEnd: 19,
};

describe('voicePlace', () => {
  test('slot windows follow the open, marks, plates and close', () => {
    const slots = voiceSlots(cut, [
      { key: 'intro', kind: 'intro', duration: 2 },
      { key: 'Plan', kind: 'caption', duration: 3 },
      { key: 'p1', kind: 'interstitial', duration: 1 },
      { key: 'Ship', kind: 'caption', duration: 2 },
      { key: 'outro', kind: 'outro', duration: 2 },
      { key: 'missing', kind: 'caption', duration: 1 },
      { key: 'adlib-1', kind: 'adlib', duration: 2 },
    ]);
    assert.deepEqual(
      slots.map((s) => [s.key, s.kind, s.markAt, s.windowStart, s.windowEnd]),
      [
        ['intro', 'intro', null, 1.1, 4.5],
        ['Plan', 'chapter', 5, 5.9, 14],
        ['p1', 'interstitial', 10.3, 11, 12.65],
        ['Ship', 'caption', 14, 14.3, 19],
        ['outro', 'outro', null, 20.9, 23.6],
        ['adlib-1', 'adlib', null, 0, 24],
      ],
    );
  });

  test('placement pushes late lines and flags long ones; the outro gets no spill', () => {
    const placed = placeVoice([
      { key: 'b', kind: 'caption', markAt: 3, windowStart: 3, windowEnd: 4, duration: 1 },
      { key: 'a', kind: 'caption', markAt: 0, windowStart: 0, windowEnd: 2, duration: 3 },
    ]);
    assert.deepEqual(placed.map((p) => [p.key, p.start, p.end, p.late, p.long]), [
      ['a', 0.45, 3.45, 0.45, 0.25],
      ['b', 3.9, 4.9, 0.9, 0],
    ]);
    assert.equal(slotRoom({ kind: 'outro', windowEnd: 10 }, 8), 2);
    assert.equal(slotRoom({ kind: 'caption', windowEnd: 10 }, 8), 10 + 1.2 - 8);
    assert.equal(VOICE_GAP, 0.45);
  });
});

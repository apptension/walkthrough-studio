import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INTRO_WINDOW, OUTRO_WINDOW, PLATE_TAIL, VOICE_GAP, VOICE_LEAD, VOICE_OVERRUN, placeVoice, voiceSlots } from '../../studio/voicePlace.js';

const cut = ({ liveDur = 30, plateAt = 14 } = {}) => ({
  open: { at: 0, dur: 6 },
  plates: [{ id: 'why', at: plateAt, dur: 5, inDur: 0.6 }],
  marks: [
    { kind: 'chapter', label: 'Create', at: 6 },
    { kind: 'caption', label: 'Sign', at: 10 },
  ],
  liveEnd: 6 + liveDur,
  close: { at: 6 + liveDur, dur: 5 },
  total: 6 + liveDur + 5,
});

const lines = [
  { key: 'intro', kind: 'intro', duration: 3 },
  { key: 'Create', kind: 'chapter', duration: 2 },
  { key: 'Sign', kind: 'caption', duration: 2 },
  { key: 'why', kind: 'interstitial', duration: 2.5 },
  { key: 'outro', kind: 'outro', duration: 3 },
];

test('slots follow the cut: open, marks, plates and close each give a window', () => {
  const slots = voiceSlots(cut(), lines);
  const by = Object.fromEntries(slots.map((s) => [s.key, s]));
  assert.equal(by.intro.windowStart, INTRO_WINDOW.start);
  assert.equal(by.intro.windowEnd, 6 + INTRO_WINDOW.pastOpen);
  assert.equal(by.Create.windowStart, 6 + VOICE_LEAD.chapter);
  assert.equal(by.Create.windowEnd, 10, 'a line ends where the next lined mark begins');
  assert.equal(by.Sign.windowStart, 10 + VOICE_LEAD.caption);
  assert.equal(by.Sign.windowEnd, 36, 'the last line runs to the end of the live reel');
  assert.equal(by.why.markAt, 14.3);
  assert.equal(by.why.windowStart, 14.3 + VOICE_LEAD.interstitial);
  assert.equal(by.why.windowEnd, 19 - PLATE_TAIL);
  assert.equal(by.outro.windowStart, 36 + OUTRO_WINDOW.lead);
  assert.equal(by.outro.windowEnd, 41 - OUTRO_WINDOW.tail);
});

test('lines with no anchor on this cut are left out instead of guessed', () => {
  const slots = voiceSlots({ ...cut(), open: null, plates: [] }, lines);
  assert.deepEqual(
    slots.map((s) => s.key).sort(),
    ['Create', 'Sign', 'outro'],
    'no open plate → no intro; no plate "why" → no interstitial line'
  );
});

test('placement keeps a breath between lines and reports late and long lines', () => {
  const placed = placeVoice([
    { key: 'a', kind: 'caption', windowStart: 1, windowEnd: 3, duration: 2.5 },
    { key: 'b', kind: 'caption', windowStart: 2, windowEnd: 6, duration: 1 },
    { key: 'outro', kind: 'outro', windowStart: 8, windowEnd: 9, duration: 2 },
  ]);
  const [a, b, outro] = placed;
  assert.equal(a.start, 1);
  assert.equal(a.end, 3.5);
  assert.equal(a.long, 0, 'a may spill up to the overrun tolerance');
  assert.equal(b.start, 3.5 + VOICE_GAP, 'b waits for a plus the gap');
  assert.equal(b.late, Math.round((3.5 + VOICE_GAP - 2) * 1000) / 1000);
  assert.equal(outro.start, 8);
  assert.equal(outro.long, 1, 'the outro gets no spill: the video ends');
  const spill = placeVoice([{ key: 'x', kind: 'caption', windowStart: 1, windowEnd: 2, duration: 1 + VOICE_OVERRUN + 0.5 }])[0];
  assert.equal(spill.start, 1, 'the first line still waits a breath after 0, so a window at 1s starts on time');
  assert.equal(spill.long, 0.5);
});

test('shortening the live reel moves the lines that follow and flags one that no longer fits', () => {
  const before = placeVoice(voiceSlots(cut({ liveDur: 30, plateAt: 14 }), lines));
  const after = placeVoice(voiceSlots(cut({ liveDur: 20, plateAt: 12 }), lines));
  const at = (list, key) => list.find((s) => s.key === key);
  assert.equal(at(before, 'why').start, 14.3 + VOICE_LEAD.interstitial);
  assert.equal(at(after, 'why').start, 12.3 + VOICE_LEAD.interstitial, 'the plate line rides with the plate');
  const tight = placeVoice(voiceSlots(cut({ liveDur: 20, plateAt: 11 }), lines));
  assert.equal(at(tight, 'why').start, 12.75, 'a plate pulled onto the previous line waits for it plus the gap');
  assert.equal(at(before, 'outro').start, 36.9);
  assert.equal(at(after, 'outro').start, 26.9, 'the outro follows the close plate');
  assert.equal(at(after, 'intro').start, at(before, 'intro').start, 'the open did not move');

  const squeezed = placeVoice(voiceSlots({ ...cut(), marks: [{ kind: 'chapter', label: 'Create', at: 6 }, { kind: 'caption', label: 'Sign', at: 7 }] }, lines));
  const create = at(squeezed, 'Create');
  assert.equal(create.start, 6.9);
  assert.ok(create.long > 0, `a 2s line in a 0.1s window runs long (${create.long})`);
});

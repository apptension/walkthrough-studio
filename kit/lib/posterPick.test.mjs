import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openPlatePosterOffset, pickPosterTime } from './posterPick.mjs';

test('pickPosterTime prefers the open plate hold, not a live chapter', () => {
  const meta = {
    chapters: [{ start: 8, title: 'Meet the product' }],
    edit: [
      { kind: 'plate', id: 'open', at: 0, dur: 6, holdAt: 3.2, clearAt: 4.1 },
      { kind: 'live', id: 'live-0', at: 5.4, dur: 40 },
    ],
  };
  const t = pickPosterTime(meta, 50);
  assert.ok(t >= 3.4 && t <= 4.8, `expected mid-open hold, got ${t}`);
  assert.ok(t < 5.4, 'should stay on the opening plate');
});

test('openPlatePosterOffset respects custom plate timing hold window', () => {
  const offset = openPlatePosterOffset({
    kind: 'plate',
    id: 'open',
    at: 0,
    dur: 7,
    naturalDur: 5,
    holdAt: 2.4,
    timing: { trimStart: 0, trimEnd: 0, hold: 1.2, rate: 1, baseDur: 5, holdAt: 2.4 },
  });
  assert.ok(offset >= 2.3 && offset <= 3.8, `hold window offset ${offset}`);
});

test('pickPosterTime falls back when there is no open plate', () => {
  const t = pickPosterTime({ chapters: [{ start: 10, title: 'Deep dive' }] }, 120);
  assert.ok(t >= 11 && t <= 14);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLivePreviewFeed, planScreencastRestart, previewCacheControl } from './livePreviewFeed.mjs';

function harness() {
  const writes = [];
  const scheduled = [];
  let now = 5_000;
  let seq = 0;
  const feed = createLivePreviewFeed('/out/live-preview.jpg', '/out/live-preview.json', {
    intervalMs: 100,
    now: () => now,
    schedule(fn, ms) {
      const id = ++seq;
      scheduled.push({ id, fn, ms });
      return id;
    },
    clear(id) {
      const i = scheduled.findIndex((item) => item.id === id);
      if (i >= 0) scheduled.splice(i, 1);
    },
    async writeFile(path, data) {
      writes.push(['write', path, Buffer.from(data).toString()]);
    },
    async rename(from, to) {
      writes.push(['rename', from, to]);
    },
  });
  return {
    feed,
    writes,
    scheduled,
    setNow(t) {
      now = t;
    },
  };
}

test('pushing a frame returns before any disk write', () => {
  const { feed, writes, scheduled } = harness();
  feed.push(Buffer.from('frame-a'));
  assert.deepEqual(writes, []);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 0);
});

test('a flush publishes only the newest frame, then the stamp, by rename', async () => {
  const h = harness();
  h.feed.push(Buffer.from('old'));
  h.feed.push(Buffer.from('new'));
  assert.equal(h.scheduled.length, 1);
  await h.scheduled[0].fn();
  assert.deepEqual(h.writes, [
    ['write', '/out/live-preview.jpg.tmp', 'new'],
    ['rename', '/out/live-preview.jpg.tmp', '/out/live-preview.jpg'],
    ['write', '/out/live-preview.json', JSON.stringify({ at: 5_000 })],
  ]);
});

test('a frame that arrives while a write is in progress is kept for the next flush', async () => {
  const writes = [];
  const scheduled = [];
  let now = 5_000;
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let seq = 0;
  const feed = createLivePreviewFeed('/out/live-preview.jpg', '/out/live-preview.json', {
    intervalMs: 100,
    now: () => now,
    schedule(fn, ms) {
      const id = ++seq;
      scheduled.push({ id, fn, ms });
      return id;
    },
    clear(id) {
      const i = scheduled.findIndex((item) => item.id === id);
      if (i >= 0) scheduled.splice(i, 1);
    },
    async writeFile(path, data) {
      if (String(path).endsWith('.tmp')) await gate;
      writes.push(['write', path, Buffer.from(data).toString()]);
    },
    async rename(from, to) {
      writes.push(['rename', from, to]);
    },
  });
  feed.push(Buffer.from('first'));
  const flushing = scheduled[0].fn();
  await Promise.resolve();
  feed.push(Buffer.from('second'));
  release();
  await flushing;
  now = 5_200;
  assert.equal(scheduled.length, 2);
  await scheduled[1].fn();
  assert.equal(writes.filter((row) => row[0] === 'write' && String(row[1]).endsWith('.tmp')).map((row) => row[2]).join(','), 'first,second');
});

test('a navigation with no later frame restarts the cast once per grace window', () => {
  const stalled = planScreencastRestart({ navigatedAt: 1_000, lastFrameAt: 900, now: 2_500, attempts: 0 });
  assert.equal(stalled.restart, true);
  assert.equal(stalled.attempts, 1);

  const healthy = planScreencastRestart({ navigatedAt: 1_000, lastFrameAt: 1_100, now: 2_500, attempts: 0 });
  assert.equal(healthy.restart, false);
  assert.equal(healthy.attempts, 0);

  const tooSoon = planScreencastRestart({ navigatedAt: 1_000, lastFrameAt: 900, now: 1_500, attempts: 0 });
  assert.equal(tooSoon.restart, false);

  const capped = planScreencastRestart({ navigatedAt: 1_000, lastFrameAt: 900, now: 9_000, attempts: 3, attemptsNavigatedAt: 1_000 });
  assert.equal(capped.restart, false);
  assert.equal(capped.attempts, 3);
});

test('a later, distinct navigation gets its own restart budget even if an earlier one used up its attempts', () => {
  // record.mjs threads `attempts` through a 400ms poll for the whole capture, one long
  // walkthrough click-chain. If a cast never recovers after one stuck navigation, every
  // *later* navigation must still get a fresh chance — the live preview should not go
  // dark for the rest of a multi-chapter capture just because one earlier click stalled.
  let attempts = 0;
  let attemptsNavigatedAt = 0;
  const tick = (navigatedAt, now) => {
    const plan = planScreencastRestart({ navigatedAt, lastFrameAt: 0, now, attempts, attemptsNavigatedAt });
    attempts = plan.attempts;
    attemptsNavigatedAt = plan.attemptsNavigatedAt;
    return plan;
  };

  // First navigation (t=1000): the cast never recovers, three restarts are spent.
  assert.equal(tick(1_000, 2_500).restart, true);
  assert.equal(tick(1_000, 4_000).restart, true);
  assert.equal(tick(1_000, 6_000).restart, true);
  assert.equal(tick(1_000, 20_000).restart, false, 'budget for this navigation is spent');

  // A second, later navigation (t=25000) must still get restarts of its own.
  const secondNav = tick(25_000, 26_500);
  assert.equal(secondNav.restart, true, 'a new navigation must not inherit an earlier one\'s exhausted budget');
  assert.equal(secondNav.attempts, 1);
});

test('live preview files are not cached; other media is left alone', () => {
  assert.equal(previewCacheControl('live-preview.jpg'), 'no-store');
  assert.equal(previewCacheControl('live-preview.json'), 'no-store');
  assert.equal(previewCacheControl('live.mp4'), undefined);
});

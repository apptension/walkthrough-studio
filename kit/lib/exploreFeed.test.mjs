import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { exploreFeed, latestShots, LIVE_PREVIEW_FRESH_MS, screenLabel } from './exploreFeed.mjs';

const fixture = () => {
  const out = mkdtempSync(join(tmpdir(), 'explore-feed-'));
  mkdirSync(join(out, 'browse', 'shots'), { recursive: true });
  return { slug: 'demo video', out };
};

test('latestShots keeps the newest shot per screen and counts all of them', () => {
  const { byScreen, total } = latestShots(['001-S1.jpg', '002-S2.jpg', '003-S1.jpg', 'notes.txt', '010-S2.jpg']);
  assert.equal(total, 4);
  assert.equal(byScreen.get('S1').file, '003-S1.jpg');
  assert.equal(byScreen.get('S2').file, '010-S2.jpg');
});

test('screenLabel drops the brand suffix of a page title', () => {
  assert.equal(screenLabel({ title: 'Seamless Team Management | Teamdeck' }), 'Seamless Team Management');
  assert.equal(screenLabel({ title: 'Pricing – Acme' }), 'Pricing');
  assert.equal(screenLabel({ title: '', dialog: 'Invite teammates' }), 'Invite teammates');
  assert.equal(screenLabel({ title: 'Home | Acme', dialog: 'menu' }), 'Home · menu');
  assert.equal(screenLabel({ title: '', headings: ['Welcome back'] }), 'Welcome back');
  assert.equal(screenLabel({ path: '/settings' }), '/settings');
});

test('exploreFeed is empty before the explore agent writes anything', () => {
  const feed = exploreFeed(fixture());
  assert.deepEqual(feed.screens, []);
  assert.equal(feed.shots, 0);
  assert.equal(feed.preview, null);
});

test('exploreFeed maps screens to their newest screenshot, moves and notes', () => {
  const video = fixture();
  const dir = join(video.out, 'browse');
  writeFileSync(
    join(dir, 'map.json'),
    JSON.stringify({
      startedAt: '2026-10-24T08:17:00.000Z',
      signedIn: true,
      current: 'S2',
      screens: [
        { id: 'S1', title: 'Home | Acme', url: 'https://acme.test/', path: '/', headings: ['Plan your team'], controls: 12, tried: ['Features'] },
        { id: 'S2', title: 'Scheduling | Acme', path: '/scheduling', reachedBy: { from: 'S1', action: 'click', label: 'Features' }, controls: 4, tried: [] },
      ],
      moves: [{ at: 'x', from: 'S1', action: 'click', label: 'Features', where: 'top bar' }],
      notes: [{ screen: 'S2', text: 'Strongest promise', at: 'y' }, 'loose note'],
    }),
  );
  for (const f of ['001-S1.jpg', '002-S2.jpg', '003-S1.jpg']) writeFileSync(join(dir, 'shots', f), 'jpg');
  const feed = exploreFeed(video);
  assert.equal(feed.current, 'S2');
  assert.equal(feed.signedIn, true);
  assert.equal(feed.shots, 3);
  assert.equal(feed.screens[0].label, 'Home');
  assert.match(feed.screens[0].shot, /^\/media\/demo%20video\/browse\/shots\/003-S1\.jpg\?v=\d+$/);
  assert.match(feed.screens[1].shot, /002-S2\.jpg/);
  assert.deepEqual(feed.screens[1].reachedBy, { from: 'S1', action: 'click', label: 'Features' });
  assert.equal(feed.screens[0].tried, 1);
  assert.deepEqual(feed.moves, [{ at: 'x', from: 'S1', action: 'click', label: 'Features' }]);
  assert.deepEqual(feed.notes, [
    { screen: 'S2', text: 'Strongest promise' },
    { screen: null, text: 'loose note' },
  ]);
});

test('exploreFeed exposes the live screencast only while it is fresh', () => {
  const video = fixture();
  const file = join(video.out, 'live-preview.jpg');
  writeFileSync(file, 'jpg');
  const now = Date.now();
  assert.match(exploreFeed(video, { now }).preview, /live-preview\.jpg\?v=/);
  const old = (now - LIVE_PREVIEW_FRESH_MS - 5000) / 1000;
  utimesSync(file, old, old);
  assert.equal(exploreFeed(video, { now }).preview, null);
});

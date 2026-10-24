import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { duration } from '../media.mjs';
import { compositionPlan, joinSections, musicBarSec, musicReuse, musicTargetSec, planOutroAtSec, planRequests } from './music.mjs';

const MUSIC = { styles: ['brand pad', '100 BPM'], intro: ['open'], bed: ['steady'], outro: ['resolve'] };
const planSec = (plan) => plan.chunks.reduce((s, c) => s + c.duration_ms, 0) / 1000;

test('musicTargetSec adds 10 % headroom (4–15 s) rounded up to a 5 s bucket', () => {
  assert.equal(musicTargetSec(20), 25);
  assert.equal(musicTargetSec(60), 70);
  assert.equal(musicTargetSec(120), 135);
  assert.equal(musicTargetSec(300), 315);
  assert.equal(musicTargetSec(900), 915);
  for (const t of [12, 47, 95, 181, 420]) {
    const target = musicTargetSec(t);
    assert.ok(target >= t + 4 && target <= t + 20, `${t}s → ${target}s`);
    assert.equal(target % 5, 0);
  }
  // Small changes in take length land in the same bucket.
  assert.equal(musicTargetSec(61), musicTargetSec(62));
});

test('compositionPlan covers the picture plus headroom with API-legal chunks', () => {
  for (const totalSec of [25, 90, 240, 590]) {
    const plan = compositionPlan(MUSIC, { totalSec, openSec: 6, closeSec: 5, interstitialSec: 4 });
    const sec = planSec(plan);
    assert.ok(Math.abs(sec - musicTargetSec(totalSec)) < 0.05, `${totalSec}s picture → ${sec}s plan`);
    assert.ok(sec >= totalSec + 4);
    for (const c of plan.chunks) assert.ok(c.duration_ms >= 3000 && c.duration_ms <= 120000, `chunk ${c.text} ${c.duration_ms}ms`);
    assert.equal(plan.chunks[0].text, '[Intro]');
    assert.equal(plan.chunks.at(-1).text, '[Outro]');
    // The outro starts 1.5 s before the close plate on a take of exactly this length.
    assert.ok(Math.abs(sec - planOutroAtSec(plan) - (5 + 1.5 + 1)) < 0.01);
  }
});

test('planRequests keeps a short plan in one request', () => {
  const plan = compositionPlan(MUSIC, { totalSec: 180, openSec: 6, closeSec: 5 });
  assert.deepEqual(planRequests(plan), [plan]);
});

test('planRequests splits a bed longer than 10 min into overlapping requests that rejoin to the planned length', () => {
  const plan = compositionPlan(MUSIC, { totalSec: 900, openSec: 6, closeSec: 5 });
  const requests = planRequests(plan, { overlapSec: 4 });
  assert.ok(requests.length >= 2);
  for (const r of requests) {
    assert.ok(planSec(r) <= 600, `request ${planSec(r)}s`);
    assert.ok(r.chunks.length <= 30);
    for (const c of r.chunks) assert.ok(c.duration_ms >= 3000 && c.duration_ms <= 120000);
  }
  const joined = requests.reduce((s, r) => s + planSec(r), 0) - 4 * (requests.length - 1);
  assert.ok(Math.abs(joined - planSec(plan)) < 0.01);
  assert.equal(requests[0].chunks[0].text, '[Intro]');
  assert.equal(requests.at(-1).chunks.at(-1).text, '[Outro]');
  // Every section keeps the brand styles, so the parts stay in one key and tempo.
  for (const r of requests) assert.ok(r.chunks.every((c) => c.positive_styles.includes('100 BPM')));
});

test('musicReuse recomposes a cached bed shorter than the new take instead of looping it', () => {
  const current = { durationSec: 70 };
  assert.deepEqual(musicReuse({ current, sameStyle: true, totalSec: 60 }), { reuse: true, reason: 'fits' });
  assert.deepEqual(musicReuse({ current, sameStyle: true, totalSec: 68 }), { reuse: true, reason: 'fits' });
  assert.deepEqual(musicReuse({ current, sameStyle: true, totalSec: 75 }), { reuse: false, reason: 'short' });
  assert.deepEqual(musicReuse({ current, sameStyle: true, totalSec: 30 }), { reuse: false, reason: 'long' });
  assert.deepEqual(musicReuse({ current, sameStyle: false, totalSec: 60 }), { reuse: false, reason: 'style' });
  const offline = musicReuse({ current, sameStyle: true, totalSec: 75, offline: true });
  assert.equal(offline.reuse, true);
  assert.equal(offline.reason, 'offline-short');
  assert.match(offline.warning, /^⚠ music is 6\.0s short/);
});

test('musicBarSec reads the tempo from styles or prompt', () => {
  assert.equal(musicBarSec({ styles: ['118 BPM'] }).toFixed(4), (240 / 118).toFixed(4));
  assert.equal(musicBarSec({ prompt: 'warm piano at 90 bpm' }), 240 / 90);
  assert.equal(musicBarSec({ styles: ['no tempo'] }), 0);
});

test('joinSections crossfades parts into one bed (length = sum − crossfades)', () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-join-'));
  try {
    const parts = [6, 5, 4].map((sec, i) => {
      const file = join(root, `p${i}.mp3`);
      const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${220 + i * 55}:sample_rate=44100:duration=${sec}`, '-ac', '2', file]);
      assert.equal(r.status, 0);
      return file;
    });
    const out = join(root, 'music.mp3');
    joinSections(parts, out, { xfadeSec: 1 });
    const sec = duration(out);
    assert.ok(Math.abs(sec - (15 - 2)) < 0.2, `joined ${sec}s`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

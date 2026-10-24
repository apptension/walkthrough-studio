import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { duration } from '../media.mjs';
import { checkMusicCoverage, musicCoverageIssues } from './coverage.mjs';
import { mixAudio } from './mix.mjs';

const ffmpeg = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
};

const MIX = { voiceLufs: -16, plateLufs: -20, bedLufs: -31, duck: { ratio: 3 }, targetLufs: -14, truePeakDb: -1, sampleRate: 48000, bitrate: '192k' };

/** Silent picture of `totalSec` + a music-only mix with a `musicSec` bed (no voice). */
function fixture(root, { totalSec, musicSec, loop = false, plan = null }) {
  const out = join(root, 'out');
  mkdirSync(join(out, 'music'), { recursive: true });
  const segments = { openSec: 1, liveSec: totalSec - 3, closeSec: 2, interstitialSec: 0 };
  writeFileSync(join(out, 'produce-meta.json'), JSON.stringify({ durationSec: totalSec, segments }));
  ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=44100:duration=${musicSec}`, '-ac', '2', join(out, 'music', 'music.mp3')]);
  if (plan) writeFileSync(join(out, 'music', 'plan.json'), JSON.stringify({ ...plan, durationSec: musicSec }));
  const master = join(out, 'picture.mp4');
  ffmpeg(['-f', 'lavfi', '-i', `testsrc=size=160x90:rate=30:duration=${totalSec}`, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', master]);
  const video = { slug: 'fixture', out, config: { edit: { audio: loop ? { music: { loop: true } } : {} } }, audio: { mix: MIX } };
  return { video, master };
}

test('mix extends a slightly short bed once, keeps the length, and reports the repeat', () => {
  const root = mkdtempSync(join(tmpdir(), 'mix-fit-extend-'));
  try {
    const { video, master } = fixture(root, { totalSec: 30, musicSec: 24 });
    const result = mixAudio(video, { out: master });
    assert.equal(result.musicFit.kind, 'extend');
    assert.match(result.warnings[0], /^⚠ music is 6\.0s short.*Compose to fit/);
    const meta = JSON.parse(readFileSync(join(video.out, 'audio-meta.json'), 'utf8'));
    assert.equal(meta.musicFit.kind, 'extend');
    assert.ok(Math.abs(duration(master) - 30) < 0.3);
    const report = checkMusicCoverage(video);
    assert.equal(report.checked, true);
    assert.equal(report.issues.length, 1);
    assert.match(report.issues[0], /repeats .* compose to fit/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mix loops a far-short bed with crossfades only when Loop to fill is on', () => {
  const root = mkdtempSync(join(tmpdir(), 'mix-fit-loop-'));
  try {
    const { video, master } = fixture(root, { totalSec: 30, musicSec: 10, loop: true });
    const result = mixAudio(video, { out: master });
    assert.equal(result.musicFit.kind, 'loop');
    assert.equal(result.musicFit.shortfallSec, 0);
    assert.match(result.warnings[0], /^⚠ music looped/);
    assert.match(checkMusicCoverage(video).issues[0], /^music loops/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mix trims a composed bed with headroom and reports no coverage issue', () => {
  const root = mkdtempSync(join(tmpdir(), 'mix-fit-trim-'));
  try {
    // 40 s composed bed for a 30 s picture: outro chunk (2 + 1.5 + 1 s) starts at 35.5 s.
    const plan = { source: 'stub', plan: { chunks: [{ duration_ms: 4500 }, { duration_ms: 31000 }, { duration_ms: 4500 }] }, outroAtSec: 35.5, segments: { openSec: 1, liveSec: 27, closeSec: 2, interstitialSec: 0 } };
    const { video, master } = fixture(root, { totalSec: 30, musicSec: 40, plan });
    const result = mixAudio(video, { out: master });
    assert.equal(result.musicFit.kind, 'trim');
    assert.equal(result.musicFit.shortfallSec, 0);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(checkMusicCoverage(video).issues, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('musicCoverageIssues flags a legacy hard loop and a silent tail from durations', () => {
  const pictureSec = 90;
  const plan = { durationSec: 60 };
  assert.match(musicCoverageIssues({ audioMeta: { music: true, desk: { music: { loop: true } } }, plan, pictureSec })[0], /hard-looped/);
  assert.match(musicCoverageIssues({ audioMeta: { music: true, desk: null }, plan, pictureSec })[0], /tail is silent/);
  assert.deepEqual(musicCoverageIssues({ audioMeta: { music: true }, plan: { durationSec: 95 }, pictureSec }), []);
  assert.deepEqual(musicCoverageIssues({ audioMeta: { music: false }, plan, pictureSec }), []);
});

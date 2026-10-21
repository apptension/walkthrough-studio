import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compositionPlan, installCustomMusic, musicPath, musicPlanPath, promptStyles } from './music.mjs';

function fakeVideo() {
  const root = mkdtempSync(join(tmpdir(), 'wt-music-'));
  const out = join(root, 'out');
  mkdirSync(out, { recursive: true });
  return {
    root,
    dir: root,
    out,
    slug: 'test',
    audio: { music: { model: 'music_v2_5', styles: ['soft pad'] } },
    config: {},
  };
}

/** Tiny silent stereo mp3 via ffmpeg. */
function makeTinyMp3(path, sec = 1.2) {
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo`, '-t', String(sec), '-b:a', '64k', path],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) throw new Error(`ffmpeg stub failed: ${(r.stderr || '').slice(-200)}`);
}

test('installCustomMusic writes music.mp3 and plan.json with source upload', async () => {
  const video = fakeVideo();
  const src = join(video.root, 'in.mp3');
  try {
    makeTinyMp3(src, 1.5);
    const meta = await installCustomMusic(video, { buffer: readFileSync(src), mime: 'audio/mpeg' });
    assert.equal(meta.source, 'upload');
    assert.ok(meta.durationSec > 1);
    assert.ok(existsSync(musicPath(video)));
    const plan = JSON.parse(readFileSync(musicPlanPath(video), 'utf8'));
    assert.equal(plan.source, 'upload');
    assert.equal(plan.mode, 'upload');
  } finally {
    rmSync(video.root, { recursive: true, force: true });
  }
});

test('installCustomMusic rejects empty buffers', async () => {
  const video = fakeVideo();
  try {
    await assert.rejects(() => installCustomMusic(video, { buffer: Buffer.alloc(0) }), /Audio data required/);
  } finally {
    rmSync(video.root, { recursive: true, force: true });
  }
});

test('promptStyles splits phrases and compositionPlan merges them into positive_styles', () => {
  assert.deepEqual(promptStyles('warm piano; soft pulse'), ['warm piano', 'soft pulse']);
  assert.deepEqual(promptStyles(''), []);
  const plan = compositionPlan(
    { styles: ['brand pad'], prompt: 'optimistic underscore\nno vocals', intro: ['open'], bed: ['steady'], outro: ['resolve'] },
    { totalSec: 40, openSec: 5, closeSec: 5, interstitialSec: 0 }
  );
  const styles = plan.chunks[0].positive_styles;
  assert.ok(styles.includes('brand pad'));
  assert.ok(styles.includes('optimistic underscore'));
  assert.ok(styles.includes('no vocals'));
  assert.ok(styles.includes('open'));
});

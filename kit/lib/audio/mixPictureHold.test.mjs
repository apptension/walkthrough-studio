import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { duration } from '../media.mjs';
import { mixAudio } from './mix.mjs';

const ffmpeg = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
};

const MIX_DEFAULTS = {
  voiceLufs: -16,
  plateLufs: -20,
  bedLufs: -31,
  duck: { threshold: 0.02, ratio: 3, attackMs: 20, releaseMs: 350 },
  targetLufs: -14,
  truePeakDb: -1,
  sampleRate: 48000,
  bitrate: '192k',
};

/** A minimal silent master + voice.json whose one clip ends `outroDur` past `totalSec`. */
function fixture(root, { totalSec, outroDur }) {
  const out = join(root, 'out');
  mkdirSync(join(out, 'voice'), { recursive: true });
  writeFileSync(
    join(out, 'produce-meta.json'),
    JSON.stringify({ segments: { openSec: 1, liveSec: Math.max(1, totalSec - 3), closeSec: 2 } })
  );
  const voiceWav = join(out, 'voice', 'outro.wav');
  ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=440:duration=${outroDur}`, '-ar', '48000', voiceWav]);
  const start = totalSec - 2;
  writeFileSync(
    join(out, 'voice', 'voice.json'),
    JSON.stringify({
      clips: [
        {
          key: 'outro',
          kind: 'outro',
          start,
          end: start + outroDur,
          duration: outroDur,
          full: outroDur,
          file: voiceWav,
          speed: 1,
          take: 1,
          text: 'outro line',
          notes: [],
        },
      ],
      warnings: [],
    })
  );
  const master = join(out, 'picture.mp4');
  ffmpeg(['-f', 'lavfi', '-i', `testsrc=size=320x180:rate=30:duration=${totalSec}`, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', master]);
  const video = { slug: 'fixture', out, config: { edit: { audio: {} } }, audio: { mix: MIX_DEFAULTS } };
  return { video, master };
}

test('mixAudio freezes the last frame when the actual read runs past the picture', () => {
  const root = mkdtempSync(join(tmpdir(), 'mix-hold-'));
  try {
    // The outro clip starts 2s before the end and plays 5s, so it ends 3s past the 10s picture —
    // the exact shape of a TTS read that ran longer than the word-count estimate.
    const { video, master } = fixture(root, { totalSec: 10, outroDur: 5 });
    const result = mixAudio(video, { out: master });
    assert.equal(result.final, master);
    const sec = duration(master);
    assert.ok(sec > 12.5 && sec < 13.6, `expected the picture to extend to ~13s, got ${sec}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mixAudio refuses to silently freeze a large overrun', () => {
  const root = mkdtempSync(join(tmpdir(), 'mix-hold-big-'));
  try {
    // The outro ends 10s past the picture — a scripting problem, not TTS timing noise.
    const { video, master } = fixture(root, { totalSec: 10, outroDur: 20 });
    assert.throws(() => mixAudio(video, { out: master }), /too long to freeze/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { assertX264Args, BT709_PARAMS, BT709_TAGS, lossyX264, QUALITY } from './encode.mjs';
// Not `./motion.mjs`: that module sits mid-cycle with camera.mjs/direction.mjs/project.mjs, and
// media.mjs is meant to stay a dependency-free leaf. The tail below reads the source's own rate.

export const run = (bin, args, label) => {
  if (label) console.log('·', label);
  const r = spawnSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  if (r.status !== 0) {
    console.error((r.stderr || r.stdout || '').slice(-3000));
    throw new Error(`failed: ${label || bin}`);
  }
  return r.stdout;
};

/**
 * ffmpeg with live progress. Adds `-progress pipe:1` and calls onProgress about once a second
 * with { done, total, fraction, speed, etaSec } measured against `totalSec` of output.
 */
export function ffmpegProgress(args, { label, totalSec, onProgress, everyMs = 1000 } = {}) {
  if (label) console.log('·', label);
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-progress', 'pipe:1', '-nostats', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let buf = '';
    let last = 0;
    const started = Date.now();
    ff.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-6000);
    });
    ff.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
        if (!m || !onProgress || !totalSec) continue;
        const done = Math.min(totalSec, Number(m[1]) / 1e6);
        const now = Date.now();
        if (now - last < everyMs) continue;
        last = now;
        const wall = (now - started) / 1000;
        const speed = wall > 0 ? done / wall : 0;
        onProgress({
          done,
          total: totalSec,
          fraction: done / totalSec,
          speed,
          etaSec: speed > 0 ? (totalSec - done) / speed : null,
        });
      }
    });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0) return resolve();
      console.error(stderr.slice(-3000));
      reject(new Error(`failed: ${label || 'ffmpeg'}`));
    });
  });
}

export { STILL_JPEG_ARGS } from './encode.mjs';

/** 125.4 → "2:05". */
export const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const duration = (file) =>
  parseFloat(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]));

/**
 * Refuse to pass a broken render downstream.
 *
 * ffmpeg exits 0 when it copies a damaged stream, so a corrupt master used to sail
 * through mix and deliver as a few black seconds. Checks the container length against
 * what was planned and decodes the head and tail, where a truncated or interleaved
 * write shows up first.
 *
 * @param {string} file
 * @param {{expectedSec?: number, toleranceSec?: number, label?: string}} opts
 */
export function assertPlayable(file, { expectedSec, toleranceSec = 1.5, label = 'render' } = {}) {
  const probe = spawnSync(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=duration,nb_frames:format=duration',
      '-of', 'json',
      file,
    ],
    { encoding: 'utf8' }
  );
  const noise = (probe.stderr || '').trim();
  if (probe.status !== 0 || noise) {
    throw new Error(`${label} is unreadable: ${noise.split('\n')[0] || `ffprobe exit ${probe.status}`}`);
  }
  let info;
  try {
    info = JSON.parse(probe.stdout);
  } catch {
    throw new Error(`${label} has no readable stream info`);
  }
  const stream = info.streams?.[0];
  if (!stream) throw new Error(`${label} has no video stream`);
  const containerSec = parseFloat(info.format?.duration);
  // Measure the picture, not the container: a master whose video stream stopped early
  // still reports full length from its audio track, and plays as minutes of black.
  const pictureSec = parseFloat(stream.duration);
  const sec = Number.isFinite(pictureSec) ? pictureSec : containerSec;
  if (!Number.isFinite(sec) || sec <= 0) throw new Error(`${label} has no duration`);
  if (Number.isFinite(containerSec) && containerSec - sec > toleranceSec) {
    throw new Error(
      `${label} has ${sec.toFixed(2)}s of picture in a ${containerSec.toFixed(2)}s file — ` +
        'the rest would play back black'
    );
  }
  if (Number.isFinite(expectedSec) && Math.abs(sec - expectedSec) > toleranceSec) {
    throw new Error(
      `${label} is ${sec.toFixed(2)}s but ${expectedSec.toFixed(2)}s was planned — the encode was cut short`
    );
  }
  for (const window of [['-t', '2'], ['-sseof', '-2']]) {
    const decode = spawnSync('ffmpeg', ['-v', 'error', ...window, '-i', file, '-map', '0:v:0', '-f', 'null', '-'], {
      encoding: 'utf8',
    });
    const errs = (decode.stderr || '').trim();
    if (decode.status !== 0 || errs) {
      throw new Error(`${label} does not decode cleanly: ${errs.split('\n')[0] || `ffmpeg exit ${decode.status}`}`);
    }
  }
  return sec;
}

/**
 * Freeze the last frame of `source` and hold it for `padSec` more seconds, overwriting `source`
 * in place. Real narration can run past the hold `extendCloseForVoice` estimated at plan time
 * (the word-count heuristic is only ever an estimate) — the picture should catch up to it rather
 * than the mux leaving a container longer than its last video frame, which plays back as a freeze
 * or black once the picture runs out.
 *
 * Only the small new tail is re-encoded; the existing master is concatenated in as a stream copy,
 * so this stays inside the single-lossy-generation floor (see encode.mjs).
 *
 * @param {string} source path to the silent master (video-only, no audio stream)
 * @param {number} padSec seconds to add
 * @param {{label?: string}} [opts]
 */
export function extendPictureTail(source, padSec, { label = 'master' } = {}) {
  const pad = Number(padSec);
  if (!(pad > 0)) return;
  // Match the source's own rate (e.g. "30/1") rather than importing a shared FPS constant —
  // this file stays a dependency-free leaf that encode-adjacent modules can import from.
  const fps = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', source]).trim() || '30/1';
  const base = source.replace(/\.mp4$/, '');
  const still = `${base}.tail-frame.png`;
  const tail = `${base}.tail-hold.mp4`;
  const list = `${base}.tail-concat.txt`;
  const joined = `${base}.tail-joined.mp4`;
  try {
    run(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-sseof', '-0.1', '-i', source, '-frames:v', '1', still],
      `${label}: grabbing the last frame`
    );
    const tailArgs = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-loop', '1', '-framerate', fps, '-t', pad.toFixed(3), '-i', still,
      '-vf', `format=yuv420p,${BT709_PARAMS}`,
      ...lossyX264(QUALITY.delivery),
      '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p',
      '-g', '60', '-keyint_min', '30', '-bf', '2',
      ...BT709_TAGS,
      '-r', fps,
      tail,
    ];
    assertX264Args('delivery', tailArgs);
    run('ffmpeg', tailArgs, `${label}: holding the last frame for ${pad.toFixed(1)}s`);
    writeFileSync(list, `file '${source}'\nfile '${tail}'\n`);
    run(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined],
      `${label}: joining the held tail`
    );
    renameSync(joined, source);
  } finally {
    for (const f of [still, tail, list, joined]) {
      if (existsSync(f)) unlinkSync(f);
    }
  }
}

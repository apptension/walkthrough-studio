import { spawn, spawnSync } from 'node:child_process';

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

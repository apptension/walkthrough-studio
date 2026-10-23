/**
 * Blank-frame repair. While a new document loads, Chromium paints a blank white (or black) page
 * that the screencast captures as a flash — sometimes with a toast or the pointer on top.
 *
 * Two signals per frame: luma entropy (real UI ≈ 0.5, a white email ≥ 0.13, a blank page ≈ 0,
 * a blank page under a toast ≈ 0.1) and mean luma. A run is a flash when it is short and either
 * perfectly flat, or near-flat and much brighter than the frames around it.
 *
 * Each flash becomes a dissolve from the last good frame to the next good one, applied inside
 * the delivery encode (no extra generation).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { FPS } from './motion.mjs';

const FLAT = 0.018; // entropy below this: blank (SPA white/ink flash), whatever the context
const NEAR_FLAT = 0.18; // entropy below this: blank if it is also a bright spike
const SPIKE = 80; // luma a near-flat run must exceed its surroundings by
const MAX_GAP = 120; // frames (~4s); longer runs are treated as intentional and reported
const MERGE = 6; // frames of partial paint allowed between two blank runs before they count as separate
const VERSION = 3;

function frameStats(file) {
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', file, '-vf', 'scale=320:-2,entropy,signalstats,metadata=print:file=-', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 1 << 28 }
  );
  if (r.status !== 0) throw new Error(`frame scan failed: ${(r.stderr || '').slice(-800)}`);
  const frames = [];
  let cur = null;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('frame:')) {
      cur = { e: 1, y: 0 };
      frames.push(cur);
      continue;
    }
    const e = line.match(/normalized_entropy\.normal\.Y=([\d.]+)/);
    if (e && cur) cur.e = parseFloat(e[1]);
    const y = line.match(/signalstats\.YAVG=([\d.]+)/);
    if (y && cur) cur.y = parseFloat(y[1]);
  }
  return frames;
}

/** Flash runs → { frames, gaps: [{ first, last }] (inclusive), kept: long runs left alone }. */
function runsOf(f, test) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= f.length; i++) {
    const hit = i < f.length && test(f[i]);
    if (hit && start < 0) start = i;
    if (!hit && start >= 0) {
      const prev = runs.at(-1);
      if (prev && start - prev.last <= MERGE + 1) prev.last = i - 1;
      else runs.push({ first: start, last: i - 1 });
      start = -1;
    }
  }
  return runs;
}

export function scanFlashes(file) {
  const f = frameStats(file);
  // Perfectly flat frames are always blank pages
  const flat = runsOf(f, (s) => s.e < FLAT);
  // Near-flat bright frames only when they spike above both neighbours (a white email is bright but not a spike)
  const spikes = runsOf(f, (s) => s.e < NEAR_FLAT && s.y > 200).filter((run) => {
    const span = f.slice(run.first, run.last + 1);
    const meanY = span.reduce((a, s) => a + s.y, 0) / span.length;
    const around = [f[run.first - 1]?.y, f[run.last + 1]?.y].filter((v) => v !== undefined);
    return around.length > 0 && meanY - Math.max(...around) > SPIKE;
  });
  const merged = [];
  for (const run of [...flat, ...spikes].sort((a, b) => a.first - b.first)) {
    const prev = merged.at(-1);
    if (prev && run.first - prev.last <= MERGE + 1) prev.last = Math.max(prev.last, run.last);
    else merged.push({ ...run });
  }
  const gaps = merged.filter((r) => r.last - r.first + 1 <= MAX_GAP);
  const kept = merged.filter((r) => r.last - r.first + 1 > MAX_GAP);
  return { frames: f.length, gaps, kept };
}

/** Cached per live take (size + mtime + detector version). */
export function flashesFor(livePath, cachePath) {
  const s = statSync(livePath);
  const key = `${VERSION}:${s.size}:${s.mtimeMs}`;
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
    if (cached.key === key) return cached;
  }
  const result = { key, ...scanFlashes(livePath) };
  writeFileSync(cachePath, JSON.stringify(result, null, 2));
  return result;
}

/**
 * Filter-graph fragment: `inLabel` → `outLabel` with every gap dissolved; null when there is nothing to fix.
 * Two copies of the stream are frozen over each gap (one on the frame before, one on the frame after)
 * and blended with a smoothstep across the gap; outside the gaps the blend is disabled (pass-through).
 */
export function deflashGraph(gaps, frames, inLabel, outLabel) {
  const usable = gaps
    .map((g) => ({ ...g, prev: g.first - 1, next: g.last + 1 }))
    .filter((g) => g.prev >= 0 || g.next < frames)
    .map((g) => ({ ...g, prev: g.prev >= 0 ? g.prev : g.next, next: g.next < frames ? g.next : g.prev }));
  if (!usable.length) return null;
  const n = usable.length;
  const parts = [`${inLabel}split=${2 + 2 * n}[dfA0][dfB0]${usable.map((_, i) => `[dfRa${i}][dfRb${i}]`).join('')}`];
  usable.forEach((g, i) => {
    parts.push(`[dfA${i}][dfRa${i}]freezeframes=first=${g.first}:last=${g.last}:replace=${g.prev}[dfA${i + 1}]`);
    parts.push(`[dfB${i}][dfRb${i}]freezeframes=first=${g.first}:last=${g.last}:replace=${g.next}[dfB${i + 1}]`);
  });
  // k: 0 on the frame before the gap → 1 on the frame after, smoothstep-eased
  let k = '0';
  for (const g of [...usable].reverse()) {
    const t0 = (g.first - 1) / FPS;
    const len = (g.last - g.first + 2) / FPS;
    // Inline, no st()/ld(): registers in a per-pixel expression are shared across slice threads.
    const u = `((T-${t0.toFixed(4)})/${len.toFixed(4)})`;
    k = `if(between(T,${t0.toFixed(4)},${(t0 + len).toFixed(4)}),${u}*${u}*(3-2*${u}),${k})`;
  }
  const enable = usable.map((g) => `between(t,${(g.first / FPS - 0.001).toFixed(4)},${((g.last + 0.5) / FPS).toFixed(4)})`).join('+');
  parts.push(`[dfA${n}][dfB${n}]blend=all_expr='A*(1-(${k}))+B*(${k})':enable='${enable}'${outLabel}`);
  return parts.join(';');
}

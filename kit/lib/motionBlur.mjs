/**
 * Shutter motion blur for camera moves (zoom push-ins, pans, the cross-zoom transition).
 *
 * Each delivered frame integrates the camera transform over a 180° shutter centred on it: the
 * transform is evaluated at `samples` evenly spaced instants inside the open half of the frame
 * and the results are averaged. Blur length therefore follows velocity exactly — the fast middle
 * of an eased move streaks, the slow ends and the zoom's own centre stay crisp, a held frame is
 * untouched (identical samples average to themselves) — and every sample of a frame reads the
 * same source frame, so UI content never ghosts.
 *
 * The sample count adapts to the window's peak speed so neighbouring samples land at most
 * `MAX_GAP_PX` apart (a continuous streak, not stepped copies). Only windows whose fastest edge
 * travels more than `MIN_TRAVEL_PX` per frame are rendered this way.
 */

export const MIN_TRAVEL_PX = 3;
/** Widest spacing between two shutter samples, in px, at the window's peak speed. */
export const MAX_GAP_PX = 1.25;
export const MIN_SAMPLES = 4;
export const MAX_SAMPLES = 32;
/** Frames added either side of a window so the blur fades in and out with the velocity. */
const PAD_FRAMES = 2;
/** Windows closer than this are merged (one piece costs less than two splits). */
const MERGE_FRAMES = 6;

/**
 * Fastest per-frame travel (px) of any visible pixel when the camera goes from `a` to `b`
 * ({ z, cx, cy } in source px, frame centred on cx/cy at magnification z). A source point s sits
 * at (s − c)·z + W/2; over one frame it moves by (s − c)·Δz − Δc·z, largest at the frame corners.
 */
export function frameTravel(a, b, { width, height }) {
  const z = (a.z + b.z) / 2;
  const dz = b.z - a.z;
  const dx = Math.abs((width / 2 / z) * dz) + Math.abs((b.cx - a.cx) * z);
  const dy = Math.abs((height / 2 / z) * dz) + Math.abs((b.cy - a.cy) * z);
  return Math.hypot(dx, dy);
}

/**
 * Frame windows [startFrame, endFrame, peakTravelPx] where the camera moves fast enough to need
 * blur. `cameraAt(t)` returns { z, cx, cy }; only [from, to) seconds are scanned.
 */
export function blurWindows(cameraAt, { from = 0, to, fps, width, height, totalFrames = Infinity, minTravel = MIN_TRAVEL_PX }) {
  const f0 = Math.max(0, Math.floor(from * fps));
  const f1 = Math.min(totalFrames, Math.ceil(to * fps));
  const raw = [];
  let prev = cameraAt(f0 / fps);
  for (let f = f0 + 1; f <= f1; f++) {
    const next = cameraAt(f / fps);
    const travel = frameTravel(prev, next, { width, height });
    if (travel >= minTravel) {
      const last = raw.at(-1);
      if (last && f - 1 <= last[1]) {
        last[1] = f + 1;
        last[2] = Math.max(last[2], travel);
      } else raw.push([f - 1, f + 1, travel]);
    }
    prev = next;
  }
  return mergeWindows(
    raw.map(([a, b, p]) => [Math.max(0, a - PAD_FRAMES), Math.min(totalFrames, b + PAD_FRAMES), p]),
    MERGE_FRAMES
  );
}

/** Union of [start, end, peak?] windows; touching or `gap`-close windows merge and keep the higher peak. */
export function mergeWindows(windows, gap = 0) {
  const out = [];
  for (const w of [...windows].sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && w[0] - last[1] <= gap) {
      last[1] = Math.max(last[1], w[1]);
      if (w[2] != null) last[2] = Math.max(last[2] ?? 0, w[2]);
    } else out.push([...w]);
  }
  return out.filter(([a, b]) => b > a);
}

/** Shutter samples for a peak travel: a power of two, spaced at most MAX_GAP_PX across half a frame. */
export function shutterSamples(peakTravel = 0) {
  const want = (peakTravel / 2) / MAX_GAP_PX;
  let n = MIN_SAMPLES;
  while (n < want && n < MAX_SAMPLES) n *= 2;
  return n;
}

/**
 * Supersample → transform → 180° box shutter → back on the frame grid.
 * `transform(clock)` returns the camera chain with `clock` as the stream-time expression; `offset`
 * is the piece's start in stream seconds. Each frame k keeps `n` samples from the first half of
 * its 2n-subframe interval and re-times them to straddle k/fps, then a pairwise pyramid
 * (tmix of 2, keep every second) averages them down to one frame.
 */
export function shutterChain(transform, fps, { offset = 0, samples = MIN_SAMPLES } = {}) {
  const n = samples;
  const rate = fps * 2 * n;
  const shift = (n / 2 - 0.5) / rate;
  const clock = `(t${fmtOffset(Number(offset) - shift)})`;
  const halve = `tmix=frames=2,select='mod(n\\,2)'`;
  const stages = Array.from({ length: Math.log2(n) }, () => halve).join(',');
  return (
    `fps=${rate},select='lt(mod(n\\,${2 * n})\\,${n})',${transform(clock)},${stages},` +
    `setpts=N/(${fps}*TB),fps=${fps}`
  );
}

const fmtOffset = (v) => (Math.abs(v) < 5e-7 ? '' : v > 0 ? `+${v.toFixed(6)}` : `-${Math.abs(v).toFixed(6)}`);
/** `t` shifted by `offset` seconds, as an ffmpeg expression. */
export const clockAt = (offset) => (fmtOffset(Number(offset)) ? `(t${fmtOffset(Number(offset))})` : 't');

/**
 * Graph statements applying a camera transform to `src` with shutter blur inside `windows`.
 * The stream is cut on the frame grid into still and moving pieces; each piece restarts its clock,
 * and `transform(clock)` receives the expression for stream time. `active` (frame windows,
 * default: whole stream) limits where the transform runs at all.
 */
export function blurredGraph({ src, out, totalFrames, fps, windows, transform, active = null }) {
  const cuts = new Set([0, totalFrames]);
  const within = (f, list) => list.find(([a, b]) => f >= a && f < b);
  const blur = mergeWindows(windows)
    .map(([a, b, p]) => [Math.max(0, a), Math.min(totalFrames, b), p])
    .filter(([a, b]) => b > a);
  for (const [a, b] of [...blur, ...(active || [])]) {
    cuts.add(Math.max(0, Math.min(totalFrames, a)));
    cuts.add(Math.max(0, Math.min(totalFrames, b)));
  }
  const edges = [...cuts].sort((a, b) => a - b);
  const pieces = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const [a, b] = [edges[i], edges[i + 1]];
    if (b <= a) continue;
    const moving = within(a, blur);
    const transformed = Boolean(moving) || !active || Boolean(within(a, active));
    pieces.push({ a, b, samples: moving ? shutterSamples(moving[2]) : 0, transformed });
  }
  if (!pieces.some((p) => p.samples)) {
    if (!pieces.some((p) => p.transformed)) return [`${src}null${out}`];
    if (!active) return [`${src}${transform('t')}${out}`];
  }
  const name = out.slice(1, -1);
  const labels = pieces.map((_, i) => `[${name}_p${i}]`);
  const taps = pieces.map((_, i) => `[${name}_s${i}]`);
  const lines = [pieces.length > 1 ? `${src}split=${pieces.length}${taps.join('')}` : `${src}null${taps[0]}`];
  pieces.forEach((p, i) => {
    const offset = p.a / fps;
    // The last piece runs to the end of the stream, so a frame-count estimate can never truncate it.
    const end = p.b >= totalFrames ? '' : `:end_frame=${p.b}`;
    const cut = `trim=start_frame=${p.a}${end},setpts=PTS-STARTPTS`;
    const body = p.samples
      ? shutterChain(transform, fps, { offset, samples: p.samples })
      : p.transformed
        ? transform(clockAt(offset))
        : 'null';
    lines.push(`${taps[i]}${cut},${body}${labels[i]}`);
  });
  lines.push(`${labels.join('')}concat=n=${pieces.length}:v=1:a=0,setpts=N/(${fps}*TB),fps=${fps}${out}`);
  return lines;
}

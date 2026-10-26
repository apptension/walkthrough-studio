/**
 * Camera direction for the live reel, applied in the lossless clean pass:
 *   - auto zoom: eased push-ins that follow the pointer from click to click (from `click`/`type`
 *     marks the recorder writes), kept clear of chapter cards, captions and lenses;
 *   - inset frame: the take as a rounded window with a soft shadow on a brand background.
 * The product UI is only scaled, never graded.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BT709_PARAMS, BT709_SCALE_OPTS } from './encode.mjs';
import { run } from './media.mjs';
import { blurWindows, blurredGraph, mergeWindows } from './motionBlur.mjs';
import { clampZoomCenter } from './shared/zoomAim.js';
import { CURVE_IDS, DEFAULT_CURVE, DEFAULT_MOTION, MOTION_IDS, curveOf, motionScale, unitExpr } from './shared/easing.js';

export const ZOOM_LEVELS = Object.freeze({ off: 0, subtle: 1.3, bold: 1.65 });
export const FRAME_STYLES = Object.freeze(['full', 'inset']);
export const BACKGROUNDS = Object.freeze(['brand', 'ink', 'accent']);
export const FRAME_PADDING = Object.freeze({ tight: 0.95, balanced: 0.9, roomy: 0.82 });
export const FRAME_CORNERS = Object.freeze({ square: 0, soft: 22, round: 42 });
export const FRAME_SHADOWS = Object.freeze(['off', 'soft', 'deep']);
export const CAMERA_CURVES = CURVE_IDS;
export const CAMERA_MOTIONS = MOTION_IDS;

/**
 * Base move lengths at `natural` motion. The push-in is quick enough to read as a response to the
 * click, the pull-back is a touch longer (the eye forgives a slow release, never a slow attack),
 * and a pan between targets arrives with the pointer.
 */
const IN = 0.9;
const OUT = 1.05;
const PAN = 0.7;
/** Ease lengths + curve shared with the Studio's live preview so the on-screen push-in matches the render. */
export const ZOOM_TIMING = Object.freeze({ in: IN, out: OUT, pan: PAN, curve: DEFAULT_CURVE, motion: DEFAULT_MOTION });

/** Timing for a video's camera direction: `motion` scales the lengths, `curve` shapes them. */
export function zoomTiming(camera = {}) {
  const k = motionScale(camera.motion);
  const curve = CURVE_IDS.includes(camera.curve) ? camera.curve : DEFAULT_CURVE;
  const motion = MOTION_IDS.includes(camera.motion) ? camera.motion : DEFAULT_MOTION;
  return { in: Number((IN * k).toFixed(3)), out: Number((OUT * k).toFixed(3)), pan: Number((PAN * k).toFixed(3)), curve, motion };
}
const HOLD_AFTER = 1.6;
const MERGE_GAP = 2.8;
const MIN_HOLD = 0.5;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const even = (v) => Math.round(v / 2) * 2;
const f3 = (v) => Number(v).toFixed(3);

/** Windows where the frame must stay whole: cards and captions are part of the picture. */
export function blockedWindows(timeline) {
  const out = [];
  for (const m of timeline) {
    if (!Number.isFinite(m.t)) continue;
    if (m.kind === 'chapter') out.push([m.t - 0.3, m.t + (m.dur || 2.8) + 0.4]);
    else if (m.kind === 'caption') out.push([m.t - 0.3, m.t + (m.dur || 2.4) + 0.5]);
    else if (m.kind === 'magnify' && m.dur) out.push([m.t - 0.3, m.t + m.dur + 0.3]);
    else if (m.kind === 'zoom' && m.dur) out.push([m.t, m.t + m.dur]);
    // Editor "keep whole" windows (edit.zoomSkips) — auto zoom stays out, manual zooms still apply.
    else if (m.kind === 'nozoom' && m.dur) out.push([m.t, m.t + m.dur]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * Group pointer targets into zoom shots. Returns [{ start, end, zoom, points: [{ t, cx, cy }] }]
 * plus how many targets fell inside a blocked window.
 */
export function planZooms(timeline = [], { width, height, level = 'off', duration = Infinity, timing = ZOOM_TIMING } = {}) {
  const { in: IN, out: OUT } = timing;
  const zoom = ZOOM_LEVELS[level] || 0;
  const targets = timeline
    .filter((m) => (m.kind === 'click' || m.kind === 'type') && Number.isFinite(m.x) && Number.isFinite(m.y))
    .sort((a, b) => a.t - b.t);
  const manual = timeline
    .filter((m) => m.kind === 'zoom' && Number.isFinite(m.t) && Number.isFinite(m.dur) && m.dur > 0)
    .map((m) => {
      const z = Number.isFinite(m.zoom) ? clamp(m.zoom, 1.1, 2.2) : ZOOM_LEVELS[m.level] || ZOOM_LEVELS.bold;
      const x = Number.isFinite(m.x) ? m.x : m.rect ? m.rect.x + m.rect.w / 2 : width / 2;
      const y = Number.isFinite(m.y) ? m.y : m.rect ? m.rect.y + m.rect.h / 2 : height / 2;
      const aim = clampZoomCenter(x, y, { zoom: z, width, height });
      return {
        start: Number(f3(Math.max(0, m.t))),
        end: Number(f3(Math.min(duration, m.t + m.dur))),
        zoom: z,
        source: m.source === 'edit' ? 'edit' : 'manual',
        ...(m.id ? { id: m.id } : {}),
        points: [{ t: m.t + Math.min(IN, m.dur * 0.35), cx: aim.cx, cy: aim.cy }],
      };
    })
    .filter((shot) => shot.end - shot.start >= IN + OUT + 0.15);
  if ((!zoom || !targets.length) && !manual.length) {
    return { shots: [], skipped: 0, targets: targets.length, manual: 0 };
  }
  const blocked = blockedWindows(timeline);
  const isBlocked = (t) => blocked.some(([a, b]) => t >= a && t <= b);
  const usable = zoom ? targets.filter((m) => !isBlocked(m.t)) : [];

  const groups = [];
  for (const m of usable) {
    const last = groups.at(-1);
    const between = last && blocked.some(([a, b]) => a < m.t && b > last.at(-1).t);
    if (last && m.t - last.at(-1).t < MERGE_GAP && !between) last.push(m);
    else groups.push([m]);
  }

  const shots = [];
  for (const group of groups) {
    const first = group[0].t;
    const lastT = group.at(-1).t;
    let start = Math.max(0, first - IN - 0.15);
    let end = Math.min(duration, lastT + HOLD_AFTER + OUT);
    for (const [a, b] of blocked) {
      if (b <= first && b > start) start = b;
      if (a >= lastT && a < end) end = a;
    }
    if (end - start < IN + OUT + MIN_HOLD) continue;
    const points = group.map((m) => {
      const aim = clampZoomCenter(m.x, m.y, { zoom, width, height });
      return { t: m.t, cx: aim.cx, cy: aim.cy };
    });
    shots.push({ start: Number(f3(start)), end: Number(f3(end)), zoom, source: 'auto', points });
  }
  shots.push(...manual);
  shots.sort((a, b) => a.start - b.start);
  return { shots, skipped: zoom ? targets.length - usable.length : 0, targets: targets.length, manual: manual.length };
}

/** The video's curve over `dur` seconds from `from`, as an ffmpeg expression in `clock`. */
const ease = (curve, from, dur, clock = 't') => curveOf(curve).expr(unitExpr(clock, from, dur));

function zoomExpr(shots, timing, clock = 't') {
  const { in: IN, out: OUT, curve } = timing;
  const terms = shots.map((s) => {
    const inE = ease(curve, s.start, IN, clock);
    const outE = ease(curve, s.end - OUT, OUT, clock);
    return `${(s.zoom - 1).toFixed(4)}*${inE}*(1-${outE})*between(${clock},${f3(s.start)},${f3(s.end)})`;
  });
  return `(1+${terms.join('+')})`;
}

/** Keyframes of one centre coordinate: hold at each target, ease to the next over `pan` seconds. */
function centerPoints(shots, key, timing) {
  const points = [];
  for (const s of shots) {
    const pts = s.points;
    points.push({ t: s.start, v: pts[0][key] });
    for (let i = 1; i < pts.length; i++) {
      points.push({ t: Math.max(pts[i - 1].t, pts[i].t - timing.pan), v: pts[i - 1][key] });
      points.push({ t: pts[i].t, v: pts[i][key] });
    }
    points.push({ t: s.end, v: pts.at(-1)[key] });
  }
  return points;
}

function centerExpr(shots, key, timing, clock = 't') {
  const points = centerPoints(shots, key, timing);
  let out = String(points.at(-1).v);
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i];
    const b = points[i + 1];
    const value = a.v === b.v ? String(a.v) : `${a.v}+(${b.v - a.v})*${ease(timing.curve, a.t, b.t - a.t, clock)}`;
    out = `if(lt(${clock},${f3(b.t)}),${value},${out})`;
  }
  return out;
}

/** The same camera path as the filter expressions, in JS: { z, cx, cy } at `t` (centre null = frame centre). */
export function cameraAt(shots, t, { width, height, timing = ZOOM_TIMING } = {}) {
  const { in: IN, out: OUT, curve } = timing;
  const fn = curveOf(curve).fn;
  let z = 1;
  for (const s of shots) {
    if (t < s.start || t > s.end) continue;
    z += (s.zoom - 1) * fn((t - s.start) / IN) * (1 - fn((t - (s.end - OUT)) / OUT));
  }
  const at = (key) => {
    const points = centerPoints(shots, key, timing);
    for (let i = 0; i + 1 < points.length; i++) {
      const [a, b] = [points[i], points[i + 1]];
      if (t < b.t) return a.v === b.v ? a.v : a.v + (b.v - a.v) * fn((t - a.t) / Math.max(0.001, b.t - a.t));
    }
    return points.at(-1).v;
  };
  return shots.length ? { z, cx: at('cx'), cy: at('cy') } : { z, cx: width / 2, cy: height / 2 };
}

/**
 * Magnify by `Z` about (cx, cy): scale first (lanczos, continuous zoom), then crop at output
 * resolution, so a move never steps by whole source pixels. No colour conversion happens here.
 */
export function pushFilter({ Z, cx, cy, width, height }) {
  const sw = `trunc(${width}*${Z}/2)*2`;
  const sh = `trunc(${height}*${Z}/2)*2`;
  const keep = 'in_color_matrix=bt709:out_color_matrix=bt709:in_range=tv:out_range=tv';
  return (
    `scale=w='${sw}':h='${sh}':eval=frame:flags=lanczos+accurate_rnd+full_chroma_int:${keep},` +
    `crop=${width}:${height}:x='clip((${cx})*${Z}-${width / 2},0,${sw}-${width})':` +
    `y='clip((${cy})*${Z}-${height / 2},0,${sh}-${height})':exact=1,` +
    // Even-rounded scale sizes are not exactly proportional; the crop is square pixels again.
    'setsar=1'
  );
}

/** Per-frame push-in following the planned shots. `clock` is the stream-time expression. */
export function zoomFilter(shots, { width, height, timing = ZOOM_TIMING, clock = 't' }) {
  if (!shots?.length) return null;
  return pushFilter({
    Z: zoomExpr(shots, timing, clock),
    cx: centerExpr(shots, 'cx', timing, clock),
    cy: centerExpr(shots, 'cy', timing, clock),
    width,
    height,
  });
}

/**
 * Graph statements for the planned shots on `src`, with shutter blur wherever a push-in, pan or
 * pull-back moves fast enough to judder. Returns null when there is nothing to zoom.
 */
export function zoomGraph(shots, { src, out, width, height, fps, totalFrames, timing = ZOOM_TIMING, blur = true }) {
  if (!shots?.length) return null;
  const windows = blur
    ? mergeWindows(
        shots.flatMap((s) =>
          blurWindows((t) => cameraAt(shots, t, { width, height, timing }), { from: s.start, to: s.end, fps, width, height, totalFrames })
        )
      )
    : [];
  const active = shots.map((s) => [Math.max(0, Math.floor(s.start * fps) - 1), Math.min(totalFrames, Math.ceil(s.end * fps) + 1)]);
  const lines = blurredGraph({
    src,
    out,
    totalFrames,
    fps,
    windows,
    active: mergeWindows(active),
    transform: (clock) => zoomFilter(shots, { width, height, timing, clock }),
  });
  return { lines, windows };
}

/**
 * Cross zoom: the outgoing shot accelerates into a push-in while the incoming one lands from a
 * slight magnification, both under the dissolve and both shutter-blurred. Peak magnification stays
 * low so lanczos keeps the picture clean (ffmpeg's `zoomin` magnifies to a single pixel, nearest).
 */
export const CROSS_ZOOM = Object.freeze({ out: 0.3, in: 0.16 });

/** Magnification of a segment `dur` seconds long that leaves on a cross zoom of `tail` s and/or arrives on one of `head` s. */
export function crossZoomAt(t, { dur, head = 0, tail = 0 }) {
  let z = 1;
  if (head > 0 && t < head) z += CROSS_ZOOM.in * (1 - curveOf('glide').fn(t / head));
  if (tail > 0 && t > dur - tail) z += CROSS_ZOOM.out * ((t - (dur - tail)) / tail) ** 2;
  return z;
}

function crossZoomExpr({ dur, head = 0, tail = 0, clock }) {
  const terms = [];
  if (head > 0) terms.push(`${CROSS_ZOOM.in}*(1-${curveOf('glide').expr(unitExpr(clock, 0, head))})`);
  if (tail > 0) terms.push(`${CROSS_ZOOM.out}*pow(${unitExpr(clock, dur - tail, tail)},2)`);
  return `(1+${terms.join('+')})`;
}

/** Graph statements putting the cross-zoom moves on one segment stream (local clock from 0). */
export function crossZoomGraph({ src, out, dur, head = 0, tail = 0, width, height, fps }) {
  const totalFrames = Math.round(dur * fps);
  const geo = { dur, head, tail };
  const camera = (t) => ({ z: crossZoomAt(t, geo), cx: width / 2, cy: height / 2 });
  const active = [];
  if (head > 0) active.push([0, Math.min(totalFrames, Math.ceil(head * fps) + 1)]);
  if (tail > 0) active.push([Math.max(0, Math.floor((dur - tail) * fps) - 1), totalFrames]);
  const windows = active.flatMap(([a, b]) => blurWindows(camera, { from: a / fps, to: b / fps, fps, width, height, totalFrames }));
  return blurredGraph({
    src,
    out,
    totalFrames,
    fps,
    windows,
    active: mergeWindows(active),
    transform: (clock) =>
      pushFilter({
        Z: crossZoomExpr({ ...geo, clock }),
        cx: width / 2,
        cy: height / 2,
        width,
        height,
      }),
  });
}

/** Window geometry for the inset frame. */
export function insetGeometry({ width, height, padding = 'balanced', corners = 'soft' }) {
  const inset = FRAME_PADDING[padding] || FRAME_PADDING.balanced;
  const w = even(width * inset);
  const h = even(height * inset);
  return {
    w,
    h,
    x: 2 * Math.floor((width - w) / 4),
    y: 2 * Math.floor((height - h) / 4) - (padding === 'roomy' ? 8 : 4),
    radius: FRAME_CORNERS[corners] ?? FRAME_CORNERS.soft,
  };
}

const hex = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.slice(1) : fallback);

/**
 * Alpha mask for one recording window, cached beside the take. The section graph uses it to round
 * the recording that sits on a backdrop rendered from the shared HTML template.
 */
export function frameMask(dir, geo) {
  const key = createHash('sha1')
    .update(JSON.stringify({ v: 1, w: geo.w, h: geo.h, r: geo.radius }))
    .digest('hex')
    .slice(0, 12);
  mkdirSync(dir, { recursive: true });
  const mask = join(dir, `win-mask-${key}.png`);
  if (existsSync(mask)) return mask;
  run(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=black:s=${geo.w}x${geo.h}:d=1`,
      '-vf', `format=gray,geq=lum='${roundedMask(geo.w, geo.h, geo.radius)}'`,
      '-frames:v', '1', '-update', '1', mask,
    ],
    'window mask',
  );
  return mask;
}

/** Rounded-rect coverage (anti-aliased) as a geq expression over a w×h frame. */
function roundedMask(w, h, r) {
  const dx = `max(abs(X-${w / 2}+0.5)-${w / 2 - r},0)`;
  const dy = `max(abs(Y-${h / 2}+0.5)-${h / 2 - r},0)`;
  return `255*clip(${r}+0.5-hypot(${dx},${dy}),0,1)`;
}

/**
 * Background (gradient + accent glow + window shadow) and the window alpha mask, rendered once
 * per brand colours and frame size, then cached beside the take.
 */
export function frameAssets(
  video,
  { width, height, background = 'brand', padding = 'balanced', corners = 'soft', shadow = 'soft', geo = insetGeometry({ width, height, padding, corners }) }
) {
  const colors = video.brand.colors || {};
  const ink = hex(colors.ink, '0b1020');
  const surface = hex(colors.surface, ink);
  const accent = hex(colors.gold, '7c5cff');
  const secondary = hex(colors.amber, accent);
  const key = createHash('sha1')
    .update(JSON.stringify({ v: 3, width, height, background, shadow, ink, surface, accent, secondary, geo }))
    .digest('hex')
    .slice(0, 12);
  const dir = join(video.out, 'camera');
  mkdirSync(dir, { recursive: true });
  const bg = join(dir, `frame-bg-${key}.png`);
  const mask = join(dir, `frame-mask-${key}.png`);
  if (existsSync(bg) && existsSync(mask)) return { bg, mask, geo };

  const [c0, c1] =
    background === 'accent' ? [accent, secondary] : background === 'ink' ? [ink, ink] : [surface, ink];
  const glow = background === 'ink' ? '00' : background === 'accent' ? '40' : '55';
  const shadowSpec =
    shadow === 'off'
      ? { offset: 0, sigma: 1, opacity: 0 }
      : shadow === 'deep'
        ? { offset: 24, sigma: 44, opacity: 0.8 }
        : { offset: 18, sigma: 34, opacity: 0.62 };
  const shadowMask = roundedMask(geo.w, geo.h, geo.radius);
  run(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `gradients=s=${width}x${height}:c0=0x${c0}:c1=0x${c1}:x0=0:y0=0:x1=${width}:y1=${height}:speed=0:nb_colors=2:d=1`,
      '-f', 'lavfi', '-i', `gradients=s=${width}x${height}:type=radial:c0=0x${accent}${glow}:c1=0x${accent}00:x0=${Math.round(width * 0.82)}:y0=${Math.round(height * 0.12)}:x1=${Math.round(width * 0.3)}:y1=${Math.round(height * 0.95)}:speed=0:nb_colors=2:d=1`,
      '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:d=1`,
      '-filter_complex',
      [
        `[0:v]format=rgba[base]`,
        `[1:v]format=rgba[glow]`,
        `[base][glow]overlay=format=auto[lit]`,
        `color=c=black:s=${geo.w}x${geo.h}:d=1,format=gray,geq=lum='${shadowMask}'[win]`,
        `color=c=black:s=${width}x${height}:d=1,format=gray[canvas]`,
        `[canvas][win]overlay=x=${geo.x}:y=${geo.y + shadowSpec.offset}[sm]`,
        `[sm]gblur=sigma=${shadowSpec.sigma},lutyuv=y='val*${shadowSpec.opacity}'[salpha]`,
        `[2:v]format=gray[blk]`,
        `[blk][salpha]alphamerge[shadow]`,
        `[lit][shadow]overlay=format=auto,format=rgb24[out]`,
      ].join(';'),
      '-map', '[out]', '-frames:v', '1', '-update', '1', bg,
    ],
    'frame background'
  );
  run(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=black:s=${geo.w}x${geo.h}:d=1`,
      '-vf', `format=gray,geq=lum='${roundedMask(geo.w, geo.h, geo.radius)}'`,
      '-frames:v', '1', '-update', '1', mask,
    ],
    'frame mask'
  );
  return { bg, mask, geo };
}

/**
 * Inputs + graph for the inset frame. `src` is the live label; returns the output label's graph.
 * Background is converted once from RGB to tagged BT.709 like every other picture.
 */
export function frameGraph({ src, out, bgIdx, maskIdx, geo, width, height }) {
  return [
    `${src}scale=${geo.w}:${geo.h}:flags=lanczos+accurate_rnd+full_chroma_int:in_color_matrix=bt709:out_color_matrix=bt709:in_range=tv:out_range=tv,format=yuva420p[fwin]`,
    `[${maskIdx}:v]format=gray[fmask]`,
    `[fwin][fmask]alphamerge[fwa]`,
    `[${bgIdx}:v]scale=${width}:${height}:${BT709_SCALE_OPTS},format=yuv420p,${BT709_PARAMS}[fbg]`,
    `[fbg][fwa]overlay=x=${geo.x}:y=${geo.y}:format=auto:shortest=1,format=yuv420p,${BT709_PARAMS}${out}`,
  ].join(';');
}

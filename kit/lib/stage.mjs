/**
 * Where the recording sits inside the delivered frame. The recorder writes the reel at the stage
 * size, so the live picture is never upscaled; stored coordinates stay in capture CSS px and are
 * converted to reel px only when a filter graph is built.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { insetGeometry } from './camera.mjs';
import { captureProfile } from './capturePresets.mjs';
import { outputFrame } from './format.mjs';

const even = (v) => Math.round(v / 2) * 2;
const floorEven = (v) => Math.floor(v / 2) * 2;

/** { mode: fill | inset | device, x, y, w, h, radius } in output px; w×h is the reel raster. */
export function stageFor(capture, output, camera = {}) {
  const a = capture.width / capture.height;
  const b = output.width / output.height;
  if (Math.abs(a - b) / b < 0.01) {
    if (camera.frame === 'inset') {
      const g = insetGeometry({ width: output.width, height: output.height, padding: camera.padding, corners: camera.corners });
      return { mode: 'inset', x: g.x, y: g.y, w: g.w, h: g.h, radius: g.radius };
    }
    return { mode: 'fill', x: 0, y: 0, w: output.width, h: output.height, radius: 0 };
  }
  const device = capture.mobile && a < 1;
  const box = device ? { w: output.width * (b < 1 ? 0.9 : 1), h: output.height * 0.88 } : { w: output.width * 0.92, h: output.height * 0.92 };
  const scale = Math.min(box.w / capture.width, box.h / capture.height);
  const w = even(capture.width * scale);
  const h = even(capture.height * scale);
  // A vertical master keeps room under a landscape recording for captions.
  const y = !device && b < 1 ? floorEven(output.height * 0.3 - h / 2) : floorEven((output.height - h) / 2);
  return {
    mode: device ? 'device' : 'inset',
    x: floorEven((output.width - w) / 2),
    y: Math.max(0, y),
    w,
    h,
    radius: device ? Math.round(w * (capture.width < 600 ? 0.11 : 0.04)) : 18,
  };
}

/** The take as recorded: capture CSS size, reel raster size and the factor between them. */
export function reelSpace(liveMeta, config = {}) {
  const c = liveMeta?.capture;
  const profile = captureProfile(config);
  const cssW = c?.viewport?.width || profile.width;
  const cssH = c?.viewport?.height || profile.height;
  const reelW = c?.raster?.width || cssW;
  const reelH = c?.raster?.height || cssH;
  return { cssW, cssH, reelW, reelH, k: reelW / cssW };
}

/** reelSpace for a video's current take (its live-meta), or the configured capture before one exists. */
export function takeSpace(video, config = video.config) {
  const metaPath = video.out ? join(video.out, 'live-meta.json') : null;
  let meta = null;
  try {
    meta = metaPath && existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : null;
  } catch {
    /* an unreadable meta falls back to the configured capture */
  }
  if (meta && !meta.capture?.viewport) {
    // A take from before capture profiles: screencast frames are the CSS viewport, so the file says it.
    const size = liveSize(join(video.out, 'live.mp4'));
    if (size) meta = { ...meta, capture: { ...meta.capture, viewport: size, raster: size } };
  }
  return { ...reelSpace(meta, config), profile: meta?.capture?.profile || null, known: Boolean(meta?.capture?.viewport) };
}

const sizeCache = new Map();
function liveSize(file) {
  if (!existsSync(file)) return null;
  const key = `${file}:${statSync(file).mtimeMs}`;
  if (!sizeCache.has(key)) {
    const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    const [width, height] = String(r.stdout || '').trim().split(',').map(Number);
    sizeCache.set(key, width > 0 && height > 0 ? { width, height } : null);
  }
  return sizeCache.get(key);
}

/**
 * Every space a video works in: the take (capture CSS + reel px), the configured capture, the
 * output frame and the stage. `takeMatches` is false when the size or device changed after the
 * take, so it has to be recorded again.
 */
export function videoSpace(video, config = video.config, camera = video.brand?.direction?.camera || {}) {
  const take = takeSpace(video, config);
  const wanted = captureProfile(config);
  const output = outputFrame(config);
  const takeProfile = take.profile || wanted;
  const stage = stageFor({ ...takeProfile, width: take.cssW, height: take.cssH }, output, camera);
  const traits = take.profile || { mobile: false, touch: false };
  const takeMatches =
    !take.known ||
    (take.cssW === wanted.width && take.cssH === wanted.height && Boolean(traits.mobile) === wanted.mobile && Boolean(traits.touch) === wanted.touch);
  return {
    cssW: take.cssW,
    cssH: take.cssH,
    reelW: take.reelW,
    reelH: take.reelH,
    k: take.k,
    capture: { id: wanted.id, label: wanted.label, width: wanted.width, height: wanted.height, dpr: wanted.dpr, mobile: wanted.mobile, touch: wanted.touch },
    take: take.known ? { id: take.profile?.id || null, label: take.profile?.label || `${take.cssW}×${take.cssH}`, width: take.cssW, height: take.cssH, mobile: Boolean(traits.mobile) } : null,
    takeMatches,
    output: { format: output.format, width: output.width, height: output.height, label: output.label },
    stage,
    plannedStage: stageFor(wanted, output, camera),
    // >1 when the take is drawn bigger than it was captured (a shape change after the take).
    upscale: Number((stage.w / take.reelW).toFixed(2)),
  };
}

/** Capture CSS px → reel px for timeline marks, edit zooms and lenses. */
export function toReel(marks = [], k = 1) {
  if (k === 1) return marks;
  const s = (v) => (Number.isFinite(v) ? v * k : v);
  return marks.map((m) => ({
    ...m,
    ...(m.x != null ? { x: s(m.x) } : {}),
    ...(m.y != null ? { y: s(m.y) } : {}),
    ...(m.rect ? { rect: { x: s(m.rect.x), y: s(m.rect.y), w: s(m.rect.w), h: s(m.rect.h) } } : {}),
    ...(Array.isArray(m.path)
      ? {
          path: m.path.map((p) =>
            Array.isArray(p) ? p.map((v, i) => (i ? s(v) : v)) : p?.rect ? { ...p, rect: { x: s(p.rect.x), y: s(p.rect.y), w: s(p.rect.w), h: s(p.rect.h) } } : p
          ),
        }
      : {}),
  }));
}

/**
 * Pick a logo-tile background that contrasts with the mark.
 * Dark / mid / colorful marks → light tile; light (near-white) marks → dark tile.
 * Override per item with bg: "light" | "dark" | "auto".
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { inflateSync } from 'node:zlib';

const LUMA = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Near-white marks need a dark tile; everything else (dark, gray, brand color) gets light. */
const LIGHT_MARK_LUMA = 175;

function pngRgba(buf) {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  const idats = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (!width || !height || bitDepth !== 8 || ![0, 2, 4, 6].includes(colorType)) return null;
  const inflated = inflateSync(Buffer.concat(idats));
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const stride = width * bpp;
  const rgba = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[src++];
    const row = Buffer.alloc(stride);
    inflated.copy(row, 0, src, src + stride);
    src += stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? row[i - bpp] : 0;
      const up = prev[i];
      const upLeft = i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (filter === 1) v = (v + left) & 255;
      else if (filter === 2) v = (v + up) & 255;
      else if (filter === 3) v = (v + ((left + up) >> 1)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        v = (v + pr) & 255;
      } else if (filter !== 0) {
        return null;
      }
      row[i] = v;
    }
    for (let x = 0; x < width; x++) {
      const i = x * bpp;
      const o = (y * width + x) * 4;
      if (colorType === 6) {
        rgba[o] = row[i];
        rgba[o + 1] = row[i + 1];
        rgba[o + 2] = row[i + 2];
        rgba[o + 3] = row[i + 3];
      } else if (colorType === 2) {
        rgba[o] = row[i];
        rgba[o + 1] = row[i + 1];
        rgba[o + 2] = row[i + 2];
        rgba[o + 3] = 255;
      } else if (colorType === 4) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = row[i];
        rgba[o + 3] = row[i + 1];
      } else {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = row[i];
        rgba[o + 3] = 255;
      }
    }
    prev = row;
  }
  return { width, height, rgba };
}

function ffmpegRgba(path) {
  const probe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', path],
    { encoding: 'utf8' }
  );
  if (probe.status !== 0) return null;
  const [w, h] = probe.stdout.trim().split('x').map(Number);
  if (!w || !h || w * h > 8_000_000) return null;
  const raw = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: w * h * 4 + 1_000_000 }
  );
  if (raw.status !== 0 || !Buffer.isBuffer(raw.stdout) || raw.stdout.length < w * h * 4) return null;
  return { width: w, height: h, rgba: raw.stdout.subarray(0, w * h * 4) };
}

function svgHint(path) {
  const text = readFileSync(path, 'utf8');
  const fills = [...text.matchAll(/fill\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1].toLowerCase());
  const lights = fills.filter((f) => /#(fff|ffffff|f[89a-f]{5}|e[89a-f]{5})|white|currentcolor/i.test(f)).length;
  const darks = fills.filter((f) => /#(000|111|222|0[0-3][0-9a-f]{4}|1[0-4][0-9a-f]{4})|black/i.test(f)).length;
  if (lights > darks && lights > 0) return { tone: 'dark', luma: 220, source: 'svg-light-fills' };
  if (darks >= lights && darks > 0) return { tone: 'light', luma: 40, source: 'svg-dark-fills' };
  return { tone: 'light', luma: 120, source: 'svg-default' };
}

function analyzeRgba(rgba) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a < 24) continue;
    // Ignore near-black / near-white "mat" pixels that some assets bake in.
    const L = LUMA(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (L < 12 || L > 248) continue;
    const w = a / 255;
    sum += L * w;
    n += w;
  }
  if (n < 1) {
    // Fully black or white mat — treat as dark mark needing light tile.
    return { tone: 'light', luma: 0, source: 'empty-or-mat' };
  }
  const luma = sum / n;
  const tone = luma >= LIGHT_MARK_LUMA ? 'dark' : 'light';
  return { tone, luma, source: 'pixels' };
}

/**
 * @param {string} path absolute asset path
 * @param {'light'|'dark'|'auto'|undefined} override
 * @returns {{ tone: 'light'|'dark', luma: number, source: string }}
 */
/** Most common chromatic colors in a logo file, ignoring near-black and near-white mats. */
export function sampleColors(path, limit = 4) {
  if (!path || !existsSync(path)) return [];
  const ext = extname(path).toLowerCase();
  if (ext === '.svg') {
    const text = readFileSync(path, 'utf8');
    const counts = new Map();
    for (const match of text.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi)) {
      const raw = match[1];
      const hex = `#${(raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw).toLowerCase()}`;
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const luma = LUMA(r, g, b);
      if (luma < 18 || luma > 245) continue;
      counts.set(hex, (counts.get(hex) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([hex, count]) => ({ hex, count }));
  }
  let frame = null;
  if (ext === '.png') {
    try {
      frame = pngRgba(readFileSync(path));
    } catch {
      frame = null;
    }
  }
  if (!frame) frame = ffmpegRgba(path);
  if (!frame) return [];
  const buckets = new Map();
  const { rgba } = frame;
  const step = Math.max(4, Math.floor(rgba.length / 4 / 12000) * 4);
  for (let i = 0; i < rgba.length; i += step) {
    if (rgba[i + 3] < 40) continue;
    const luma = LUMA(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (luma < 18 || luma > 245) continue;
    const key = [0, 1, 2].map((n) => Math.round(rgba[i + n] / 16) * 16).join(',');
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return [...buckets]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({
      hex: `#${key.split(',').map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`,
      count,
    }));
}

export function logoTileTone(path, override) {
  if (override === 'light' || override === 'dark') {
    return { tone: override, luma: override === 'light' ? 40 : 220, source: 'override' };
  }
  if (!path || !existsSync(path)) {
    return { tone: 'light', luma: 120, source: 'missing' };
  }
  const ext = extname(path).toLowerCase();
  if (ext === '.svg') return svgHint(path);

  let frame = null;
  if (ext === '.png') {
    try {
      frame = pngRgba(readFileSync(path));
    } catch {
      frame = null;
    }
  }
  if (!frame) frame = ffmpegRgba(path);
  if (!frame) return { tone: 'light', luma: 120, source: 'undecoded' };
  return analyzeRgba(frame.rgba);
}

/**
 * Images a plate can show: brand-pack assets, Inspector uploads and frames grabbed from the
 * recording. Uploads and grabs are video-local (`<video>/uploads/plates/`), referenced from the
 * config as `uploads/plates/<file>` so the pack stays clean and the video stays portable.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { basename, dirname, extname, join } from 'node:path';
import { createHash } from 'node:crypto';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif']);
const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/gif': '.gif' };
const MAX_BYTES = 12 * 1024 * 1024;

const slugify = (s) =>
  String(s || 'image')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'image';

/** Where this video's plate uploads live. */
export function plateUploadDir(video) {
  return join(video.dir, 'uploads', 'plates');
}

/**
 * Save a base64 image for a plate; returns the config-ready asset path (`uploads/plates/<file>`).
 * The file name carries a content hash, so the same upload twice is one file and a changed
 * image never collides with a cached one.
 */
export function savePlateAsset(video, { name, data, mime } = {}) {
  const b64 = String(data || '').replace(/^data:[^;]+;base64,/, '');
  if (!b64) throw new Error('image (base64) required');
  const buffer = Buffer.from(b64, 'base64');
  if (!buffer.length) throw new Error('empty image');
  if (buffer.length > MAX_BYTES) throw new Error(`image too large (${Math.round(buffer.length / 1024 / 1024)} MB, limit 12 MB)`);
  const fromName = extname(String(name || '')).toLowerCase();
  const ext = IMAGE_EXT.has(fromName) ? fromName : MIME_EXT[String(mime || '').toLowerCase()] || sniffExt(buffer);
  if (!ext) throw new Error('unsupported image type — use PNG, JPEG, WebP, SVG or GIF');
  const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 8);
  const file = `${slugify(name)}-${hash}${ext}`;
  const dir = plateUploadDir(video);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, file);
  if (!existsSync(dest)) writeFileSync(dest, buffer);
  return { asset: `uploads/plates/${file}`, bytes: buffer.length, file: dest };
}

function sniffExt(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return '.png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return '.jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  if (buf.length > 6 && buf.toString('ascii', 0, 3) === 'GIF') return '.gif';
  const head = buf.toString('utf8', 0, Math.min(buf.length, 256)).trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return '.svg';
  return null;
}

/**
 * Grab one frame of the recording at `t` seconds (program time of the live clip) as a PNG asset.
 * The grab is an interface screenshot: a Showcase or Bento plate morphs it on screen.
 */
export async function grabFrameAsset(video, t, { source } = {}) {
  const live = source || join(video.out, 'live.mp4');
  if (!existsSync(live)) throw new Error('No recording yet — record first, then grab a frame');
  const at = Math.max(0, Number(t) || 0);
  const dir = plateUploadDir(video);
  mkdirSync(dir, { recursive: true });
  const file = `grab-${at.toFixed(2).replace('.', '-')}s.png`;
  const dest = join(dir, file);
  if (!existsSync(dest)) {
    // Awaited, not synchronous: the grab runs inside the Studio server, and decoding a frame out
    // of a long take held every other request — including the editor's own polls — until it ended.
    const stderr = await new Promise((resolve, reject) => {
      execFile(
        'ffmpeg',
        ['-hide_banner', '-loglevel', 'error', '-y', '-ss', at.toFixed(3), '-i', live, '-frames:v', '1', dest],
        { encoding: 'utf8' },
        (err, _stdout, errOut) => (err ? reject(new Error(errOut || err.message)) : resolve(errOut)),
      );
    }).catch((err) => {
      throw new Error(`Could not grab a frame at ${at.toFixed(2)}s${err.message ? ` — ${err.message.trim().split('\n').pop()}` : ''}`);
    });
    if (!existsSync(dest)) {
      throw new Error(`Could not grab a frame at ${at.toFixed(2)}s${stderr ? ` — ${stderr.trim().split('\n').pop()}` : ''}`);
    }
  }
  return { asset: `uploads/plates/${file}`, t: at, file: dest };
}

/** Resolve a config asset path to a file, or null (same lookup the plate builder uses). */
export function plateAssetFile(video, asset) {
  if (!asset || /^(data:|https?:|file:)/i.test(asset)) return null;
  const clean = String(asset).replace(/^\.?\//, '');
  const rel = clean.replace(/^assets\//, '');
  const brandDir = video.brand?.dir;
  const candidates = [
    join(video.dir, clean),
    join(plateUploadDir(video), basename(rel)),
    ...(brandDir ? [join(brandDir, 'assets', rel), join(brandDir, clean), join(brandDir, 'assets', basename(rel))] : []),
  ];
  const hit = candidates.find((p) => existsSync(p) && statSync(p).isFile());
  return hit || null;
}

/**
 * Every image the Inspector can offer: brand assets first (the pack's logos), then this
 * video's uploads and grabs, newest first.
 */
export function listPlateAssets(video) {
  const out = [];
  const seen = new Set();
  const push = (dir, prefix, origin) => {
    if (!existsSync(dir)) return;
    const rows = readdirSync(dir)
      .filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
      .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    for (const { f, m } of rows) {
      const asset = `${prefix}${f}`;
      if (seen.has(asset)) continue;
      seen.add(asset);
      out.push({ asset, label: f.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '), origin, mtime: Math.round(m), kind: /^grab-/.test(f) ? 'grab' : 'image' });
    }
  };
  const brandDir = video.brand?.dir;
  if (brandDir) {
    push(join(brandDir, 'assets'), 'assets/', 'brand');
    const brandLogo = ['logo.svg', 'logo.png', 'logo-source.svg'].map((f) => join(brandDir, f)).find((p) => existsSync(p));
    if (brandLogo && !seen.has(basename(brandLogo))) {
      out.unshift({ asset: basename(brandLogo), label: 'Brand mark', origin: 'brand', mtime: Math.round(statSync(brandLogo).mtimeMs), kind: 'image' });
      seen.add(basename(brandLogo));
    }
  }
  push(plateUploadDir(video), 'uploads/plates/', 'video');
  return out;
}

export { dirname as _dirname };

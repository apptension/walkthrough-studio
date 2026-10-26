/**
 * Where a Studio request's file lives.
 *
 * The desk is the React build in `kit/studio/dist`. Files Vite copies from
 * `kit/studio/public` (the mark and the icon sprite) are also served from
 * `public/` so a dev proxy can load them before the latest build.
 */
import { statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

function fileUnder(root, rel) {
  if (!root) return null;
  const base = resolve(root);
  const file = resolve(base, rel);
  if (file !== base && !file.startsWith(base + sep)) return null;
  try {
    return statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

/**
 * The file to send for `pathname`, or null for a 404. `bad: true` for a path
 * that tries to leave the desk folders. `immutable` marks Vite's fingerprinted
 * assets, which can be cached hard. `index.html` comes only from the build, so
 * a missing build never answers `/` with a public file.
 */
export function deskFile(pathname, { distDir, publicDir } = {}) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { bad: true };
  }
  if (decoded.includes('..') || decoded.includes('\0')) return { bad: true };
  const rel = (decoded === '/' ? '/index.html' : decoded).replace(/^\/+/, '');
  const built = fileUnder(distDir, rel);
  if (built) return { file: built, immutable: rel.startsWith('assets/') };
  if (rel === 'index.html') return { file: null };
  return { file: fileUnder(publicDir, rel), immutable: false };
}

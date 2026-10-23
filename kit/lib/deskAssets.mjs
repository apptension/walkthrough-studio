/**
 * Which desk the Studio server serves, and where a request's file lives.
 *
 * The desk is the React build in `kit/studio-next/dist`. The classic desk in
 * `kit/studio` still ships for one more release: `--legacy` (or
 * WALKTHROUGH_DESK=legacy) serves it, and so does a checkout that has not built
 * the new desk yet, so a plain `node cli.mjs studio` never opens a blank page.
 *
 * The new desk reads `/logo.svg` and `/icons.svg` from the classic folder, so a
 * file missing from the build falls through to it.
 */
import { existsSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export const DESKS = Object.freeze(['next', 'legacy']);

/** `requested` from a flag or env; anything but "legacy" means the new desk when it is built. */
export function resolveDesk(requested, { nextDist }) {
  if (String(requested || '').toLowerCase() === 'legacy') return 'legacy';
  return existsSync(join(nextDist, 'index.html')) ? 'next' : 'legacy';
}

function fileUnder(root, rel) {
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
 * assets, which can be cached hard.
 */
export function deskFile(pathname, desk, { nextDist, legacyDir }) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { bad: true };
  }
  if (decoded.includes('..') || decoded.includes('\0')) return { bad: true };
  const rel = (decoded === '/' ? '/index.html' : decoded).replace(/^\/+/, '');
  if (desk === 'next') {
    const built = fileUnder(nextDist, rel);
    if (built) return { file: built, immutable: rel.startsWith('assets/') };
    if (rel === 'index.html') return { file: null };
  }
  return { file: fileUnder(legacyDir, rel), immutable: false };
}

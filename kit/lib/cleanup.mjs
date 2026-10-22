/**
 * Regenerable capture files the author can drop after a handoff.
 * The current master, live.mp4, version history, and project sources stay.
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SOURCE_NAMES = new Set(['video.config.json', 'flow.mjs', 'narration.mjs']);

export function formatBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile()) {
      const bytes = statSync(path).size;
      out.push({ path, name: entry.name, bytes });
    }
  }
  return out;
}

export function planCleanup(root, { slug = 'video' } = {}) {
  const files = [];
  for (const file of walk(root)) {
    const rel = relative(root, file.path).split(sep).join('/');
    const base = rel.split('/').pop();
    if (SOURCE_NAMES.has(base)) continue;
    if (!rel.includes('/') && (base === 'live.mp4' || base === `${slug}.mp4`)) continue;
    if (rel.startsWith('versions/')) continue;
    const regenerable =
      file.name === 'audio-premaster.wav' || rel.startsWith('slices/') || rel.startsWith('plates/');
    if (!regenerable) continue;
    files.push({ path: file.path, name: rel, bytes: file.bytes });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  return { files, totalBytes, totalLabel: formatBytes(totalBytes) };
}

export function applyCleanup(plan) {
  for (const file of plan.files || []) rmSync(file.path, { force: true });
  return plan;
}

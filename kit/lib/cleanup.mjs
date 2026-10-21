/**
 * Regenerable capture files the author can drop after a handoff.
 * The current master, live.mp4, and the project sources stay.
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SOURCE_NAMES = new Set(['video.config.json', 'flow.mjs', 'narration.mjs']);

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

export function planCleanup(root, { slug = 'video', selectedVersions = [] } = {}) {
  const selected = new Set(selectedVersions);
  const files = [];
  for (const file of walk(root)) {
    const rel = relative(root, file.path).split(sep).join('/');
    const base = rel.split('/').pop();
    if (SOURCE_NAMES.has(base)) continue;
    if (!rel.includes('/') && (base === 'live.mp4' || base === `${slug}.mp4`)) continue;
    const versionId = rel.startsWith('versions/') ? rel.split('/')[1] : '';
    const regenerable =
      file.name === 'audio-premaster.wav' ||
      rel.startsWith('slices/') ||
      rel.startsWith('plates/') ||
      (versionId && versionId !== 'index.json' && selected.has(versionId));
    if (!regenerable) continue;
    files.push({ path: file.path, name: rel, bytes: file.bytes });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { files, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0) };
}

export function applyCleanup(plan) {
  for (const file of plan.files || []) rmSync(file.path, { force: true });
  return plan;
}

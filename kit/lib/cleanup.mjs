/**
 * Regenerable capture files safe to drop after a render.
 * Keeps: current master, live.mp4 (+ timeline/live-meta), version History, project sources,
 * shared voice cache. Clears bake/overlays, plate mp4s, silent masters, premaster, slices.
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SOURCE_NAMES = new Set(['video.config.json', 'flow.mjs', 'narration.mjs', 'brief.json', 'auth-session.json']);

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

/** True when this relative path under video.out is regenerable intermediate media. */
export function isRegenerableRel(rel, { slug = 'video' } = {}) {
  const base = rel.split('/').pop() || '';
  if (SOURCE_NAMES.has(base)) return false;
  if (!rel.includes('/') && (base === 'live.mp4' || base === `${slug}.mp4`)) return false;
  if (!rel.includes('/') && (base === 'timeline.json' || base === 'live-meta.json' || base === 'live-preview.jpg')) {
    return false;
  }
  if (rel.startsWith('versions/')) return false;
  if (rel.startsWith('voice/') && /\.(json)$/i.test(base)) return false;
  if (rel.startsWith('.cache/')) return false;

  if (base === 'audio-premaster.wav' || base === 'audio-master.wav') return true;
  if (base === 'live-clean.mp4' || base === 'live-clean.json') return true;
  if (base === `${slug}.silent.mp4`) return true;
  if (/^(brand-|plate-).+\.mp4$/i.test(base)) return true;
  if (/\.handoff\.zip$/i.test(base) || base.endsWith('-handoff.zip')) return true;
  if (rel.startsWith('slices/')) return true;
  if (rel.startsWith('plates/')) return true;
  if (rel.startsWith('overlays/')) return true;
  if (rel.startsWith('studio-jobs/')) return true;
  if (rel.startsWith('validate/') && /\.(png|jpg|jpeg|webp|mp4)$/i.test(base)) return true;
  return false;
}

export function planCleanup(root, { slug = 'video' } = {}) {
  const files = [];
  for (const file of walk(root)) {
    const rel = relative(root, file.path).split(sep).join('/');
    if (!isRegenerableRel(rel, { slug })) continue;
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

/** Plan + apply for a video's out dir after produce/snapshot. */
export function cleanupAfterProduce(video) {
  const root = video.out;
  const plan = planCleanup(root, { slug: video.slug });
  plan.root = root;
  if (!plan.files.length) return plan;
  applyCleanup(plan);
  // Remove emptied overlay/plate trees even when files were nested.
  for (const name of ['overlays', 'plates', 'slices']) {
    try {
      rmSync(join(root, name), { recursive: true, force: true });
    } catch {
      /* ok */
    }
  }
  console.log(`✓ cleaned ${plan.files.length} intermediate file(s) · ${plan.totalLabel}`);
  return plan;
}

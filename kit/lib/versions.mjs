/**
 * Version vault for walkthrough takes.
 * Each snapshot stores delivery media + the source settings needed to regenerate
 * (config, narration, flow, brand motion, critic). Restore rewrites source files;
 * regenerate restores then re-runs produce (+ audio when narration exists).
 *
 * Naming:
 *   name   → v1, v2, v3… (monotonic)
 *   title  → human headline ("Rendered sequence", "Saved snapshot", …)
 *   kind   → release (shown by default) | checkpoint (pipeline intermediates)
 *   trigger→ machine source (make, produce, audio, manual, cli, …)
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

const INDEX = 'index.json';

/** Default human titles for known triggers / legacy labels. */
const TITLE_BY_TRIGGER = {
  make: 'Rendered sequence',
  'make-full': 'Re-recorded sequence',
  'make-quick': 'Rendered sequence',
  produce: 'Picture lock',
  audio: 'Audio mix',
  'post-audio': 'Audio mix',
  manual: 'Saved snapshot',
  rebuild: 'Rebuild after edit',
  deliver: 'Handoff pack',
  cli: 'CLI snapshot',
  improve: 'After AI edit',
  approve: 'Approved cut',
};

function versionsDir(video) {
  return join(video.out, 'versions');
}

function readIndex(video) {
  const dir = versionsDir(video);
  const path = join(dir, INDEX);
  if (!existsSync(path)) return { slug: video.slug, versions: [], nextNumber: 1 };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return {
      slug: raw.slug || video.slug,
      versions: Array.isArray(raw.versions) ? raw.versions : [],
      nextNumber: Number.isFinite(raw.nextNumber) ? raw.nextNumber : null,
    };
  } catch {
    return { slug: video.slug, versions: [], nextNumber: 1 };
  }
}

function writeIndex(video, index) {
  const dir = versionsDir(video);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, INDEX), JSON.stringify(index, null, 2));
}

function copyIfExists(src, dest) {
  if (!existsSync(src)) return false;
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  return true;
}

function stampId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function humanize(s) {
  const t = String(s || '')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!t) return '';
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferTrigger(label, note) {
  const l = String(label || '').toLowerCase();
  const n = String(note || '').toLowerCase();
  if (l === 'make-full' || (l === 'make' && n.includes('re-record'))) return 'make-full';
  if (l === 'make' || l === 'make-quick') return 'make';
  if (l === 'produce' || n.includes('after produce')) return 'produce';
  if (l === 'audio' || l === 'post-audio' || n.includes('after mix')) return 'audio';
  if (l === 'manual') return 'manual';
  if (l === 'rebuild' || n.includes('after improve')) return 'rebuild';
  if (l === 'deliver' || l.startsWith('handoff')) return 'deliver';
  if (n === 'cli' || l === 'cli') return 'cli';
  if (l) return l;
  return 'snapshot';
}

function inferKind(trigger, explicit) {
  if (explicit === 'release' || explicit === 'checkpoint') return explicit;
  if (trigger === 'produce' || trigger === 'audio' || trigger === 'post-audio') return 'checkpoint';
  return 'release';
}

function titleFor({ title, label, trigger, note }) {
  if (title && String(title).trim()) return String(title).trim();
  if (TITLE_BY_TRIGGER[trigger]) return TITLE_BY_TRIGGER[trigger];
  // Legacy: label was the pipeline step name — never use raw "make"/"audio" as the display title
  if (label && !TITLE_BY_TRIGGER[label] && !/^(make|audio|produce|manual|rebuild|post-audio)$/i.test(label)) {
    return humanize(label);
  }
  if (note && note.length > 3 && !/^(studio|cli|auto)/i.test(note)) return humanize(note).slice(0, 48);
  return TITLE_BY_TRIGGER[trigger] || 'Snapshot';
}

/**
 * Normalize a stored entry for UI/API (backfills vN / title / kind for older snapshots).
 */
export function normalizeVersionEntry(entry, numberFallback = 1) {
  if (!entry || typeof entry !== 'object') return null;
  const trigger = entry.trigger || inferTrigger(entry.label, entry.note);
  const kind = inferKind(trigger, entry.kind);
  const number = Number.isFinite(entry.number) ? entry.number : numberFallback;
  const name = entry.name || `v${number}`;
  const title = titleFor({
    title: entry.title,
    label: entry.label,
    trigger,
    note: entry.note,
  });
  const displayName = `${name} · ${title}`;
  return {
    ...entry,
    number,
    name,
    title,
    kind,
    trigger,
    displayName,
    label: entry.label || title, // keep label for older clients
  };
}

function ensureNumbered(index) {
  const sorted = [...index.versions].sort((a, b) =>
    String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id))
  );
  let maxN = 0;
  const byId = new Map();
  for (const raw of sorted) {
    if (Number.isFinite(raw.number)) {
      byId.set(raw.id, raw.number);
      maxN = Math.max(maxN, raw.number);
    }
  }
  for (const raw of sorted) {
    if (!byId.has(raw.id)) {
      maxN += 1;
      byId.set(raw.id, maxN);
    }
  }
  const nextNumber = Math.max(maxN + 1, Number.isFinite(index.nextNumber) ? index.nextNumber : 1);
  // Keep newest-first order from the index file
  const versions = index.versions.map((raw) => normalizeVersionEntry(raw, byId.get(raw.id) || 1));
  return { ...index, versions, nextNumber };
}

/**
 * Snapshot current delivery + editable sources into versions/<id>/.
 * @param {object} video
 * @param {{ title?: string, label?: string, note?: string, kind?: 'release'|'checkpoint', trigger?: string }} [opts]
 */
export function snapshotVersion(video, opts = {}) {
  const {
    title = '',
    label = '',
    note = '',
    kind: kindOpt,
    trigger: triggerOpt,
  } = opts;

  const final = join(video.out, `${video.slug}.mp4`);
  if (!existsSync(final)) {
    throw new Error(`Nothing to snapshot — produce ${video.slug} first`);
  }
  const id = stampId();
  const dir = join(versionsDir(video), id);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'source'), { recursive: true });
  mkdirSync(join(dir, 'out'), { recursive: true });

  // Delivery + review artifacts
  cpSync(final, join(dir, 'out', `${video.slug}.mp4`));
  for (const name of [
    'produce-meta.json',
    'audio-meta.json',
    'edit-plan.json',
    'timeline.json',
    'critic-report.md',
    'critic-report.json',
    'qc-report.json',
    'deliver-meta.json',
    'poster.jpg',
    'chapters-youtube.txt',
    'chapters.md',
    'review.html',
    `${video.slug}.silent.mp4`,
  ]) {
    copyIfExists(join(video.out, name), join(dir, 'out', name));
  }
  if (existsSync(join(video.out, 'validate'))) {
    cpSync(join(video.out, 'validate'), join(dir, 'out', 'validate'), { recursive: true });
  }
  if (existsSync(join(video.out, 'captions'))) {
    cpSync(join(video.out, 'captions'), join(dir, 'out', 'captions'), { recursive: true });
  }
  if (existsSync(join(video.out, 'deliverables'))) {
    cpSync(join(video.out, 'deliverables'), join(dir, 'out', 'deliverables'), { recursive: true });
  }
  // Plate mp4s (assets for the panel)
  for (const f of readdirSync(video.out)) {
    if (/^(brand-|plate-).*\.mp4$/.test(f)) {
      cpSync(join(video.out, f), join(dir, 'out', f));
    }
  }

  // Sources needed to regenerate
  for (const name of ['video.config.json', 'narration.mjs', 'flow.mjs']) {
    copyIfExists(join(video.dir, name), join(dir, 'source', name));
  }
  const brandMotion = {
    brand: video.config.brand,
    motion: video.brand.motion || null,
    motionBrief: existsSync(join(video.brand.dir, video.brand.motionBrief || 'motion-brief.md'))
      ? readFileSync(join(video.brand.dir, video.brand.motionBrief || 'motion-brief.md'), 'utf8').slice(0, 4000)
      : null,
  };
  writeFileSync(join(dir, 'source', 'brand-motion.json'), JSON.stringify(brandMotion, null, 2));

  const meta = existsSync(join(video.out, 'produce-meta.json'))
    ? JSON.parse(readFileSync(join(video.out, 'produce-meta.json'), 'utf8'))
    : {};

  let index = ensureNumbered(readIndex(video));
  const number = index.nextNumber;
  const trigger = triggerOpt || inferTrigger(label, note);
  const kind = inferKind(trigger, kindOpt);
  const resolvedTitle = titleFor({ title, label, trigger, note });
  const name = `v${number}`;

  const entry = normalizeVersionEntry(
    {
      id,
      number,
      name,
      title: resolvedTitle,
      label: resolvedTitle,
      kind,
      trigger,
      note: note || '',
      createdAt: new Date().toISOString(),
      durationSec: meta.durationSec || null,
      sizeMB: meta.sizeMB || Number((statSync(final).size / 1024 / 1024).toFixed(1)),
      chapters: meta.chapters?.length || 0,
      interstitials: (video.config.interstitials || []).map((i) => ({ id: i.id, type: i.type })),
      hasAudio: existsSync(join(video.out, 'audio-meta.json')),
      hasCritic: existsSync(join(video.out, 'critic-report.json')),
      hasCaptions: existsSync(join(video.out, 'captions', `${video.slug}.srt`)),
      hasDeliver: existsSync(join(video.out, 'deliverables')),
      qcStatus: existsSync(join(video.out, 'qc-report.json'))
        ? JSON.parse(readFileSync(join(video.out, 'qc-report.json'), 'utf8')).status
        : null,
    },
    number
  );

  index.versions = [entry, ...index.versions.filter((v) => v.id !== id)];
  index.nextNumber = number + 1;
  // Keep last 20 versions
  const drop = index.versions.slice(20);
  index.versions = index.versions.slice(0, 20);
  for (const d of drop) {
    const p = join(versionsDir(video), d.id);
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
  writeIndex(video, index);
  console.log(`✓ version ${entry.name} “${entry.title}” → versions/${id}`);
  return entry;
}

export function listVersions(video) {
  const raw = readIndex(video);
  const index = ensureNumbered(raw);
  const dirty =
    !Number.isFinite(raw.nextNumber) ||
    raw.versions.some((r) => !r.name || !r.title || !Number.isFinite(r.number) || !r.kind);
  if (dirty && index.versions.length) {
    writeIndex(video, {
      slug: video.slug,
      nextNumber: index.nextNumber,
      versions: index.versions,
    });
  }
  return index.versions;
}

export function getVersion(video, id) {
  const entry = listVersions(video).find((v) => v.id === id);
  if (!entry) throw new Error(`Unknown version ${id}`);
  const dir = join(versionsDir(video), id);
  if (!existsSync(dir)) throw new Error(`Version folder missing: ${id}`);
  return { ...entry, dir };
}

/** Restore source settings (and optionally delivery media) from a version. */
export function restoreVersion(video, id, { media = false } = {}) {
  const { dir } = getVersion(video, id);
  const src = join(dir, 'source');
  for (const name of ['video.config.json', 'narration.mjs', 'flow.mjs']) {
    const from = join(src, name);
    if (existsSync(from)) cpSync(from, join(video.dir, name));
  }
  const brandMotionPath = join(src, 'brand-motion.json');
  if (existsSync(brandMotionPath)) {
    const bm = JSON.parse(readFileSync(brandMotionPath, 'utf8'));
    if (bm.motion && video.brand?.dir) {
      const brandPath = join(video.brand.dir, 'brand.json');
      if (existsSync(brandPath)) {
        const brand = JSON.parse(readFileSync(brandPath, 'utf8'));
        brand.motion = { ...(brand.motion || {}), ...bm.motion };
        writeFileSync(brandPath, JSON.stringify(brand, null, 2) + '\n');
      }
    }
  }
  if (media) {
    const outSnap = join(dir, 'out');
    for (const f of readdirSync(outSnap)) {
      const from = join(outSnap, f);
      const to = join(video.out, f);
      if (statSync(from).isDirectory()) {
        if (existsSync(to)) rmSync(to, { recursive: true, force: true });
        cpSync(from, to, { recursive: true });
      } else {
        cpSync(from, to);
      }
    }
  }
  writeFileSync(
    join(video.out, 'restored-from.json'),
    JSON.stringify({ id, at: new Date().toISOString(), media }, null, 2)
  );
  console.log(`✓ restored settings from versions/${id}${media ? ' (+ media)' : ''}`);
  return getVersion(video, id);
}

export function versionMediaPath(video, id, file = null) {
  const { dir } = getVersion(video, id);
  if (!file) return join(dir, 'out', `${video.slug}.mp4`);
  return join(dir, 'out', basename(file));
}

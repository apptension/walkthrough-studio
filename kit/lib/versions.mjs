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
  constants,
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

/** APFS clone when the volume supports it; a normal copy otherwise. Snapshots stay, they just stop costing a full write. */
function cloneCopy(src, dest, opts = {}) {
  cpSync(src, dest, { ...opts, mode: constants.COPYFILE_FICLONE });
}

function copyIfExists(src, dest) {
  if (!existsSync(src)) return false;
  mkdirSync(dirname(dest), { recursive: true });
  cloneCopy(src, dest, { recursive: true });
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

  // Thin archive: playable master + small metas + sources. Plate/silent/deliverable/bake
  // copies are regenerable and used to flood the disk across History versions.
  cloneCopy(final, join(dir, 'out', `${video.slug}.mp4`));
  for (const name of [
    'produce-meta.json',
    'audio-meta.json',
    'edit-plan.json',
    'timeline.json',
    'critic-report.md',
    'critic-report.json',
    'qc-report.json',
    'poster.jpg',
    'chapters-youtube.txt',
    'chapters.md',
    'review.html',
  ]) {
    copyIfExists(join(video.out, name), join(dir, 'out', name));
  }
  if (existsSync(join(video.out, 'captions'))) {
    // Text tracks only — skip heavy contact-sheet media if present under validate.
    for (const f of readdirSync(join(video.out, 'captions'))) {
      if (/\.(srt|vtt|json|txt)$/i.test(f)) {
        copyIfExists(join(video.out, 'captions', f), join(dir, 'out', 'captions', f));
      }
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
  // Keep last 8 playable versions (sources + master). Older ones drop.
  const KEEP = 8;
  const drop = index.versions.slice(KEEP);
  index.versions = index.versions.slice(0, KEEP);
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
    if (existsSync(from)) cloneCopy(from, join(video.dir, name));
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
        cloneCopy(from, to, { recursive: true });
      } else {
        cloneCopy(from, to);
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

function dirBytes(dir) {
  let total = 0;
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += dirBytes(path);
    else if (entry.isFile()) {
      try {
        total += statSync(path).size;
      } catch {
        /* gone between list and stat */
      }
    }
  }
  return total;
}

/** Plan removing version folders + index entries. Unknown ids are listed as missing. */
export function planDeleteVersions(video, ids = []) {
  const wanted = [...new Set((ids || []).map(String).filter(Boolean))];
  const all = listVersions(video);
  const byId = new Map(all.map((ver) => [ver.id, ver]));
  const versions = [];
  const missing = [];
  for (const id of wanted) {
    const ver = byId.get(id);
    if (!ver) {
      missing.push(id);
      continue;
    }
    const dir = join(versionsDir(video), id);
    const bytes = existsSync(dir) ? dirBytes(dir) : 0;
    versions.push({
      id: ver.id,
      name: ver.name || id,
      title: ver.title || ver.label || 'Snapshot',
      kind: ver.kind || 'release',
      bytes,
    });
  }
  const totalBytes = versions.reduce((sum, ver) => sum + ver.bytes, 0);
  return { versions, missing, totalBytes };
}

/** Delete selected versions from the vault (folders + index). Returns the applied plan. */
export function deleteVersions(video, ids = []) {
  const plan = planDeleteVersions(video, ids);
  if (!plan.versions.length) return plan;
  const remove = new Set(plan.versions.map((ver) => ver.id));
  for (const id of remove) {
    const path = join(versionsDir(video), id);
    if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  }
  const index = readIndex(video);
  const ensured = ensureNumbered(index);
  ensured.versions = ensured.versions.filter((ver) => !remove.has(ver.id));
  writeIndex(video, {
    slug: video.slug,
    nextNumber: ensured.nextNumber,
    versions: ensured.versions,
  });
  return plan;
}

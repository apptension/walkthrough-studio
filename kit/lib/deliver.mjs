/**
 * Professional handoff package: poster, chapters (YouTube/markdown), captions,
 * QC report, README, and a flat deliverables/ folder ready to zip or upload.
 */
import { spawnSync } from 'node:child_process';
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
import { basename, join } from 'node:path';
import { writeCaptions } from './captions.mjs';
import { listExports } from './exports.mjs';
import { STILL_JPEG_ARGS } from './media.mjs';
import { runPacingQc } from './pacing.mjs';
import { pickPosterTime } from './posterPick.mjs';
import { readReview, scriptStatus } from './script.mjs';

function approvalsOf(video) {
  const review = readReview(video);
  const script = scriptStatus(video, review);
  const { cut } = review;
  return {
    script: { status: script.effective, approvedAt: script.approvedAt || null, approvedBy: script.approvedBy || null },
    cut: { status: cut.status, version: cut.version || null, approvedAt: cut.approvedAt || null, by: cut.by || null },
  };
}

const STATUS_LABEL = {
  draft: 'not approved',
  none: 'not reviewed',
  changed: 'changed since approval',
  'changes-requested': 'changes requested',
};

const approvalLine = (label, a, extra = '') =>
  a.approvedAt && a.status === 'approved'
    ? `- ${label}: **approved**${extra} · ${a.approvedAt.slice(0, 16).replace('T', ' ')}${a.approvedBy || a.by ? ` · ${a.approvedBy || a.by}` : ''}`
    : `- ${label}: **${STATUS_LABEL[a.status] || a.status}**`;

function ff(...args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'ffmpeg failed');
  return r;
}

function clock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

function youtubeChapters(chapters) {
  // YouTube requires the first chapter at 0:00
  const rows = [{ start: 0, title: chapters[0]?.title || 'Introduction' }, ...chapters.slice(1)];
  const seen = new Set();
  return rows
    .filter((c) => {
      const k = Math.floor(c.start);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((c) => `${clock(c.start)} ${c.title}`)
    .join('\n');
}

function extractPoster(mp4, outJpg, atSec) {
  ff('-y', '-ss', String(Math.max(0, atSec)), '-i', mp4, ...STILL_JPEG_ARGS, outJpg);
}

function posterMetaPath(video) {
  return join(video.out, 'poster-meta.json');
}

export function readPosterMeta(video) {
  const path = posterMetaPath(video);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Grab a frame from the delivery master at `atSec` and write poster.jpg.
 * Marks the poster as manual so later `deliver` keeps this frame.
 */
export function setPosterAt(video, atSec, { source = 'manual' } = {}) {
  const final = join(video.out, `${video.slug}.mp4`);
  if (!existsSync(final)) throw new Error(`No delivery MP4 — produce ${video.slug} first`);
  const sec = Math.max(0, Number(atSec) || 0);
  const poster = join(video.out, 'poster.jpg');
  extractPoster(final, poster, sec);
  const meta = {
    atSec: Number(sec.toFixed(3)),
    source,
    setAt: new Date().toISOString(),
  };
  writeFileSync(posterMetaPath(video), JSON.stringify(meta, null, 2) + '\n');
  // Keep deliverables/ in sync when a pack already exists
  const packed = join(video.out, 'deliverables', 'poster.jpg');
  if (existsSync(join(video.out, 'deliverables'))) {
    cpSync(poster, packed);
  }
  return { poster, meta, posterUrl: `/media/${video.slug}/poster.jpg` };
}

/** Crucial QC / review stills for the handoff pack. */
function copyCrucialStills(video, deliverDir) {
  const validateDir = join(video.out, 'validate');
  if (!existsSync(validateDir)) return [];
  const stillsDir = join(deliverDir, 'stills');
  mkdirSync(stillsDir, { recursive: true });
  const prefer = [
    'contact-sheet.jpg',
    '01-open-hold.jpg',
    '04-live-first.jpg',
    '00-open-build.jpg',
  ];
  const all = readdirSync(validateDir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  const picks = [
    ...prefer.filter((f) => all.includes(f)),
    ...all.filter((f) => /^plate-/i.test(f) || /-hold\.jpg$/i.test(f)).slice(0, 8),
  ];
  const unique = [...new Set(picks)];
  const copied = [];
  for (const f of unique) {
    cpSync(join(validateDir, f), join(stillsDir, f));
    copied.push(`stills/${f}`);
  }
  // Always keep contact sheet at pack root for quick open
  if (existsSync(join(validateDir, 'contact-sheet.jpg'))) {
    mkdirSync(join(deliverDir, 'validate'), { recursive: true });
    cpSync(join(validateDir, 'contact-sheet.jpg'), join(deliverDir, 'validate', 'contact-sheet.jpg'));
  }
  return copied;
}

/** Zip deliverables/ → <out>/<slug>-handoff.zip (overwrites). */
export function zipDeliverables(video) {
  const deliverDir = join(video.out, 'deliverables');
  if (!existsSync(deliverDir)) throw new Error('No deliverables yet — run Export / deliver first');
  const zipPath = join(video.out, `${video.slug}-handoff.zip`);
  if (existsSync(zipPath)) rmSync(zipPath);
  const r = spawnSync('zip', ['-r', '-q', zipPath, '.'], {
    cwd: deliverDir,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || 'zip failed — is the zip CLI installed?');
  }
  return {
    zipPath,
    zipUrl: `/media/${video.slug}/${video.slug}-handoff.zip`,
    sizeMB: Number((statSync(zipPath).size / 1024 / 1024).toFixed(2)),
  };
}

function writeReadme(video, meta, qc, deliverDir, approvals) {
  const title = video.config.title || video.slug;
  const chapters = meta?.chapters || [];
  const lines = [
    `# ${title}`,
    '',
    `Slug: \`${video.slug}\` · Brand: \`${video.config.brand || '—'}\``,
    meta?.durationSec != null ? `Duration: **${meta.durationSec}s** · Size: **${meta.sizeMB} MB**` : '',
    qc ? `QC status: **${qc.status}** (${qc.summary.fail} fail · ${qc.summary.warn} warn)` : '',
    '',
    '## Approvals',
    '',
    approvalLine('Script', approvals.script),
    approvalLine('Cut', approvals.cut, approvals.cut.version ? ` (${approvals.cut.version})` : ''),
    '',
    '## Files',
    '',
    `| File | Purpose |`,
    `| --- | --- |`,
    `| \`${video.slug}.mp4\` | Delivery master (H.264 + AAC, chapters embedded) |`,
    `| \`poster.jpg\` | Thumbnail / social preview frame |`,
    `| \`stills/\` | Crucial QC frames (open hold, live first, plate holds, contact sheet) |`,
    `| \`validate/contact-sheet.jpg\` | Full contact sheet |`,
    `| \`${video.slug}.srt\` / \`.vtt\` | Soft captions (proof before publish) |`,
    `| \`${video.slug}.transcript.txt\` | Plain transcript with timestamps |`,
    `| \`chapters-youtube.txt\` | Paste into YouTube description |`,
    `| \`chapters.md\` | Markdown chapter list |`,
    `| \`qc-report.json\` | Pacing / tutorial QC findings |`,
    `| \`produce-meta.json\` | Encode metadata + chapter JSON |`,
    `| \`exports/\` | Square, vertical, 720p and GIF cuts when built (\`node cli.mjs export ${video.slug}\`) |`,
    '',
    '## Chapters (YouTube)',
    '',
    '```',
    youtubeChapters(chapters),
    '```',
    '',
    '## Notes',
    '',
    '- Captions are timed from fitted VO — human-proof before accessibility publish.',
    '- Target loudness is ~−14 LUFS integrated (see audio-meta.json when present).',
    '- Re-run `node cli.mjs deliver ' + video.slug + '` after audio/produce changes.',
    '',
  ].filter((l) => l !== undefined);
  writeFileSync(join(deliverDir, 'README.md'), lines.join('\n'));
}

/**
 * Build handoff under <out>/deliverables/ and mirror key files at out root.
 */
export function deliverPackage(video, { forceCaptions = true } = {}) {
  const final = join(video.out, `${video.slug}.mp4`);
  if (!existsSync(final)) throw new Error(`No delivery MP4 — produce ${video.slug} first`);

  const metaPath = join(video.out, 'produce-meta.json');
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
  const totalSec = meta.durationSec || 0;

  const stage = (id, text) => console.log(`» ${id} · ${text}`);

  // Captions
  stage('captions', 'Writing SRT, WebVTT and a plain transcript');
  let captions = null;
  try {
    captions = writeCaptions(video);
    stage('captions', captions?.cueCount ? `${captions.cueCount} caption cues` : 'No fitted voice — captions skipped');
  } catch (e) {
    if (forceCaptions) {
      stage('captions', `Skipped — ${e.message}`);
      console.log(`· captions skipped: ${e.message}`);
    }
  }

  // QC
  stage('qc', 'Checking pacing, dead air and long stretches');
  const qc = runPacingQc(video, { write: true });
  stage('qc', qc.status === 'ok' ? 'Passed' : `${qc.summary?.fail ?? 0} fail · ${qc.summary?.warn ?? 0} warn`);

  // Poster — keep a manually chosen Studio frame when present
  stage('poster', 'Grabbing a still for the thumbnail');
  const poster = join(video.out, 'poster.jpg');
  const prior = readPosterMeta(video);
  const at =
    prior?.source === 'manual' && Number.isFinite(prior.atSec)
      ? prior.atSec
      : pickPosterTime(meta, totalSec || 30);
  extractPoster(final, poster, at);
  writeFileSync(
    posterMetaPath(video),
    JSON.stringify(
      {
        atSec: Number(at.toFixed(3)),
        source: prior?.source === 'manual' ? 'manual' : 'auto',
        setAt: prior?.source === 'manual' ? prior.setAt : new Date().toISOString(),
        refreshedAt: new Date().toISOString(),
      },
      null,
      2
    ) + '\n'
  );
  console.log(`✓ poster → ${poster} @ ${at.toFixed(1)}s (${prior?.source === 'manual' ? 'manual' : 'auto'})`);
  stage('poster', `Frame at ${at.toFixed(1)}s${prior?.source === 'manual' ? ' (kept from Studio)' : ''}`);

  // Chapter text formats at out root
  stage('chapters', 'Writing the YouTube paste and the markdown list');
  const chapters = meta.chapters || [];
  const yt = join(video.out, 'chapters-youtube.txt');
  const md = join(video.out, 'chapters.md');
  writeFileSync(yt, youtubeChapters(chapters) + '\n');
  writeFileSync(
    md,
    chapters.map((c) => `- **${clock(c.start)}** — ${c.title}`).join('\n') + '\n',
  );

  // Flat deliverables folder
  stage('pack', 'Copying the master, poster, captions and notes into the handoff folder');
  const deliverDir = join(video.out, 'deliverables');
  if (existsSync(deliverDir)) rmSync(deliverDir, { recursive: true, force: true });
  mkdirSync(deliverDir, { recursive: true });

  const copy = (src, name = basename(src)) => {
    if (!existsSync(src)) return false;
    cpSync(src, join(deliverDir, name), { recursive: true });
    return true;
  };

  copy(final);
  copy(poster);
  copy(yt);
  copy(md);
  copy(metaPath);
  copy(join(video.out, 'qc-report.json'));
  copy(join(video.out, 'audio-meta.json'));
  copy(join(video.out, 'critic-report.md'));
  copy(join(video.out, 'review.html'));
  copy(posterMetaPath(video));
  const stills = copyCrucialStills(video, deliverDir);
  const variants = listExports(video).filter((item) => item.mtime >= statSync(final).mtimeMs - 1000);
  if (variants.length) {
    mkdirSync(join(deliverDir, 'exports'), { recursive: true });
    for (const item of variants) copy(item.file, join('exports', basename(item.file)));
    stage('pack', `${variants.length} export preset${variants.length === 1 ? '' : 's'} included`);
  }
  if (captions) {
    copy(captions.files.srt);
    copy(captions.files.vtt);
    copy(captions.files.transcript);
  }

  const approvals = approvalsOf(video);
  writeReadme(video, meta, qc, deliverDir, approvals);

  const manifest = {
    slug: video.slug,
    title: video.config.title,
    generatedAt: new Date().toISOString(),
    durationSec: meta.durationSec ?? null,
    sizeMB: meta.sizeMB ?? Number((statSync(final).size / 1024 / 1024).toFixed(1)),
    posterAtSec: at,
    posterSource: prior?.source === 'manual' ? 'manual' : 'auto',
    qcStatus: qc.status,
    captionCues: captions?.cueCount ?? 0,
    chapterCount: chapters.length,
    stills,
    exports: variants.map((item) => ({ id: item.id, file: `exports/${basename(item.file)}`, sizeMB: item.sizeMB })),
    approvals,
    files: readdirSync(deliverDir).filter((f) => !statSync(join(deliverDir, f)).isDirectory()),
  };
  writeFileSync(join(deliverDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(video.out, 'deliver-meta.json'), JSON.stringify(manifest, null, 2));

  let zip = null;
  try {
    stage('zip', 'Bundling a downloadable handoff zip');
    zip = zipDeliverables(video);
    stage('zip', `${zip.sizeMB} MB`);
    console.log(`✓ zip → ${zip.zipPath} (${zip.sizeMB} MB)`);
  } catch (e) {
    stage('zip', `Skipped — ${e.message}`);
  }

  console.log(`✓ handoff → ${deliverDir}`);
  console.log(
    `  ${manifest.durationSec ?? '?'}s · ${manifest.sizeMB} MB · ${manifest.chapterCount} chapters · QC ${qc.status}`,
  );
  return { dir: deliverDir, manifest, qc, captions, zip };
}

/**
 * Branch a walkthrough into focused feature videos from a strong overview.
 *
 * A folder groups a root video with its branches (Studio picker + library file).
 * Discover suggests angles from the source brief/chapters (instant) and optionally
 * an agent pass that writes branch-ideas.json. Create copies the source project
 * (config, brief, flow, narration, analysis) then the draft agent rewrites for
 * the new angle — same product, narrower story.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beatTitle } from './journeyBeats.mjs';
import { promptLanguageLine } from './languages.mjs';
import { PURPOSE_IDS, resolvePurpose } from './narrative.mjs';
import { VIDEOS, listVideos, loadVideo, slugify } from './project.mjs';

import { PLATE_TYPE_IDS as PLATE_TYPES } from './plateTypes.mjs';

const LENGTHS = [60, 90, 120, 180];
const COPY_FILES = ['video.config.json', 'brief.json', 'flow.mjs', 'narration.mjs', 'flow-analysis.md'];
const COPY_DIRS = ['assets'];

export function libraryPath() {
  return join(VIDEOS, '_library.json');
}

export function readLibrary() {
  const path = libraryPath();
  if (!existsSync(path)) return { version: 1, folders: [] };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return {
      version: 1,
      folders: Array.isArray(raw.folders) ? raw.folders.filter((f) => f && f.id && f.rootSlug) : [],
    };
  } catch {
    return { version: 1, folders: [] };
  }
}

export function writeLibrary(lib) {
  mkdirSync(VIDEOS, { recursive: true });
  writeFileSync(libraryPath(), JSON.stringify({ version: 1, folders: lib.folders || [] }, null, 2) + '\n');
}

export function branchIdeasPath(video) {
  return join(video.dir, 'branch-ideas.json');
}

export function readBranchIdeas(video) {
  const path = branchIdeasPath(video);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function readBrief(dir) {
  const path = join(dir, 'brief.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function readConfig(dir) {
  return JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8'));
}

function writeConfig(dir, cfg) {
  writeFileSync(join(dir, 'video.config.json'), JSON.stringify(cfg, null, 2) + '\n');
}

function lines(v) {
  return (Array.isArray(v) ? v : String(v || '').split('\n'))
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 12);
}

function ideaId(title) {
  return slugify(title).slice(0, 40) || `idea-${Date.now().toString(36)}`;
}

/** Ensure the source video belongs to a folder (create one when branching the first time). */
export function ensureFolder(sourceSlug, { title } = {}) {
  const video = loadVideo(sourceSlug);
  const cfg = readConfig(video.dir);
  const brief = readBrief(video.dir);
  let lineage = cfg.lineage && typeof cfg.lineage === 'object' ? { ...cfg.lineage } : null;
  const lib = readLibrary();

  if (lineage?.folderId) {
    const folder = lib.folders.find((f) => f.id === lineage.folderId);
    if (!folder) {
      lib.folders.push({
        id: lineage.folderId,
        title: title || brief?.product || cfg.title || sourceSlug,
        rootSlug: lineage.rootSlug || sourceSlug,
        createdAt: new Date().toISOString(),
      });
      writeLibrary(lib);
    }
    return { folderId: lineage.folderId, rootSlug: lineage.rootSlug || sourceSlug, lineage };
  }

  const folderId = slugify(brief?.product || cfg.brand || sourceSlug) || sourceSlug;
  const rootSlug = sourceSlug;
  const folderTitle = title || brief?.product || cfg.title || sourceSlug;
  if (!lib.folders.some((f) => f.id === folderId)) {
    lib.folders.push({
      id: folderId,
      title: folderTitle,
      rootSlug,
      createdAt: new Date().toISOString(),
    });
    writeLibrary(lib);
  }
  lineage = { folderId, rootSlug, branchedFrom: null };
  cfg.lineage = lineage;
  writeConfig(video.dir, cfg);
  if (brief) {
    brief.lineage = lineage;
    writeFileSync(join(video.dir, 'brief.json'), JSON.stringify(brief, null, 2) + '\n');
  }
  return { folderId, rootSlug, lineage };
}

/** Rename a folder (picker label). */
export function renameFolder(folderId, title) {
  const name = String(title || '').trim().slice(0, 80);
  if (!name) throw new Error('Folder title required');
  const lib = readLibrary();
  const folder = lib.folders.find((f) => f.id === folderId);
  if (!folder) throw new Error(`Unknown folder "${folderId}"`);
  folder.title = name;
  writeLibrary(lib);
  return folder;
}

/** Studio list: folders with member videos (root first, then branches). */
export function listFoldersWithVideos(summaries = []) {
  const bySlug = new Map(summaries.map((v) => [v.slug, v]));
  const lib = readLibrary();
  const claimed = new Set();
  const folders = lib.folders.map((f) => {
    const members = summaries
      .filter((v) => v.lineage?.folderId === f.id || v.slug === f.rootSlug)
      .sort((a, b) => {
        if (a.slug === f.rootSlug) return -1;
        if (b.slug === f.rootSlug) return 1;
        const aBranch = a.lineage?.branchedFrom ? 1 : 0;
        const bBranch = b.lineage?.branchedFrom ? 1 : 0;
        if (aBranch !== bBranch) return aBranch - bBranch;
        return String(a.title || a.slug).localeCompare(String(b.title || b.slug));
      });
    members.forEach((m) => claimed.add(m.slug));
    return { ...f, videos: members };
  });
  const loose = summaries.filter((v) => !claimed.has(v.slug));
  return { folders, loose };
}

/**
 * Instant suggestions from the source story — no agent required.
 * Prefer chapter titles and brief mustShow beats as feature deep-dives.
 */
export function suggestBranchIdeas(video) {
  const brief = readBrief(video.dir);
  const cfg = video.config || readConfig(video.dir);
  const ideas = [];
  const seen = new Set();

  const push = (partial) => {
    const title = String(partial.title || '').trim();
    if (!title || title.length < 4) return;
    const id = partial.id || ideaId(title);
    if (seen.has(id) || seen.has(title.toLowerCase())) return;
    seen.add(id);
    seen.add(title.toLowerCase());
    ideas.push({
      id,
      title,
      purpose: PURPOSE_IDS.includes(partial.purpose) ? partial.purpose : 'feature',
      angle: String(partial.angle || '').trim().slice(0, 280),
      outcome: String(partial.outcome || '').trim().slice(0, 200),
      mustShow: lines(partial.mustShow).slice(0, 6),
      keyMessages: lines(partial.keyMessages).slice(0, 5),
      mustSay: lines(partial.mustSay).slice(0, 4),
      lengthSec: LENGTHS.includes(Number(partial.lengthSec)) ? Number(partial.lengthSec) : 90,
      plates: (partial.plates || []).filter((p) => PLATE_TYPES.includes(p)).slice(0, 4),
      source: partial.source || 'heuristic',
    });
  };

  for (const beat of brief?.story?.mustShow || []) {
    const title = beatTitle(beat) || String(beat);
    push({
      title,
      angle: `Deep dive: stay on “${title}” until the viewer can do it alone.`,
      outcome: `Confidently complete: ${title}`,
      mustShow: [beat],
      keyMessages: (brief.story?.keyMessages || []).slice(0, 2),
      lengthSec: 90,
      plates: ['features', 'callout'],
      source: 'brief',
    });
  }

  for (const plate of cfg.interstitials || []) {
    const label = plate.title || plate.id;
    if (!label) continue;
    push({
      title: String(label).replace(/\*/g, ''),
      angle: `Feature spotlight built around the “${plate.type || 'plate'}” beat “${label}”.`,
      outcome: `Understand why ${label} matters and where to find it`,
      mustShow: plate.before ? [plate.before, label] : [label],
      lengthSec: 90,
      plates: [plate.type].filter((p) => PLATE_TYPES.includes(p)),
      source: 'plate',
    });
  }

  // Chapter titles from narration keys / open-close are weak; pull from flow chapter() if present.
  const flowPath = join(video.dir, 'flow.mjs');
  if (existsSync(flowPath)) {
    const src = readFileSync(flowPath, 'utf8');
    for (const m of src.matchAll(/\bchapter\(\s*['"]([^'"]+)['"]/g)) {
      const title = m[1];
      push({
        title,
        angle: `Walk only the “${title}” chapter — richer UI detail, fewer side trips.`,
        outcome: `Complete the ${title} workflow without help`,
        mustShow: [title],
        lengthSec: 90,
        plates: ['features'],
        source: 'chapter',
      });
    }
  }

  if (!ideas.length) {
    push({
      title: `${cfg.title || video.slug} — feature deep dive`,
      angle: 'Pick one high-value path from the overview and film it end-to-end with more UI detail.',
      outcome: brief?.outcome || 'Complete one core workflow with confidence',
      mustShow: (brief?.story?.mustShow || []).slice(0, 3),
      lengthSec: 90,
      plates: ['features', 'callout'],
      source: 'fallback',
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    source: video.slug,
    ideas: ideas.slice(0, 8),
  };
}

/** Normalize agent-written branch-ideas.json (or a partial body). */
export function normalizeBranchIdeas(raw, sourceSlug) {
  const ideas = [];
  const list = Array.isArray(raw?.ideas) ? raw.ideas : Array.isArray(raw) ? raw : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const title = String(item.title || '').trim().slice(0, 80);
    if (!title) continue;
    ideas.push({
      id: String(item.id || ideaId(title)).slice(0, 48),
      title,
      purpose: PURPOSE_IDS.includes(item.purpose) ? item.purpose : 'feature',
      angle: String(item.angle || '').trim().slice(0, 280),
      outcome: String(item.outcome || '').trim().slice(0, 200),
      mustShow: lines(item.mustShow).slice(0, 6),
      keyMessages: lines(item.keyMessages).slice(0, 5),
      mustSay: lines(item.mustSay).slice(0, 4),
      lengthSec: LENGTHS.includes(Number(item.lengthSec)) ? Number(item.lengthSec) : 90,
      plates: (item.plates || []).filter((p) => PLATE_TYPES.includes(p)).slice(0, 4),
      source: item.source || 'agent',
    });
  }
  return {
    generatedAt: raw?.generatedAt || new Date().toISOString(),
    source: sourceSlug,
    ideas: ideas.slice(0, 10),
  };
}

export function writeBranchIdeas(video, ideas) {
  const normalized = normalizeBranchIdeas(ideas, video.slug);
  writeFileSync(branchIdeasPath(video), JSON.stringify(normalized, null, 2) + '\n');
  return normalized;
}

/** Merge heuristic + agent ideas (agent wins on same id/title). */
export function mergeBranchIdeas(heuristic, agent) {
  const byKey = new Map();
  for (const idea of [...(heuristic?.ideas || []), ...(agent?.ideas || [])]) {
    const key = idea.id || idea.title.toLowerCase();
    byKey.set(key, idea);
  }
  return {
    generatedAt: agent?.generatedAt || heuristic?.generatedAt || new Date().toISOString(),
    source: heuristic?.source || agent?.source,
    ideas: [...byKey.values()].slice(0, 10),
    agent: Boolean(agent?.ideas?.length),
  };
}

function resolveIdea(sourceSlug, body = {}) {
  if (body.idea && typeof body.idea === 'object') {
    return normalizeBranchIdeas({ ideas: [body.idea] }, sourceSlug).ideas[0];
  }
  if (body.ideaId) {
    const video = loadVideo(sourceSlug);
    const stored = readBranchIdeas(video);
    const heuristic = suggestBranchIdeas(video);
    const merged = mergeBranchIdeas(heuristic, stored);
    const found = merged.ideas.find((i) => i.id === body.ideaId);
    if (!found) throw new Error(`Unknown idea "${body.ideaId}" — discover ideas first`);
    return found;
  }
  const title = String(body.title || '').trim();
  if (!title) throw new Error('Pick an idea or give a title');
  return normalizeBranchIdeas(
    {
      ideas: [
        {
          title,
          angle: body.angle,
          outcome: body.outcome,
          mustShow: body.mustShow,
          keyMessages: body.keyMessages,
          mustSay: body.mustSay,
          purpose: body.purpose || 'feature',
          lengthSec: body.lengthSec || 90,
          plates: body.plates,
          source: 'custom',
        },
      ],
    },
    sourceSlug
  ).ideas[0];
}

/**
 * Copy the source project into a new slug and retarget the brief for the branch idea.
 * Does not start the agent — caller enqueues draft/branch improve.
 */
/** Pick a free slug; append -2, -3… when the base name is taken (incl. the source). */
export function uniqueBranchSlug(base, { reserved = [] } = {}) {
  const root = slugify(base);
  if (!root) throw new Error('Could not derive a slug from the title');
  const taken = new Set([...listVideos(), ...reserved]);
  if (!taken.has(root) && !existsSync(join(VIDEOS, root))) return root;
  for (let n = 2; n < 50; n++) {
    const candidate = `${root.slice(0, 48)}-${n}`;
    if (!taken.has(candidate) && !existsSync(join(VIDEOS, candidate))) return candidate;
  }
  throw new Error(`Could not find a free slug near "${root}"`);
}

export function createBranch(sourceSlug, body = {}) {
  const source = loadVideo(sourceSlug);
  const idea = resolveIdea(sourceSlug, body);
  const title = String(body.title || idea.title).trim();
  const slug = body.slug
    ? (() => {
        const want = slugify(body.slug);
        if (!want) throw new Error('Could not derive a slug from the title');
        if (existsSync(join(VIDEOS, want))) throw new Error(`A video called "${want}" already exists`);
        return want;
      })()
    : uniqueBranchSlug(title, { reserved: [sourceSlug] });

  const { folderId, rootSlug } = ensureFolder(sourceSlug);
  const dest = join(VIDEOS, slug);
  mkdirSync(dest, { recursive: true });

  for (const name of COPY_FILES) {
    const from = join(source.dir, name);
    if (existsSync(from)) cpSync(from, join(dest, name));
  }
  for (const name of COPY_DIRS) {
    const from = join(source.dir, name);
    if (existsSync(from)) cpSync(from, join(dest, name), { recursive: true });
  }

  // Always need a config; if copy missed somehow, fail clearly.
  if (!existsSync(join(dest, 'video.config.json'))) {
    rmSync(dest, { recursive: true, force: true });
    throw new Error('Source project is missing video.config.json');
  }

  const lineage = { folderId, rootSlug, branchedFrom: sourceSlug };
  const cfg = readConfig(dest);
  cfg.title = title;
  cfg.purpose = idea.purpose || 'feature';
  cfg.audience = body.audience || cfg.audience;
  cfg.lineage = lineage;
  delete cfg.edit; // fresh cut for the new story
  writeConfig(dest, cfg);

  const sourceBrief = readBrief(source.dir) || {};
  const brief = {
    version: 1,
    createdAt: new Date().toISOString(),
    title,
    product: sourceBrief.product || cfg.brand,
    audience: body.audience || sourceBrief.audience || cfg.audience || '',
    outcome: idea.outcome || sourceBrief.outcome || '',
    purpose: idea.purpose || 'feature',
    lengthSec: idea.lengthSec || 90,
    tone: sourceBrief.tone || 'confident, warm, plain-spoken',
    brand: sourceBrief.brand || { id: cfg.brand, mode: 'existing' },
    app: sourceBrief.app || {
      startUrl: cfg.record?.startUrl,
      loginRequired: Boolean(cfg.env?.email),
      envVars: [],
    },
    story: {
      mustShow: idea.mustShow?.length ? idea.mustShow : lines(sourceBrief.story?.mustShow).slice(0, 4),
      keyMessages: idea.keyMessages?.length ? idea.keyMessages : lines(sourceBrief.story?.keyMessages).slice(0, 3),
      mustSay: idea.mustSay || [],
      avoid: [
        ...lines(sourceBrief.story?.avoid),
        'Re-filming the full overview',
        'Side quests outside this feature',
      ].slice(0, 8),
    },
    proof: {
      plates: idea.plates?.length ? idea.plates : (sourceBrief.proof?.plates || ['features', 'callout']).slice(0, 3),
      stats: lines(sourceBrief.proof?.stats).slice(0, 4),
      quotes: lines(sourceBrief.proof?.quotes).slice(0, 3),
      logos: lines(sourceBrief.proof?.logos).slice(0, 6),
    },
    lineage,
    branch: {
      sourceSlug,
      ideaId: idea.id,
      angle: idea.angle,
      createdAt: new Date().toISOString(),
    },
  };
  writeFileSync(join(dest, 'brief.json'), JSON.stringify(brief, null, 2) + '\n');

  // Seed narration title in flow/config placeholders if still template-y
  for (const f of ['flow.mjs']) {
    const p = join(dest, f);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    if (text.includes('__TITLE__')) writeFileSync(p, text.replaceAll('__TITLE__', title));
  }

  return {
    slug,
    title,
    folderId,
    rootSlug,
    branchedFrom: sourceSlug,
    idea,
    brief,
  };
}

/** Director note for the branch rewrite agent. */
export function branchDraftNote(brief, { sourceSlug } = {}) {
  const list = (label, arr) => (arr?.length ? `\n${label}:\n${arr.map((s) => `- ${s}`).join('\n')}` : '');
  return [
    `## Branch of ${sourceSlug || brief?.branch?.sourceSlug || 'source'}`,
    `This project is a COPY of a finished overview. Rewrite it into a FOCUSED feature video — do not keep the full tour.`,
    `Title: ${brief?.title}`,
    promptLanguageLine(brief?.language),
    `Angle: ${brief?.branch?.angle || '—'}`,
    `Purpose: ${brief?.purpose || 'feature'} · target ~${brief?.lengthSec || 90}s`,
    `Audience: ${brief?.audience || '—'}`,
    `After watching, the viewer can: ${brief?.outcome || '—'}`,
    list('Must show (this feature only)', brief?.story?.mustShow),
    list('Key messages', brief?.story?.keyMessages),
    list('Must say', brief?.story?.mustSay),
    list('Avoid', brief?.story?.avoid),
    brief?.proof?.plates?.length ? `\nPlates wanted: ${brief.proof.plates.join(', ')}` : '',
    list('Stats (verbatim)', brief?.proof?.stats),
    list('Quotes (verbatim)', brief?.proof?.quotes),
    `\nReuse the copied flow.mjs selectors, waits and navigation patterns where they still apply. Drop chapters that are off-angle. Rewrite narration.mjs keys to match. Tighten open/close and interstitials for this feature. Keep env "$VAR" refs. Do not record or render.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Lightweight lineage fields for videoSummary. */
export function lineageSummary(video) {
  const cfg = video.config || {};
  const brief = readBrief(video.dir);
  const lineage = cfg.lineage || brief?.lineage || null;
  if (!lineage?.folderId) return null;
  const lib = readLibrary();
  const folder = lib.folders.find((f) => f.id === lineage.folderId);
  return {
    folderId: lineage.folderId,
    folderTitle: folder?.title || lineage.folderId,
    rootSlug: lineage.rootSlug || null,
    branchedFrom: lineage.branchedFrom || null,
    role: lineage.branchedFrom ? 'branch' : 'root',
  };
}

export function listAllSlugs() {
  return listVideos().filter((s) => s !== '_library');
}

/**
 * Local Walkthrough Studio — web panel for preview, versions, critic, motion/plates,
 * and Cursor-agent improve jobs.
 *
 *   node cli.mjs studio [slug] [--port 4747]
 */
import { createServer } from 'node:http';
import { VERSION } from './version.mjs';

process.env.WALKTHROUGH_STUDIO = '1';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  agentAuthStatus,
  agentAvailable,
  cancelAllJobs,
  cancelJob,
  getJob,
  answerJob,
  jobView as jobPayload,
  listJobs,
  setAgentPreference,
  startBriefDraft,
  startDiscoverBrand,
  startExplore,
  startImprove,
  startKitJob,
} from './agentRunner.mjs';
import { loadNarrationLines, runCritic } from './critic.mjs';
import { CAMERA_OPTIONS, CURSOR_OPTIONS, FOCUS_PRESETS, PALETTE_PRESETS, listLockups, patchDirection } from './direction.mjs';
import { ZOOM_LEVELS, insetGeometry, planZooms, zoomTiming } from './camera.mjs';
import { takeSpace, videoSpace } from './stage.mjs';
import { applyCaptureSettings, captureOptions, captureSettings, parseScreen } from './captureSettings.mjs';
import { outputFrame } from './format.mjs';
import { lensGeometry, lensTiming } from './lens.mjs';
import { CURVES, MOTION_SPEEDS } from '../studio/easing.js';

/** Curve / motion presets for the Studio UI (labels, hints, CSS equivalents — no functions). */
const CURVES_META = Object.fromEntries(Object.entries(CURVES).map(([id, c]) => [id, { label: c.label, hint: c.hint, css: c.css }]));
const MOTIONS_META = Object.fromEntries(Object.entries(MOTION_SPEEDS).map(([id, m]) => [id, { label: m.label, hint: m.hint, scale: m.scale }]));
import { recordNeedsRerecord, recordRerecordReason } from './recordFreshness.mjs';
import { recordFailureView } from './recordFailure.mjs';
import { nextBrief, revisePlan } from '../studio/briefRevise.js';
import { applyBriefRevision, saveSourceRevision, storeCredential } from './briefRevise.mjs';
import { waitFiles } from './signInPause.mjs';
import { applyCleanup, formatBytes, planCleanup } from './cleanup.mjs';
import { keyCardMarks, loadRawTimeline } from './cardMarks.mjs';
import { resolveEdit, resolveTransitions, TRANSITION_STYLES } from './edit.mjs';
import {
  SPEED_RANGE,
  STYLE_GROUPS,
  TRANSITION_DUR_RANGE,
  ZOOM_RANGE,
  MIN_RAMP_SEC,
  MIN_ZOOM_SEC,
  compactEdit,
  describeDeck,
  editCameraMarks,
  LENS_ZOOM_RANGE,
  MIN_LENS_SEC,
  resolveLenses,
  withEditLenses,
  applyCardEdits,
  applySegmentCuts,
  applySegmentOmit,
  applySegmentOrder,
  applySegmentTrims,
  cardMarkKey,
  joinKey,
  liveTimeMap,
  patchEdit,
  patchStyle,
  plateTarget,
  rampConflicts,
} from './editDeck.mjs';
import {
  GAIN_RANGE,
  MASTER_RANGES,
  NUDGE_RANGE,
  OFFSET_RANGE,
  VOICE_FADE_RANGE,
  VOICE_MIN_SEC,
  VOICE_SPEED_RANGE,
  VOICE_TEXT_MAX,
  compactAudio,
  normalizeAudio,
  resolveMix,
  voiceShape,
} from './audio/desk.mjs';
import { audioMode, listVoices } from './audio/elevenlabs.mjs';
import {
  addAdlibLine,
  cachedTakes,
  installCustomTake,
  loadNarration,
  narrationLineFor,
  regenerateLine,
} from './audio/voice.mjs';
import { duration as mediaDuration } from './media.mjs';
import { EXPORT_PRESETS, listExports } from './exports.mjs';
import {
  applyScriptStructure,
  approveScript,
  refreshScriptApproval,
  buildScript,
  readReview,
  requestScriptChanges,
  scriptStatus,
  setCutReview,
  setNarrationLine,
} from './script.mjs';
import { ATMOSPHERE_IDS, ATMOSPHERE_LABELS, DEPTHS, ENERGIES, TITLE_REVEALS, lookVarTable, motionOverrides, patchMotion, plateLook, resolveMotion } from './plateMotion.mjs';
import { PURPOSES, PURPOSE_IDS, critiqueStory, resolvePurpose } from './narrative.mjs';
import {
  buildLiveCards,
  listLiveCards,
  parseCardId,
  patchOverlays,
  resolveOverlays,
  saveLiveCardCopy,
} from './liveCards.mjs';
import { buildPlates, platePaths, readPlateRenderMeta } from './plates.mjs';
import { plateStill } from './plateStills.mjs';
import { savePlateCopy } from './plateCopy.mjs';
import {
  branchDraftNote,
  createBranch,
  lineageSummary,
  listFoldersWithVideos,
  mergeBranchIdeas,
  readBranchIdeas,
  renameFolder,
  suggestBranchIdeas,
  writeBranchIdeas,
} from './branch.mjs';
import { createProject, draftNote } from './newProject.mjs';
import { readGuidedTake, takeFiles } from './guideTake.mjs';
import { readGuideStatus, readGuidedTour, requestGuideControl, requestGuideFinish } from './guidedTour.mjs';
import { resolveVideoLanguage } from './languages.mjs';
import { createDevHub, injectDevClient } from './devServer.mjs';
import { brandReadiness, listBrands, listVideos, loadVideo, OUT_ROOT } from './project.mjs';
import { suggestPlates, applyPlateSuggestions } from './suggestPlates.mjs';
import {
  deleteVersions,
  listVersions,
  planDeleteVersions,
  restoreVersion,
  snapshotVersion,
  versionMediaPath,
} from './versions.mjs';

const STUDIO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'studio');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.srt': 'application/x-subrip; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/** One-line agent status for the Studio boot banner / `./studio` Ready card. */
function formatAgentBanner(agent) {
  if (!agent?.available) return 'not found (improve saves prompts)';
  const active = agent.active;
  const label = active?.label || (agent.provider === 'claude' ? 'Claude Code' : 'Cursor agent');
  if (agent.ready) {
    const extras = [];
    if (agent.switchable) {
      const other = agent.provider === 'claude' ? agent.runners.cursor : agent.runners.claude;
      if (other?.available) extras.push(`${other.label} also available`);
    }
    return `ready · ${label}${agent.via ? ` (${agent.via})` : ''}${extras.length ? ` · ${extras.join(', ')}` : ''}`;
  }
  if (agent.provider === 'claude') {
    return 'needs Claude `/login` or ANTHROPIC_API_KEY (Improve saves prompts until then)';
  }
  if (agent.runners?.claude?.available && !agent.runners.claude.authenticated) {
    return 'needs `agent login` / CURSOR_API_KEY or Claude `/login` (Improve saves prompts until then)';
  }
  return 'needs `agent login` or CURSOR_API_KEY (Improve saves prompts until then)';
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function safeUnder(root, rel) {
  const full = resolve(root, rel);
  if (!full.startsWith(resolve(root))) throw new Error('path escape');
  return full;
}

/**
 * Product exploration for new projects and replans: the explore agent walks the live app and
 * decides the journey. Without a signed-in agent, fall back to the link crawl (map only).
 */
function startProductExplore(video, brief, { guided = captureModeOf(brief) === 'guided' } = {}) {
  // Prefer the live app URL when the brief names one and config still points at marketing.
  const appUrl = brief?.brand?.appUrl && video.config.record?.startUrl !== brief.brand.appUrl ? brief.brand.appUrl : null;
  if (guided) return startKitJob(video, 'guide', appUrl ? ['--url', appUrl] : []);
  const agent = agentAuthStatus();
  if (agent.available && agent.authenticated) return startExplore(video, { note: draftNote(brief), url: appUrl });
  const args = ['--explore'];
  if (appUrl) args.push('--url', appUrl);
  return startKitJob(video, 'analyze', args);
}

function captureModeOf(brief) {
  return brief?.capture?.mode === 'guided' ? 'guided' : 'agent';
}

/** The reviewer's recording from the last guided session, as the take choice card shows it. */
function guidedTakeSummary(video, tour) {
  const take = readGuidedTake(video);
  if (!take || (tour?.finishedAt && take.tourFinishedAt !== tour.finishedAt)) return null;
  const f = takeFiles(video);
  const v = Math.round(mtimeMs(f.take));
  const live = readJsonSafe(join(video.out, 'live-meta.json'));
  const chapters = (take.timeline || []).filter((m) => m.kind === 'chapter').map((m) => ({ title: m.label, t: m.t }));
  return {
    seconds: take.seconds,
    cuts: (take.cuts || []).length,
    cutSec: Number((take.cuts || []).reduce((a, c) => a + c.dur, 0).toFixed(1)),
    chapters,
    recordedAt: take.recordedAt || null,
    url: `/media/${encodeURIComponent(video.slug)}/guide/take.mp4?v=${v}`,
    poster: existsSync(f.poster) ? `/media/${encodeURIComponent(video.slug)}/guide/take-poster.jpg?v=${v}` : null,
    // Already the video's take (adopted after this recording was made).
    inUse: live?.source === 'reviewer' && live?.createdAt === take.recordedAt,
  };
}

function guidedTourSummary(video) {
  const tour = readGuidedTour(video);
  const status = readGuideStatus(video);
  if (!tour && !status) return null;
  return {
    steps: tour?.stats?.steps || 0,
    marks: tour?.stats?.marks || 0,
    activeSec: tour?.stats?.activeSec || 0,
    idleSec: tour?.stats?.idleSec || 0,
    finishedAt: tour?.finishedAt || null,
    take: guidedTakeSummary(video, tour),
    status,
  };
}

function readJsonSafe(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function mtimeMs(path) {
  try {
    return existsSync(path) ? statSync(path).mtimeMs : 0;
  } catch {
    return 0;
  }
}

function freshnessInfo(video) {
  const sources = [
    { key: 'config', path: join(video.dir, 'video.config.json') },
    { key: 'narration', path: join(video.dir, 'narration.mjs') },
    { key: 'flow', path: join(video.dir, 'flow.mjs') },
    { key: 'brand', path: join(video.brand.dir, 'brand.json') },
  ]
    .map((s) => ({ ...s, mtime: mtimeMs(s.path), exists: existsSync(s.path) }))
    .filter((s) => s.exists);

  const deliveryPath = join(video.out, `${video.slug}.mp4`);
  const livePath = join(video.out, 'live.mp4');
  const deliveryAt = mtimeMs(deliveryPath);
  const liveAt = mtimeMs(livePath);
  const sourceAt = sources.reduce((m, s) => Math.max(m, s.mtime), 0);
  const flowAt = sources.find((s) => s.key === 'flow')?.mtime || 0;
  const newest = sources.slice().sort((a, b) => b.mtime - a.mtime)[0];

  const plateHealth = plateRenderHealth(video);
  const liveMeta = readJsonSafe(join(video.out, 'live-meta.json')) || {};
  const startUrl = video.config.record?.startUrl || '';
  const loginRequired = typeof video.config.record?.loginRequired === 'boolean' ? video.config.record.loginRequired : Boolean(video.config.env?.email);
  const recordedUrl = liveMeta.startUrl || '';
  const recordedLogin = liveMeta.loginRequired == null ? null : Boolean(liveMeta.loginRequired);
  const flowNewer = Boolean(liveAt && flowAt && flowAt > liveAt + 1500);
  const urlChanged = Boolean(recordedUrl && startUrl && recordedUrl !== startUrl);
  const loginChanged = recordedLogin != null && recordedLogin !== loginRequired;
  const sizeChanged = Boolean(liveAt) && !videoSpace(video).takeMatches;
  const needsRecord = recordNeedsRerecord({
    hasLive: Boolean(liveAt),
    flowNewer,
    sizeChanged,
    recordedUrl,
    startUrl,
    recordedLogin,
    loginRequired,
  });
  const staleSources = Boolean(deliveryAt && sourceAt && sourceAt > deliveryAt + 1500);
  const stale = staleSources || plateHealth.bad;
  const fresh = Boolean(deliveryAt) && !stale && !needsRecord;

  let reason = 'Delivery matches current sources';
  if (!deliveryAt) reason = 'No delivery master yet — run produce';
  else if (needsRecord) reason = recordRerecordReason({ flowNewer, urlChanged, loginChanged, sizeChanged });
  else if (plateHealth.bad) {
    reason = `Plate render QC: ${plateHealth.issues.slice(0, 2).join('; ')} — re-render plates`;
  } else if (staleSources) reason = `${newest?.key || 'sources'} newer than delivery — rebuild to preview`;

  return {
    fresh,
    stale,
    needsRecord,
    startUrl,
    loginRequired,
    plateHealth,
    reason,
    sourceAt: sourceAt || null,
    deliveryAt: deliveryAt || null,
    liveAt: liveAt || null,
    newestSource: newest?.key || null,
    sources: sources.map((s) => ({
      key: s.key,
      mtime: s.mtime,
      newerThanDelivery: Boolean(deliveryAt && s.mtime > deliveryAt + 1500),
      newerThanLive: Boolean(liveAt && s.mtime > liveAt + 1500),
    })),
  };
}

function captureMarks(video) {
  const file = join(video.out, 'timeline.json');
  const marks = readJsonSafe(file);
  if (!Array.isArray(marks)) return [];
  return marks
    .filter((mark) => mark.kind === 'chapter' || mark.kind === 'caption')
    .map((mark) => ({ start: Number(mark.t) || 0, title: mark.label || '', kind: mark.kind }));
}

function videoSummary(slug) {
  const video = loadVideo(slug);
  const brandState = brandReadiness(video.config.brand);
  const final = join(video.out, `${slug}.mp4`);
  const meta = readJsonSafe(join(video.out, 'produce-meta.json'));
  const qc = readJsonSafe(join(video.out, 'qc-report.json'));
  const deliver = readJsonSafe(join(video.out, 'deliver-meta.json'));
  const captionsMeta = readJsonSafe(join(video.out, 'captions', 'captions-meta.json'));
  const versions = listVersions(video);
  const srt = join(video.out, 'captions', `${slug}.srt`);
  const vtt = join(video.out, 'captions', `${slug}.vtt`);
  const poster = join(video.out, 'poster.jpg');
  const posterMetaPath = join(video.out, 'poster-meta.json');
  const posterMeta = existsSync(posterMetaPath)
    ? (() => {
        try {
          return JSON.parse(readFileSync(posterMetaPath, 'utf8'));
        } catch {
          return null;
        }
      })()
    : null;
  const handoffZip = join(video.out, `${slug}-handoff.zip`);
  const freshness = freshnessInfo(video);
  const shotPath = join(video.out, 'error.png');
  const liveFile = join(video.out, 'live.mp4');
  const notePath = join(video.out, 'error.txt');
  const recordFailure = recordFailureView({
    shotMtime: existsSync(shotPath) ? statSync(shotPath).mtimeMs : null,
    liveMtime: existsSync(liveFile) ? statSync(liveFile).mtimeMs : null,
    note: existsSync(notePath) ? readFileSync(notePath, 'utf8') : '',
    screenshot: `/media/${slug}/error.png`,
  });
  return {
    slug,
    title: video.config.title,
    audience: video.config.audience || '',
    language: resolveVideoLanguage(video.config.language),
    brand: video.config.brand,
    brandFoundation: {
      name: video.brand.name || video.config.brand,
      platform: video.brand.platform || '',
      font: video.brand.font?.family || 'System',
      accent: video.brand.colors?.gold || '#3b82f6',
      logo: video.brand.logo || 'logo.html',
      colors: video.brand.colors || {},
      ready: brandState.ready,
      placeholder: brandState.placeholder,
      issues: brandState.issues,
      discovery: brandState.discovery,
      lockups: listLockups(video.brand).map(({ file, label }) => ({ file, label })),
    },
    direction: video.brand.direction,
    directionOptions: { palettes: PALETTE_PRESETS, focus: FOCUS_PRESETS, transitions: TRANSITION_STYLES, camera: CAMERA_OPTIONS, cursor: CURSOR_OPTIONS },
    motion: resolveMotion(video.brand),
    motionOptions: {
      energies: ENERGIES,
      atmospheres: ATMOSPHERE_IDS,
      atmosphereLabels: ATMOSPHERE_LABELS,
      titleReveals: TITLE_REVEALS,
      depths: DEPTHS,
      // Look choice → plate CSS variables, so the Editor paints a change the moment it is picked.
      lookVars: lookVarTable(video.brand),
    },
    story: storySummary(video),
    critic: criticSummary(video),
    livePace: readJsonSafe(join(video.out, 'live-meta.json'))?.pace || null,
    transitions: resolveTransitions(video),
    review: reviewSummary(video),
    hasFlow: existsSync(join(video.dir, 'flow.mjs')),
    captureMode: captureModeOf(readJsonSafe(join(video.dir, 'brief.json'))),
    output: outputFrame(video.config),
    guidedTour: guidedTourSummary(video),
    brief: readJsonSafe(join(video.dir, 'brief.json')),
    lineage: lineageSummary(video),
    interstitials: (video.config.interstitials || []).map((i) => ({
      id: i.id,
      type: i.type,
      before: i.before,
      title: i.title,
      overrides: motionOverrides(i.motion),
    })),
    plateAccents: {
      open: motionOverrides(video.config.open?.motion),
      close: motionOverrides(video.config.close?.motion),
    },
    plateStyles: Object.fromEntries(
      ['open', 'close', ...(video.config.interstitials || []).map((i) => i.id)]
        .map((id) => [id, Object.keys(plateTarget(video.config, id)?.style || {}).length])
        .filter(([, n]) => n > 0)
    ),
    editSummary: describeDeck(resolveEdit(video)),
    hasDelivery: existsSync(final),
    deliveryUrl: existsSync(final) ? `/media/${slug}/${slug}.mp4` : null,
    freshness,
    recordFailure,
    previewUrl: existsSync(join(video.out, 'live-preview.jpg')) ? `/media/${slug}/live-preview.jpg` : null,
    liveUrl: existsSync(join(video.out, 'live.mp4')) ? `/media/${slug}/live.mp4` : null,
    captureMarks: captureMarks(video),
    signInWait: existsSync(waitFiles(video.out).wait) ? readJsonSafe(waitFiles(video.out).wait) : null,
    durationSec: meta?.durationSec || null,
    sizeMB: meta?.sizeMB || null,
    chapters: meta?.chapters || [],
    hasCritic: existsSync(join(video.out, 'critic-report.json')),
    criticUrl: existsSync(join(video.out, 'critic-report.md')) ? `/media/${slug}/critic-report.md` : null,
    contactSheet: existsSync(join(video.out, 'validate', 'contact-sheet.jpg'))
      ? `/media/${slug}/validate/contact-sheet.jpg`
      : null,
    reviewUrl: existsSync(join(video.out, 'review.html')) ? `/media/${slug}/review.html` : null,
    posterUrl: existsSync(poster) ? `/media/${slug}/poster.jpg` : null,
    posterMeta: posterMeta || null,
    handoffZipUrl: existsSync(handoffZip) ? `/media/${slug}/${slug}-handoff.zip` : null,
    captions: {
      srtUrl: existsSync(srt) ? `/media/${slug}/captions/${slug}.srt` : null,
      vttUrl: existsSync(vtt) ? `/media/${slug}/captions/${slug}.vtt` : null,
      cueCount: captionsMeta?.cueCount || null,
      hash: captionsMeta?.hash || null,
      language: resolveVideoLanguage(captionsMeta?.language || video.config.language).code,
      languageName: resolveVideoLanguage(captionsMeta?.language || video.config.language).name,
    },
    qc: qc
      ? {
          status: qc.status,
          summary: qc.summary,
          findings: qc.findings || [],
          url: `/media/${slug}/qc-report.json`,
        }
      : null,
    deliver: deliver
      ? {
          ...deliver,
          dirUrl: existsSync(join(video.out, 'deliverables')) ? `/media/${slug}/deliverables/` : null,
          readmeUrl: existsSync(join(video.out, 'deliverables', 'README.md'))
            ? `/media/${slug}/deliverables/README.md`
            : null,
        }
      : null,
    exports: listExports(video).map((item) => ({
      id: item.id,
      label: item.label,
      sizeMB: item.sizeMB,
      url: `/media/${slug}/exports/${basename(item.file)}`,
      stale: Boolean(existsSync(final) && item.mtime < statSync(final).mtimeMs - 1000),
    })),
    exportPresets: EXPORT_PRESETS,
    youtubeChaptersUrl: existsSync(join(video.out, 'chapters-youtube.txt'))
      ? `/media/${slug}/chapters-youtube.txt`
      : null,
    versions: versions.slice(0, 12),
    assets: listAssets(video),
    htmlPlates: listProgramCards(video),
    overlays: resolveOverlays(video.brand, video.brand.direction || {}),
    scenes: listScenes(video),
    hasDraft: existsSync(join(draftDir(video), 'meta.json')),
    source: {
      config: existsSync(join(video.dir, 'video.config.json')),
      narration: existsSync(join(video.dir, 'narration.mjs')),
      flow: existsSync(join(video.dir, 'flow.mjs')),
    },
  };
}

function listAssets(video) {
  const out = [];
  if (!existsSync(video.out)) return out;
  for (const f of readdirSync(video.out)) {
    if (/^(brand-|plate-).*\.mp4$/.test(f) || f === `${video.slug}.mp4`) {
      const st = statSync(join(video.out, f));
      out.push({
        name: f,
        url: `/media/${video.slug}/${f}`,
        sizeMB: Number((st.size / 1024 / 1024).toFixed(1)),
        kind: f.startsWith('plate-') ? 'plate' : f.startsWith('brand-') ? 'brand' : 'delivery',
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Summarize encode QC for one plate MP4.
 * ok:true = safe cache; ok:false = must re-render; ok:null = not encoded yet (not a freshness fail).
 */
function plateEncodeSummary(mp4Path) {
  if (!existsSync(mp4Path)) {
    return { ok: null, status: 'missing', warnings: [] };
  }
  const meta = readPlateRenderMeta(mp4Path);
  if (!meta) {
    return { ok: false, status: 'no-meta', warnings: ['render-json-missing'] };
  }
  if (meta.qc && meta.qc.ok === false) {
    return {
      ok: false,
      status: 'qc-fail',
      warnings: meta.qc.warnings || ['qc-failed'],
      pipeline: meta.pipeline,
      holdFrom: meta.holdFrom,
      holdUntil: meta.holdUntil,
      snapped: meta.snapped,
      reused: meta.reused,
    };
  }
  if (!meta.qc?.ok) {
    return {
      ok: false,
      status: 'qc-pending',
      warnings: ['needs-pipeline-rebuild'],
      pipeline: meta.pipeline,
    };
  }
  const clipped = meta.typeFit?.clipped || [];
  const floored = (meta.typeFit?.fitted || []).filter((f) => f.atFloor);
  return {
    ok: true,
    status: 'ok',
    warnings: [],
    notes: [
      ...clipped.map((c) => `Copy clips: ${c}`),
      ...floored.map((f) => `Type at its floor (${f.px}px): ${f.el}`),
    ],
    pipeline: meta.pipeline,
    holdFrom: meta.holdFrom,
    holdUntil: meta.holdUntil,
    snapped: meta.snapped,
    reused: meta.reused,
    holdNote: meta.hold?.note || null,
  };
}

/**
 * Approval state for the stage stepper. A script approval is void once its sources change; a cut
 * approval is void once a newer delivery master replaces the approved one.
 */
/** Purpose + spine for the Story section; `set` tells the UI whether it was chosen or guessed. */
function storySummary(video) {
  const brief = readJsonSafe(join(video.dir, 'brief.json'));
  const purpose = resolvePurpose(video.config, brief);
  const spine = PURPOSES[purpose];
  const types = new Set((video.config.interstitials || []).map((i) => i.type));
  return {
    purpose,
    explicit: PURPOSE_IDS.includes(video.config.purpose) || PURPOSE_IDS.includes(brief?.purpose),
    label: spine.label,
    framework: spine.framework,
    hint: spine.hint,
    beats: spine.beats.map((b) => ({
      ...b,
      covered: b.plates ? b.plates.some((t) => types.has(t)) : null,
    })),
    options: PURPOSE_IDS.map((id) => ({ id, label: PURPOSES[id].label, short: PURPOSES[id].short, framework: PURPOSES[id].framework, hint: PURPOSES[id].hint })),
  };
}

/** The last critic report, trimmed for the Review panel. */
function criticSummary(video) {
  const report = readJsonSafe(join(video.out, 'critic-report.json'));
  if (!report) return null;
  const findings = (report.findings || []).map(({ apply, ...f }) => f);
  const count = (sev) => findings.filter((f) => f.severity === sev).length;
  return {
    generatedAt: report.generatedAt,
    fingerprint: report.fingerprint,
    purpose: report.purpose || null,
    high: count('high'),
    medium: count('medium'),
    low: count('low'),
    findings,
    stale: setupChanged(video),
  };
}

/** True when config or narration changed after the critic last ran (the report is a frozen read). */
function setupChanged(video) {
  const stamp = join(video.out, 'critic-report.json');
  if (!existsSync(stamp)) return false;
  const reportAt = statSync(stamp).mtimeMs;
  const narrationPath = join(video.dir, 'narration.mjs');
  const srcAt = Math.max(
    existsSync(video.configPath) ? statSync(video.configPath).mtimeMs : 0,
    existsSync(narrationPath) ? statSync(narrationPath).mtimeMs : 0
  );
  return srcAt > reportAt + 1500;
}

function reviewSummary(video) {
  const review = readReview(video);
  const script = scriptStatus(video, review);
  const deliveryAt = mtimeMs(join(video.out, `${video.slug}.mp4`));
  const cut = { ...review.cut, effective: review.cut.status };
  if (cut.version) cut.versionName = listVersions(video).find((v) => v.id === cut.version)?.name || null;
  if (cut.status === 'approved' && deliveryAt && cut.approvedAt && deliveryAt > Date.parse(cut.approvedAt) + 5000) {
    cut.effective = 'changed';
  }
  return {
    script: { ...script, history: (script.history || []).slice(-8) },
    cut: { ...cut, history: (cut.history || []).slice(-8) },
  };
}

function plateRenderHealth(video) {
  const paths = platePaths(video);
  const issues = [];
  const check = (id, mp4) => {
    const s = plateEncodeSummary(mp4);
    // Only encoded plates with failed/outdated QC block Studio freshness
    if (s.ok === false) issues.push(`${id}: ${s.warnings.join(',') || s.status}`);
    return s;
  };
  const byId = {
    open: check('open', paths.open.mp4),
    close: check('close', paths.close.mp4),
  };
  for (const it of video.config.interstitials || []) {
    const dest = paths.interstitial[it.id];
    if (dest) byId[it.id] = check(it.id, dest.mp4);
  }
  return { bad: issues.length > 0, issues, byId };
}

/** Live HTML plate previews (open / close / interstitials) for the Program iframe. */
function listHtmlPlates(video) {
  const paths = platePaths(video);
  const slug = video.slug;
  const plates = [];
  const push = (id, label, htmlPath, mp4Path, type) => {
    if (!existsSync(htmlPath)) return;
    const encode = plateEncodeSummary(mp4Path);
    plates.push({
      id,
      label,
      type,
      htmlUrl: `/media/${slug}/plates/${id}.html?t=${Date.now()}`,
      path: htmlPath,
      mp4Url: existsSync(mp4Path) ? `/media/${slug}/${basename(mp4Path)}` : null,
      encode,
    });
  };
  push('open', 'Open', paths.open.html, paths.open.mp4, 'open');
  for (const it of video.config.interstitials || []) {
    const dest = paths.interstitial[it.id];
    if (dest) push(it.id, it.title || it.id, dest.html, dest.mp4, it.type);
  }
  push('close', 'Close', paths.close.html, paths.close.mp4, 'close');
  return plates;
}

/** Plates + live chapter/caption cards for the Program picker (story order: open → cards → close). */
function listProgramCards(video) {
  const plates = listHtmlPlates(video);
  let live = [];
  try {
    live = listLiveCards(video);
  } catch {
    live = [];
  }
  if (!plates.length) return live;
  const open = plates.filter((p) => p.id === 'open');
  const close = plates.filter((p) => p.id === 'close');
  const mid = plates.filter((p) => p.id !== 'open' && p.id !== 'close');
  // open → chapter/caption cards (with interstitial plates still in their own mid list after open)
  return [...open, ...live, ...mid, ...close];
}

function draftDir(video) {
  return join(video.out, 'studio-draft');
}

export function snapshotSources(video) {
  const dir = draftDir(video);
  mkdirSync(dir, { recursive: true });
  const configSrc = join(video.dir, 'video.config.json');
  const brandSrc = join(video.brand.dir, 'brand.json');
  const narrationSrc = join(video.dir, 'narration.mjs');
  const flowSrc = join(video.dir, 'flow.mjs');
  copyFileSync(configSrc, join(dir, 'video.config.json'));
  copyFileSync(brandSrc, join(dir, 'brand.json'));
  if (existsSync(narrationSrc)) copyFileSync(narrationSrc, join(dir, 'narration.mjs'));
  if (existsSync(flowSrc)) copyFileSync(flowSrc, join(dir, 'flow.mjs'));
  const meta = {
    at: new Date().toISOString(),
    slug: video.slug,
    brandPath: brandSrc,
    configPath: configSrc,
    narrationPath: existsSync(narrationSrc) ? narrationSrc : null,
    flowPath: existsSync(flowSrc) ? flowSrc : null,
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}

export function draftChanges(video) {
  const dir = draftDir(video);
  const metaPath = join(dir, 'meta.json');
  if (!existsSync(metaPath)) return { files: [], domains: [], labels: [] };
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const specs = [
    ['config', join(dir, 'video.config.json'), meta.configPath || join(video.dir, 'video.config.json')],
    ['narration', join(dir, 'narration.mjs'), meta.narrationPath || join(video.dir, 'narration.mjs')],
    ['flow', join(dir, 'flow.mjs'), meta.flowPath || join(video.dir, 'flow.mjs')],
    ['brand', join(dir, 'brand.json'), meta.brandPath || join(video.brand.dir, 'brand.json')],
  ];
  const files = specs
    .filter(([, before, current]) => existsSync(before) && existsSync(current))
    .filter(([, before, current]) => readFileSync(before, 'utf8') !== readFileSync(current, 'utf8'))
    .map(([key]) => key);
  const domains = new Set();
  if (files.includes('narration')) {
    domains.add('script');
    domains.add('voice');
    domains.add('timing');
  }
  if (files.includes('flow')) {
    domains.add('script');
    domains.add('journey');
    domains.add('timing');
  }
  if (files.includes('brand')) domains.add('brand');
  if (files.includes('config')) {
    try {
      const before = JSON.parse(readFileSync(join(dir, 'video.config.json'), 'utf8'));
      const current = JSON.parse(readFileSync(meta.configPath || join(video.dir, 'video.config.json'), 'utf8'));
      const changed = (key) => JSON.stringify(before[key]) !== JSON.stringify(current[key]);
      if (['open', 'close', 'interstitials'].some(changed)) domains.add('plates');
      if (changed('direction')) {
        domains.add('brand');
        domains.add('motion');
      }
      if (changed('audio')) {
        domains.add('voice');
        domains.add('audio');
      }
      if (changed('record')) domains.add('recording');
      if (['transitions', 'timing', 'edit'].some(changed)) domains.add('timing');
      if (['title', 'audience'].some(changed)) domains.add('script');
      if (!domains.size) domains.add('video');
    } catch {
      domains.add('video');
    }
  }
  const labels = [...domains].map(
    (domain) =>
      ({
        script: 'Story & script',
        voice: 'Voice & narration',
        timing: 'Timing & pacing',
        journey: 'Live journey',
        plates: 'Brand plates',
        brand: 'Brand direction',
        motion: 'Motion',
        audio: 'Audio mix',
        recording: 'Recording',
        video: 'Video settings',
      })[domain] || domain
  );
  return { files, domains: [...domains], labels };
}

export function discardDraft(video) {
  const dir = draftDir(video);
  const metaPath = join(dir, 'meta.json');
  if (!existsSync(metaPath)) throw new Error('No draft snapshot to discard');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  if (existsSync(join(dir, 'video.config.json'))) {
    copyFileSync(join(dir, 'video.config.json'), meta.configPath || join(video.dir, 'video.config.json'));
  }
  if (existsSync(join(dir, 'brand.json'))) {
    copyFileSync(join(dir, 'brand.json'), meta.brandPath || join(video.brand.dir, 'brand.json'));
  }
  if (meta.narrationPath && existsSync(join(dir, 'narration.mjs'))) {
    copyFileSync(join(dir, 'narration.mjs'), meta.narrationPath);
  }
  if (meta.flowPath && existsSync(join(dir, 'flow.mjs'))) {
    copyFileSync(join(dir, 'flow.mjs'), meta.flowPath);
  }
  return { ok: true, restoredAt: meta.at };
}

function rebuildPlateHtml(slug) {
  const video = loadVideo(slug);
  buildPlates(video);
  let overlays = null;
  try {
    overlays = buildLiveCards(video);
  } catch (err) {
    overlays = { error: err.message || String(err), cards: [] };
  }
  const fresh = loadVideo(slug);
  return {
    ok: true,
    plates: listProgramCards(fresh),
    motion: resolveMotion(fresh.brand),
    overlays: resolveOverlays(fresh.brand, fresh.brand.direction || {}),
    liveCards: overlays?.cards?.length ?? 0,
  };
}

/** Merge adjacent live bricks that abut on the recording clock (undo a prior chapter split). */
function coalesceContiguousLive(scenes) {
  if (!Array.isArray(scenes) || !scenes.length) return scenes || [];
  const out = [];
  for (const s of scenes) {
    const prev = out[out.length - 1];
    // Allow small gaps (card-cover trims in edit-plan); never merge reverse / reordered time.
    const canMerge =
      s.kind === 'live' &&
      prev?.kind === 'live' &&
      Number.isFinite(prev.recTo) &&
      Number.isFinite(s.recFrom) &&
      s.recFrom >= prev.recFrom - 0.05 &&
      s.recFrom <= prev.recTo + 0.85;
    if (!canMerge) {
      out.push({ ...s });
      continue;
    }
    const recFrom = prev.recFrom;
    const recTo = s.recTo;
    const cleanFrom = prev.cleanFrom ?? prev.start;
    const cleanTo = s.cleanTo ?? s.end;
    const merged = {
      ...prev,
      id: `live-${Number(recFrom).toFixed(2)}`,
      title: 'Live screencast',
      start: cleanFrom,
      end: cleanTo,
      dur: Math.max(0.2, cleanTo - cleanFrom),
      cleanFrom,
      cleanTo,
      recFrom,
      recTo,
    };
    delete merged.opensOnCard;
    out[out.length - 1] = merged;
  }
  return out;
}

/**
 * Editor-only: break live scenes at chapter marks so “Meet Apptension” etc. appear as their own
 * bricks (order/omit). Produce’s buildEditPlan applies the same split when writing edit-plan.json.
 */
function splitEditorScenesAtChapters(scenes, timeline, map) {
  const chapters = (timeline || []).filter((m) => m.kind === 'chapter');
  if (!chapters.length) return scenes;
  const out = [];
  for (const s of scenes) {
    if (s.kind !== 'live' || s.recFrom == null || s.recTo == null) {
      out.push(s);
      continue;
    }
    const inside = chapters
      .filter((c) => c.t >= s.recFrom - 0.02 && c.t < s.recTo - 0.35)
      .slice()
      .sort((a, b) => a.t - b.t);
    if (!inside.length) {
      out.push(s);
      continue;
    }
    let cursor = s.recFrom;
    for (let i = 0; i < inside.length; i++) {
      const ch = inside[i];
      const chStart = Number(ch.t);
      const nextT = i + 1 < inside.length ? Number(inside[i + 1].t) : s.recTo;
      if (chStart > cursor + 0.35) {
        out.push(liveSceneSlice(s, cursor, chStart, map));
        cursor = chStart;
      }
      const start = cursor < chStart ? cursor : chStart;
      out.push(liveSceneSlice(s, start, nextT, map, ch.label));
      cursor = nextT;
    }
    if (cursor < s.recTo - 0.05) out.push(liveSceneSlice(s, cursor, s.recTo, map));
  }
  return out.length ? out : scenes;
}

function liveSceneSlice(base, recFrom, recTo, map, title = null) {
  const cleanFrom = map?.toClean ? map.toClean(recFrom) : recFrom;
  const cleanTo = map?.toClean ? map.toClean(recTo) : recTo;
  const dur = Math.max(0.2, cleanTo - cleanFrom);
  return {
    ...base,
    id: `live-${recFrom.toFixed(2)}`,
    title: title || base.title || 'Live screencast',
    start: cleanFrom,
    end: cleanTo,
    dur,
    cleanFrom,
    cleanTo,
    recFrom,
    recTo,
    ...(title ? { opensOnCard: title } : {}),
  };
}

/** Delivery-timeline scenes from edit-plan.json (or produce-meta.edit). */
function listScenes(video) {
  const planPath = join(video.out, 'edit-plan.json');
  const metaPath = join(video.out, 'produce-meta.json');
  let segments = [];
  if (existsSync(planPath)) {
    segments = JSON.parse(readFileSync(planPath, 'utf8')).segments || [];
  } else if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    segments = meta.edit || [];
  }
  const html = listHtmlPlates(video);
  const htmlById = Object.fromEntries(html.map((p) => [p.id, p]));
  let t = 0;
  return segments.map((seg, index) => {
    const start = seg.at ?? t;
    const end = start + (seg.dur || 0);
    t = end;
    const isPlate = seg.kind === 'plate';
    const plateKey = isPlate ? (seg.id === 'open' || seg.id === 'close' ? seg.id : `plate:${seg.id}`) : null;
    return {
      index,
      id: seg.id,
      kind: seg.kind,
      title: seg.title || seg.opensOnCard || (isPlate ? seg.id : 'Live screencast'),
      type: seg.type || (seg.id === 'open' || seg.id === 'close' ? seg.id : null),
      start,
      end,
      dur: seg.dur || 0,
      transitionIn: seg.transitionIn || null,
      join: seg.join || null,
      cleanFrom: isPlate ? null : (seg.start ?? null),
      cleanTo: isPlate ? null : (seg.end ?? null),
      editable: isPlate,
      plateId: isPlate ? seg.id : null,
      renderOnly: plateKey,
      htmlUrl: isPlate && htmlById[seg.id] ? htmlById[seg.id].htmlUrl : null,
      mp4Url: isPlate
        ? seg.id === 'open'
          ? `/media/${video.slug}/brand-open.mp4`
          : seg.id === 'close'
            ? `/media/${video.slug}/brand-close.mp4`
            : `/media/${video.slug}/plate-${seg.id}.mp4`
        : null,
    };
  });
}

/**
 * Everything the Studio Editor needs in one payload: the deck, the recording's marks, the zoom
 * shots the camera would plan, every join with its chosen transition, and the per-plate style.
 * Times for the live reel are in the recording's clock; `pieces` converts to the cleaned reel.
 */
/** The narration as written, keyed by line, for the Editor's Line panel. */
async function writtenLines(video) {
  const out = new Map();
  try {
    const narration = await loadNarration(video);
    if (!narration) return out;
    if (narration.intro != null) out.set('intro', narrationLineFor(narration, { key: 'intro', kind: 'intro' })?.text || '');
    if (narration.outro != null) out.set('outro', narrationLineFor(narration, { key: 'outro', kind: 'outro' })?.text || '');
    for (const [key, raw] of Object.entries({ ...(narration.lines || {}), ...(narration.plates || {}) })) {
      out.set(key, typeof raw === 'string' ? raw : raw?.text || '');
    }
  } catch {
    /* a narration file that fails to import leaves the panel without the written text */
  }
  return out;
}

/** The deck with the written narration attached; the API handlers use this one. */
async function editDeckFull(video) {
  const narration = await loadNarration(video).catch(() => null);
  return editDeck(video, { written: await writtenLines(video), narration });
}

function editDeck(video, { written = new Map(), narration = null } = {}) {
  const voiceWritten = written;
  const slug = video.slug;
  const LIVE = join(video.out, 'live.mp4');
  const hasLive = existsSync(LIVE);
  const liveDur = hasLive ? mediaDuration(LIVE) : 0;
  const space = takeSpace(video);
  const width = space.cssW;
  const height = space.cssH;
  const deck = resolveEdit(video, { liveDur: hasLive ? liveDur : Infinity });
  const timeline = loadRawTimeline(video);
  const camera = video.brand.direction?.camera || { zoom: 'off', frame: 'full', background: 'brand' };
  const cameraTimeline = [...withEditLenses(timeline, deck), ...editCameraMarks(deck)].sort((a, b) => a.t - b.t);
  const timing = zoomTiming(camera);
  const zoomPlan = hasLive
    ? planZooms(cameraTimeline, { width, height, level: camera.zoom, duration: liveDur, timing })
    : { shots: [], skipped: 0, targets: 0, manual: 0 };
  const map = liveTimeMap(deck.speed, liveDur);
  const meta = readJsonSafe(join(video.out, 'produce-meta.json'));
  // Live slices were cut on the clean reel of the last render; map them back to recording time
  // with that render's ramps so the editor can lay them out under the current deck.
  const renderedMap = liveTimeMap(meta?.speed?.ramps || [], liveDur);
  const listed = listScenes(video).map((s) =>
    s.kind === 'live' && hasLive && s.cleanFrom != null
      ? { ...s, recFrom: renderedMap.fromClean(s.cleanFrom), recTo: renderedMap.fromClean(s.cleanTo) }
      : s
  );
  // Honour edit.cards so moving a chapter on the timeline reshapes rearrangeable sections.
  const splitMarks = applyCardEdits(keyCardMarks(timeline), deck.cards);
  // edit-plan may already be chapter-split; coalesce contiguous live bricks, then re-split
  // from current marks so Editor sections track timeline card moves.
  const natural = splitEditorScenesAtChapters(coalesceContiguousLive(listed), splitMarks, map);
  // The editor's order plays the rendered slices in a new sequence; omit drops sections; trims cut heads/tails.
  const scenes = applySegmentCuts(
    applySegmentTrims(applySegmentOmit(applySegmentOrder(natural, deck.order), deck.omit), deck.trims),
    deck.cuts,
    map
  );
  const omitted = natural
    .filter((s) => (deck.omit || []).includes(s.id))
    .map((s) => ({ id: s.id, kind: s.kind, title: s.title, type: s.type || null }));
  const joins = scenes.slice(1).map((s, i) => {
    const prev = scenes[i];
    const key = s.join || joinKey(prev, s);
    return {
      key,
      prev: { id: prev.id, kind: prev.kind, title: prev.title },
      next: { id: s.id, kind: s.kind, title: s.title },
      at: s.start,
      type: s.hardCut ? null : s.transitionIn?.type || null,
      dur: s.hardCut ? 0 : s.transitionIn?.dur || null,
      card: s.hardCut ? false : Boolean(s.transitionIn?.card),
      pinned: deck.transitions[key] || null,
    };
  });
  const rendered = meta?.editDeck || null;
  const pictureOf = (deck) => {
    if (!deck || typeof deck !== 'object') return null;
    const { audio: _audio, ...rest } = deck;
    return Object.keys(rest).length ? rest : null;
  };
  const plates = listHtmlPlates(video).map((p) => {
    const target = plateTarget(video.config, p.id) || {};
    return {
      id: p.id,
      label: p.label,
      type: p.type,
      htmlUrl: p.htmlUrl,
      mp4Url: p.mp4Url,
      style: target.style || {},
      motion: target.motion || {},
      overrides: motionOverrides(target.motion),
    };
  });
  const marks = applyCardEdits(
    timeline
      .filter((m) => ['chapter', 'caption', 'magnify', 'click', 'type', 'zoom', 'hold', 'pace'].includes(m.kind))
      .map((m) => ({
        kind: m.kind,
        t: m.t,
        ...(m.dur != null ? { dur: m.dur } : {}),
        ...(m.label || m.body ? { label: m.label || m.body } : {}),
        ...(Number.isFinite(m.x) ? { x: m.x, y: m.y } : {}),
        ...(m.rect ? { rect: m.rect } : {}),
        ...(m.tempo != null ? { tempo: m.tempo } : {}),
        ...((m.kind === 'chapter' || m.kind === 'caption') ? { key: cardMarkKey(m) } : {}),
      })),
    deck.cards
  );
  const direction = video.brand.direction || {};
  const lenses = resolveLenses(timeline, deck).map((m) => {
    const geo = lensGeometry(m, { width, height });
    return {
      key: m.source === 'edit' ? `edit:${m.id}` : `auto:${m.t}`,
      id: m.id || null,
      source: m.source,
      label: m.label || 'Magnifier',
      t: m.t,
      dur: m.dur,
      rect: m.rect,
      path: m.path || null,
      zoom: Number(geo.zoom.toFixed(3)),
      diameter: geo.diameter,
      S: geo.S,
    };
  });
  const recordedLenses = timeline
    .filter((m) => m.kind === 'magnify' && m.rect && m.dur)
    .map((m) => ({ t: m.t, dur: m.dur, label: m.label || 'Magnifier', rect: m.rect, off: deck.lensOff.includes(Math.round(m.t * 1000) / 1000) }));
  const audioMeta = readJsonSafe(join(video.out, 'audio-meta.json'));
  const audioWant = compactAudio(deck.audio) || null;
  const audioGot = audioMeta && Object.prototype.hasOwnProperty.call(audioMeta, 'desk') ? audioMeta.desk || null : null;
  const voiceMeta = readJsonSafe(join(video.out, 'voice', 'voice.json'));
  const voiceEdits = new Map((deck.audio?.voice || []).map((v) => [v.key, v]));
  const voiceClips = (voiceMeta?.clips || []).map((c, i) => {
    const edit = voiceEdits.get(c.key) || {};
    const shape = voiceShape(c.full ?? c.duration, edit);
    const spoken = String(c.text || c.key).replace(/^\[[^\]]+\]\s*/, '');
    const takes = Math.max(edit.takes || 1, edit.take || 1, c.take || 1);
    const spec = narration ? narrationLineFor(narration, c) : null;
    return {
      key: c.key,
      kind: c.kind,
      text: spoken.slice(0, VOICE_TEXT_MAX),
      // The desk's rewrite, when the line was regenerated from one; the mix speaks `text`.
      textOverride: edit.text || null,
      written: voiceWritten.get(c.key) || null,
      start: Math.round((c.start + (edit.nudge || 0)) * 1000) / 1000,
      writtenStart: c.start,
      nudge: edit.nudge || 0,
      at: edit.at != null ? edit.at : null,
      markAt: c.markAt ?? null,
      dur: shape.duration,
      full: shape.full,
      trimStart: shape.trimStart,
      trimEnd: shape.trimEnd,
      fadeIn: shape.fadeIn,
      fadeOut: shape.fadeOut,
      speed: edit.speed || null,
      spokenSpeed: c.speed ?? null,
      take: c.take || edit.take || 1,
      takes,
      // Takes with a clip in the cache or a custom upload/mic file: switch without speaking again.
      cachedTakes: cachedTakes(video, spec, edit, takes, c.key),
      takeSources: edit.takeSources || {},
      source: c.source || edit.takeSources?.[String(c.take || edit.take || 1)] || null,
      gainDb: edit.gainDb || 0,
      mute: Boolean(edit.mute),
      notes: c.notes || [],
      url: `/media/${slug}/voice-file/${i}?t=${encodeURIComponent(c.file ? basename(c.file) : i)}`,
    };
  });
  const narratorWant = video.audio?.voice || {};
  const narratorBuilt = voiceMeta?.voice || null;
  const narrator = {
    voiceId: narratorWant.voiceId || null,
    name: narratorWant.name || null,
    model: narratorWant.model || null,
    // Set per video (config.audio.voice) or inherited from the brand pack.
    source: video.config?.audio?.voice?.voiceId ? 'video' : 'brand',
    built: narratorBuilt ? { voiceId: narratorBuilt.voiceId || null, name: narratorBuilt.name || null } : null,
    stale: Boolean(narratorBuilt && narratorWant.voiceId && narratorBuilt.voiceId !== narratorWant.voiceId),
    mode: audioMode(),
  };
  const musicFile = join(video.out, 'music', 'music.mp3');
  const musicPlan = readJsonSafe(join(video.out, 'music', 'plan.json'));
  let music = null;
  if (existsSync(musicFile)) {
    let durationSec = musicPlan?.durationSec || 0;
    try {
      durationSec = mediaDuration(musicFile);
    } catch {
      /* a missing decoder still leaves the bed editable */
    }
    const source =
      musicPlan?.source ||
      (musicPlan?.mode === 'upload' ? 'upload' : musicPlan?.mode === 'stub' ? 'stub' : musicPlan ? 'eleven' : null);
    music = {
      url: `/media/${slug}/music/music.mp3?t=${Math.round(statSync(musicFile).mtimeMs)}`,
      durationSec: Number(durationSec.toFixed(3)),
      source,
      prompt: video.audio?.music?.prompt || musicPlan?.prompt || null,
      generatedAt: musicPlan?.generatedAt || null,
    };
  }
  const musicPrompt = video.audio?.music?.prompt || musicPlan?.prompt || music?.prompt || null;
  const levels = resolveMix(video.audio?.mix || {}, deck.audio);
  const audio = {
    desk: deck.audio,
    levels,
    defaults: video.audio?.mix || {},
    voiceName: voiceMeta?.voice?.name || video.audio?.voice?.name || null,
    narrator,
    voiceClips,
    music,
    musicPrompt,
    windows: scenes.filter((s) => s.kind === 'live').map((s) => ({ start: s.start, end: s.end })),
    // The mix is behind when the desk changed, the narrator changed, a line was regenerated, or the bed changed.
    stale:
      JSON.stringify(audioWant) !== JSON.stringify(audioGot) ||
      narrator.stale ||
      Boolean(audioMeta && voiceMeta?.generatedAt && audioMeta.generatedAt && voiceMeta.generatedAt > audioMeta.generatedAt) ||
      Boolean(audioMeta && musicPlan?.generatedAt && audioMeta.generatedAt && musicPlan.generatedAt > audioMeta.generatedAt),
    mixed: Boolean(audioMeta),
  };
  return {
    slug,
    deck,
    summary: describeDeck(deck),
    stale: JSON.stringify(pictureOf(compactEdit(deck) || null)) !== JSON.stringify(pictureOf(rendered)) || freshnessInfo(video).stale,
    audioStale: audio.stale,
    rendered: Boolean(meta),
    space: videoSpace(video),
    live: {
      exists: hasLive,
      url: hasLive ? `/media/${slug}/live.mp4?t=${Math.round(statSync(LIVE).mtimeMs)}` : null,
      durationSec: Number(liveDur.toFixed(3)),
      cleanSec: map.cleanDur,
      width,
      height,
      pieces: map.pieces,
      // clean = cards composited at Produce; burned/missing = legacy paint-into-screencast
      overlaysMode: (() => {
        try {
          const metaPath = join(video.out, 'live-meta.json');
          if (!existsSync(metaPath)) return 'burned';
          const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
          return meta?.overlays?.mode === 'clean' ? 'clean' : 'burned';
        } catch {
          return 'burned';
        }
      })(),
    },
    marks,
    zoomShots: zoomPlan.shots,
    zoomPlan: { skipped: zoomPlan.skipped, targets: zoomPlan.targets, manual: zoomPlan.manual },
    zoomTiming: timing,
    lensTiming: lensTiming(camera),
    curves: CURVES_META,
    motions: MOTIONS_META,
    zoomLevels: ZOOM_LEVELS,
    conflicts: rampConflicts(deck, timeline),
    joins,
    scenes,
    naturalIds: natural.map((s) => s.id),
    omitted,
    plates,
    styleGroups: STYLE_GROUPS,
    transitionStyles: TRANSITION_STYLES,
    transitions: resolveTransitions(video),
    camera,
    frame: camera.frame === 'inset' ? { ...insetGeometry({ width, height, padding: camera.padding, corners: camera.corners }), background: camera.background || 'brand', shadow: camera.shadow || 'soft' } : null,
    lenses,
    recordedLenses,
    lensRim: video.brand.colors?.gold || '#F6AA1E',
    brandColors: { ink: video.brand.colors?.ink, surface: video.brand.colors?.surface, gold: video.brand.colors?.gold, amber: video.brand.colors?.amber },
    cursor: direction.cursor || null,
    cursorOptions: CURSOR_OPTIONS,
    pace: direction.pace || 'steady',
    ranges: {
      speed: SPEED_RANGE,
      zoom: ZOOM_RANGE,
      transitionDuration: TRANSITION_DUR_RANGE,
      minRampSec: MIN_RAMP_SEC,
      minZoomSec: MIN_ZOOM_SEC,
      lensZoom: LENS_ZOOM_RANGE,
      minLensSec: MIN_LENS_SEC,
      /** Chapter/caption on-screen hold (recording clock); matches edit.cards normalize. */
      cardDur: [0.4, 30],
      gain: GAIN_RANGE,
      nudge: NUDGE_RANGE,
      musicOffset: OFFSET_RANGE,
      master: MASTER_RANGES,
      voiceFade: VOICE_FADE_RANGE,
      voiceMinSec: VOICE_MIN_SEC,
      voiceSpeed: VOICE_SPEED_RANGE,
      voiceTextMax: VOICE_TEXT_MAX,
    },
    audio,
  };
}

function sceneAtTime(scenes, t) {
  if (!scenes?.length) return null;
  for (const s of scenes) {
    if (t >= s.start - 0.05 && t < s.end - 0.02) return s;
  }
  return scenes[scenes.length - 1];
}

async function handleApi(req, res, url) {
  const path = url.pathname;

  if (path === '/api/health') {
    const agent = agentAuthStatus();
    return json(res, 200, {
      ok: true,
      version: VERSION,
      agent: agent.ready || agent.available,
      agentAuth: agent,
      outRoot: OUT_ROOT,
    });
  }

  if (path === '/api/agent/preference' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const agentAuth = setAgentPreference(body.provider || body.agent);
      return json(res, 200, { ok: true, agentAuth });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (path === '/api/videos' && req.method === 'GET') {
    const agent = agentAuthStatus();
    const videos = listVideos().map((slug) => {
      try {
        return videoSummary(slug);
      } catch (err) {
        return { slug, title: slug, error: err.message };
      }
    });
    const grouped = listFoldersWithVideos(videos);
    return json(res, 200, {
      videos,
      folders: grouped.folders,
      loose: grouped.loose,
      agent: agent.available,
      agentAuth: agent,
    });
  }

  if (path === '/api/folders' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const folder = renameFolder(String(body.id || ''), body.title);
      return json(res, 200, { ok: true, folder });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (path === '/api/capture/options' && req.method === 'GET') {
    return json(res, 200, { options: captureOptions({ screen: parseScreen(url.searchParams), mode: url.searchParams.get('mode') === 'guided' ? 'guided' : 'agent' }) });
  }

  if (path === '/api/brands' && req.method === 'GET') {
    return json(res, 200, { brands: listBrands() });
  }

  const plateStillMatch = path.match(/^\/api\/plate-stills\/([^/]+)\/([^/]+)\.jpg$/);
  if (plateStillMatch && req.method === 'GET') {
    const brandName = decodeURIComponent(plateStillMatch[1]);
    const type = decodeURIComponent(plateStillMatch[2]).replace(/\.jpg$/, '');
    try {
      const file = await plateStill(brandName, type);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache' });
      createReadStream(file).pipe(res);
    } catch (err) {
      json(res, 404, { error: err.message || String(err) });
    }
    return;
  }

  if (path === '/api/projects' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      return json(res, 200, { ok: true, ...createProject(body) });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  // One description → the agent fills every brief field. Nothing is created until the reviewer confirms.
  if (path === '/api/brief/draft' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    try {
      const job = startBriefDraft({ description: body.description, startUrl: body.startUrl, language: body.language });
      return json(res, 200, { ok: true, job: jobPayload(job) });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (path === '/api/jobs' && req.method === 'GET') {
    return json(res, 200, { jobs: listJobs().map(jobPayload) });
  }

  if (path === '/api/jobs/cancel-all' && req.method === 'POST') {
    const stopped = cancelAllJobs().map(jobPayload);
    return json(res, 200, { ok: true, stopped: stopped.length, jobs: stopped });
  }

  const jobCancel = path.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
  if (jobCancel && req.method === 'POST') {
    const job = cancelJob(jobCancel[1]);
    if (!job) return json(res, 404, { error: 'job not found' });
    return json(res, 200, { ok: true, job: jobPayload(job) });
  }

  const jobAnswer = path.match(/^\/api\/jobs\/([^/]+)\/answer$/);
  if (jobAnswer && req.method === 'POST') {
    const body = await readBody(req);
    const result = answerJob(jobAnswer[1], { value: body.value, cancel: Boolean(body.cancel) });
    if (!result) return json(res, 404, { error: 'job not found' });
    return json(res, 200, { ok: true, continue: result.continue });
  }

  const jobMatch = path.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobMatch && req.method === 'GET') {
    const job = getJob(jobMatch[1]);
    if (!job) return json(res, 404, { error: 'job not found' });
    return json(res, 200, jobPayload(job));
  }

  const slugMatch = path.match(/^\/api\/video\/([^/]+)(.*)$/);
  if (!slugMatch) return json(res, 404, { error: 'not found' });
  const slug = decodeURIComponent(slugMatch[1]);
  const rest = slugMatch[2] || '';

  let video;
  try {
    video = loadVideo(slug);
  } catch (e) {
    return json(res, 404, { error: e.message });
  }

  const brandFile = rest.match(/^\/brand-file\/([^/]+)$/);
  if (brandFile && req.method === 'GET') {
    const name = basename(decodeURIComponent(brandFile[1]));
    const allowed = listLockups(video.brand).some((item) => item.file === name);
    const file = join(video.brand.dir, name);
    if (!allowed || !existsSync(file)) return json(res, 404, { error: 'logo not found' });
    const body = readFileSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  if (rest === '' && req.method === 'GET') {
    return json(res, 200, videoSummary(slug));
  }

  if (rest === '/config' && req.method === 'GET') {
    return json(res, 200, {
      config: JSON.parse(readFileSync(join(video.dir, 'video.config.json'), 'utf8')),
      motion: resolveMotion(video.brand),
      brandPath: join(video.brand.dir, 'brand.json'),
    });
  }

  if (rest === '/config' && req.method === 'PUT') {
    const body = await readBody(req);
    const pathCfg = join(video.dir, 'video.config.json');
    const current = JSON.parse(readFileSync(pathCfg, 'utf8'));
    const next = { ...current, ...body, record: { ...current.record, ...(body.record || {}) } };
    writeFileSync(pathCfg, JSON.stringify(next, null, 2) + '\n');
    return json(res, 200, { ok: true, config: next });
  }

  if (rest === '/script' && req.method === 'GET') {
    const script = await buildScript(video);
    return json(res, 200, { script, review: reviewSummary(video) });
  }

  if (rest === '/script/line' && req.method === 'PUT') {
    const body = await readBody(req);
    await setNarrationLine(video, {
      kind: body.kind,
      key: body.key,
      text: body.text,
      ...(body.speed !== undefined ? { speed: body.speed } : {}),
    });
    // Narration/pace edits keep an approved script approved — no re-approve dialog, no re-render.
    refreshScriptApproval(loadVideo(slug), { reason: 'narration' });
    const fresh = loadVideo(slug);
    const script = await buildScript(fresh);
    return json(res, 200, { ok: true, script, review: reviewSummary(fresh) });
  }

  if (rest === '/script/structure' && req.method === 'PUT') {
    const body = await readBody(req);
    try {
      const result = await applyScriptStructure(video, body);
      // Reload so buildScript sees fresh config (env resolution, defaults).
      const fresh = loadVideo(slug);
      const script = await buildScript(fresh);
      return json(res, 200, { ok: true, result, script, review: reviewSummary(fresh) });
    } catch (err) {
      return json(res, 400, { error: err.message || String(err) });
    }
  }

  if (rest === '/brief' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const current = readJsonSafe(join(video.dir, 'brief.json')) || {};
      const plan = revisePlan(current, body);
      if (!plan.changed.length) return json(res, 200, { ok: true, plan, revision: null });
      const secrets = [body.app?.password].filter((value) => value && String(value).length >= 4);
      const revision = saveSourceRevision(video, { secrets });
      const written = applyBriefRevision(video, nextBrief(current, body), { secrets });
      const stored = storeCredential(video, { email: body.app?.email, password: body.app?.password });
      return json(res, 200, { ok: true, plan, revision: revision.id, brief: written, stored: stored.includes(`${video.slug.replace(/-/g, '_').toUpperCase()}_PASSWORD`) ? ['password'] : [] });
    } catch (err) {
      return json(res, 400, { error: err.message || String(err) });
    }
  }

  if (rest === '/script/approve' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    const script = await buildScript(video);
    if (script.totals.errors && !body.force) {
      return json(res, 409, { error: `Script has ${script.totals.errors} blocking issue(s) — fix them or approve with force`, script });
    }
    approveScript(video, { note: body.note, by: body.by });
    return json(res, 200, { ok: true, review: reviewSummary(video) });
  }

  if (rest === '/script/request-changes' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.note?.trim()) return json(res, 400, { error: 'Describe the changes you want' });
    const job = body.agent === false ? null : startImprove(video, 'script', { note: body.note });
    requestScriptChanges(video, { note: body.note, by: body.by, jobId: job?.id });
    return json(res, 200, { ok: true, job: jobPayload(job), review: reviewSummary(video) });
  }

  if (rest === '/cut/review' && req.method === 'POST') {
    const body = await readBody(req);
    let version = body.version || null;
    if (body.status === 'approved' && !version) {
      const entry = snapshotVersion(video, {
        title: body.title || 'Approved cut',
        note: body.note || '',
        kind: 'release',
        trigger: 'approve',
      });
      version = entry.id;
    }
    setCutReview(video, { status: body.status, version, note: body.note, by: body.by });
    return json(res, 200, { ok: true, review: reviewSummary(video), versions: listVersions(video) });
  }

  if (rest === '/record-target' && req.method === 'PUT') {
    const body = await readBody(req);
    const startUrl = String(body.startUrl || '').trim();
    if (!/^https?:\/\//i.test(startUrl)) return json(res, 400, { error: 'Start URL must be a full http(s) URL.' });
    const pathCfg = join(video.dir, 'video.config.json');
    const current = JSON.parse(readFileSync(pathCfg, 'utf8'));
    const previousUrl = current.record?.startUrl || '';
    const previousLogin = typeof current.record?.loginRequired === 'boolean' ? current.record.loginRequired : Boolean(current.env?.email);
    const loginRequired = Boolean(body.loginRequired);
    const metaPath = join(video.out, 'live-meta.json');
    const meta = readJsonSafe(metaPath) || {};
    if (existsSync(join(video.out, 'live.mp4')) && !meta.startUrl && previousUrl) {
      meta.startUrl = previousUrl;
      meta.loginRequired = previousLogin;
      writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
    }
    const record = { ...(current.record || {}), startUrl, loginRequired };
    writeFileSync(pathCfg, JSON.stringify({ ...current, record }, null, 2) + '\n');
    return json(res, 200, { ok: true, freshness: freshnessInfo(loadVideo(video.slug)) });
  }

  if (rest === '/sign-in-continue' && req.method === 'POST') {
    writeFileSync(waitFiles(video.out).resume, 'ok\n');
    return json(res, 200, { ok: true });
  }

  if (rest === '/cleanup' && req.method === 'POST') {
    const body = await readBody(req);
    const plan = planCleanup(video.out, { slug: video.slug });
    if (body.confirm) applyCleanup(plan);
    return json(res, 200, {
      ok: true,
      deleted: Boolean(body.confirm),
      files: plan.files.map((file) => ({ name: file.name, bytes: file.bytes })),
      totalBytes: plan.totalBytes,
      totalLabel: plan.totalLabel,
    });
  }

  if (rest === '/transitions' && req.method === 'GET') {
    return json(res, 200, { styles: TRANSITION_STYLES, transitions: resolveTransitions(video) });
  }

  if (rest === '/transitions' && req.method === 'PUT') {
    const body = await readBody(req);
    if (body.style && !TRANSITION_STYLES[body.style]) {
      return json(res, 400, { error: `Unknown transition style: ${body.style}` });
    }
    const pathCfg = join(video.dir, 'video.config.json');
    const current = JSON.parse(readFileSync(pathCfg, 'utf8'));
    const transitions = { ...(current.transitions || {}) };
    if (body.style) transitions.style = body.style;
    if (body.duration != null) transitions.duration = Math.min(1.2, Math.max(0.2, Number(body.duration) || 0.6));
    const direction = { ...(current.direction || {}) };
    delete direction.approvedAt;
    writeFileSync(pathCfg, JSON.stringify({ ...current, transitions, direction }, null, 2) + '\n');
    return json(res, 200, { ok: true, transitions: resolveTransitions(loadVideo(video.slug)) });
  }

  if (rest === '/capture' && req.method === 'GET') {
    const brief = readJsonSafe(join(video.dir, 'brief.json')) || {};
    return json(res, 200, captureSettings(video, { screen: parseScreen(url.searchParams), brief, mode: captureModeOf(brief) }));
  }

  if (rest === '/capture' && req.method === 'POST') {
    const body = await readBody(req);
    const pathCfg = join(video.dir, 'video.config.json');
    const current = JSON.parse(readFileSync(pathCfg, 'utf8'));
    let next;
    try {
      next = applyCaptureSettings(current, body);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
    writeFileSync(pathCfg, JSON.stringify(next, null, 2) + '\n');
    const refreshed = loadVideo(video.slug);
    const brief = readJsonSafe(join(video.dir, 'brief.json')) || {};
    const outputChanged = outputFrame(current).format !== outputFrame(next).format;
    const rebuilt = outputChanged ? rebuildPlateHtml(video.slug) : null;
    return json(res, 200, {
      ok: true,
      ...captureSettings(refreshed, { screen: body.screen || null, brief, mode: captureModeOf(brief) }),
      freshness: freshnessInfo(refreshed),
      ...(rebuilt ? { plates: rebuilt.plates, overlays: rebuilt.overlays } : {}),
    });
  }

  if (rest === '/direction' && req.method === 'PUT') {
    const body = await readBody(req);
    const pathCfg = join(video.dir, 'video.config.json');
    const current = JSON.parse(readFileSync(pathCfg, 'utf8'));
    let direction;
    try {
      direction = patchDirection(current.direction || {}, body, video.brand);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
    writeFileSync(pathCfg, JSON.stringify({ ...current, direction }, null, 2) + '\n');
    const refreshed = loadVideo(video.slug);
    return json(res, 200, {
      ok: true,
      direction: refreshed.brand.direction,
      motion: resolveMotion(refreshed.brand),
      transitions: resolveTransitions(refreshed),
    });
  }

  if (rest === '/motion' && req.method === 'POST') {
    const body = await readBody(req);
    const pathCfg = join(video.dir, 'video.config.json');
    const current = JSON.parse(readFileSync(pathCfg, 'utf8'));
    const direction = { ...(current.direction || {}) };
    try {
      direction.motion = patchMotion(direction.motion || {}, body);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
    delete direction.approvedAt;
    writeFileSync(pathCfg, JSON.stringify({ ...current, direction }, null, 2) + '\n');
    const refreshed = loadVideo(slug);
    const rebuilt = rebuildPlateHtml(slug);
    return json(res, 200, {
      ok: true,
      motion: resolveMotion(refreshed.brand),
      direction: refreshed.brand.direction,
      overlays: rebuilt.overlays,
      plates: rebuilt.plates,
    });
  }

  // Live chapter/caption look: direction.overlays (presets + per-slot atmosphere/seat/…).
  if (rest === '/overlays' && req.method === 'GET') {
    return json(res, 200, {
      overlays: resolveOverlays(video.brand, video.brand.direction || {}),
      plates: listProgramCards(video),
    });
  }
  if (rest === '/overlays' && req.method === 'POST') {
    const body = await readBody(req);
    const pathCfg = join(video.dir, 'video.config.json');
    const current = JSON.parse(readFileSync(pathCfg, 'utf8'));
    const direction = { ...(current.direction || {}) };
    try {
      direction.overlays = patchOverlays(direction.overlays || {}, body);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
    delete direction.approvedAt;
    writeFileSync(pathCfg, JSON.stringify({ ...current, direction }, null, 2) + '\n');
    const rebuilt = rebuildPlateHtml(slug);
    return json(res, 200, {
      ok: true,
      overlays: rebuilt.overlays,
      plates: rebuilt.plates,
      direction: loadVideo(slug).brand.direction,
    });
  }

  // Per-plate accent: interstitials[].motion (or open/close.motion). `null` values clear a key,
  // `{ reset: true }` drops the whole override so the plate follows the video again.
  const plateMotion = rest.match(/^\/plates\/([^/]+)\/motion$/);
  if (plateMotion && req.method === 'POST') {
    const plateId = decodeURIComponent(plateMotion[1]);
    const body = await readBody(req);
    const pathCfg = join(video.dir, 'video.config.json');
    const current = JSON.parse(readFileSync(pathCfg, 'utf8'));
    const target =
      plateId === 'open' || plateId === 'close'
        ? (current[plateId] = current[plateId] || {})
        : (current.interstitials || []).find((i) => i.id === plateId);
    if (!target) return json(res, 404, { error: `No plate "${plateId}"` });
    try {
      if (body.reset) delete target.motion;
      else {
        const next = patchMotion(target.motion || {}, body);
        if (Object.keys(next).length) target.motion = next;
        else delete target.motion;
      }
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
    snapshotSources(video);
    writeFileSync(pathCfg, JSON.stringify(current, null, 2) + '\n');
    const rebuilt = rebuildPlateHtml(slug);
    return json(res, 200, {
      ...rebuilt,
      ok: true,
      plateId,
      overrides: motionOverrides(target.motion),
      motion: target.motion || {},
      // Resolved look for this plate — the Editor syncs the live frame to it and reloads only when the markup changed.
      look: plateLook(loadVideo(slug).brand, target.motion),
    });
  }

  // Editor deck: speed ramps, manual zooms, zoom-free windows, pinned joins.
  if (rest === '/edit' && req.method === 'GET') {
    try {
      return json(res, 200, await editDeckFull(video));
    } catch (err) {
      return json(res, 500, { error: err.message || String(err) });
    }
  }

  // Narrators the ElevenLabs account offers (empty in stub / missing-key mode).
  if (rest === '/narrators' && req.method === 'GET') {
    try {
      return json(res, 200, { mode: audioMode(), voices: await listVoices({ force: url.searchParams.get('force') === '1' }) });
    } catch (err) {
      return json(res, 502, { error: err.message || String(err) });
    }
  }

  // Pick the narrator for this video: config.audio.voice overrides the brand's voice. Lines are
  // spoken again with the new voice on the next Mix (clip cache keys include the voice).
  if (rest === '/narrator' && req.method === 'POST') {
    const body = await readBody(req);
    const pathCfg = join(video.dir, 'video.config.json');
    const current = JSON.parse(readFileSync(pathCfg, 'utf8'));
    if (body.reset) {
      if (current.audio?.voice) {
        delete current.audio.voice.voiceId;
        delete current.audio.voice.name;
        if (!Object.keys(current.audio.voice).length) delete current.audio.voice;
        if (!Object.keys(current.audio).length) delete current.audio;
      }
    } else {
      const voiceId = String(body.voiceId || '').trim();
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(voiceId)) return json(res, 400, { error: 'voiceId required' });
      current.audio = current.audio || {};
      current.audio.voice = { ...(current.audio.voice || {}), voiceId, name: String(body.name || voiceId).slice(0, 80) };
    }
    snapshotSources(video);
    writeFileSync(pathCfg, JSON.stringify(current, null, 2) + '\n');
    return json(res, 200, { ok: true, ...(await editDeckFull(loadVideo(slug))) });
  }

  // Branch: ideas for focused videos from this overview, then copy + draft.
  if (rest === '/branch/ideas' && req.method === 'GET') {
    const heuristic = suggestBranchIdeas(video);
    const agent = readBranchIdeas(video);
    return json(res, 200, mergeBranchIdeas(heuristic, agent));
  }

  if (rest === '/branch/discover' && req.method === 'POST') {
    // Seed heuristics immediately so the UI has cards while the agent thinks.
    const heuristic = suggestBranchIdeas(video);
    writeBranchIdeas(video, heuristic);
    const job = startImprove(loadVideo(slug), 'branch-ideas', {
      note: 'Write branch-ideas.json with 5–8 focused feature angles from this overview.',
    });
    return json(res, 200, { ok: true, ideas: heuristic, job: jobPayload(job) });
  }

  if (rest === '/branch' && req.method === 'POST') {
    const body = await readBody(req);
    let created;
    try {
      created = createBranch(slug, body);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
    const child = loadVideo(created.slug);
    const note = branchDraftNote(created.brief, { sourceSlug: slug });
    const job =
      body.draft === false
        ? null
        : startImprove(child, 'branch', { note });
    return json(res, 200, {
      ok: true,
      ...created,
      job: job ? jobPayload(job) : null,
      video: videoSummary(created.slug),
    });
  }

  // Add a free-standing voice line at an absolute time (ad-lib on the cut).
  if (rest === '/voice/line/add' && req.method === 'POST') {
    const body = await readBody(req);
    const at = Math.max(0, Number(body.at) || 0);
    const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim().slice(0, 600) : '';
    const pathCfg = join(video.dir, 'video.config.json');
    const current = JSON.parse(readFileSync(pathCfg, 'utf8'));
    const desk = normalizeAudio(current.edit?.audio || {});
    let created;
    try {
      created = await addAdlibLine(loadVideo(slug), { text, at });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
    const entry = { key: created.key, at: Number(at.toFixed(3)) };
    if (text) entry.text = text;
    let nextAudio;
    try {
      nextAudio = patchEdit(current.edit || {}, {
        audio: { ...desk, voice: [...desk.voice.filter((v) => v.key !== created.key), entry] },
      }).audio;
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
    const compact = compactEdit({ ...(current.edit || {}), audio: nextAudio });
    if (compact) current.edit = compact;
    else delete current.edit;
    snapshotSources(video);
    writeFileSync(pathCfg, JSON.stringify(current, null, 2) + '\n');
    const via = body.via === 'eleven' && text ? 'eleven' : null;
    if (via === 'eleven') {
      try {
        const r = await regenerateLine(loadVideo(slug), created.key);
        if (r?.mode !== 'custom') {
          const after = JSON.parse(readFileSync(pathCfg, 'utf8'));
          const deskAfter = normalizeAudio(after.edit?.audio || {});
          const row = deskAfter.voice.find((v) => v.key === created.key) || { key: created.key, at: Number(at.toFixed(3)) };
          if (text) row.text = text;
          row.takeSources = { ...(row.takeSources || {}), [String(row.take || 1)]: 'eleven' };
          const audio = patchEdit(after.edit || {}, {
            audio: { ...deskAfter, voice: [...deskAfter.voice.filter((v) => v.key !== created.key), row] },
          }).audio;
          const compactAfter = compactEdit({ ...(after.edit || {}), audio });
          if (compactAfter) after.edit = compactAfter;
          else delete after.edit;
          writeFileSync(pathCfg, JSON.stringify(after, null, 2) + '\n');
        }
        return json(res, 200, { ok: true, key: created.key, line: r, ...(await editDeckFull(loadVideo(slug))) });
      } catch (err) {
        return json(res, 502, { error: err.message || String(err), key: created.key, ...(await editDeckFull(loadVideo(slug))) });
      }
    }
    return json(res, 200, { ok: true, key: created.key, ...(await editDeckFull(loadVideo(slug))) });
  }

  // Save an ElevenLabs music prompt (and optionally kick off compose). Lives on config.audio.music.prompt.
  if (rest === '/music/prompt' && req.method === 'POST') {
    const body = await readBody(req);
    const { normalizeMusicPrompt } = await import('./audio/music.mjs');
    const prompt = normalizeMusicPrompt(body.prompt);
    const pathCfg = join(video.dir, 'video.config.json');
    const current = JSON.parse(readFileSync(pathCfg, 'utf8'));
    current.audio = current.audio && typeof current.audio === 'object' ? current.audio : {};
    current.audio.music = current.audio.music && typeof current.audio.music === 'object' ? current.audio.music : {};
    if (prompt) current.audio.music.prompt = prompt;
    else delete current.audio.music.prompt;
    if (!Object.keys(current.audio.music).length) delete current.audio.music;
    if (!Object.keys(current.audio).length) delete current.audio;
    snapshotSources(video);
    writeFileSync(pathCfg, JSON.stringify(current, null, 2) + '\n');
    return json(res, 200, { ok: true, prompt: prompt || null, ...(await editDeckFull(loadVideo(slug))) });
  }

  // Attach an uploaded music bed (base64 audio) — replaces music/music.mp3.
  if (rest === '/music/upload' && req.method === 'POST') {
    const body = await readBody(req);
    const b64 = String(body.audio || body.data || '').replace(/^data:[^;]+;base64,/, '');
    if (!b64) return json(res, 400, { error: 'audio (base64) required' });
    let buffer;
    try {
      buffer = Buffer.from(b64, 'base64');
    } catch {
      return json(res, 400, { error: 'invalid base64 audio' });
    }
    const mime = String(body.mime || 'audio/mpeg').slice(0, 80);
    try {
      const { installCustomMusic } = await import('./audio/music.mjs');
      const bed = await installCustomMusic(loadVideo(slug), { buffer, mime });
      snapshotSources(video);
      return json(res, 200, { ok: true, music: bed, ...(await editDeckFull(loadVideo(slug))) });
    } catch (err) {
      return json(res, 400, { error: err.message || String(err) });
    }
  }

  // Attach an uploaded or mic-recorded take (base64 audio). Optional newTake bumps the take index.
  if (rest === '/voice/line/upload' && req.method === 'POST') {
    const body = await readBody(req);
    const key = String(body.key || '').trim();
    if (!key) return json(res, 400, { error: 'key required' });
    const b64 = String(body.audio || body.data || '').replace(/^data:[^;]+;base64,/, '');
    if (!b64) return json(res, 400, { error: 'audio (base64) required' });
    let buffer;
    try {
      buffer = Buffer.from(b64, 'base64');
    } catch {
      return json(res, 400, { error: 'invalid base64 audio' });
    }
    const source = body.source === 'mic' ? 'mic' : 'upload';
    const mime = String(body.mime || 'audio/mpeg').slice(0, 80);
    const pathCfg = join(video.dir, 'video.config.json');
    const current = JSON.parse(readFileSync(pathCfg, 'utf8'));
    const desk = normalizeAudio(current.edit?.audio || {});
    const prev = desk.voice.find((v) => v.key === key) || { key };
    let installed;
    try {
      installed = await installCustomTake(loadVideo(slug), key, {
        buffer,
        mime,
        source,
        newTake: body.newTake !== false,
        take: body.take != null ? Number(body.take) : null,
      });
    } catch (err) {
      return json(res, 400, { error: err.message || String(err) });
    }
    const entry = { ...prev, take: installed.take, takes: Math.max(prev.takes || 1, prev.take || 1, installed.take) };
    entry.takeSources = { ...(prev.takeSources || {}), [String(installed.take)]: source };
    // Custom audio replaces TTS for this take — drop speed remints that don't apply.
    delete entry.speed;
    if (entry.trimStart || entry.trimEnd) {
      entry.nudge = Math.round(((entry.nudge || 0) - (entry.trimStart || 0)) * 1000) / 1000;
      delete entry.trimStart;
      delete entry.trimEnd;
    }
    let nextAudio;
    try {
      nextAudio = patchEdit(current.edit || {}, {
        audio: { ...desk, voice: [...desk.voice.filter((v) => v.key !== key), entry] },
      }).audio;
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
    const compact = compactEdit({ ...(current.edit || {}), audio: nextAudio });
    if (compact) current.edit = compact;
    else delete current.edit;
    snapshotSources(video);
    writeFileSync(pathCfg, JSON.stringify(current, null, 2) + '\n');
    return json(res, 200, { ok: true, line: installed, ...(await editDeckFull(loadVideo(slug))) });
  }

  // Speak one line again. Saves the line's desk entry (rewrite, speed, take) first, then
  // synthesizes — a new take, a rewrite, or a step back to an earlier take (from the cache).
  if (rest === '/voice/line' && req.method === 'POST') {
    const body = await readBody(req);
    const key = String(body.key || '').trim();
    if (!key) return json(res, 400, { error: 'key required' });
    const pathCfg = join(video.dir, 'video.config.json');
    const current = JSON.parse(readFileSync(pathCfg, 'utf8'));
    const desk = normalizeAudio(current.edit?.audio || {});
    const prev = desk.voice.find((v) => v.key === key) || { key };
    const entry = { ...prev };
    if (typeof body.text === 'string') {
      const text = body.text.replace(/\s+/g, ' ').trim();
      if (text) entry.text = text;
      else delete entry.text;
    }
    if (body.speed != null) {
      const speed = Number(body.speed);
      if (!Number.isFinite(speed)) return json(res, 400, { error: 'speed must be a number' });
      if (Math.abs(speed - 1) < 0.005) delete entry.speed;
      else entry.speed = speed;
    }
    if (body.take != null) {
      const take = Math.max(1, Math.round(Number(body.take) || 1));
      if (take > (prev.takes || prev.take || 1)) return json(res, 400, { error: `take ${take} was never recorded` });
      entry.take = take;
    } else if (body.newTake) {
      const next = Math.max(prev.takes || 1, prev.take || 1) + 1;
      entry.take = next;
      entry.takes = next;
    }
    entry.takes = Math.max(entry.takes || 1, entry.take || 1);
    // Trims belong to the old audio: a different take, pace or wording starts from the whole clip
    // (the head trim's start compensation goes with it). Fades and level carry over.
    const respoken = (entry.text || '') !== (prev.text || '') || (entry.speed || 1) !== (prev.speed || 1) || (entry.take || 1) !== (prev.take || 1);
    if (respoken && (entry.trimStart || entry.trimEnd)) {
      entry.nudge = Math.round(((entry.nudge || 0) - (entry.trimStart || 0)) * 1000) / 1000;
      delete entry.trimStart;
      delete entry.trimEnd;
    }
    let nextAudio;
    try {
      nextAudio = patchEdit(current.edit || {}, { audio: { ...desk, voice: [...desk.voice.filter((v) => v.key !== key), entry] } }).audio;
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
    const compact = compactEdit({ ...(current.edit || {}), audio: nextAudio });
    if (compact) current.edit = compact;
    else delete current.edit;
    snapshotSources(video);
    writeFileSync(pathCfg, JSON.stringify(current, null, 2) + '\n');
    try {
      const r = await regenerateLine(loadVideo(slug), key);
      // Label ElevenLabs takes so chips show the source alongside upload/mic.
      if (r?.mode !== 'custom') {
        const after = JSON.parse(readFileSync(pathCfg, 'utf8'));
        const deskAfter = normalizeAudio(after.edit?.audio || {});
        const row = deskAfter.voice.find((v) => v.key === key) || { key };
        const t = String(row.take || entry.take || 1);
        row.takeSources = { ...(row.takeSources || {}), [t]: 'eleven' };
        const audio = patchEdit(after.edit || {}, {
          audio: { ...deskAfter, voice: [...deskAfter.voice.filter((v) => v.key !== key), row] },
        }).audio;
        const compactAfter = compactEdit({ ...(after.edit || {}), audio });
        if (compactAfter) after.edit = compactAfter;
        else delete after.edit;
        writeFileSync(pathCfg, JSON.stringify(after, null, 2) + '\n');
      }
      return json(res, 200, { ok: true, line: r, ...(await editDeckFull(loadVideo(slug))) });
    } catch (err) {
      return json(res, 502, { error: err.message || String(err), ...(await editDeckFull(loadVideo(slug))) });
    }
  }

  if (rest === '/edit' && req.method === 'POST') {
    const body = await readBody(req);
    const pathCfg = join(video.dir, 'video.config.json');
    const current = JSON.parse(readFileSync(pathCfg, 'utf8'));
    const LIVE = join(video.out, 'live.mp4');
    const space = takeSpace(video, current);
    let next;
    try {
      next = patchEdit(current.edit || {}, body, {
        liveDur: existsSync(LIVE) ? mediaDuration(LIVE) : Infinity,
        width: space.cssW,
        height: space.cssH,
        styles: TRANSITION_STYLES,
      });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
    const compact = compactEdit(next);
    if (compact) current.edit = compact;
    else delete current.edit;
    snapshotSources(video);
    writeFileSync(pathCfg, JSON.stringify(current, null, 2) + '\n');
    // Timeline card trims change overlay HTML --hold / --x-out (preview + produce bake).
    if (Object.prototype.hasOwnProperty.call(body || {}, 'cards')) {
      try {
        buildLiveCards(loadVideo(slug));
      } catch (err) {
        console.warn('live cards rebuild after edit.cards:', err.message || err);
      }
    }
    return json(res, 200, { ok: true, ...(await editDeckFull(loadVideo(slug))) });
  }

  // Per-plate CSS variables (open.style / close.style / interstitials[].style) → rebuilt HTML.
  const plateStyleMatch = rest.match(/^\/plates\/([^/]+)\/style$/);
  if (plateStyleMatch && req.method === 'POST') {
    const plateId = decodeURIComponent(plateStyleMatch[1]);
    const body = await readBody(req);
    const pathCfg = join(video.dir, 'video.config.json');
    const current = JSON.parse(readFileSync(pathCfg, 'utf8'));
    const target = plateTarget(current, plateId, { create: true });
    if (!target) return json(res, 404, { error: `No plate "${plateId}"` });
    try {
      const plateType = plateId === 'open' || plateId === 'close' ? plateId : target.type || null;
      const next = body.reset ? undefined : patchStyle(target.style || {}, body.style || {}, { plateId, plateType });
      if (next) target.style = next;
      else delete target.style;
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
    snapshotSources(video);
    writeFileSync(pathCfg, JSON.stringify(current, null, 2) + '\n');
    let rebuilt;
    try {
      rebuilt = rebuildPlateHtml(slug);
    } catch (err) {
      return json(res, 500, { error: err.message || String(err) });
    }
    return json(res, 200, { ...rebuilt, ok: true, plateId, style: target.style || {} });
  }

  // Story purpose → config.purpose; the agents and the critic read it from there.
  if (rest === '/story' && req.method === 'POST') {
    const body = await readBody(req);
    if (!PURPOSE_IDS.includes(body.purpose)) return json(res, 400, { error: `purpose must be one of ${PURPOSE_IDS.join(', ')}` });
    const pathCfg = join(video.dir, 'video.config.json');
    const current = JSON.parse(readFileSync(pathCfg, 'utf8'));
    const next = {};
    for (const [k, v] of Object.entries(current)) {
      next[k] = v;
      if (k === 'audience') next.purpose = body.purpose;
    }
    if (!('purpose' in next)) next.purpose = body.purpose;
    writeFileSync(pathCfg, JSON.stringify(next, null, 2) + '\n');
    const briefPath = join(video.dir, 'brief.json');
    const brief = readJsonSafe(briefPath);
    if (brief) writeFileSync(briefPath, JSON.stringify({ ...brief, purpose: body.purpose }, null, 2) + '\n');
    return json(res, 200, { ok: true, story: storySummary(loadVideo(slug)) });
  }

  // Story check without writing a report — the Review panel's live spine read.
  if (rest === '/story/check' && req.method === 'GET') {
    const lines = await loadNarrationLines(video);
    const brief = readJsonSafe(join(video.dir, 'brief.json'));
    return json(res, 200, critiqueStory(video.config, lines, { brief }));
  }

  if (rest === '/narration' && req.method === 'GET') {
    const p = join(video.dir, 'narration.mjs');
    if (!existsSync(p)) return json(res, 404, { error: 'no narration.mjs' });
    return json(res, 200, { source: readFileSync(p, 'utf8') });
  }

  if (rest === '/narration' && req.method === 'PUT') {
    const body = await readBody(req);
    if (typeof body.source !== 'string') return json(res, 400, { error: 'source required' });
    writeFileSync(join(video.dir, 'narration.mjs'), body.source);
    refreshScriptApproval(loadVideo(slug), { reason: 'narration' });
    return json(res, 200, { ok: true, review: reviewSummary(loadVideo(slug)) });
  }

  if (rest === '/versions' && req.method === 'GET') {
    return json(res, 200, { versions: listVersions(video) });
  }

  if (rest === '/versions/snapshot' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    const entry = snapshotVersion(video, {
      title: body.title || body.label || '',
      label: body.label || '',
      note: body.note || '',
      kind: body.kind || 'release',
      trigger: body.trigger || (body.label ? undefined : 'manual'),
    });
    return json(res, 200, { ok: true, version: entry });
  }

  if (rest === '/versions/delete' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const plan = planDeleteVersions(video, ids);
    if (body.confirm) deleteVersions(video, ids);
    return json(res, 200, {
      ok: true,
      deleted: Boolean(body.confirm),
      versions: plan.versions.map((ver) => ({
        id: ver.id,
        name: ver.name,
        title: ver.title,
        kind: ver.kind,
        bytes: ver.bytes,
        sizeLabel: formatBytes(ver.bytes),
      })),
      missing: plan.missing,
      totalBytes: plan.totalBytes,
      totalLabel: formatBytes(plan.totalBytes),
      summary: body.confirm ? videoSummary(slug) : undefined,
    });
  }

  const restoreMatch = rest.match(/^\/versions\/([^/]+)\/(restore|regenerate)$/);
  if (restoreMatch && req.method === 'POST') {
    const id = restoreMatch[1];
    const action = restoreMatch[2];
    const body = await readBody(req).catch(() => ({}));
    restoreVersion(video, id, { media: Boolean(body.media) && action === 'restore' });
    if (action === 'regenerate') {
      const job = startKitJob(loadVideo(slug), 'produce', body.force ? ['--force'] : []);
      // chain audio after produce via a follow-up note in response — client can call audio
      return json(res, 200, { ok: true, restored: id, job, next: 'audio' });
    }
    return json(res, 200, { ok: true, restored: id, summary: videoSummary(slug) });
  }

  if (rest === '/critic' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    const report = await runCritic(loadVideo(slug), {
      force: Boolean(body.force),
      apply: Boolean(body.apply),
      applyPlates: Boolean(body.applyPlates),
    });
    return json(res, 200, { ok: true, report });
  }

  if (rest === '/suggest-plates' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    const v = loadVideo(slug);
    const result = suggestPlates(v);
    if (body.apply) applyPlateSuggestions(v, result.proposals);
    return json(res, 200, { ...result, applied: Boolean(body.apply) });
  }

  if (rest === '/captions' && req.method === 'GET') {
    const { loadVoiceClips } = await import('./captions.mjs');
    const clips = loadVoiceClips(video);
    return json(res, 200, {
      clips,
      srtUrl: existsSync(join(video.out, 'captions', `${slug}.srt`))
        ? `/media/${slug}/captions/${slug}.srt`
        : null,
      vttUrl: existsSync(join(video.out, 'captions', `${slug}.vtt`))
        ? `/media/${slug}/captions/${slug}.vtt`
        : null,
    });
  }

  if (rest === '/captions' && req.method === 'POST') {
    const { writeCaptions } = await import('./captions.mjs');
    const result = writeCaptions(loadVideo(slug));
    return json(res, 200, {
      ok: true,
      cueCount: result.cueCount,
      clips: result.clips,
      srtUrl: `/media/${slug}/captions/${slug}.srt`,
      vttUrl: `/media/${slug}/captions/${slug}.vtt`,
    });
  }

  if (rest === '/qc' && req.method === 'POST') {
    const { runPacingQc } = await import('./pacing.mjs');
    const report = runPacingQc(loadVideo(slug));
    return json(res, 200, { ok: true, report });
  }

  if (rest === '/deliver' && req.method === 'POST') {
    const { deliverPackage } = await import('./deliver.mjs');
    const result = deliverPackage(loadVideo(slug));
    return json(res, 200, {
      ok: true,
      manifest: result.manifest,
      qc: result.qc,
      zip: result.zip || null,
    });
  }

  if (rest === '/poster' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const atSec = Number(body.atSec);
      if (!Number.isFinite(atSec) || atSec < 0) {
        return json(res, 400, { error: 'atSec (seconds) is required' });
      }
      const { setPosterAt } = await import('./deliver.mjs');
      const result = setPosterAt(loadVideo(slug), atSec, { source: 'manual' });
      return json(res, 200, { ok: true, ...result, summary: videoSummary(slug) });
    } catch (err) {
      return json(res, 400, { error: err.message || String(err) });
    }
  }

  if (rest === '/deliverables/zip' && (req.method === 'POST' || req.method === 'GET')) {
    try {
      const { zipDeliverables } = await import('./deliver.mjs');
      const video = loadVideo(slug);
      if (!existsSync(join(video.out, 'deliverables'))) {
        const { deliverPackage } = await import('./deliver.mjs');
        deliverPackage(video);
      }
      const zip = zipDeliverables(loadVideo(slug));
      return json(res, 200, { ok: true, ...zip });
    } catch (err) {
      return json(res, 400, { error: err.message || String(err) });
    }
  }

  if (rest === '/run' && req.method === 'POST') {
    const body = await readBody(req);
    const step = body.step;
    const allowed = new Set([
      'plates',
      'record',
      'produce',
      'audio',
      'music',
      'mix',
      'validate',
      'critic',
      'smoke',
      'captions',
      'qc',
      'deliver',
      'export',
      'guide',
      'adopt-take',
    ]);
    if (!allowed.has(step)) return json(res, 400, { error: 'invalid step' });
    const args = [];
    if (step === 'guide' && body.url) args.push('--url', String(body.url));
    if (step === 'export') {
      const { EXPORT_PRESETS } = await import('./exports.mjs');
      const presets = (Array.isArray(body.presets) ? body.presets : []).filter((id) => EXPORT_PRESETS[id]);
      if (!presets.length) return json(res, 400, { error: 'Pick at least one export preset' });
      args.push('--presets', presets.join(','));
    }
    if (body.force) args.push('--force');
    if (body.headed) args.push('--headed');
    if (step === 'critic' && body.apply) args.push('--apply');
    const job = startKitJob(loadVideo(slug), step, args);
    return json(res, 200, { ok: true, job: jobPayload(job) });
  }

  if (rest === '/improve' && req.method === 'POST') {
    const body = await readBody(req);
    const goal = body.goal || 'full';
    const video = loadVideo(slug);
    let draft = null;
    if (body.snapshot !== false) {
      try {
        draft = snapshotSources(video);
      } catch (err) {
        return json(res, 500, { error: `draft snapshot failed: ${err.message}` });
      }
    }
    const job = startImprove(video, goal, {
      note: body.note,
      force: Boolean(body.force),
      plateId: body.plateId || null,
    });
    return json(res, 200, { ok: true, job, draft });
  }

  if (rest === '/draft-project' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    const brief = readJsonSafe(join(video.dir, 'brief.json'));
    if (body.step === 'discover') {
      const b = brief?.brand || {};
      const site = b.url || brief?.app?.marketingUrl || brief?.app?.appUrl || brief?.app?.startUrl || video.config.record?.startUrl;
      if (!site) return json(res, 400, { error: 'Brief has no brand website or app URL to discover from' });
      // Always read the live product too: its header lockup is often the real mark when the site is a landing page.
      const app = b.appUrl || brief?.app?.appUrl || brief?.app?.startUrl || video.config.record?.startUrl;
      return json(
        res,
        200,
        {
          ok: true,
          job: jobPayload(
            startDiscoverBrand(video, {
              name: b.name || video.config.brand,
              url: site,
              appUrl: app && app !== site ? app : undefined,
              audience: brief?.audience || '',
              force: true,
            })
          ),
        }
      );
    }
    if (body.step === 'analyze') {
      const startUrl = video.config.record?.startUrl || brief?.brand?.appUrl || brief?.brand?.url;
      if (!startUrl) {
        return json(res, 400, { error: 'No start URL to analyze — set record.startUrl or brand.appUrl / brand.url in the brief' });
      }
      return json(res, 200, { ok: true, job: jobPayload(startProductExplore(video, brief)) });
    }
    const readiness = brandReadiness(video.config.brand);
    if (!readiness.ready) {
      return json(res, 409, {
        error: `Brand foundation is not ready. Finish discovery before drafting: ${readiness.issues.join('; ')}`,
        brandReadiness: readiness,
      });
    }
    const branched = Boolean(brief?.branch?.sourceSlug);
    const job = startImprove(video, branched ? 'branch' : 'draft', {
      note: branched ? branchDraftNote(brief, { sourceSlug: brief.branch.sourceSlug }) : draftNote(brief),
    });
    return json(res, 200, { ok: true, job: jobPayload(job) });
  }

  if (rest === '/guide' && req.method === 'GET') {
    return json(res, 200, { captureMode: captureModeOf(readJsonSafe(join(video.dir, 'brief.json'))), tour: guidedTourSummary(video) });
  }

  if (rest === '/guide/finish' && req.method === 'POST') {
    requestGuideFinish(video);
    return json(res, 200, { ok: true });
  }

  if (rest === '/guide/control' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    try {
      requestGuideControl(video, String(body.action || ''), { title: body.title });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
    return json(res, 200, { ok: true });
  }

  if (rest === '/capture-mode' && req.method === 'PUT') {
    const body = await readBody(req).catch(() => ({}));
    const mode = body.mode === 'guided' ? 'guided' : body.mode === 'agent' ? 'agent' : null;
    if (!mode) return json(res, 400, { error: 'mode must be agent or guided' });
    const path = join(video.dir, 'brief.json');
    const brief = readJsonSafe(path) || {};
    brief.capture = { ...(brief.capture || {}), mode };
    writeFileSync(path, JSON.stringify(brief, null, 2) + '\n');
    return json(res, 200, { ok: true, captureMode: mode });
  }

  if (rest === '/analyze' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    const brief = readJsonSafe(join(video.dir, 'brief.json'));
    if (body.guided || (body.guided !== false && captureModeOf(brief) === 'guided' && body.explore !== false && !body.headed)) {
      return json(res, 200, { ok: true, job: jobPayload(startKitJob(video, 'guide', body.url ? ['--url', String(body.url)] : [])) });
    }
    if (body.explore !== false && !body.url && !body.headed) {
      return json(res, 200, { ok: true, job: jobPayload(startProductExplore(video, brief, { guided: false })) });
    }
    const args = [];
    if (body.explore !== false) args.push('--explore');
    if (body.url) args.push('--url', String(body.url));
    if (body.headed) args.push('--headed');
    return json(res, 200, { ok: true, job: jobPayload(startKitJob(video, 'analyze', args)) });
  }

  if (rest === '/scenes' && req.method === 'GET') {
    return json(res, 200, { scenes: listScenes(video) });
  }

  const sceneImprove = rest.match(/^\/scenes\/([^/]+)\/improve$/);
  if (sceneImprove && req.method === 'POST') {
    const plateId = decodeURIComponent(sceneImprove[1]);
    const body = await readBody(req).catch(() => ({}));
    const scenes = listScenes(video);
    const scene = scenes.find((s) => s.plateId === plateId || s.id === plateId);
    if (!scene || !scene.editable) {
      return json(res, 400, { error: 'Only brand plates can be improved as HTML scenes' });
    }
    let draft = null;
    try {
      draft = snapshotSources(video);
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
    const note =
      body.note ||
      `Improve the "${scene.title}" plate (id ${scene.plateId}). Make it clearer and on-brand.`;
    const job = startImprove(video, body.goal === 'motion' ? 'motion' : 'scene', {
      note,
      plateId: scene.plateId,
      force: Boolean(body.force),
    });
    return json(res, 200, { ok: true, job, draft, scene });
  }

  const sceneRender = rest.match(/^\/scenes\/([^/]+)\/render$/);
  if (sceneRender && req.method === 'POST') {
    const plateId = decodeURIComponent(sceneRender[1]);
    const scenes = listScenes(video);
    const scene = scenes.find((s) => s.plateId === plateId || s.id === plateId);
    if (!scene?.renderOnly) {
      return json(res, 400, { error: 'Unknown plate scene' });
    }
    const body = await readBody(req).catch(() => ({}));
    // Rebuild HTML then encode just this plate
    try {
      buildPlates(loadVideo(slug));
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
    const onlyArg = scene.renderOnly.startsWith('plate:')
      ? scene.renderOnly.replace(/^plate:/, '')
      : scene.renderOnly;
    const job = startKitJob(loadVideo(slug), 'plates', [
      '--force',
      '--only',
      onlyArg,
    ]);
    return json(res, 200, { ok: true, job, scene, scope: body.scope || 'plate' });
  }

  if (rest === '/plates' && req.method === 'GET') {
    return json(res, 200, {
      plates: listProgramCards(video),
      motion: resolveMotion(video.brand),
      overlays: resolveOverlays(video.brand, video.brand.direction || {}),
    });
  }

  if (rest === '/plates/rebuild-html' && req.method === 'POST') {
    try {
      return json(res, 200, rebuildPlateHtml(slug));
    } catch (err) {
      return json(res, 500, { error: err.message || String(err) });
    }
  }

  const plateCopy = rest.match(/^\/plates\/([^/]+)\/copy$/);
  if (plateCopy && req.method === 'POST') {
    const plateId = decodeURIComponent(plateCopy[1]);
    try {
      const body = await readBody(req);
      const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
      if (!Object.keys(fields).length) {
        return json(res, 400, { error: 'No fields to save' });
      }
      snapshotSources(loadVideo(slug));
      if (parseCardId(plateId)) {
        await saveLiveCardCopy(loadVideo(slug), plateId, fields);
      } else {
        savePlateCopy(loadVideo(slug), plateId, fields);
      }
      const rebuilt = rebuildPlateHtml(slug);
      return json(res, 200, { ok: true, plateId, saved: Object.keys(fields).length, ...rebuilt });
    } catch (err) {
      return json(res, 400, { error: err.message || String(err) });
    }
  }

  if (rest === '/draft/snapshot' && req.method === 'POST') {
    return json(res, 200, { ok: true, draft: snapshotSources(video) });
  }

  if (rest === '/draft/changes' && req.method === 'GET') {
    return json(res, 200, { ok: true, ...draftChanges(video) });
  }

  if (rest === '/draft/discard' && req.method === 'POST') {
    try {
      const result = discardDraft(video);
      const rebuilt = rebuildPlateHtml(slug);
      return json(res, 200, { ...result, ...rebuilt });
    } catch (err) {
      return json(res, 400, { error: err.message || String(err) });
    }
  }

  if (rest === '/draft/approve' && req.method === 'POST') {
    // Keep current sources; clear draft marker by rewriting meta as approved
    const dir = draftDir(video);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({ approvedAt: new Date().toISOString(), slug, status: 'approved' }, null, 2)
    );
    return json(res, 200, { ok: true, approved: true });
  }

  if (rest === '/snapshot-after-audio' && req.method === 'POST') {
    const entry = snapshotVersion(loadVideo(slug), {
      trigger: 'post-audio',
      kind: 'checkpoint',
      title: 'Audio mix',
      note: 'studio',
    });
    return json(res, 200, { ok: true, version: entry });
  }

  return json(res, 404, { error: 'unknown api route' });
}

function serveMedia(req, res, url) {
  // /media/<slug>/... under OUT_ROOT/<slug>/
  // /version-media/<slug>/<id>/... under versions
  const m = url.pathname.match(/^\/media\/([^/]+)\/(.+)$/);
  const vm = url.pathname.match(/^\/version-media\/([^/]+)\/([^/]+)\/(.+)$/);
  let file;
  try {
    if (vm) {
      const video = loadVideo(decodeURIComponent(vm[1]));
      file = versionMediaPath(video, vm[2], vm[3]);
    } else if (m) {
      const slug = decodeURIComponent(m[1]);
      const voiceFile = m[2].match(/^voice-file\/(\d+)$/);
      if (voiceFile) {
        const video = loadVideo(slug);
        const meta = readJsonSafe(join(video.out, 'voice', 'voice.json'));
        const clip = meta?.clips?.[Number(voiceFile[1])];
        const full = clip?.file ? resolve(clip.file) : '';
        const root = resolve(OUT_ROOT);
        if (!full.startsWith(root + '/') && !full.startsWith(resolve(video.out) + '/')) {
          json(res, 404, { error: 'missing' });
          return true;
        }
        file = full;
      } else file = safeUnder(join(OUT_ROOT, slug), m[2]);
    } else {
      return false;
    }
  } catch {
    json(res, 400, { error: 'bad path' });
    return true;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    json(res, 404, { error: 'missing' });
    return true;
  }
  const mime = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  const st = statSync(file);
  if (mime.startsWith('video/') && req.headers.range) {
    const range = req.headers.range;
    const m2 = /bytes=(\d+)-(\d*)/.exec(range);
    const start = Number(m2[1]);
    const end = m2[2] ? Number(m2[2]) : st.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${st.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': mime,
    });
    createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  const headers = {
    'Content-Type': mime,
    'Content-Length': st.size,
    'Accept-Ranges': 'bytes',
  };
  // Force download for handoff zips (or any ?download=1)
  if (extname(file).toLowerCase() === '.zip' || url.searchParams?.get('download') === '1') {
    headers['Content-Disposition'] = `attachment; filename="${basename(file)}"`;
  }
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
  return true;
}

function serveStatic(req, res, url, { dev = false } = {}) {
  let rel = url.pathname === '/' ? '/index.html' : url.pathname;
  if (rel.includes('..')) {
    res.writeHead(400);
    res.end('bad');
    return true;
  }
  const file = join(STUDIO_DIR, rel.replace(/^\//, ''));
  if (!existsSync(file) || !file.startsWith(STUDIO_DIR)) return false;
  const mime = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  const raw = readFileSync(file);
  const payload = dev && /\.html?$/i.test(file) ? Buffer.from(injectDevClient(raw.toString('utf8'))) : raw;
  const fresh = dev || /\.(html|js|css|mjs|svg)$/i.test(file);
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': payload.length,
    'Cache-Control': fresh ? 'no-store' : 'public, max-age=3600',
  });
  res.end(payload);
  return true;
}

export async function startStudio({ port = 4747, openSlug = null, dev = false } = {}) {
  // Surface fatal async failures — otherwise a rejected promise can kill the process with no log.
  if (!globalThis.__wtStudioHandlers) {
    globalThis.__wtStudioHandlers = true;
    process.on('uncaughtException', (err) => console.error('Studio uncaughtException', err));
    process.on('unhandledRejection', (err) => console.error('Studio unhandledRejection', err));
  }

  const devHub = dev ? createDevHub({ studioDir: STUDIO_DIR, kitDir: join(STUDIO_DIR, '..') }) : null;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      if (devHub && (await devHub.handle(req, res, url))) return;
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      if (url.pathname.startsWith('/media/') || url.pathname.startsWith('/version-media/')) {
        if (serveMedia(req, res, url)) return;
      }
      if (serveStatic(req, res, url, { dev: Boolean(devHub) })) return;
      res.writeHead(404);
      res.end('Not found');
    } catch (err) {
      console.error(err);
      if (!res.headersSent) json(res, 500, { error: err.message || String(err) });
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${port}/${openSlug ? `?slug=${encodeURIComponent(openSlug)}` : ''}`;
  const agent = agentAuthStatus();
  console.log(`✓ Walkthrough Studio → ${url}`);
  console.log(`  agent CLI: ${formatAgentBanner(agent)}`);
  console.log(`  videos: ${listVideos().join(', ') || '(none)'} · out: ${OUT_ROOT}`);
  return { server, url };
}

/**
 * What the explore agent has seen so far, shaped for the New video creation
 * view: every screen it reached, the newest screenshot of each, the moves
 * between them and the notes it took. Reads only files the browse session
 * already writes (`browse/map.json`, `browse/shots/NNN-S#.jpg`).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** A screencast frame older than this is a finished take, not a live view. */
export const LIVE_PREVIEW_FRESH_MS = 20_000;
const MAX_MOVES = 40;
const MAX_NOTES = 12;
const SHOT_RE = /^(\d+)-(S\d+)\.jpg$/;

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const mediaUrl = (slug, rel, mtime) => `/media/${encodeURIComponent(slug)}/${rel}?v=${Math.round(mtime)}`;

/** Newest shot per screen id, plus how many were taken in total. */
export function latestShots(files = []) {
  const byScreen = new Map();
  let total = 0;
  for (const file of files) {
    const m = String(file).match(SHOT_RE);
    if (!m) continue;
    total += 1;
    const n = Number(m[1]);
    const prev = byScreen.get(m[2]);
    if (!prev || prev.n < n) byScreen.set(m[2], { n, file });
  }
  return { byScreen, total };
}

const clip = (text, max) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** Page titles often end in " | Brand" or " – Brand"; the part before reads better on a card. */
export function screenLabel(screen = {}) {
  const head = clip(screen.title || '', 120).split(/\s+[|–—·-]\s+/)[0]?.trim() || screen.headings?.[0] || '';
  const dialog = clip(screen.dialog || '', 60);
  if (dialog) return head ? `${head} · ${dialog}` : dialog;
  return head || screen.path || screen.id || '';
}

/**
 * @param {{ slug: string, out: string }} video
 * @param {{ now?: number }} [opts]
 */
export function exploreFeed(video, { now = Date.now() } = {}) {
  const dir = join(video.out, 'browse');
  const map = readJson(join(dir, 'map.json'));
  const shotsDir = join(dir, 'shots');
  let shotFiles = [];
  try {
    shotFiles = existsSync(shotsDir) ? readdirSync(shotsDir) : [];
  } catch {
    shotFiles = [];
  }
  const { byScreen, total } = latestShots(shotFiles);
  const shotUrl = (id) => {
    const hit = byScreen.get(id);
    if (!hit) return null;
    try {
      return mediaUrl(video.slug, `browse/shots/${hit.file}`, statSync(join(shotsDir, hit.file)).mtimeMs);
    } catch {
      return null;
    }
  };

  const screens = (map?.screens || []).map((s) => ({
    id: s.id,
    label: screenLabel(s),
    title: clip(s.title, 140),
    url: s.url || '',
    path: s.path || '',
    dialog: s.dialog || null,
    heading: clip(s.headings?.[0], 140),
    reachedBy: s.reachedBy ? { from: s.reachedBy.from || null, action: s.reachedBy.action || '', label: clip(s.reachedBy.label, 60) } : null,
    controls: s.controls || 0,
    tried: s.tried?.length || 0,
    shot: shotUrl(s.id),
  }));

  let preview = null;
  const live = join(video.out, 'live-preview.jpg');
  try {
    const t = statSync(live).mtimeMs;
    if (now - t < LIVE_PREVIEW_FRESH_MS) preview = mediaUrl(video.slug, 'live-preview.jpg', t);
  } catch {
    /* no screencast running */
  }

  return {
    startedAt: map?.startedAt || null,
    signedIn: Boolean(map?.signedIn),
    current: map?.current || null,
    screens,
    moves: (map?.moves || []).slice(-MAX_MOVES).map((m) => ({ at: m.at || null, from: m.from || null, action: m.action || '', label: clip(m.label, 60) })),
    notes: (map?.notes || [])
      .slice(-MAX_NOTES)
      .map((n) => ({ screen: typeof n === 'string' ? null : n?.screen || null, text: clip(typeof n === 'string' ? n : n?.text || n?.note || '', 220) }))
      .filter((n) => n.text),
    shots: total,
    preview,
  };
}

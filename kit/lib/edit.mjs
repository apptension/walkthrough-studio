/**
 * Edit plan: open → live slices interleaved with interstitial plates → close.
 * Interstitials in video.config.json:
 *   { "id": "capabilities", "type": "features"|"stats"|"callout", "before": "<chapter title>", ... }
 * `before` inserts the plate immediately before that chapter starts on the live reel.
 *
 * Joins overlap (xfade) instead of dipping through black, so every segment carries:
 *   at            delivery start (seconds, frame-snapped)
 *   transitionIn  { type, xfade, dur } for the join from the previous segment (null on the first)
 * A live slice that opens on a chapter card right after a plate starts once the card's backdrop
 * covers the UI, so the plate dissolves straight into the card — no flash of raw UI between them.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { keyCardMarks, loadRawTimeline } from './cardMarks.mjs';
import { duration } from './media.mjs';
import { FPS } from './motion.mjs';
import { platePaths } from './plates.mjs';
import { takeSpace } from './stage.mjs';
import { extendCloseForVoice, narrationSeconds, outroFromNarrationSource } from '../studio/voiceHold.js';
import {
  applyCardEdits,
  applySegmentCuts,
  applySegmentOmit,
  applySegmentOrder,
  applySegmentRepeats,
  applySegmentTrims,
  joinKey,
  liveTimeMap,
  normalizeEdit,
  remapTimeline,
} from './editDeck.mjs';

/** Trim a beat before the chapter so the outgoing slice never ends on the incoming slice's first frame. */
const PRE_ROLL = 0.12;
/** Chapter card backdrop (motion.mjs `.wt-ch .dim`, 0.55s in-out) is ~98% opaque here. */
const CARD_COVER = 0.48;
/** A chapter mark this close to a slice start counts as "the slice opens on a card". */
const CARD_AT_START = 0.6;
/** Plate exits run from `--black-out` and are fully clear this much later (verified on every template). */
const EXIT_CLEAR = 0.32;
/**
 * Live peeks shorter than this (common: recorder pre-roll before chapter 1 when an interstitial
 * is `before` that chapter) read as a frozen product still — drop them so open dissolves into the plate.
 */
const MIN_LIVE_SLICE = 2.0;

export const TRANSITION_STYLES = Object.freeze({
  directed: {
    label: 'Directed',
    xfade: null,
    hint: 'Chooses a restrained transition for each type of hand-off',
  },
  dissolve: { label: 'Dissolve', xfade: 'fade', hint: 'Soft continuity between every scene' },
  wipe: { label: 'Brand wipe', xfade: 'smoothleft', hint: 'A polished directional reveal' },
  push: { label: 'Push', xfade: 'slideleft', hint: 'The next scene moves the story forward' },
  // Rendered by the camera (lanczos cross zoom with shutter blur) under a dissolve — see camera.crossZoomGraph.
  zoom: { label: 'Focus zoom', xfade: 'fade', motion: 'crosszoom', hint: 'Pulls attention into the next scene' },
  iris: { label: 'Iris', xfade: 'circleopen', hint: 'A cinematic circular reveal' },
  blur: { label: 'Blur', xfade: 'hblur', hint: 'Defocuses one idea before resolving the next' },
  dip: { label: 'Dip to black', xfade: 'fadeblack', hint: 'A deliberate chapter break' },
  radial: { label: 'Radial', xfade: 'radial', hint: 'A clock-hand sweep that reveals the next scene' },
  slice: { label: 'Slice', xfade: 'hlslice', hint: 'Horizontal slats peel the scene away' },
  diagonal: { label: 'Diagonal', xfade: 'diagtl', hint: 'A corner-to-corner reveal with real momentum' },
});

const snap = (s) => Math.round(s * FPS) / FPS;

/**
 * xfade arguments for a style's transition. A plain `fade` mixes linearly, which reads as a
 * sudden start and a lingering ghost at the end; the dissolve instead follows a smootherstep so
 * it eases in and out of the mix — the same curve the Studio stage previews. `P` runs 1 → 0.
 *
 * No st()/ld() registers: xfade evaluates one expression on every slice thread at once and the
 * registers are shared, so a pixel could read another row's half-computed weight. Weights far
 * outside 0–1 turned small dark differences into white speckle across the dissolve.
 */
const SMOOTHERSTEP_1_MINUS_P = '(1-P)*(1-P)*(1-P)*((1-P)*((1-P)*6-15)+10)';

export function xfadeArgs(xfade) {
  if (xfade === 'fade') {
    return `transition=custom:expr='A+(B-A)*${SMOOTHERSTEP_1_MINUS_P}'`;
  }
  return `transition=${xfade}`;
}

/** Brand default (brand.json → motion.transitions) overridden per video (video.config.json → transitions). */
export function resolveTransitions(video) {
  const merged = {
    style: 'directed',
    duration: 0.6,
    ...(video.brand?.motion?.transitions || {}),
    ...(video.config?.transitions || {}),
  };
  const style = TRANSITION_STYLES[merged.style] ? merged.style : 'directed';
  const dur = Math.min(1.2, Math.max(0.2, Number(merged.duration) || 0.6));
  return { style, duration: snap(dur), xfade: TRANSITION_STYLES[style].xfade };
}

/**
 * Directed mode uses editing intent rather than repeating one effect at every join. Product UI
 * remains legible: chapter cards dissolve, proof plates reveal, and the close gets a firm break.
 */
export function transitionFor(style, prev, next) {
  if (style !== 'directed') return style;
  if (next.id === 'close') return 'dip';
  if (prev.id === 'open') return next.kind === 'live' ? 'zoom' : 'dissolve';
  if (prev.kind === 'live' && next.kind === 'plate') return 'wipe';
  if (prev.kind === 'plate' && next.kind === 'live') return 'dissolve';
  return 'dissolve';
}

/** The recording's marks as captured (live.mp4 clock). */
export { loadRawTimeline };

/** The editor deck (video.config → edit), validated against this recording. */
export function resolveEdit(video, { liveDur = Infinity } = {}) {
  // Edit zooms and lenses live in the take's CSS px, like the recorded marks.
  const space = takeSpace(video);
  return normalizeEdit(video.config?.edit, {
    liveDur,
    width: space.cssW,
    height: space.cssH,
    styles: TRANSITION_STYLES,
  });
}

/** Clock between live.mp4 and the cleaned reel once the deck's speed ramps are applied. */
export function resolveLiveMap(video, liveDur) {
  return liveTimeMap(resolveEdit(video, { liveDur }).speed, liveDur);
}

/**
 * Timeline marks on the cleaned reel's clock — what every stage after prepareLive reasons in.
 * Without speed ramps this is the raw timeline.
 */
export function loadTimeline(video) {
  const raw = loadRawTimeline(video);
  const LIVE = join(video.out, 'live.mp4');
  if (!raw.length || !existsSync(LIVE)) return raw;
  const map = resolveLiveMap(video, duration(LIVE));
  return remapTimeline(raw, map);
}

/**
 * A live slice that cuts to a plate right after a page navigation would show the new, half-loaded
 * page for a beat and then dissolve away — reads as a glitch. When a hard scene change lands in the
 * last SETTLE_WINDOW seconds, end the slice on the frame before it.
 * Cached per (live.mp4 mtime, cut) in edit-trims.json — buildEditPlan stays cheap.
 */
const SETTLE_WINDOW = 1.2;
const SCENE_CUT_SCORE = 20;
function settledEnd(video, livePath, start, end, map = null) {
  // Times arrive on the cleaned clock; the probe reads the recording, so convert both ways.
  if (map && !map.identity) {
    const out = settledEnd(video, livePath, map.fromClean(start), map.fromClean(end));
    return snap(map.toClean(out));
  }
  const cachePath = join(video.out, 'edit-trims.json');
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  const keyId = `${Math.round(statSync(livePath).mtimeMs)}:${end.toFixed(3)}`;
  if (cache[keyId] != null) return cache[keyId];
  const from = Math.max(start, end - SETTLE_WINDOW);
  const r = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-nostats', '-ss', from.toFixed(3), '-t', (end - from).toFixed(3), '-i', livePath,
      '-vf', `fps=${FPS},scale=320:180,scdet=threshold=${SCENE_CUT_SCORE},metadata=print:key=lavfi.scd.score:file=-`,
      '-f', 'null', '-',
    ],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  );
  const scores = [...(r.stdout || '').matchAll(/lavfi\.scd\.score=([\d.]+)/g)].map((m) => Number(m[1]));
  let out = end;
  for (let i = scores.length - 1; i > 0; i--) {
    if (scores[i] >= SCENE_CUT_SCORE) {
      const t = snap(from + (i - 1) / FPS);
      if (t - start > 2) out = t;
      break;
    }
  }
  cache[keyId] = out;
  writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  return out;
}

/** Seconds into a plate after which only the brand background remains (exits done). */
function plateClearAt(htmlPath, dur) {
  if (!htmlPath || !existsSync(htmlPath)) return Math.max(0, dur - 0.4);
  const m = readFileSync(htmlPath, 'utf8').match(/--black-out:\s*([\d.]+)s/);
  const blackOut = m ? Number(m[1]) : dur - 0.7;
  return Math.min(dur, blackOut + EXIT_CLEAR);
}

function chapterTime(timeline, title) {
  const m = timeline.find((e) => e.kind === 'chapter' && e.label === title);
  if (!m) throw new Error(`interstitial before "${title}" — no chapter with that title in timeline.json`);
  return m.t;
}

/**
 * Break a live slice at chapter marks so each chapter is a named, reorderable section
 * (same order/omit machinery as plates). Captions stay as marks on those slices.
 */
function splitLiveAtChapters(seg, chapters) {
  const inside = (chapters || [])
    .filter((c) => c.t >= seg.start - 0.02 && c.t < seg.end - 0.35)
    .slice()
    .sort((a, b) => a.t - b.t);
  if (!inside.length) return [seg];
  const out = [];
  let cursor = seg.start;
  for (let i = 0; i < inside.length; i++) {
    const ch = inside[i];
    const chStart = snap(ch.t);
    const nextT = i + 1 < inside.length ? snap(inside[i + 1].t) : seg.end;
    // Lead-in before the chapter (keep if it has real duration).
    if (chStart > cursor + 0.35) {
      out.push({ kind: 'live', start: cursor, end: chStart });
      cursor = chStart;
    }
    const start = cursor < chStart ? cursor : chStart;
    out.push({
      kind: 'live',
      start,
      end: nextT,
      opensOnCard: ch.label,
      title: ch.label,
    });
    cursor = nextT;
  }
  if (cursor < seg.end - 0.05) out.push({ kind: 'live', start: cursor, end: seg.end });
  return out.length ? out : [seg];
}

/**
 * @returns {{
 *   segments: Array<{kind:'plate'|'live', id:string, file?:string, start?:number, end?:number, dur:number,
 *     at:number, title?:string, transitionIn: null | {type:string, xfade:string, dur:number, card?:boolean}}>,
 *   liveToDelivery: (liveT:number)=>number,
 *   deliveryToLive: (delT:number)=>number|null,
 *   total: number,
 *   dOpen: number,
 *   dLive: number,
 *   dClose: number,
 *   transitions: {style:string, duration:number, xfade:string},
 * }}
 */
export function buildEditPlan(video) {
  const paths = platePaths(video);
  const LIVE = join(video.out, 'live.mp4');
  if (!existsSync(paths.open.mp4) || !existsSync(paths.close.mp4)) {
    throw new Error(`Render plates first: node cli.mjs plates ${video.slug}`);
  }
  if (!existsSync(LIVE)) throw new Error(`Missing live reel — run: node cli.mjs record ${video.slug}`);

  const transitions = resolveTransitions(video);
  const openDur = snap(duration(paths.open.mp4));
  const liveDurRaw = duration(LIVE);
  const deck = resolveEdit(video, { liveDur: liveDurRaw });
  const liveMap = liveTimeMap(deck.speed, liveDurRaw);
  // Speed ramps shorten (or stretch) the reel: plan on the cleaned clock.
  const dLive = snap(liveMap.cleanDur);
  const closeDur = snap(duration(paths.close.mp4));
  // Editor timeline moves (`edit.cards`) shift chapter/caption marks before we split sections.
  const rawMarks = applyCardEdits(keyCardMarks(loadRawTimeline(video)), deck.cards);
  const timeline = remapTimeline(rawMarks, liveMap);
  // A duplicated chapter card shows again; it does not start a new section.
  const chapters = timeline.filter((m) => m.kind === 'chapter' && !m.copyOf);

  const interstitials = [...(video.config.interstitials || [])].map((it) => {
    if (!it.id || !it.type || !it.before) {
      throw new Error('Each interstitial needs id, type, and before (chapter title)');
    }
    const at = chapterTime(timeline, it.before);
    const file = paths.interstitial[it.id]?.mp4;
    if (!file || !existsSync(file)) {
      throw new Error(`Missing interstitial plate for "${it.id}" — run: node cli.mjs plates ${video.slug}`);
    }
    const dur = snap(duration(file));
    return { ...it, liveAt: at, file, dur, clearAt: plateClearAt(paths.interstitial[it.id].html, dur) };
  });
  interstitials.sort((a, b) => a.liveAt - b.liveAt || a.id.localeCompare(b.id));

  const raw = [];
  raw.push({
    kind: 'plate',
    id: 'open',
    file: paths.open.mp4,
    dur: openDur,
    clearAt: plateClearAt(paths.open.html, openDur),
    title: 'Introduction',
  });
  let cursor = 0;
  for (const it of interstitials) {
    const cut = snap(Math.max(cursor, it.liveAt - PRE_ROLL));
    if (cut > cursor + 0.05) {
      const end = settledEnd(video, LIVE, cursor, cut, liveMap);
      // Skip micro-peeks (e.g. 0.9s recorder lead-in on the landing CTA) — they freeze on one UI frame.
      if (end - cursor >= MIN_LIVE_SLICE) {
        raw.push({ kind: 'live', start: cursor, end, ...(end < cut ? { settledFrom: cut } : {}) });
      }
    }
    raw.push({
      kind: 'plate',
      id: it.id,
      file: it.file,
      dur: it.dur,
      clearAt: it.clearAt,
      title: it.title || it.id,
      interstitial: true,
      type: it.type,
    });
    cursor = snap(it.liveAt);
  }
  if (cursor < dLive - 0.05) raw.push({ kind: 'live', start: cursor, end: dLive });
  raw.push({ kind: 'plate', id: 'close', file: paths.close.mp4, dur: closeDur, title: 'Summary' });

  // Split live slices at chapter marks so each chapter is its own rearrangeable section on the cut.
  const split = [];
  for (const seg of raw) {
    if (seg.kind !== 'live') {
      split.push(seg);
      continue;
    }
    split.push(...splitLiveAtChapters(seg, chapters));
  }
  raw.length = 0;
  raw.push(...split);

  // Live slices that open on a chapter card right after a plate: skip the card's fade-in over UI.
  for (let i = 1; i < raw.length; i++) {
    const seg = raw[i];
    if (seg.kind !== 'live' || raw[i - 1].kind !== 'plate') continue;
    const card = chapters.find((m) => m.t >= seg.start - 0.02 && m.t <= seg.start + CARD_AT_START);
    if (!card) continue;
    const start = snap(card.t + CARD_COVER);
    if (start < seg.end - 1) {
      seg.start = start;
      seg.opensOnCard = card.label;
      seg.title = card.label;
    }
  }
  for (const seg of raw) {
    if (seg.kind === 'live') {
      seg.start = snap(seg.start);
      seg.end = snap(seg.end);
      seg.dur = snap(seg.end - seg.start);
      // Id from recording clock so Editor omit/trim keys survive speed ramps.
      const recStart = liveMap.fromClean ? liveMap.fromClean(seg.start) : seg.start;
      seg.id = `live-${Number(recStart).toFixed(2)}`;
    }
  }
  const replayed = applySegmentRepeats(raw, deck.repeats);
  raw.length = 0;
  raw.push(...replayed);

  // The editor's sequence (edit.order) plays these same slices in a different order.
  // Overlapping joins. An outgoing plate transitions only once its exits are clear: when its clean
  // tail is shorter than the transition, its last frame is held (padOut, applied as tpad in produce).
  // edit.trims are recording-clock seconds; plan slices are on the cleaned reel.
  const trimsClean = (deck.trims || []).map((t) => {
    const seg = raw.find((s) => s.id === t.id && s.kind === 'live');
    if (!seg) return t;
    const recFrom = liveMap.fromClean(seg.start);
    const recTo = liveMap.fromClean(seg.end);
    const head = Number(t.trimStart) || 0;
    const tail = Number(t.trimEnd) || 0;
    const cleanHead = snap(Math.max(0, liveMap.toClean(recFrom + head) - seg.start));
    const cleanTail = snap(Math.max(0, seg.end - liveMap.toClean(Math.max(recFrom, recTo - tail))));
    return {
      id: t.id,
      ...(cleanHead ? { trimStart: cleanHead } : {}),
      ...(cleanTail ? { trimEnd: cleanTail } : {}),
    };
  });
  const segments = applySegmentCuts(
    applySegmentTrims(applySegmentOmit(applySegmentOrder(raw, deck.order), deck.omit), trimsClean),
    deck.cuts,
    liveMap
  ).map((seg) => ({
    ...seg,
    baseDur: seg.dur,
    padOut: 0,
  }));
  segments[0].at = 0;
  segments[0].transitionIn = null;
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const seg = segments[i];
    const cap = Math.min(prev.kind === 'live' ? prev.dur / 3 : Infinity, seg.kind === 'live' ? seg.dur / 3 : seg.dur / 3);
    if (seg.opensOnCard && prev.kind !== 'plate') delete seg.opensOnCard;
    const card = Boolean(seg.opensOnCard);
    // The editor can pin one join (edit.transitions["prev>next"]); otherwise the video's style decides.
    const key = joinKey(prev, seg);
    const pinned = seg.hardCut ? null : deck.transitions[key] || null;
    const style = pinned?.style || transitions.style;
    const wantDur = pinned?.duration != null ? snap(pinned.duration) : transitions.duration;
    // A cut inside the recording is a straight join — one frame, not the scene transition.
    const hard = Boolean(seg.hardCut) && prev.kind === 'live';
    const dur = hard ? snap(1 / FPS) : snap(Math.max(1 / FPS, Math.min(wantDur, cap)));
    if (prev.kind === 'plate' && prev.clearAt != null) {
      prev.padOut = snap(Math.max(0, prev.clearAt + dur - prev.baseDur));
      prev.dur = snap(prev.baseDur + prev.padOut);
    }
    // Dark plate → dark chapter card always dissolves; movement reads as noise between two dark frames.
    const selected = transitionFor(style, prev, seg);
    const type = card && selected !== 'dip' && !pinned?.style ? 'dissolve' : selected;
    seg.at = snap(prev.at + prev.dur - dur);
    seg.join = key;
    seg.transitionIn = {
      type,
      xfade: TRANSITION_STYLES[type].xfade,
      ...(TRANSITION_STYLES[type].motion && !hard ? { motion: TRANSITION_STYLES[type].motion } : {}),
      dur,
      ...(card ? { card: true } : {}),
      ...(pinned ? { pinned: true } : {}),
    };
  }
  const lastSeg = segments[segments.length - 1];
  const at = lastSeg.at + lastSeg.dur;
  const total = snap(at);
  const lives = segments.filter((s) => s.kind === 'live');
  const openSeg = segments.find((s) => s.id === 'open') || segments[0];
  const closeSeg = segments.find((s) => s.id === 'close') || segments[segments.length - 1];
  const openIdx = segments.indexOf(openSeg);
  const openNext = segments[openIdx + 1];
  const openAt = openSeg.at;
  const openYield = openNext ? openNext.at : openAt + openSeg.dur;
  const closeAt = closeSeg.at;
  const closeIsLast = segments[segments.length - 1] === closeSeg;

  // Recording time maps to whichever slice contains it, so a reordered cut still
  // puts a chapter on the slice it was recorded in.
  const byRec = [...lives].sort((a, b) => a.start - b.start);
  const byDelivery = [...lives].sort((a, b) => a.at - b.at);
  const liveToDelivery = (liveT) => {
    for (const s of byRec) {
      if (liveT < s.start) return s.at;
      if (liveT <= s.end) return s.at + (liveT - s.start);
    }
    const last = byRec[byRec.length - 1];
    return last ? last.at + last.dur : segments[0].dur;
  };
  const deliveryToLive = (delT) => {
    for (const s of byDelivery) {
      if (delT >= s.at && delT < s.at + s.dur) return s.start + (delT - s.at);
    }
    return null;
  };

  const plan = {
    segments,
    liveToDelivery,
    deliveryToLive,
    total,
    /**
     * Where the open plate yields to the next segment (live or interstitial).
     * Prefer segments[1].at over first live — when a short peek is dropped, open dissolves
     * straight into the first interstitial and intro VO must still end on the open plate.
     */
    dOpen: openIdx === 0 ? openYield : openSeg.dur,
    dLive,
    /** Close plate span counted from its first (overlapping) frame, when it ends the cut. */
    dClose: closeIsLast ? snap(total - closeAt) : closeSeg.dur,
    openAt,
    openYield,
    closeAt,
    closeDur: closeIsLast ? snap(total - closeAt) : closeSeg.dur,
    interstitials: segments
      .filter((s) => s.interstitial)
      .map((s) => ({ ...interstitials.find((it) => it.id === (s.repeatOf || s.id)), id: s.id, at: s.at, dur: s.dur })),
    timeline,
    transitions,
    /** The editor deck this plan honoured, plus the live↔clean clock. */
    edit: deck,
    liveMap,
  };
  try {
    const narrationPath = video?.dir ? join(video.dir, 'narration.mjs') : '';
    if (narrationPath && existsSync(narrationPath)) {
      const spoken = narrationSeconds(outroFromNarrationSource(readFileSync(narrationPath, 'utf8')));
      extendCloseForVoice(plan, spoken);
    }
  } catch {
    /* A narration file that is not a single literal keeps the plate length. The editor still warns. */
  }
  return plan;
}

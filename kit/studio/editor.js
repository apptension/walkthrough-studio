/**
 * Studio Editor — the cut as one timeline. Plates and live slices sit on the clips track;
 * chapter cards and captions each get their own row; speed, zoom, cuts, voice and music
 * sit under those. Overlapping blocks on a row stack into sub-lanes instead of painting
 * on top of each other. One playhead, one transport. Playback runs the whole
 * cut on one clock: plates are stepped frame by frame through their own animation runtime, the
 * recording plays at the ramped rate with the planned push-ins, and joins preview their
 * transition. Everything it writes lands in video.config.json through /edit, /overlays and
 * /plates/:id/style, which `produce` reads back, so what plays here is what renders.
 *
 * Effect times are in the recording's clock (live.mp4). The deck's `pieces` map them onto the
 * cleaned reel; the clip layout is rebuilt from the current deck after every edit.
 */

import { createAudioPreview } from './audioPreview.js';
import {
  canReloadPlateFrame,
  capturePlayheadAnchor,
  plateClipFor,
  joinFrameOwner,
  liveRecDiscontinuous,
  playheadOnPlate,
  previewClockMs,
  restorePlayheadAnchor,
  shouldBlacklistPlateLoad,
  shouldParkPlayheadAtClipStart,
  soloJoinFocus,
  stagePointerOwner,
} from './plateSync.js';
import { FRAME_EDITOR_HIT, lensLoupe, lensZoomCeiling, planAfterSeeked, planFrameEditor, planLensPaint, planLiveSeek } from './livePreview.js';
import { clampZoomCenter, zoomPreviewStyle } from './zoomAim.js';
import { curveOf, minJerk } from './easing.js';
import { GLASS, glassProfile, glassShade, lensOpenState, rimWidth } from './lensGlass.js';
import { narratorKeyNote } from './narratorNote.js';
import { applyCardMotionToDocument } from './cardMotion.js';
import {
  cardEditLandingEd,
  cardElapsedMs,
  cardMarkDuration,
  cardMarkInClip,
  cardMarkKey,
  liveMarksAtRecTime,
  resolveLiveCardFromPlates,
} from './liveCardStage.js';
import { ZEN_ART } from './zen.js';
import { ICONS, T_GLYPH, icon } from './icons.js';
import { placeVoice, voiceSlots } from './voicePlace.js';

export { ICONS };

const PLATE_ICON = { open: 'open', close: 'close' };
const SPEED_PRESETS = [0.5, 0.75, 1.25, 1.5, 2, 3, 4];
const ZOOM_PRESETS = [1.2, 1.4, 1.6, 1.8, 2];
const LENS_PRESETS = [1.4, 1.8, 2.2];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r3 = (v) => Math.round(v * 1000) / 1000;
const CUT_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6.5" r="2.35"/><circle cx="6" cy="17.5" r="2.35"/><path d="m8.1 8.2 12.4 9.2M8.1 15.8 20.5 6.5"/></svg>`;
const fmtRate = (r) => `${Number(r).toFixed(2).replace(/\.?0+$/, '')}×`;

/** Smootherstep — the stage's own transition preview curve (xfade dissolves use the same). */
const ease = minJerk;

/** Zoom factor + centre at recording time t (mirrors zoomExpr/centerExpr in camera.mjs). */
export function zoomStateAt(shots, t, timing) {
  const IN = timing?.in ?? 0.9;
  const OUT = timing?.out ?? 1.05;
  const PAN = timing?.pan ?? 0.7;
  const curve = curveOf(timing?.curve).fn;
  let z = 1;
  let cx = null;
  let cy = null;
  for (const s of shots || []) {
    if (t < s.start || t > s.end) continue;
    z += (s.zoom - 1) * curve((t - s.start) / IN) * (1 - curve((t - (s.end - OUT)) / OUT));
    const pts = s.points || [];
    if (!pts.length) continue;
    let x = pts[0].cx;
    let y = pts[0].cy;
    for (let i = 1; i < pts.length; i++) {
      const from = Math.max(pts[i - 1].t, pts[i].t - PAN);
      const k = curve((t - from) / Math.max(0.001, pts[i].t - from));
      x += (pts[i].cx - x) * k;
      y += (pts[i].cy - y) * k;
    }
    cx = x;
    cy = y;
  }
  return { zoom: z, cx, cy };
}

// Loupe geometry mirrors lib/lens.mjs and the optics come from lensGlass.js, so the stage shows
// the glass the render draws.
const LENS_PAD = 36;

/** Top-left of the S×S loupe, centred on the target (may hang off-frame; mirrors lib/lens.mjs). */
export function loupeOrigin(cx, cy, S, _width, _height) {
  return {
    ox: cx - S / 2,
    oy: cy - S / 2,
  };
}

/** How far the glass is in `T` seconds into a lens that lasts `dur` (0..1; alpha/scale/swell in lensOpenState). */
export function lensOpen(T, dur, timing) {
  return lensOpenState(T, dur, timing).open;
}

/** Target centre of a lens at `T` seconds in: pointer-follow paths travel on the pointer's own minimum-jerk bell. */
export function lensCentre(lens, T) {
  const path = lens.path?.length ? lens.path : [{ at: 0, rect: lens.rect }];
  const c = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  if (T <= path[0].at || path.length === 1) return c(path[0].rect);
  for (let i = 1; i < path.length; i++) {
    if (T < path[i].at) {
      const a = c(path[i - 1].rect);
      const b = c(path[i].rect);
      const k = minJerk((T - path[i - 1].at) / Math.max(0.001, path[i].at - path[i - 1].at));
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return c(path.at(-1).rect);
}

/** `#rrggbb` scaled by `k` (lit / shaded metal), clamped. */
function shadeHex(hex, k) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const v = [0, 2, 4].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(m[1].slice(i, i + 2), 16) * k))));
  return `rgb(${v.join(',')})`;
}

function clockFromPieces(pieces = []) {
  if (!pieces.length) return { toClean: (t) => t, fromClean: (c) => c };
  const toClean = (t) => {
    if (t <= 0) return 0;
    for (const p of pieces) if (t <= p.to) return p.cleanFrom + (t - p.from) / p.rate;
    const last = pieces.at(-1);
    return last.cleanTo + (t - last.to);
  };
  const fromClean = (c) => {
    if (c <= 0) return 0;
    for (const p of pieces) if (c <= p.cleanTo) return p.from + (c - p.cleanFrom) * p.rate;
    const last = pieces.at(-1);
    return last.to + (c - last.cleanTo);
  };
  return { toClean, fromClean };
}

const fmtT = (sec) => {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
};
const fmtRuler = (sec) => {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${String(Math.floor(s)).padStart(2, '0')}${s % 1 ? `.${Math.round((s % 1) * 10)}` : ''}`;
};

/** Transition preview on the two stage layers (incoming over outgoing), progress p in 0–1. */
function paintTransition(style, p, inL, outL) {
  // Same DOM node (live→live / plate→plate): crossfading one element is a no-op — dip instead.
  if (inL && outL && inL === outL) {
    const opacity = p < 0.5 ? clamp(1 - 2 * p, 0, 1) : clamp(2 * p - 1, 0, 1);
    inL.style.opacity = String(opacity);
    return;
  }
  const e = ease(p);
  const set = (el, prop, v) => el && (el.style[prop] = v);
  switch (style) {
    case 'wipe':
      set(inL, 'clipPath', `inset(0 0 0 ${(1 - e) * 100}%)`);
      break;
    case 'push':
      set(inL, 'transform', `translateX(${(1 - e) * 100}%)`);
      set(outL, 'transform', `translateX(${-e * 100}%)`);
      break;
    case 'zoom':
      set(outL, 'transform', `scale(${1 + e * 0.5})`);
      set(outL, 'opacity', String(1 - e));
      set(inL, 'opacity', String(e));
      break;
    case 'iris':
      set(inL, 'clipPath', `circle(${e * 75}% at 50% 50%)`);
      break;
    case 'blur':
      set(inL, 'opacity', String(e));
      set(inL, 'filter', `blur(${(1 - e) * 16}px)`);
      set(outL, 'filter', `blur(${e * 16}px)`);
      break;
    case 'dip':
      set(outL, 'opacity', String(clamp(1 - 2 * p, 0, 1)));
      set(inL, 'opacity', String(clamp(2 * p - 1, 0, 1)));
      break;
    case 'radial': {
      const m = `conic-gradient(from 0deg, #000 ${e * 360}deg, transparent ${e * 360 + 0.5}deg)`;
      set(inL, 'maskImage', m);
      set(inL, 'webkitMaskImage', m);
      break;
    }
    case 'slice': {
      const m = `repeating-linear-gradient(to bottom, #000 0 ${e * 12.5}%, transparent ${e * 12.5}% 12.5%)`;
      set(inL, 'maskImage', m);
      set(inL, 'webkitMaskImage', m);
      break;
    }
    case 'diagonal':
      set(inL, 'clipPath', `polygon(0 0, ${e * 200}% 0, 0 ${e * 200}%)`);
      break;
    default:
      set(inL, 'opacity', String(e));
  }
}
const LAYER_PROPS = ['opacity', 'transform', 'clipPath', 'filter', 'maskImage', 'webkitMaskImage', 'zIndex'];

export function initEditor(ctx) {
  const { $, api, state, toast, escapeHtml } = ctx;
  const P = ctx.plate;
  const ed = {
    deck: null,
    seq: [],
    clock: clockFromPieces([]),
    total: 0,
    t: 0,
    cur: -1,
    playing: false,
    lastTs: 0,
    raf: 0,
    stopAt: null,
    loop: false,
    loopClip: null,
    fx: true,
    textMode: false,
    /** Look & reveal background edits: 'chapter' saves for the selected card's chapter, 'video' for all. */
    lookScope: 'chapter',
    /** When set, text mode is editing a chapter/caption template (overlay:…) over a live clip. */
    liveCardId: null,
    /** Overlay id currently composited for preview (motion mode), if any. */
    compositeCardId: null,
    /** Hold length (ms) last applied to the composited card’s CSS exit timing. */
    compositeHoldMs: null,
    /** Last motion-seek ms applied to the composited card (skip redundant seeks). */
    compositeSeekMs: null,
    /** Last live-card id under the playhead — used to refresh Edit text / coach without every frame. */
    cardHint: '',
    /** Focused plate copy field while editing: { path, kind, source, dirty, accent }. */
    plateField: null,
    /** Plate id that needs animation resync after text mode / in-flight load finishes. */
    needsPlateResync: null,
    /** Bumps to cancel an in-flight enterText when Done / play / leave wins the race. */
    textGen: 0,
    sel: null, // { type: 'clip'|'ramp'|'zoom'|'skip'|'join'|'range', … }
    zoomScale: 1,
    pps: 20,
    undo: [],
    redo: [],
    loadingPlate: null,
    missing: new Set(),
    /** Plates whose HTML changed while the frame showed something else — reload them on the next visit. */
    stalePlates: new Set(),
    stall: false,
    dirtyRender: false,
    styleTimers: new Map(),
    pendingStyle: new Map(),
    active: false,
    drag: null,
    preSeek: null,
    /** Latest recording-time target while scrubbing; chase it across in-flight seeks. */
    wantRec: null,
    sound: true,
    hear: null,
  };
  const preview = createAudioPreview();
  let stylePreviewTimer = 0;
  const slug = () => state.slug;
  const video = () => $('livePlayer');
  const live = () => ed.deck?.live || {};
  // The take's CSS size — the space every zoom, lens and mark is stored in.
  const liveW = () => live().width || ed.deck?.space?.cssW || 1;
  const liveH = () => live().height || ed.deck?.space?.cssH || 1;
  const deckEdit = () =>
    ed.deck?.deck || {
      speed: [],
      zooms: [],
      zoomSkips: [],
      lenses: [],
      lensOff: [],
      transitions: {},
      audio: null,
      cards: [],
      order: [],
      omit: [],
      trims: [],
      cuts: [],
    };

  function overlayLook() {
    return state.video?.overlays || { preset: 'plateMatch', chapter: {}, caption: {}, catalog: {} };
  }

  /** The Program row (listLiveCards) behind a selected card: carries chapterNo + its effective look. */
  function liveCardRow(sel) {
    if (!sel) return null;
    return (
      (state.htmlPlates || []).find((p) => p.liveCard && sel.cardId && p.id === sel.cardId) ||
      (state.htmlPlates || []).find((p) => p.liveCard && sel.key && p.markKey === sel.key) ||
      null
    );
  }

  function renderCardLook(kind, card = null) {
    const look = overlayLook();
    const videoSlot = kind === 'caption' ? look.caption || {} : look.chapter || {};
    const chapterNo = Number(card?.chapterNo) || 0;
    const ownKeys = Array.isArray(card?.lookScope) ? card.lookScope : [];
    const scope = ed.lookScope === 'video' ? 'video' : 'chapter';
    const perChapter = Boolean(chapterNo) && scope === 'chapter';
    // Background rows show what this card will actually paint (chapter look over the video's)
    // in chapter scope, and the video-wide values in video scope. Everything else is video-wide.
    const slot = perChapter && card?.look ? card.look : videoSlot;
    const cat = look.catalog || {};
    const atmospheres = cat.atmospheres || ['waves', 'mesh', 'blobs', 'none'];
    const energies = cat.energies || ['calm', 'clear', 'punchy'];
    const seats = cat.seats || ['bottom-center', 'bottom-left', 'bottom-right'];
    const aligns = cat.aligns || ['left', 'center'];
    const presets = cat.presets || [
      { id: 'plateMatch', label: 'Match plates' },
      { id: 'editorial', label: 'Editorial' },
      { id: 'punchy', label: 'Punchy' },
      { id: 'minimal', label: 'Minimal' },
      { id: 'spotlight', label: 'Spotlight' },
    ];
    const opt = (values, current, labels = {}) =>
      values
        .map((v) => {
          const id = typeof v === 'string' ? v : v.id;
          const label = typeof v === 'string' ? labels[v] || v[0].toUpperCase() + v.slice(1) : v.label || v.id;
          return `<option value="${escapeHtml(id)}" ${current === id ? 'selected' : ''}>${escapeHtml(label)}</option>`;
        })
        .join('');
    const row = (label, control) => `<label class="ins-row"><span>${label}</span>${control}</label>`;
    const energyLabels = { calm: 'Calm · slower unfold', clear: 'Clear · balanced', punchy: 'Punchy · snappy reveal' };
    const atmLabels = { waves: 'Waves', mesh: 'Mesh', blobs: 'Blobs', none: 'None' };
    const seatLabels = { 'bottom-center': 'Bottom center', 'bottom-left': 'Bottom left', 'bottom-right': 'Bottom right' };
    const kindLabel = kind === 'caption' ? 'captions' : 'chapters';
    // Backdrop: the solid fill behind the atmosphere. `auto` = black or white from the brand,
    // `none` = clear, a brand role or a custom #hex = that colour at `backdropOpacity` %.
    const paperName = (look.paper === '#ffffff' ? 'white' : 'black');
    const backdrops = (cat.backdrops || [
      { id: 'auto', label: 'Auto' },
      { id: 'none', label: 'None' },
      { id: 'ink', label: 'Ink' },
      { id: 'surface', label: 'Surface' },
      { id: 'gold', label: 'Accent' },
      { id: 'amber', label: 'Secondary' },
      { id: 'teal', label: 'Support' },
      { id: 'custom', label: 'Custom…' },
    ]).map((c) => (c.id === 'auto' ? { ...c, label: `Auto · ${paperName}` } : c));
    const bd = String(slot.backdrop || 'auto');
    const bdCustom = bd.startsWith('#');
    const bdChoice = bdCustom ? 'custom' : bd;
    const bdColored = bdChoice !== 'auto' && bdChoice !== 'none';
    const brandHex = (role) => state.video?.direction?.colors?.[role] || state.video?.brandFoundation?.colors?.[role] || null;
    const paper = look.paper === '#ffffff' ? '#ffffff' : '#000000';
    const bdHex = bdCustom ? bd : bdColored ? brandHex(bd) || paper : paper;
    const bdAlpha = Math.max(0, Math.min(100, Math.round(Number(slot.backdropOpacity ?? 100))));
    const swatchTitle =
      bdChoice === 'none'
        ? 'No backdrop — the recording shows through'
        : bdChoice === 'auto'
          ? `Auto picked ${paperName} from the brand. Pick a colour to override.`
          : 'Pick a custom colour';
    const backdropRows =
      `<div class="ins-row"><span>Backdrop</span><div class="ins-backdrop">` +
      `<select class="ins-select" data-overlay-backdrop aria-label="Backdrop colour behind the background" title="Solid fill behind the background. Auto picks black or white from the brand, None lets the recording show through, or pick a brand colour / custom colour and set its opacity.">${opt(backdrops, bdChoice)}</select>` +
      `<span class="ins-swatch${bdChoice === 'none' ? ' is-off' : ''}" style="--sw:${escapeHtml(bdHex)}" title="${escapeHtml(swatchTitle)}">` +
      `<input type="color" value="${escapeHtml(bdHex)}" data-overlay-backdrop-color aria-label="Custom backdrop colour" /></span></div></div>` +
      (bdColored
        ? `<label class="ins-row"><span>Opacity</span><div class="ins-inline-range"><input type="range" min="0" max="100" step="5" value="${bdAlpha}" data-overlay-backdrop-opacity aria-label="Backdrop opacity" /><output>${bdAlpha}%</output></div></label>`
        : '');
    const toggles =
      kind === 'chapter'
        ? row(
            'Ornaments',
            `<div class="ins-seg ins-seg-wrap">${[
              ['ghost', 'Ghost'],
              ['blobs', 'Blobs'],
              ['rail', 'Rail'],
              ['sheen', 'Sheen'],
            ]
              .map(
                ([key, label]) =>
                  `<button type="button" data-overlay-bool="${key}" class="${slot[key] !== false ? 'on' : ''}" aria-pressed="${slot[key] !== false}">${label}</button>`
              )
              .join('')}</div>`
          )
        : row(
            'Sheen',
            `<div class="ins-seg">${['on', 'off']
              .map(
                (v) =>
                  `<button type="button" data-overlay-bool="sheen" data-bool="${v}" class="${(slot.sheen !== false) === (v === 'on') ? 'on' : ''}">${v[0].toUpperCase() + v.slice(1)}</button>`
              )
              .join('')}</div>`
          ) +
          row('Seat', `<select class="ins-select" data-overlay="seat">${opt(seats, slot.seat || 'bottom-center', seatLabels)}</select>`) +
          row('Text', `<select class="ins-select" data-overlay="align">${opt(aligns, slot.align || 'left', { left: 'Left', center: 'Center' })}</select>`);
    const keyLabels = { atmosphere: 'background', backdrop: 'backdrop', backdropOpacity: 'opacity' };
    const slotWord = kindLabel.replace(/s$/, '');
    const scopeRow = chapterNo
      ? row(
          'Applies to',
          `<div class="ins-seg" data-look-scope-seg>${[
            ['chapter', `Chapter ${chapterNo}`, `Background and backdrop apply to chapter ${chapterNo} only — its chapter card and captions`],
            ['video', 'Video default', `Set the video-wide background and backdrop; chapters with a custom look keep it`],
          ]
            .map(
              ([v, label, title]) =>
                `<button type="button" data-look-scope="${v}" class="${scope === v ? 'on' : ''}" aria-pressed="${scope === v}" title="${escapeHtml(title)}">${label}</button>`
            )
            .join('')}</div>`
        )
      : '';
    const lookScopeBanner = (() => {
      if (!chapterNo) return '';
      const ownList = ownKeys.map((k) => keyLabels[k] || k).join(' · ');
      if (ownKeys.length) {
        return (
          `<div class="ins-look-scope is-custom" role="status" aria-live="polite">` +
          `<div class="ins-look-scope__head"><span class="ins-look-scope__badge">Ch. ${chapterNo}</span><strong>Custom ${escapeHtml(slotWord)} look</strong></div>` +
          `<p class="ins-look-scope__lede">Overrides the video: <b>${escapeHtml(ownList)}</b></p>` +
          `<div class="ins-look-scope__actions">` +
          `<button type="button" class="ins-btn" data-act="look-apply-all" title="Promote chapter ${chapterNo}’s look to the video — every chapter follows it">${ICONS.sparkle || ''}<span>Apply to all</span></button>` +
          `<button type="button" class="ins-btn ghost" data-act="look-follow-video" title="Drop chapter ${chapterNo}’s overrides and follow the video look again"><span>Follow video</span></button>` +
          `</div></div>`
        );
      }
      if (scope === 'video') {
        return (
          `<div class="ins-look-scope is-video" role="status" aria-live="polite">` +
          `<div class="ins-look-scope__head"><span class="ins-look-scope__badge">Video</span><strong>Default for all chapters</strong></div>` +
          `<p class="ins-look-scope__lede">Background and backdrop set the shared look. Chapters you styled on their own stay as they are.</p>` +
          `</div>`
        );
      }
      return (
        `<div class="ins-look-scope is-chapter" role="status" aria-live="polite">` +
        `<div class="ins-look-scope__head"><span class="ins-look-scope__badge">Ch. ${chapterNo}</span><strong>Follows the video look</strong></div>` +
        `<p class="ins-look-scope__lede">Tweaks below save for this chapter only.</p>` +
        `<button type="button" class="ins-link ins-look-scope__switch" data-look-scope="video">Edit video-wide look</button>` +
        `</div>`
      );
    })();
    return (
      row('Preset', `<select class="ins-select" data-overlay-preset>${opt(presets, look.preset || 'plateMatch')}</select>`) +
      scopeRow +
      lookScopeBanner +
      row('Background', `<select class="ins-select" data-overlay="atmosphere">${opt(atmospheres, slot.atmosphere || 'waves', atmLabels)}</select>`) +
      backdropRows +
      row('Entrance', `<select class="ins-select" data-overlay="energy">${opt(energies, slot.energy || 'clear', energyLabels)}</select>`) +
      toggles +
      `<p class="ins-note subtle">Preset, entrance and ornaments apply to all ${kindLabel} (same as Direction → Live cards). Timing above is this card only. Double-click the block to edit copy.</p>`
    );
  }

  function renderCardSel(s) {
    const mark = (ed.deck?.marks || []).find((m) => (m.key || cardMarkKey(m)) === s.key);
    const slot = mark?.kind === 'chapter' ? 'chapter' : 'caption';
    const kind = slot === 'chapter' ? 'Chapter' : 'Caption';
    const fields = ed.textMode && ed.liveCardId ? renderPlateFields() : '';
    const dur = Number(s.markDur ?? mark?.dur ?? cardMarkDuration(mark || { kind: mark?.kind || 'caption' }));
    const [lo, hi] = ed.deck?.ranges?.cardDur || [0.4, 30];
    const t = Number(s.markT ?? mark?.t ?? 0);
    return (
      head(ICONS.plate, slot === 'chapter' ? 'plate' : 'live', mark?.label || kind, `${kind} card · ${fmtT(t)} · ${dur.toFixed(1)}s`) +
      section(
        'plate',
        'Card',
        `<button type="button" class="ins-btn wide primary" data-edit-card="${escapeHtml(s.cardId || '')}" data-mark-t="${t}" data-mark-key="${escapeHtml(s.key || mark?.key || '')}">${ICONS.plate}<span>Edit ${slot} copy</span></button>
        <p class="ins-note subtle">Or double-click the block · click text on the stage · tip’s <b>Edit copy</b>. Drag the tip if it covers the words.</p>`
      ) +
      section(
        'live',
        'On screen',
        `<div class="ins-big"><output id="insCardDurOut">${dur.toFixed(1)}s</output><input type="range" min="${lo}" max="${hi}" step="0.1" value="${clamp(dur, lo, hi)}" data-card-dur aria-label="How long this card stays on screen" /></div>
        <p class="ins-note subtle">How long this ${slot} stays on the recording.</p>`
      ) +
      section('motion', 'Look & reveal', renderCardLook(slot, liveCardRow(s))) +
      fields
    );
  }
  const audioDesk = () => deckEdit().audio || { music: { offset: 0, gainDb: 0, mute: false, fadeIn: 1.2, fadeOut: 2.6, rides: [] }, voice: [], master: {} };
  function previewState() {
    const audio = ed.deck?.audio;
    if (!audio) return null;
    const desk = structuredClone(audioDesk());
    const levels = { ...(audio.levels || {}) };
    const hear = ed.hear;
    if (hear?.music) Object.assign(desk.music, hear.music);
    if (hear?.master) {
      Object.assign(desk.master, hear.master);
      Object.assign(levels, hear.master);
    }
    const clips = (audio.voiceClips || []).map((c) => {
      const over = hear?.voice?.key === c.key ? hear.voice : null;
      return over ? { ...c, ...over } : c;
    });
    return { ...audio, desk, levels, voiceClips: clips, total: ed.total };
  }
  function postAudio(next, hint) {
    return postDeck({ audio: next }, { hint });
  }
  function withMusic(patch, hint) {
    return postAudio({ ...audioDesk(), music: { ...audioDesk().music, ...patch } }, hint);
  }
  function withMaster(patch, hint) {
    const master = { ...audioDesk().master };
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || value === '') delete master[key];
      else master[key] = value;
    }
    return postAudio({ ...audioDesk(), master }, hint);
  }
  /** Save one line's desk entry; keys at their default drop out so an untouched line stores nothing. */
  function withVoice(key, patch, hint) {
    const prev = audioDesk().voice.find((v) => v.key === key) || { key };
    const merged = { key, ...prev, ...patch };
    if (!merged.mute) delete merged.mute;
    for (const k of ['nudge', 'gainDb', 'trimStart', 'trimEnd', 'fadeIn', 'fadeOut']) if (!merged[k]) delete merged[k];
    if (merged.at == null) delete merged.at;
    if (!merged.text) delete merged.text;
    if (!merged.speed || Math.abs(merged.speed - 1) < 0.005) delete merged.speed;
    if (!(merged.take > 1)) delete merged.take;
    if (!(merged.takes > 1)) delete merged.takes;
    const voice = audioDesk().voice.filter((v) => v.key !== key);
    if (Object.keys(merged).length > 1) voice.push(merged);
    return postAudio({ ...audioDesk(), voice }, hint);
  }
  const voiceClip = (key) => (ed.deck?.audio?.voiceClips || []).find((c) => c.key === key);

  /** Pick the narrator for this video (or go back to the brand's). Mix speaks the lines again. */
  async function setNarrator(body, hint) {
    try {
      const r = await api(`/api/video/${encodeURIComponent(slug())}/narrator`, { method: 'POST', body });
      ed.deck = r;
      ed.narratorPick = null;
      buildSeq();
      renderTimeline();
      renderInspector();
      paintStatus();
      flashHint(hint);
      return r;
    } catch (err) {
      toast('Narrator not changed', err.message, 'err');
      return null;
    }
  }

  /** Hear one line from its start, with the sound on. */
  function listenLine(clip) {
    if (!clip) return;
    if (!ed.sound) {
      ed.sound = true;
      preview.setEnabled(true);
      $('edSound')?.classList.toggle('is-on', true);
    }
    previewRange(clip.start, clip.start + clip.dur);
  }

  /**
   * Speak a line again on the server (new take, rewrite, speed, or an earlier take from the cache)
   * and play it as soon as it lands.
   */
  const REGEN_TIMEOUT_MS = 120_000;
  async function regenerateLine(key, body, hint) {
    if (ed.regenerating) return null;
    // Busy state in place: the inspector keeps the textarea as typed, the pill on the timeline speaks.
    const root = $('inspectorRoot');
    root?.querySelectorAll('[data-act="voice-regen"], [data-act="voice-revert"], [data-take]').forEach((b) => (b.disabled = true));
    const regen = root?.querySelector('[data-act="voice-regen"]');
    regen?.classList.add('is-busy');
    if (regen?.querySelector('span')) regen.querySelector('span').textContent = 'Speaking…';
    ed.regenerating = key;
    renderTimeline();
    const before = snapshotDeck();
    let r;
    try {
      r = await api(`/api/video/${encodeURIComponent(slug())}/voice/line`, { method: 'POST', body: { key, ...body }, signal: AbortSignal.timeout(REGEN_TIMEOUT_MS) });
    } catch (err) {
      // The flag goes first: every render below reads it, and a render that sees it stays busy.
      ed.regenerating = null;
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      toast('Line not regenerated', timedOut ? `The narrator did not answer within ${REGEN_TIMEOUT_MS / 1000}s. The line is as it was.` : err.message, 'err');
      await refresh();
      const ta = $('inspectorRoot')?.querySelector('[data-voice-text]');
      if (ta && typeof body.text === 'string' && body.text) ta.value = body.text;
      return null;
    }
    ed.regenerating = null;
    ed.undo.push(before);
    ed.redo = [];
    preview.forget(key);
    ed.deck = r;
    ed.hear = null;
    buildSeq();
    await preview.load(previewState());
    validateSelection();
    renderTimeline();
    renderFrame();
    renderInspector();
    paintStatus();
    flashHint(hint || (r.line?.synthesized ? 'New take ready' : 'Take loaded'));
    listenLine(voiceClip(key));
    return r;
  }

  /** Apply a deck response from voice add/upload and select the line. */
  async function applyVoiceDeck(r, key, hint) {
    const before = snapshotDeck();
    ed.undo.push(before);
    ed.redo = [];
    if (key) preview.forget(key);
    ed.deck = r;
    ed.hear = null;
    buildSeq();
    await preview.load(previewState());
    if (key) ed.sel = { type: 'voice', key };
    validateSelection();
    renderTimeline();
    renderFrame();
    renderInspector();
    paintStatus();
    if (hint) flashHint(hint);
    if (key) listenLine(voiceClip(key));
    return r;
  }

  /** Add a free-standing voice line at the playhead (ad-lib). Optional ElevenLabs speak. */
  async function addVoiceLine({ text = '', via = null, at = null } = {}) {
    const t = at != null ? at : ed.t;
    const body = { at: Math.max(0, Number(t) || 0), text: String(text || '').trim() };
    if (via === 'eleven') body.via = 'eleven';
    try {
      const r = await api(`/api/video/${encodeURIComponent(slug())}/voice/line/add`, {
        method: 'POST',
        body,
        signal: via === 'eleven' ? AbortSignal.timeout(REGEN_TIMEOUT_MS) : undefined,
      });
      return applyVoiceDeck(r, r.key, via === 'eleven' ? 'Line spoken' : 'Voice line added');
    } catch (err) {
      toast('Voice line not added', err.message, 'err');
      return null;
    }
  }

  /** Base64-encode an ArrayBuffer without blowing the call stack on large files. */
  function bufferToBase64(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  /** Upload or attach a mic take (base64) for an existing line. */
  async function uploadVoiceTake(key, { buffer, mime, source = 'upload', newTake = true } = {}) {
    if (!key || !buffer) return null;
    let b64;
    if (typeof buffer === 'string') b64 = buffer.replace(/^data:[^;]+;base64,/, '');
    else if (buffer instanceof ArrayBuffer || buffer instanceof Uint8Array) b64 = bufferToBase64(buffer);
    else if (buffer.arrayBuffer) b64 = bufferToBase64(await buffer.arrayBuffer());
    else return null;
    ed.regenerating = key;
    renderTimeline();
    renderInspector();
    try {
      const r = await api(`/api/video/${encodeURIComponent(slug())}/voice/line/upload`, {
        method: 'POST',
        body: { key, audio: b64, mime: mime || 'audio/mpeg', source, newTake },
        signal: AbortSignal.timeout(60_000),
      });
      ed.regenerating = null;
      return applyVoiceDeck(r, key, source === 'mic' ? 'Recording saved' : 'MP3 attached');
    } catch (err) {
      ed.regenerating = null;
      toast(source === 'mic' ? 'Recording not saved' : 'Upload failed', err.message, 'err');
      renderTimeline();
      renderInspector();
      return null;
    }
  }

  /** Pick an audio file and attach it as a new take (or the first take on an empty line). */
  function pickVoiceFile(key) {
    const clip = voiceClip(key);
    const empty = clip && !(clip.full > 0) && !(clip.dur > 0);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/mpeg,audio/mp3,audio/wav,audio/webm,audio/ogg,audio/mp4,.mp3,.wav,.webm,.ogg,.m4a';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const buf = await file.arrayBuffer();
      await uploadVoiceTake(key, { buffer: buf, mime: file.type || 'audio/mpeg', source: 'upload', newTake: !empty });
    };
    input.click();
  }

  /** Upload an MP3 (etc.) as the music bed for this cut. */
  async function uploadMusicBed({ buffer, mime } = {}) {
    if (!buffer) return null;
    let b64;
    if (typeof buffer === 'string') b64 = buffer.replace(/^data:[^;]+;base64,/, '');
    else if (buffer instanceof ArrayBuffer || buffer instanceof Uint8Array) b64 = bufferToBase64(buffer);
    else if (buffer.arrayBuffer) b64 = bufferToBase64(await buffer.arrayBuffer());
    else return null;
    const want = slug();
    ed.regenerating = 'music';
    renderTimeline();
    renderInspector();
    try {
      const r = await api(`/api/video/${encodeURIComponent(want)}/music/upload`, {
        method: 'POST',
        body: { audio: b64, mime: mime || 'audio/mpeg' },
        signal: AbortSignal.timeout(120_000),
      });
      ed.regenerating = null;
      if (slug() !== want) return r; // sequence changed mid-upload — discard UI apply
      const before = snapshotDeck();
      ed.undo.push(before);
      ed.redo = [];
      ed.deck = r;
      ed.hear = null;
      buildSeq();
      await preview.load(previewState());
      ed.sel = { type: 'music' };
      renderTimeline();
      renderFrame();
      renderInspector();
      paintStatus();
      const dur = r?.music?.durationSec;
      flashHint(dur ? `Music attached · ${Number(dur).toFixed(0)}s` : 'Music attached');
      toast('Music attached', dur ? `${Number(dur).toFixed(0)}s bed · Mix to bake it into the master` : 'Bed ready · Mix to bake it into the master');
      return r;
    } catch (err) {
      ed.regenerating = null;
      if (slug() === want) {
        toast('Upload failed', err.message, 'err');
        renderTimeline();
        renderInspector();
      }
      return null;
    }
  }

  function pickMusicFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/mpeg,audio/mp3,audio/wav,audio/webm,audio/ogg,audio/mp4,.mp3,.wav,.webm,.ogg,.m4a';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const buf = await file.arrayBuffer();
      await uploadMusicBed({ buffer: buf, mime: file.type || 'audio/mpeg' });
    };
    input.click();
  }

  /** Start or stop a mic recording for a line. */
  async function toggleMicRecord(key) {
    if (ed.micRecord?.key === key) {
      const rec = ed.micRecord;
      ed.micRecord = null;
      renderInspector();
      try {
        const blob = await new Promise((resolve, reject) => {
          rec.recorder.onstop = () => resolve(new Blob(rec.chunks, { type: rec.mime }));
          rec.recorder.onerror = () => reject(new Error('Recording failed'));
          try {
            rec.recorder.stop();
          } catch (err) {
            reject(err);
          }
          rec.stream.getTracks().forEach((t) => t.stop());
        });
        const buf = await blob.arrayBuffer();
        const clip = voiceClip(key);
        const empty = clip && !(clip.full > 0) && !(clip.dur > 0);
        await uploadVoiceTake(key, { buffer: buf, mime: rec.mime, source: 'mic', newTake: !empty });
      } catch (err) {
        toast('Recording not saved', err.message, 'err');
      }
      return;
    }
    if (ed.micRecord) {
      toast('Already recording', 'Stop the current recording first.', 'warn');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast('Mic unavailable', 'This browser cannot record audio.', 'err');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data?.size) chunks.push(e.data);
      };
      ed.micRecord = { key, recorder, stream, chunks, mime: recorder.mimeType || mime || 'audio/webm' };
      recorder.start();
      renderInspector();
      flashHint('Recording… click Stop when done');
    } catch (err) {
      toast('Mic blocked', err.message || 'Allow microphone access and try again.', 'err');
    }
  }

  // ─── Sequence ────────────────────────────────────────────────────────────────────────────
  function chapterTitle(from, to) {
    const marks = (ed.deck?.marks || []).filter((m) => (m.kind === 'chapter' || m.kind === 'caption') && m.t >= from - 0.05 && m.t < to && m.label);
    return (marks.find((m) => m.kind === 'chapter') || marks[0])?.label || null;
  }

  function buildSeq() {
    const anchor = capturePlayheadAnchor(ed.seq, ed.t);
    const prevT = ed.t;
    const d = ed.deck;
    ed.clock = clockFromPieces(d?.live?.pieces || []);
    const { toClean } = ed.clock;
    const seq = [];
    const scenes = (d?.scenes || []).filter((s) => s.dur > 0);
    const liveOk = Boolean(d?.live?.exists);
    if (scenes.length) {
      scenes.forEach((s, i) => {
        const isLive = s.kind === 'live';
        const join = i ? (d.joins || [])[i - 1] || null : null;
        const recFrom = isLive ? (s.recFrom ?? s.cleanFrom ?? 0) : null;
        const recTo = isLive ? (s.recTo ?? s.cleanTo ?? recFrom + s.dur) : null;
        const dur = isLive && liveOk ? Math.max(0.2, toClean(recTo) - toClean(recFrom)) : s.dur;
        const prev = seq[i - 1];
        const want = !i || s.hardCut ? 0 : (join?.pinned?.duration ?? s.transitionIn?.dur ?? 0);
        const overlap = prev ? clamp(want, 0, Math.min(prev.dur, dur) / 2) : 0;
        seq.push({
          i,
          id: s.id,
          kind: isLive ? 'live' : 'plate',
          plateId: s.plateId || null,
          type: s.type || null,
          title: isLive
            ? (s.title && s.title !== 'Live screencast' ? s.title : null) || chapterTitle(recFrom, recTo) || 'Recording'
            : s.title,
          at: prev ? prev.at + prev.dur - overlap : 0,
          dur,
          overlap,
          recFrom,
          recTo,
          join,
        });
      });
    } else {
      // No render yet: lay out the plates around the whole recording so they can still be styled.
      const plates = d?.plates || [];
      const order = [
        ...plates.filter((p) => p.id === 'open'),
        ...(liveOk ? [{ live: true }] : []),
        ...plates.filter((p) => p.id !== 'open' && p.id !== 'close'),
        ...plates.filter((p) => p.id === 'close'),
      ];
      let at = 0;
      const push = (clip) => {
        seq.push({ ...clip, i: seq.length, at, overlap: 0, join: null });
        at += clip.dur;
      };
      for (const p of order) {
        if (!p.live) {
          push({ id: p.id, kind: 'plate', plateId: p.id, type: p.type || null, title: p.label || p.id, dur: 6, recFrom: null, recTo: null });
          continue;
        }
        const recEnd = d.live.durationSec || 0;
        const toClean = ed.clock.toClean;
        for (const [a, b] of keptSpans(0, recEnd, d.cuts)) {
          const dur = Math.max(0.2, toClean(b) - toClean(a));
          push({ id: `live-${a.toFixed(2)}`, kind: 'live', plateId: null, type: null, title: 'Recording', dur, recFrom: a, recTo: b });
        }
      }
    }
    ed.seq = seq;
    const last = seq.at(-1);
    ed.total = last ? last.at + last.dur : 0;
    // Prefer the same section after omit/undo/reorder — raw clamp lands on the wrong plate.
    ed.t = restorePlayheadAnchor(ed.seq, ed.total, anchor, prevT);
    projectAudio();
  }

  /**
   * Lay the narration and the music ducking onto the cut as it stands. voice.json holds where the
   * last mix put each line; a speed ramp or a pinned join moves the picture under it, so the Editor
   * re-places every line with the same rules the voice step uses (studio/voicePlace.js). `start`
   * is where the line lands on the next render, `mixStart` where the current mix has it.
   */
  function projectAudio() {
    const audio = ed.deck?.audio;
    if (!audio) return;
    const seq = ed.seq;
    const lives = seq.filter((c) => c.kind === 'live');
    audio.windows = lives.map((c) => ({ start: c.at, end: c.at + c.dur }));
    const clips = audio.voiceClips || [];
    if (!clips.length || !seq.length) return;
    const atRec = (rec) => {
      const c = lives.find((l) => rec <= l.recTo + 1e-6) || lives.at(-1);
      if (!c) return null;
      return recToEd(c, clamp(rec, c.recFrom, c.recTo));
    };
    const lineKeys = new Set(clips.filter((c) => c.kind === 'caption' || c.kind === 'chapter').map((c) => c.key));
    const marks = (ed.deck.marks || [])
      .filter((m) => (m.kind === 'chapter' || m.kind === 'caption') && m.label && lineKeys.has(m.label))
      .map((m) => ({ kind: m.kind, label: m.label, at: atRec(m.t) }))
      .filter((m) => m.at != null);
    const open = seq.find((c) => c.plateId === 'open');
    const close = seq.find((c) => c.plateId === 'close');
    const lastLive = lives.at(-1);
    const cut = {
      open: open ? { at: open.at, dur: open.dur } : null,
      close: close ? { at: close.at, dur: close.dur } : null,
      total: ed.total,
      plates: seq.filter((c) => c.kind === 'plate' && c.plateId !== 'open' && c.plateId !== 'close').map((c) => ({ id: c.plateId, at: c.at, dur: c.dur, inDur: c.overlap })),
      marks,
      liveEnd: lastLive ? lastLive.at + lastLive.dur : ed.total,
    };
    const placed = placeVoice(voiceSlots(cut, clips.map((c) => ({ key: c.key, kind: c.kind, duration: c.dur }))));
    const byKey = new Map(placed.map((p) => [p.key, p]));
    for (const c of clips) {
      const p = byKey.get(c.key);
      if (!p) continue;
      const base = c.at != null ? c.at : p.start;
      c.start = Math.round((base + (c.nudge || 0)) * 1000) / 1000;
      c.moved = c.at == null && Math.abs(p.start - c.writtenStart) > 0.05;
      c.long = p.long;
      c.late = p.late;
    }
  }

  const clipIndexAt = (t) => {
    for (let i = ed.seq.length - 1; i >= 0; i--) if (ed.seq[i].at <= t + 1e-4) return i;
    return 0;
  };
  function visualSpan(i) {
    const c = ed.seq[i];
    const n = ed.seq[i + 1];
    return [i ? c.at + c.overlap / 2 : 0, n ? n.at + n.overlap / 2 : c.at + c.dur];
  }
  function visualIndexAt(t) {
    for (let i = 0; i < ed.seq.length; i++) if (t < visualSpan(i)[1]) return i;
    return ed.seq.length - 1;
  }
  const recToEd = (c, rec) => c.at + (ed.clock.toClean(rec) - ed.clock.toClean(c.recFrom));
  const edToRec = (c, t) => clamp(ed.clock.fromClean(ed.clock.toClean(c.recFrom) + (t - c.at)), c.recFrom, c.recTo);
  const rateAt = (rec) => deckEdit().speed.find((r) => rec >= r.from && rec < r.to)?.rate || 1;
  const curClip = () => ed.seq[clipIndexAt(ed.t)] || null;
  const shotKey = (s) => s.id || `auto@${s.start}`;
  /** Every magnifier the zoom row shows: the ones that render plus recorded ones switched off. */
  const lensItems = () => [
    ...(ed.deck?.lenses || []),
    ...(ed.deck?.recordedLenses || []).filter((l) => l.off).map((l) => ({ ...l, key: `off:${l.t}`, source: 'off' })),
  ];
  const lensByKey = (key) => lensItems().find((l) => l.key === key) || null;
  const selectedLens = () => (ed.sel?.type === 'lens' ? lensByKey(ed.sel.key) : null);

  // ─── Data ────────────────────────────────────────────────────────────────────────────────

  /**
   * Drop per-project editor state when the sequence changes. Keeps chrome (active / zoom scale)
   * but clears playhead, selection, undo, and in-flight voice/music work so the last video
   * cannot leak into the next.
   */
  function resetForProject() {
    pause();
    preview.pause();
    clearPlatePreviewTimers();
    if (ed.micRecord) {
      try {
        ed.micRecord.recorder?.stop?.();
        ed.micRecord.stream?.getTracks?.().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      ed.micRecord = null;
    }
    ed.textGen += 1;
    if (ed.textMode) {
      try {
        exitText();
      } catch {
        /* plate may already be gone */
      }
    }
    ed.t = 0;
    ed.total = 0;
    ed.seq = [];
    ed.sel = null;
    ed.undo = [];
    ed.redo = [];
    ed.hear = null;
    ed.deck = null;
    ed.regenerating = null;
    ed.loadingPlate = null;
    ed.missing = new Set();
    ed.stalePlates = new Set();
    ed.needsPlateResync = null;
    ed.dirtyRender = false;
    ed.voices = null;
    ed.drag = null;
    ed.preSeek = null;
    ed.wantRec = null;
    ed.stopAt = null;
    ed.loopClip = null;
    ed.cur = -1;
    ed.clock = null;
  }

  async function refresh() {
    if (!slug()) return null;
    const want = slug();
    try {
      const deck = await api(`/api/video/${encodeURIComponent(want)}/edit`);
      // Sequence may have changed while the request was in flight.
      if (slug() !== want) return null;
      ed.deck = deck;
    } catch (err) {
      if (slug() !== want) return null;
      ed.deck = null;
      console.warn('editor deck', err);
    }
    syncLiveSource();
    buildSeq();
    ed.t = clamp(ed.t, 0, ed.total || 0);
    paintFrame();
    preview.load(previewState());
    if (ed.active) {
      validateSelection();
      renderTimeline();
      renderFrame();
      renderInspector();
      paintStatus();
      paintTransport();
    }
    return ed.deck;
  }

  const snapshotDeck = () => {
    const d = deckEdit();
    return JSON.parse(
      JSON.stringify({
        speed: d.speed || [],
        zooms: d.zooms || [],
        zoomSkips: d.zoomSkips || [],
        lenses: d.lenses || [],
        lensOff: d.lensOff || [],
        transitions: d.transitions || {},
        audio: d.audio || null,
        cards: d.cards || [],
        order: d.order || [],
        omit: d.omit || [],
        trims: d.trims || [],
        cuts: d.cuts || [],
      })
    );
  };

  async function postDeck(patch, { undoable = true, hint } = {}) {
    const before = snapshotDeck();
    try {
      const r = await api(`/api/video/${encodeURIComponent(slug())}/edit`, { method: 'POST', body: patch });
      if (undoable) {
        ed.undo.push(before);
        if (ed.undo.length > 60) ed.undo.shift();
        ed.redo = [];
      }
      ed.deck = r;
      ed.hear = null;
      // Cut shape changed — drop composite preview so the next frame loads the true plate/HTML.
      ed.compositeCardId = null;
      ed.compositeHoldMs = null;
      ed.compositeSeekMs = null;
      if (Object.prototype.hasOwnProperty.call(patch || {}, 'cards')) {
        for (const p of state.htmlPlates || []) {
          if (p.liveCard || String(p.id || '').startsWith('overlay:')) ed.stalePlates.add(p.id);
        }
      }
      if (!ed.textMode) ed.liveCardId = null;
      buildSeq();
      ed.cur = -1;
      // Omit/reorder races often cancelled an in-flight iframe load and blacklisted Opening.
      for (const c of ed.seq) if (c.plateId) ed.missing.delete(c.plateId);
      if (ed.textMode && ed.liveCardId && String(ed.liveCardId).startsWith('overlay:')) {
        const still = liveCardAtPlayhead();
        if (!still || still.id !== ed.liveCardId) exitText();
      }
      preview.load(previewState());
      if (ed.playing && ed.sound) preview.play(previewState(), ed.t);
      validateSelection();
      renderTimeline();
      const stage = ed.seq[clipIndexAt(ed.t)];
      if (stage?.kind === 'plate' && stage.plateId && !plateReady(stage.plateId)) {
        await requestPlate(stage.plateId, { reason: 'show', force: true });
      } else {
        renderFrame();
      }
      paintHead();
      renderInspector();
      paintStatus();
      if (hint) flashHint(hint);
      return r;
    } catch (err) {
      toast('Edit not saved', err.message, 'err');
      renderTimeline();
      return null;
    }
  }

  async function undo() {
    const snap = ed.undo.pop();
    if (!snap) return;
    ed.redo.push(snapshotDeck());
    await postDeck(snap, { undoable: false, hint: 'Undone' });
  }
  async function redo() {
    const snap = ed.redo.pop();
    if (!snap) return;
    ed.undo.push(snapshotDeck());
    await postDeck(snap, { undoable: false, hint: 'Redone' });
  }

  function validateSelection() {
    const s = ed.sel;
    if (!s) return;
    const d = deckEdit();
    if (s.type === 'ramp' && !d.speed[s.i]) ed.sel = null;
    if (s.type === 'zoom' && !(ed.deck.zoomShots || []).some((z) => shotKey(z) === s.key)) ed.sel = null;
    if (s.type === 'skip' && !d.zoomSkips[s.i]) ed.sel = null;
    if (s.type === 'lens' && !lensByKey(s.key)) ed.sel = null;
    if (s.type === 'voice' && !(ed.deck?.audio?.voiceClips || []).some((c) => c.key === s.key)) ed.sel = null;
    if (s.type === 'ride' && !audioDesk().music.rides[s.i]) ed.sel = null;
    if (s.type === 'clip' && !ed.seq.some((c) => c.id === s.id)) ed.sel = null;
    if (s.type === 'cut' && !d.cuts[s.i]) ed.sel = null;
  }

  // ─── Stage ───────────────────────────────────────────────────────────────────────────────
  /** Inset framing previews with the render's geometry: frame rect, corner radius, brand backdrop. */
  function paintFrame() {
    const el = $('liveStage');
    if (!el) return;
    const f = ed.deck?.frame;
    el.classList.toggle('is-inset', Boolean(f));
    if (!f) return;
    const W = liveW();
    const H = liveH();
    const c = ed.deck.brandColors || {};
    const [c0, c1] = f.background === 'accent' ? [c.gold, c.amber || c.gold] : f.background === 'ink' ? [c.ink, c.ink] : [c.surface || c.ink, c.ink];
    const vars = {
      '--frame-x': `${(f.x / W) * 100}%`,
      '--frame-y': `${(f.y / H) * 100}%`,
      '--frame-w': `${(f.w / W) * 100}%`,
      '--frame-h': `${(f.h / H) * 100}%`,
      '--frame-rx': `${(f.radius / f.w) * 100}%`,
      '--frame-ry': `${(f.radius / f.h) * 100}%`,
      '--frame-c0': c0 || '#151715',
      '--frame-c1': c1 || '#0b120d',
      '--frame-accent': c.gold || '#42f272',
      '--frame-glow': f.background === 'ink' ? '0%' : f.background === 'accent' ? '25%' : '33%',
      '--frame-shadow': f.shadow === 'off' ? 'none' : f.shadow === 'deep' ? '0 16px 44px rgba(0,0,0,.75)' : '0 12px 34px rgba(0,0,0,.55)',
    };
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  }

  function syncLiveSource() {
    const v = video();
    if (!v || !ed.deck?.live?.url) return;
    const base = ed.deck.live.url.split('?')[0];
    if (!v.src.includes(base)) v.src = ed.deck.live.url;
  }

  /**
   * Who gets the pointer when a card is composited over the recording. The card iframe sits
   * above the take, so by default it would swallow every drag meant for the zoom / magnifier
   * aim boxes underneath. Text mode owns the stage; an aim box in view owns it next; only then
   * does the card keep click-to-edit on its copy. Playback never routes into the iframe.
   */
  function routeStagePointer(cardOnTop) {
    const plateL = $('fhdFit');
    if (!plateL) return;
    if (!cardOnTop) {
      plateL.style.pointerEvents = '';
      return;
    }
    const aimBoxUp = !($('liveZoomBox')?.hidden ?? true) || !($('liveLensBox')?.hidden ?? true);
    plateL.style.pointerEvents = stagePointerOwner({ textMode: ed.textMode, playing: ed.playing, aimBoxUp }) === 'card' ? '' : 'none';
  }

  /** The iframe currently shows this plate's document (even if a fresher build is pending). */
  const plateHolds = (id) => Boolean(id) && state.activePlateId === id && P.ready() === id;
  // A stale frame counts as ready only while it holds unsaved copy — a forced reload would drop that.
  const plateReady = (id) => plateHolds(id) && !(ed.stalePlates.has(id) && !P.dirty());

  /** Ensure Program live-card HTML rows exist (rebuild if Studio loaded before Apply live cards). */
  async function ensureLiveCards(cardId = null) {
    const has = (id) => (state.htmlPlates || []).some((p) => p.id === id && p.htmlUrl);
    const anyLive = () => (state.htmlPlates || []).some((p) => p.liveCard && p.htmlUrl);
    if (cardId && has(cardId)) return true;
    if (!cardId && anyLive()) return true;
    // Prefer in-memory video payload before hitting the network.
    if (state.video?.htmlPlates?.length) {
      state.htmlPlates = state.video.htmlPlates;
      if (cardId && has(cardId)) return true;
      if (!cardId && anyLive()) return true;
    }
    try {
      const r = await api(`/api/video/${encodeURIComponent(slug())}/plates`);
      if (r?.plates) {
        state.htmlPlates = r.plates;
        if (state.video) state.video.htmlPlates = r.plates;
      }
    } catch {
      /* ignore */
    }
    if (cardId && has(cardId)) return true;
    if (!cardId && anyLive()) return true;
    try {
      const r = await api(`/api/video/${encodeURIComponent(slug())}/plates/rebuild-html`, { method: 'POST', body: {} });
      if (r?.plates) {
        state.htmlPlates = r.plates;
        if (state.video) state.video.htmlPlates = r.plates;
      }
    } catch {
      /* ignore */
    }
    return cardId ? has(cardId) : anyLive();
  }

  function plateHtmlKnown(id) {
    return Boolean((state.htmlPlates || []).find((p) => p.id === id)?.htmlUrl);
  }

  async function requestPlate(id, { reason = 'show', force = false } = {}) {
    if (!id || ed.loadingPlate === id) return;
    if (!force && plateReady(id)) return;
    // Soft-miss recovery: a cancelled iframe race used to blacklist plates permanently.
    if (ed.missing.has(id)) {
      if (force || plateHtmlKnown(id)) ed.missing.delete(id);
      else return;
    }
    // One iframe: never steal the frame for a prefetch / neighbor while a live card is up.
    const holdCard = ed.liveCardId || ed.compositeCardId || null;
    if (holdCard && id !== holdCard && reason !== 'show') return;
    if (ed.textMode) {
      const keep = ed.liveCardId || state.activePlateId;
      if (keep && id !== keep) return;
    }
    if (String(id).startsWith('overlay:')) {
      const okList = await ensureLiveCards(id);
      if (!okList) {
        ed.missing.add(id);
        return;
      }
      ed.missing.delete(id);
    }
    const gen = (ed.plateReqGen = (ed.plateReqGen || 0) + 1);
    ed.loadingPlate = id;
    paintLoading();
    try {
      if (P.dirty() && state.activePlateId && state.activePlateId !== id) await P.save();
      if (gen !== ed.plateReqGen) return;
      let ok = await P.load(id, { force: force || ed.stalePlates.delete(id) });
      if (gen !== ed.plateReqGen) return;
      // One retry — iframe onload / inline-edit arm can race the first paint.
      if (ok !== true && String(id).startsWith('overlay:') && shouldBlacklistPlateLoad(ok, { activePlateId: state.activePlateId, requestedId: id })) {
        await new Promise((r) => setTimeout(r, 80));
        if (gen !== ed.plateReqGen) return;
        ok = await P.load(id, { force: true });
        if (gen !== ed.plateReqGen) return;
      }
      if (ok !== true) {
        // Cancelled / superseded must not blacklist — that blanked Opening after omit/reorder.
        if (shouldBlacklistPlateLoad(ok, { activePlateId: state.activePlateId, requestedId: id })) {
          ed.missing.add(id);
        }
        return;
      }
      ed.missing.delete(id);
      if (ed.textMode) markPlateResync(id);
      else {
        P.motion();
        if (String(id).startsWith('overlay:')) P.composite?.(true);
        if (ed.needsPlateResync === id) {
          const c = curClip();
          const ms = playheadOnPlate(c, id) ? Math.max(0, (ed.t - c.at) * 1000) : 0;
          P.restart?.(ms);
          ed.needsPlateResync = null;
        }
      }
    } finally {
      if (ed.loadingPlate === id) ed.loadingPlate = null;
    }
    paintLoading();
    if (gen === ed.plateReqGen) renderFrame();
    if (ed.sel?.type === 'clip' && ed.seq.find((c) => c.id === ed.sel.id)?.plateId === id) renderInspector();
  }

  function joinStyle(c) {
    const j = c.join;
    const pinned = j?.pinned?.style;
    const st = pinned && pinned !== 'directed' ? pinned : j?.type || ed.deck?.transitions?.style || 'dissolve';
    if (j?.card && st !== 'dip') return 'dissolve';
    return st === 'directed' ? 'dissolve' : st;
  }

  function applyLiveSeek(v, rec) {
    ed.wantRec = rec;
    const plan = planLiveSeek({
      currentTime: v.currentTime || 0,
      wantRec: rec,
      seeking: v.seeking,
      readyState: v.readyState,
    });
    if (plan.action !== 'seek') return;
    try {
      if (typeof v.fastSeek === 'function') v.fastSeek(plan.wantRec);
      else v.currentTime = plan.wantRec;
    } catch {
      /* metadata still arriving */
    }
  }

  function drawLive(c, { outgoing = false } = {}) {
    const v = video();
    if (!v || !live().exists) return;
    const rec = edToRec(c, ed.t);
    const atEnd = rec >= c.recTo - 0.03;
    if (ed.playing && !atEnd) armLive(v, rec, { outgoing });
    else {
      if (!v.paused) v.pause();
      applyLiveSeek(v, rec);
    }
    const W = liveW();
    const H = liveH();
    // A selected zoom paints its push-in on the stage (strength and aim), so the slider is not a
    // silent aim-box resize — Escape is no longer required to see what the cut will do.
    const shot = !ed.playing && ed.sel?.type === 'zoom' ? selectedShot() : null;
    let zs;
    if (shot) {
      const p = ed.aim || shot.points?.[0] || { cx: W / 2, cy: H / 2 };
      zs = { zoom: ed.aimZoom || shot.zoom, cx: p.cx, cy: p.cy };
    } else {
      zs = ed.fx ? zoomStateAt(ed.deck.zoomShots, rec, ed.deck.zoomTiming) : { zoom: 1 };
    }
    // Push-ins without an aim point still scale from frame centre (matches ffmpeg default).
    if (zs.zoom > 1.001) {
      const cx = zs.cx ?? W / 2;
      const cy = zs.cy ?? H / 2;
      const style = zoomPreviewStyle(cx, cy, { zoom: zs.zoom, width: W, height: H });
      v.style.transformOrigin = style.transformOrigin;
      v.style.transform = style.transform;
    } else {
      v.style.transform = '';
      v.style.transformOrigin = '';
    }
    const lens = drawLens(outgoing ? null : rec);
    if (!outgoing) ed.hud = { rate: rateAt(rec), zoom: zs.zoom, lens };
  }

  // ─── Magnifier (canvas loupe over the recording; not scaled by the camera zoom) ──────────
  function lensAt(rec) {
    if (rec == null || !ed.fx) return null;
    const sel = selectedLens();
    const list = (ed.deck?.lenses || []).filter((l) => rec >= l.t && rec <= l.t + l.dur);
    // While aiming, the selected lens shows where it is going to be.
    if (sel && sel.source !== 'off' && ed.lensAim && !ed.playing) return { ...sel, ...lensShape(sel, ed.lensAim) };
    return list.find((l) => l.key === sel?.key) || list.at(-1) || null;
  }

  /** Geometry of a lens with its target moved/resized (same sizing rules as lensGeometry). */
  function lensShape(lens, aim) {
    const rect = { x: aim.x - aim.w / 2, y: aim.y - aim.h / 2, w: aim.w, h: aim.h };
    const { zoom, diameter, S } = lensLoupe(Math.max(rect.w, rect.h), aim.zoom);
    return { rect, path: null, zoom, diameter, S };
  }

  /** Edge-smear crop so corner targets still fill the loupe (mirrors ffmpeg pad+fillborders). */
  function loupeSourceCanvas(v, cx, cy, crop, vidW, vidH) {
    const size = Math.max(1, Math.round(crop));
    if (!ed._loupeBuf || ed._loupeBuf.width !== size) {
      ed._loupeBuf = document.createElement('canvas');
      ed._loupeBuf.width = size;
      ed._loupeBuf.height = size;
    }
    const buf = ed._loupeBuf;
    const t = buf.getContext('2d');
    t.clearRect(0, 0, size, size);
    const x0 = cx - size / 2;
    const y0 = cy - size / 2;
    const left = Math.max(0, Math.ceil(-x0));
    const top = Math.max(0, Math.ceil(-y0));
    const right = Math.max(0, Math.ceil(x0 + size - vidW));
    const bottom = Math.max(0, Math.ceil(y0 + size - vidH));
    const srcX = Math.max(0, Math.floor(x0));
    const srcY = Math.max(0, Math.floor(y0));
    const srcW = Math.max(0, size - left - right);
    const srcH = Math.max(0, size - top - bottom);
    if (srcW > 0 && srcH > 0) t.drawImage(v, srcX, srcY, srcW, srcH, left, top, srcW, srcH);
    if (left > 0 && srcH > 0) t.drawImage(v, srcX, srcY, 1, srcH, 0, top, left, srcH);
    if (right > 0 && srcH > 0) t.drawImage(v, srcX + srcW - 1, srcY, 1, srcH, left + srcW, top, right, srcH);
    if (top > 0 && srcW > 0) t.drawImage(v, srcX, srcY, srcW, 1, left, 0, srcW, top);
    if (bottom > 0 && srcW > 0) t.drawImage(v, srcX, srcY + srcH - 1, srcW, 1, left, top + srcH, srcW, bottom);
    if (left > 0 && top > 0) t.drawImage(v, srcX, srcY, 1, 1, 0, 0, left, top);
    if (right > 0 && top > 0) t.drawImage(v, srcX + srcW - 1, srcY, 1, 1, left + srcW, 0, right, top);
    if (left > 0 && bottom > 0) t.drawImage(v, srcX, srcY + srcH - 1, 1, 1, 0, top + srcH, left, bottom);
    if (right > 0 && bottom > 0) t.drawImage(v, srcX + srcW - 1, srcY + srcH - 1, 1, 1, left + srcW, top + srcH, right, bottom);
    return buf;
  }

  function drawLens(rec) {
    const cv = $('liveLens');
    const v = video();
    if (!cv || !v) return null;
    const lens = lensAt(rec);
    const selected = selectedLens();
    const hold = planFrameEditor({
      selected: Boolean(selected) && selected.source !== 'off',
      blockStart: selected?.t ?? 0,
      blockEnd: (selected?.t ?? 0) + (selected?.dur ?? 0),
      playhead: rec,
      playing: ed.playing,
    }).visible;
    const vp = $('liveViewport');
    const cssW = vp?.clientWidth || 0;
    const cw = Math.round(cssW * (window.devicePixelRatio || 1));
    const ch = Math.round((vp?.clientHeight || 0) * (window.devicePixelRatio || 1));
    if (cv.width !== cw || cv.height !== ch) {
      cv.width = cw;
      cv.height = ch;
    }
    const g = cv.getContext('2d');
    const paint = planLensPaint({ hasLens: Boolean(lens), viewportCssPx: cssW, readyState: v.readyState, hold });
    if (paint.action === 'clear') {
      g.clearRect(0, 0, cv.width, cv.height);
      return null;
    }
    // Mid-seek the decoder often dips below HAVE_CURRENT_DATA — keep the last loupe.
    if (paint.action === 'keep') return lens;
    g.clearRect(0, 0, cv.width, cv.height);
    const W = liveW();
    const H = liveH();
    const k = cw / W;
    const aiming = ed.lensAim && !ed.playing && lens.key === ed.sel?.key;
    const T = rec - lens.t;
    const st = aiming ? { open: 1, scale: 1, alpha: 1, swell: 1 } : lensOpenState(T, lens.dur, ed.deck.lensTiming);
    if (st.alpha <= 0.001) return null;
    const { x: tx, y: ty } = lensCentre(lens, clamp(T, 0, lens.dur));
    const cx = clamp(tx, 0, W);
    const cy = clamp(ty, 0, H);
    const R0 = lens.diameter / 2;
    const R = R0 * st.scale;
    const mx = cx * k;
    const my = cy * k;
    const Rk = R * k;
    const rim = rimWidth(lens.diameter);
    const rimHex = ed.deck.lensRim || '#F6AA1E';
    // Source: the frame around the target at full zoom, over the glass's whole reach.
    const reach = (1 + GLASS.bulge + GLASS.bevel) / st.swell;
    const crop = (2 * R * reach + 8) / lens.zoom;
    g.save();
    g.globalAlpha = st.alpha;
    // Drop shadow, falling slightly below the glass.
    g.save();
    g.shadowColor = `rgba(0,0,0,${(GLASS.shadow / 255).toFixed(3)})`;
    g.shadowBlur = LENS_PAD * k * 1.1;
    g.shadowOffsetY = GLASS.shadowDrop * Rk;
    g.beginPath();
    g.arc(mx, my, Rk, 0, Math.PI * 2);
    g.fillStyle = '#000';
    g.fill();
    g.restore();
    // Glass: concentric bands, each drawing the magnified frame at that radius' sampling factor
    // (outer bands squeeze toward the bevel, the centre stays flat) — the canvas take on geq's
    // per-pixel refraction.
    g.save();
    g.beginPath();
    g.arc(mx, my, Rk, 0, Math.PI * 2);
    g.clip();
    try {
      const src = loupeSourceCanvas(v, cx, cy, crop, W, H);
      const full = src.width * lens.zoom * k; // on-screen size of the source at full magnification
      const bands = 14;
      for (let i = bands - 1; i >= 0; i--) {
        const d1 = (i + 1) / bands;
        const dm = (i + 0.5) / bands;
        const gF = glassProfile(dm) / st.swell;
        if (i < bands - 1) {
          g.save();
          g.beginPath();
          g.arc(mx, my, Rk * d1, 0, Math.PI * 2);
          g.clip();
        }
        const size = full / gF;
        g.drawImage(src, mx - size / 2, my - size / 2, size, size);
        if (i < bands - 1) g.restore();
      }
    } catch {
      /* frame not decodable yet */
    }
    // Shade: vignette toward the rim and the dark bevel band.
    const vig = g.createRadialGradient(mx, my, 0, mx, my, Rk);
    for (const d of [0, 0.6, 0.8, 0.88, 0.94, 1]) vig.addColorStop(d, `rgba(0,0,0,${(1 - glassShade(d)).toFixed(3)})`);
    g.fillStyle = vig;
    g.fillRect(mx - Rk, my - Rk, 2 * Rk, 2 * Rk);
    // Light: specular blob upper-left, soft top light, edge arc on the lit side, Fresnel crescent lower-right.
    const spec = g.createRadialGradient(mx - 0.5 * Rk, my - 0.52 * Rk, 0, mx - 0.5 * Rk, my - 0.52 * Rk, 0.3 * Rk);
    spec.addColorStop(0, `rgba(255,255,255,${(GLASS.specular / 255).toFixed(3)})`);
    spec.addColorStop(0.5, `rgba(255,255,255,${(GLASS.specular / 255 / 3).toFixed(3)})`);
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = spec;
    g.fillRect(mx - Rk, my - Rk, 2 * Rk, 2 * Rk);
    const top = g.createLinearGradient(0, my - Rk, 0, my);
    top.addColorStop(0, `rgba(255,255,255,${(GLASS.topLight / 255).toFixed(3)})`);
    top.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = top;
    g.fillRect(mx - Rk, my - Rk, 2 * Rk, Rk);
    g.lineCap = 'round';
    g.beginPath();
    g.arc(mx, my, Rk * 0.955, Math.PI * 0.95, Math.PI * 1.55);
    g.lineWidth = Math.max(1, 0.03 * Rk);
    g.strokeStyle = `rgba(255,255,255,${(GLASS.edgeLight / 255).toFixed(3)})`;
    g.stroke();
    g.beginPath();
    g.arc(mx, my, Rk * 0.93, Math.PI * 0.05, Math.PI * 0.45);
    g.lineWidth = 0.12 * Rk;
    g.strokeStyle = `rgba(255,255,255,${(GLASS.crescent / 255 / 2).toFixed(3)})`;
    g.stroke();
    g.restore();
    // Rim: lit metal from the top, a dark outer line, a bright inner bevel.
    const metal = g.createLinearGradient(0, my - Rk, 0, my + Rk);
    metal.addColorStop(0, shadeHex(rimHex, 1 + GLASS.rimLight / 2));
    metal.addColorStop(1, shadeHex(rimHex, 1 - GLASS.rimLight / 2));
    g.beginPath();
    g.arc(mx, my, Math.max(0, R - rim / 2) * k, 0, Math.PI * 2);
    g.lineWidth = rim * k;
    g.strokeStyle = metal;
    g.stroke();
    g.beginPath();
    g.arc(mx, my, Math.max(0, R - 0.6) * k, 0, Math.PI * 2);
    g.lineWidth = Math.max(1, 1.2 * k);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.stroke();
    g.beginPath();
    g.arc(mx, my, Math.max(0, R - rim) * k, 0, Math.PI * 2);
    g.lineWidth = Math.max(1, 1.1 * k);
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.stroke();
    g.restore();
    return lens;
  }

  function drawPlate(c) {
    if (!plateReady(c.plateId)) {
      requestPlate(c.plateId);
      return false;
    }
    if (!ed.textMode) P.seek(Math.max(0, (ed.t - c.at) * 1000));
    return true;
  }

  function renderFrame() {
    if (!ed.active || !ed.seq.length) return;
    const i = clipIndexAt(ed.t);
    const c = ed.seq[i];
    const prev = ed.seq[i - 1];
    const indexChanged = ed.cur !== i;
    ed.cur = i;
    if (indexChanged) ed.liveSeeked = false;
    ed.hud = null;
    const inJoin = Boolean(ed.fx && prev && c.overlap > 0 && ed.t < c.at + c.overlap);
    const joinP = inJoin ? (ed.t - c.at) / c.overlap : 0;
    const liveHit = c.kind === 'live' ? liveHitAtPlayhead() : null;
    const editingCard = Boolean(ed.textMode && ed.liveCardId && c.kind === 'live');
    const wantsCard = Boolean(liveHit || editingCard);
    // Plate→live join onto a card: the plate iframe can hold only one of them per frame.
    const frameOwner = inJoin ? joinFrameOwner(prev, c, joinP, { curNeedsCard: wantsCard, lockCard: editingCard }) : null;
    const trans = inJoin && frameOwner !== 'card';
    // One surface: plate→plate / live→live cannot dual-draw. Focus one clip (avoids omitted-middle flash).
    const soloFocus = trans ? soloJoinFocus(prev, c, joinP) : null;
    const plateFocus = soloFocus?.kind === 'plate' ? soloFocus : null;
    const liveFocus = soloFocus?.kind === 'live' ? soloFocus : null;
    const plateL = $('fhdFit');
    const liveL = $('liveStage');
    const layer = (k) => (k === 'plate' ? plateL : liveL);
    for (const L of [plateL, liveL]) for (const p of LAYER_PROPS) L.style[p] = '';
    const inL = layer(c.kind);
    const outL = trans && !soloFocus ? layer(prev.kind) : null;
    const showLiveCard = wantsCard && frameOwner !== 'plate';
    const wantCardId = ed.textMode && ed.liveCardId ? ed.liveCardId : liveHit?.card?.id || null;
    // Keep the last composited card visible while its frame loads — hiding the layer every
    // ready-flicker (or while prefetch stole the iframe) looked like a blink storm.
    const cardFrameReady = Boolean(wantCardId && plateReady(wantCardId));
    const showCardLayer = Boolean(
      showLiveCard && (cardFrameReady || (ed.textMode && ed.liveCardId) || (ed.compositeCardId && ed.compositeCardId === wantCardId))
    );
    const stagePlate = plateFocus || (!soloFocus && c.kind === 'plate' ? c : null);
    // The plate this frame wants in the iframe: the clip on stage, or the outgoing plate of a
    // plate→live wipe. Show the layer only when the iframe actually holds that plate — never the
    // document left over from the previous frame (an omitted plate, the next card…).
    const platePartner = stagePlate || (outL === plateL ? prev : null);
    const plateContentReady = Boolean(platePartner && plateHolds(platePartner.plateId));
    const plateWasHidden = plateL.hidden;
    plateL.hidden = !(showCardLayer || plateContentReady);
    if (plateWasHidden && !plateL.hidden) P.fit();
    liveL.hidden = !(inL === liveL || outL === liveL || liveFocus);
    if (showLiveCard) {
      liveL.hidden = false;
      plateL.style.zIndex = '3';
      liveL.style.zIndex = '1';
      document.body.classList.add('is-live-card');
      if (wantCardId && !cardFrameReady) requestPlate(wantCardId, { reason: 'show' });
    } else {
      inL.style.zIndex = '2';
      if (outL) outL.style.zIndex = '1';
      plateL.style.pointerEvents = '';
      if (ed.compositeCardId) P.composite?.(false);
      ed.compositeCardId = null;
      ed.compositeSeekMs = null;
      document.body.classList.remove('is-live-card');
    }

    let ready = true;
    if (stagePlate) {
      ready = drawPlate(stagePlate) && plateContentReady;
    } else if (liveFocus) {
      drawLive(liveFocus, { outgoing: liveFocus === prev });
      if (showLiveCard && liveFocus === c) syncLiveCardComposite(liveHit);
    } else {
      drawLive(c);
      if (showLiveCard) syncLiveCardComposite(liveHit);
    }
    if (trans && soloFocus) {
      // Solo surface: dip the one layer (paintTransition handles inL === outL).
      paintTransition(joinStyle(c), joinP, layer(soloFocus.kind), layer(soloFocus.kind));
      // Hide while seeking across an omitted hole so middle recording frames never paint.
      if (liveFocus && liveRecDiscontinuous(prev, c)) {
        const v = video();
        const want = edToRec(liveFocus, ed.t);
        if (v && (v.seeking || Math.abs((v.currentTime || 0) - want) > 0.45)) liveL.style.opacity = '0';
      }
    } else if (trans && !soloFocus) {
      if (prev.kind === 'plate') drawPlate(prev);
      else drawLive(prev, { outgoing: true });
      paintTransition(joinStyle(c), joinP, inL, outL);
    } else if ((c.kind === 'plate' || plateFocus) && video() && !video().paused) {
      video().pause();
    }
    const stallId = stagePlate?.plateId || c.plateId;
    ed.stall = ed.playing && !ready && stallId && !ed.missing.has(stallId);
    $('plateEmpty').hidden = !(stagePlate && ed.missing.has(stagePlate.plateId));

    // Get the next surface ready so the cut never waits (skip while editing — don't stomp the frame).
    const n = ed.seq[i + 1];
    if (n && !ed.textMode) {
      // Prefetch only — must not unload a live card currently composited in the plate iframe.
      if (c.kind === 'live' && n.kind === 'plate' && ed.t > c.at + c.overlap && n.at - ed.t < 2.5) {
        requestPlate(n.plateId, { reason: 'prefetch' });
      }
      if (c.kind === 'plate' && n.kind === 'live' && !trans) {
        const v = video();
        if (v && v.paused && ed.preSeek !== n.id && Math.abs(v.currentTime - n.recFrom) > 0.05) {
          ed.preSeek = n.id;
          v.currentTime = n.recFrom;
        }
      }
    }
    if (c.kind !== 'live') drawLens(null);
    paintHud(c, trans ? joinStyle(c) : null);
    paintZoomBox();
    paintLensBox();
    routeStagePointer(showLiveCard);
    const cardHint = c.kind === 'live' ? liveCardAtPlayhead()?.id || '' : '';
    const cardChanged = cardHint !== ed.cardHint;
    ed.cardHint = cardHint;
    if (indexChanged || cardChanged) {
      paintClipChip();
      if (!ed.textMode) paintTextMode();
    }
    if (indexChanged) {
      paintTools();
      document.querySelectorAll('#etlClips .etl-clip').forEach((el) => el.classList.toggle('is-cur', Number(el.dataset.i) === i));
      // Look/style changed while the playhead was elsewhere — resync as we enter the plate.
      if (c.kind === 'plate' && ed.needsPlateResync === c.plateId && !ed.textMode) flushPlateResync();
    }
  }

  function paintHud(c, transition) {
    const hud = $('edHud');
    if (!hud) return;
    const chips = [];
    if (transition) chips.push(`<span class="ed-chip tr">${T_GLYPH[transition] || ICONS.transition}${escapeHtml(ed.deck.transitionStyles?.[transition]?.label || transition)}</span>`);
    if (ed.hud && Math.abs(ed.hud.rate - 1) > 0.01) chips.push(`<span class="ed-chip speed${ed.hud.rate < 1 ? ' slow' : ''}">${ed.hud.rate < 1 ? ICONS.slow : ICONS.speed}${fmtRate(ed.hud.rate)}</span>`);
    if (ed.hud && ed.hud.zoom > 1.01) chips.push(`<span class="ed-chip zoom">${ICONS.zoom}${ed.hud.zoom.toFixed(2)}×</span>`);
    if (ed.hud?.lens) chips.push(`<span class="ed-chip lens">${ICONS.lens}${ed.hud.lens.zoom.toFixed(1)}× magnifier</span>`);
    const html = chips.join('');
    if (hud.innerHTML !== html) hud.innerHTML = html;
  }

  function paintLoading() {
    const el = $('edLoading');
    if (!el) return;
    const c = curClip();
    const forPlate = ed.loadingPlate && c?.kind === 'plate' && c.plateId === ed.loadingPlate;
    const previewId = ed.liveCardId || ed.compositeCardId || liveCardAtPlayhead()?.id;
    const forCard = ed.loadingPlate && previewId && ed.loadingPlate === previewId;
    el.hidden = !(forPlate || forCard);
  }

  // ─── Zoom aim box (selected zoom shot, paused) ───────────────────────────────────────────
  function selectedShot() {
    if (ed.sel?.type !== 'zoom') return null;
    return (ed.deck?.zoomShots || []).find((s) => shotKey(s) === ed.sel.key) || null;
  }

  /** Fill the stage aim card (zoom / magnifier) with a title, optional meta, and action chips. */
  function paintAimTip(root, { kind, meta = '', actions = [] } = {}) {
    const tip = root?.querySelector?.('.stage-aim-tip');
    if (!tip) return;
    const kindEl = tip.querySelector('.stage-aim-tip__kind');
    const metaEl = tip.querySelector('.stage-aim-tip__meta');
    const list = tip.querySelector('.stage-aim-tip__actions');
    if (kindEl) kindEl.textContent = kind || '';
    if (metaEl) {
      metaEl.textContent = meta || '';
      metaEl.hidden = !meta;
    }
    if (list) {
      list.innerHTML = actions
        .map((a) => `<li><span class="stage-aim-tip__key">${escapeHtml(a.key)}</span><em>${escapeHtml(a.label)}</em></li>`)
        .join('');
      list.hidden = !actions.length;
    }
  }

  function paintZoomBox() {
    const box = $('liveZoomBox');
    if (!box) return;
    const shot = selectedShot();
    const c = curClip();
    const rec = c?.kind === 'live' ? edToRec(c, ed.t) : null;
    const editor = planFrameEditor({
      selected: Boolean(shot),
      blockStart: shot?.start ?? 0,
      blockEnd: shot?.end ?? 0,
      playhead: rec,
      playing: ed.playing,
      reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
    });
    if (!editor.visible || !ed.deck) {
      box.hidden = true;
      return;
    }
    const zoom = ed.aimZoom || shot.zoom;
    // The stage already shows the push-in; the box is a full-frame drag surface (pan) with corner
    // handles for strength — not a crop preview on a 1× frame.
    box.hidden = false;
    box.dataset.hit = String(FRAME_EDITOR_HIT);
    const strength = box.querySelector('[data-frame-zoom]');
    if (strength && document.activeElement !== strength) strength.value = String(Number(zoom.toFixed(2)));
    box.style.left = '0';
    box.style.top = '0';
    box.style.width = '100%';
    box.style.height = '100%';
    box.classList.toggle('is-auto', shot.source === 'auto');
    box.classList.add('is-live');
    paintAimTip(box, shot.source === 'auto'
      ? {
          kind: 'Auto zoom',
          meta: `${zoom.toFixed(2)}×`,
          actions: [{ key: 'Drag', label: 'take over & aim' }],
        }
      : {
          kind: 'Focus zoom',
          meta: `${zoom.toFixed(2)}×`,
          actions: [
            { key: 'Drag', label: 'aim' },
            { key: 'Corners', label: 'strength' },
          ],
        });
  }

  function wireZoomBox() {
    const box = $('liveZoomBox');
    const vp = $('liveViewport');
    if (!box || !vp) return;
    let drag = null;
    box.addEventListener('pointerdown', (e) => {
      const shot = selectedShot();
      if (!shot) return;
      const W = liveW();
      const H = liveH();
      const p = ed.aim || shot.points?.[0] || { cx: W / 2, cy: H / 2 };
      drag = {
        x: e.clientX,
        y: e.clientY,
        cx: p.cx,
        cy: p.cy,
        zoom: ed.aimZoom || shot.zoom,
        shot,
        corner: e.target.classList.contains('zh'),
        moved: false,
      };
      box.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const rect = vp.getBoundingClientRect();
      const W = liveW();
      const H = liveH();
      drag.moved = true;
      if (drag.corner) {
        // Corners of the full-frame surface: pull toward the centre to push in further.
        const cxPx = rect.left + rect.width / 2;
        const cyPx = rect.top + rect.height / 2;
        const half = Math.max(
          Math.max(Math.abs(e.clientX - cxPx) / rect.width, Math.abs(e.clientY - cyPx) / rect.height),
          0.02
        );
        const [lo, hi] = ed.deck.ranges.zoom;
        ed.aimZoom = r3(clamp(1 / (2 * half), lo, hi));
        ed.aim = { cx: drag.cx, cy: drag.cy };
      } else {
        const zoom = ed.aimZoom || drag.zoom;
        const aim = clampZoomCenter(
          drag.cx - ((e.clientX - drag.x) / rect.width) * (W / zoom),
          drag.cy - ((e.clientY - drag.y) / rect.height) * (H / zoom),
          { zoom, width: W, height: H }
        );
        ed.aim = { cx: aim.cx, cy: aim.cy };
      }
      paintZoomBox();
      renderFrame();
    });
    const finish = async () => {
      if (!drag) return;
      const { shot, moved } = drag;
      drag = null;
      const aim = ed.aim;
      const zoom = ed.aimZoom || shot.zoom;
      ed.aim = null;
      ed.aimZoom = null;
      if (!moved || !aim) return;
      if (shot.source === 'auto') {
        await adoptShot(shot, { x: aim.cx, y: aim.cy, zoom });
        return;
      }
      const zooms = deckEdit().zooms.map((z) => (z.id === shot.id ? { ...z, x: aim.cx, y: aim.cy, zoom } : z));
      await postDeck({ zooms });
    };
    box.addEventListener('pointerup', finish);
    box.addEventListener('pointercancel', finish);
    box.querySelector('.frame-editor')?.addEventListener('pointerdown', (e) => e.stopPropagation());
    box.querySelector('[data-frame-zoom]')?.addEventListener('change', (e) => {
      const current = selectedShot();
      if (!current) return;
      const nextZoom = Number(e.target.value);
      ed.aimZoom = nextZoom;
      const done = () => {
        ed.aimZoom = null;
      };
      if (current.source === 'auto') {
        adoptShot(current, { zoom: nextZoom })?.finally(done);
        return;
      }
      const d = deckEdit();
      postDeck({ zooms: d.zooms.map((z) => (z.id === current.id ? { ...z, zoom: nextZoom } : z)) }, { hint: 'Zoom strength saved' })?.finally(done);
    });
    box.querySelector('[data-frame-remove="zoom"]')?.addEventListener('click', () => {
      document.querySelector('#inspectorRoot [data-act="remove"]')?.click();
    });
  }

  // ─── Magnifier aim box (selected lens, paused, playhead inside it) ───────────────────────
  const lensTarget = (l) => ({ x: l.rect.x + l.rect.w / 2, y: l.rect.y + l.rect.h / 2, w: l.rect.w, h: l.rect.h, zoom: l.source === 'edit' ? deckLens(l)?.zoom : undefined });
  const deckLens = (l) => deckEdit().lenses.find((x) => x.id === l.id) || null;

  /** Gap between the magnifier ring and the HUD card (screen px). */
  const LENS_HUD_GAP = 14;

  /** Shortest distance from the circle edge to the HUD rect; positive = clear. */
  function lensHudClearance(hx, hy, hudW, hudH, ccx, ccy, r, gap) {
    const l = hx - hudW / 2;
    const t = hy - hudH / 2;
    const ri = hx + hudW / 2;
    const b = hy + hudH / 2;
    const nx = clamp(ccx, l, ri);
    const ny = clamp(ccy, t, b);
    return Math.hypot(ccx - nx, ccy - ny) - (r + gap);
  }

  /**
   * Park the HUD just outside the on-screen magnifier circle, biased toward the stage
   * centre so it reads naturally in corners and never sits on top of the glass.
   */
  function placeLensHud() {
    const hud = $('liveLensHud');
    const box = $('liveLensBox');
    const plate = $('playerPlate');
    if (!hud || !box || !plate || box.hidden) return;

    const card = hud.querySelector('.lens-stage-hud__card');
    if (!card) return;

    const bRect = box.getBoundingClientRect();
    const pRect = plate.getBoundingClientRect();
    const hudW = card.offsetWidth || 188;
    const hudH = card.offsetHeight || 80;

    const ccx = bRect.left + bRect.width / 2;
    const ccy = bRect.top + bRect.height / 2;
    const r = Math.min(bRect.width, bRect.height) / 2;
    const gap = LENS_HUD_GAP;
    const margin = 8;

    const plateCx = pRect.left + pRect.width / 2;
    const plateCy = pRect.top + pRect.height / 2;

    const dirs = [];
    let dx = plateCx - ccx;
    let dy = plateCy - ccy;
    const dlen = Math.hypot(dx, dy);
    if (dlen < 6) dirs.push({ dx: 0, dy: 1, weight: 4 });
    else {
      dirs.push({ dx: dx / dlen, dy: dy / dlen, weight: 5 });
      dirs.push({ dx: -dx / dlen, dy: -dy / dlen, weight: 1 });
    }
    for (const [ux, uy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
      [0.707, 0.707],
      [-0.707, 0.707],
      [0.707, -0.707],
      [-0.707, -0.707],
    ]) {
      dirs.push({ dx: ux, dy: uy, weight: 0 });
    }

    const clampHud = (hx, hy) => {
      const halfW = hudW / 2;
      const halfH = hudH / 2;
      return {
        x: clamp(hx, pRect.left + margin + halfW, pRect.right - margin - halfW),
        y: clamp(hy, pRect.top + margin + halfH, pRect.bottom - margin - halfH),
      };
    };

    let best = null;
    for (const { dx: ux, dy: uy, weight } of dirs) {
      const proj = (hudW / 2) * Math.abs(ux) + (hudH / 2) * Math.abs(uy);
      const dist = r + gap + proj;
      const raw = { x: ccx + ux * dist, y: ccy + uy * dist };
      const { x, y } = clampHud(raw.x, raw.y);
      const clear = lensHudClearance(x, y, hudW, hudH, ccx, ccy, r, gap);
      const overflow =
        (x - hudW / 2 < pRect.left + margin ? 1 : 0) +
        (x + hudW / 2 > pRect.right - margin ? 1 : 0) +
        (y - hudH / 2 < pRect.top + margin ? 1 : 0) +
        (y + hudH / 2 > pRect.bottom - margin ? 1 : 0);
      const score = (clear < 0 ? clear * 12 : clear) - overflow * 80 + weight;
      if (!best || score > best.score) best = { x, y, score };
    }

    if (!best) return;
    hud.style.left = `${best.x - pRect.left}px`;
    hud.style.top = `${best.y - pRect.top}px`;
    hud.style.transform = 'translate(-50%, -50%)';
  }

  function paintLensHud(lens, zNow, sizeNow) {
    const hud = $('liveLensHud');
    if (!hud) return;
    const ico = hud.querySelector('[data-lens-hud-ico]');
    const title = hud.querySelector('[data-lens-hud-title]');
    const meta = hud.querySelector('[data-lens-hud-meta]');
    const controls = hud.querySelector('[data-lens-hud-controls]');
    const hint = hud.querySelector('[data-lens-hud-hint]');
    const take = hud.querySelector('[data-lens-hud-take]');
    const rm = hud.querySelector('[data-frame-remove="lens"]');
    const recorded = lens.source === 'auto';
    if (ico && !ico.querySelector('svg')) ico.innerHTML = ICONS.lens;
    if (rm && !rm.querySelector('svg')) rm.innerHTML = ICONS.x;
    if (title) title.textContent = recorded ? 'Recorded magnifier' : 'Magnifier';
    if (meta) {
      meta.textContent = recorded ? '' : `${Number(zNow).toFixed(1)}×`;
      meta.hidden = recorded;
    }
    if (controls) controls.hidden = recorded;
    if (hint) {
      hint.textContent = recorded ? 'Drag the ring to claim and aim' : 'Drag the ring to aim';
      hint.hidden = false;
    }
    if (take) {
      take.hidden = !recorded;
      take.setAttribute('aria-label', 'Take over this recorded magnifier');
    }
    if (rm) rm.setAttribute('aria-label', recorded ? 'Switch off recorded magnifier' : 'Remove magnifier');
    hud.classList.toggle('is-recorded', recorded);
  }

  function paintLensBox() {
    const box = $('liveLensBox');
    const hud = $('liveLensHud');
    if (!box) return;
    const lens = selectedLens();
    const c = curClip();
    const rec = c?.kind === 'live' ? edToRec(c, ed.t) : null;
    const editor = planFrameEditor({
      selected: Boolean(lens) && lens.source !== 'off',
      blockStart: lens?.t ?? 0,
      blockEnd: (lens?.t ?? 0) + (lens?.dur ?? 0),
      playhead: rec,
      playing: ed.playing,
      reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
    });
    if (!editor.visible) {
      box.hidden = true;
      if (hud) hud.hidden = true;
      return;
    }
    const W = liveW();
    const H = liveH();
    const shape = ed.lensAim ? lensShape(lens, ed.lensAim) : lens;
    const { x, y } = ed.lensAim || lensCentre(lens, clamp(rec - lens.t, 0, lens.dur));
    const { ox: canvasX, oy: canvasY } = loupeOrigin(x, y, shape.S, W, H);
    const ox = canvasX + LENS_PAD;
    const oy = canvasY + LENS_PAD;
    box.hidden = false;
    box.dataset.hit = String(FRAME_EDITOR_HIT);
    const own = lens.source === 'edit' ? deckLens(lens) : null;
    const strength = hud?.querySelector('[data-frame-lens-zoom]');
    const size = hud?.querySelector('[data-frame-lens-size]');
    const zNow = ed.lensAim?.zoom ?? own?.zoom ?? lens.zoom;
    const sizeNow = Math.max(ed.lensAim?.w ?? own?.w ?? lens.rect?.w ?? 80, ed.lensAim?.h ?? own?.h ?? lens.rect?.h ?? 80);
    if (strength && document.activeElement !== strength) strength.value = String(Number(zNow).toFixed(2));
    if (size && document.activeElement !== size) size.value = String(Math.round(sizeNow));
    box.style.left = `${(ox / W) * 100}%`;
    box.style.top = `${(oy / H) * 100}%`;
    box.style.width = `${(shape.diameter / W) * 100}%`;
    box.style.height = `${(shape.diameter / H) * 100}%`;
    box.classList.toggle('is-auto', lens.source === 'auto');
    if (hud) {
      hud.hidden = false;
      paintLensHud(lens, zNow, sizeNow);
      placeLensHud();
    }
  }

  function wireLensBox() {
    const box = $('liveLensBox');
    const hud = $('liveLensHud');
    const vp = $('liveViewport');
    if (!box || !vp) return;
    let drag = null;
    box.addEventListener('pointerdown', (e) => {
      const lens = selectedLens();
      if (!lens || lens.source === 'off') return;
      drag = { x: e.clientX, y: e.clientY, start: lensTarget(lens), lens, moved: false };
      hud?.classList.add('is-dragging');
      box.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const rect = vp.getBoundingClientRect();
      const W = liveW();
      const H = liveH();
      const dx = ((e.clientX - drag.x) / rect.width) * W;
      const dy = ((e.clientY - drag.y) / rect.height) * H;
      if (Math.abs(dx) + Math.abs(dy) < 2 && !drag.moved) return;
      drag.moved = true;
      const s = drag.start;
      ed.lensAim = { ...s, x: Math.round(clamp(s.x + dx, 0, W)), y: Math.round(clamp(s.y + dy, 0, H)) };
      paintLensBox();
      renderFrame();
    });
    const finish = async () => {
      if (!drag) return;
      const { lens, moved } = drag;
      drag = null;
      hud?.classList.remove('is-dragging');
      const aim = ed.lensAim;
      ed.lensAim = null;
      if (!moved || !aim) return renderFrame();
      const shape = { x: aim.x, y: aim.y, w: aim.w, h: aim.h };
      if (lens.source === 'auto') return adoptLens(lens, shape);
      await postDeck({ lenses: deckEdit().lenses.map((l) => (l.id === lens.id ? { ...l, ...shape } : l)) }, { hint: 'Magnifier moved' });
    };
    box.addEventListener('pointerup', finish);
    box.addEventListener('pointercancel', finish);
    hud?.addEventListener('pointerdown', (e) => e.stopPropagation());
    const saveLensPatch = (patch) => {
      const current = selectedLens();
      if (!current || current.source === 'off') return;
      if (current.source === 'auto') return adoptLens(current, patch);
      const d = deckEdit();
      return postDeck({ lenses: d.lenses.map((l) => (l.id === current.id ? { ...l, ...patch } : l)) }, { hint: 'Magnifier saved' });
    };
    const zoomEl = hud?.querySelector('[data-frame-lens-zoom]');
    const sizeEl = hud?.querySelector('[data-frame-lens-size]');
    const metaEl = hud?.querySelector('[data-lens-hud-meta]');
    zoomEl?.addEventListener('input', (e) => {
      if (metaEl && !metaEl.hidden) metaEl.textContent = `${Number(e.target.value).toFixed(1)}×`;
    });
    zoomEl?.addEventListener('change', (e) => {
      saveLensPatch({ zoom: Number(e.target.value) });
    });
    sizeEl?.addEventListener('change', (e) => {
      const size = Math.round(Number(e.target.value));
      const current = selectedLens();
      const own = current?.source === 'edit' ? deckLens(current) : null;
      const w0 = own?.w ?? current?.rect?.w ?? size;
      const h0 = own?.h ?? current?.rect?.h ?? size;
      const max = Math.max(w0, h0, 1);
      saveLensPatch({ w: Math.max(16, Math.round((w0 * size) / max)), h: Math.max(12, Math.round((h0 * size) / max)) });
    });
    hud?.querySelector('[data-frame-remove="lens"]')?.addEventListener('click', () => {
      document.querySelector('#inspectorRoot [data-act="remove"]')?.click();
    });
    hud?.querySelector('[data-lens-hud-take]')?.addEventListener('click', () => {
      const lens = selectedLens();
      if (lens?.source === 'auto') adoptLens(lens);
    });
  }

  // ─── Transport ───────────────────────────────────────────────────────────────────────────
  function seek(t, { follow = false } = {}) {
    if (ed.textMode) exitText();
    ed.t = clamp(t, 0, ed.total);
    if (ed.loop && ed.playing) ed.loopClip = curClip();
    renderFrame();
    paintHead(follow);
  }

  /**
   * Start the recording once. Seeking on every frame aborts play() before the
   * first frame lands, so the timeline looks like it never started.
   */
  function armLive(v, rec, { outgoing = false } = {}) {
    ed.wantRec = rec;
    const drift = Math.abs((v.currentTime || 0) - rec);
    if (v.paused || v.ended) {
      if (!ed.liveSeeked && !v.seeking && drift > 0.12 && v.readyState >= 1) {
        ed.liveSeeked = true;
        try {
          if (typeof v.fastSeek === 'function') v.fastSeek(rec);
          else v.currentTime = rec;
        } catch { /* metadata still arriving */ }
      }
      if (ed.liveKick) return;
      const start = () => {
        if (!ed.playing) return;
        ed.liveKick = true;
        const pending = v.play();
        const done = () => { ed.liveKick = false; };
        if (pending?.then) pending.then(done, done);
        else done();
      };
      if (v.readyState >= 2 && !v.seeking) start();
      else if (!ed.liveArm) {
        ed.liveArm = true;
        v.addEventListener('canplay', () => {
          ed.liveArm = false;
          if (ed.playing) start();
        }, { once: true });
      }
      return;
    }
    ed.liveKick = false;
    // 0.18s, not 0.5s: a short cut jumps the recording clock by less than half a second
    // and must still seek, or playback rolls through the stretch that was removed.
    if (!outgoing && !v.seeking && drift > 0.18) {
      try { v.currentTime = rec; } catch { /* ignore */ }
    }
    const rate = rateAt(v.currentTime);
    if (Math.abs(v.playbackRate - rate) > 0.01) v.playbackRate = rate;
  }

  function play() {
    if (!ed.seq.length) {
      if (!ed.playWhenReady) {
        ed.playWhenReady = true;
        refresh().finally(() => {
          ed.playWhenReady = false;
          if (ed.active && ed.seq.length && !ed.playing) play();
        });
      }
      return;
    }
    if (ed.textMode) exitText();
    if (ed.t >= ed.total - 0.03) ed.t = 0;
    ed.liveSeeked = false;
    ed.liveKick = false;
    ed.stallFor = 0;
    ed.playing = true;
    if (ed.sound) preview.play(previewState(), ed.t);
    ed.loopClip = ed.loop ? curClip() : null;
    ed.lastTs = performance.now();
    cancelAnimationFrame(ed.raf);
    ed.raf = requestAnimationFrame(tick);
    paintTransport();
    paintTextMode();
    paintZoomBox();
    paintLensBox();
  }

  function pause() {
    ed.playing = false;
    ed.stopAt = null;
    preview.pause();
    cancelAnimationFrame(ed.raf);
    ed.liveKick = false;
    ed.liveArm = false;
    ed.stallFor = 0;
    const v = video();
    if (v && !v.paused) v.pause();
    renderFrame();
    paintHead();
    paintTransport();
    paintTextMode();
  }

  const toggle = () => (ed.playing ? pause() : play());

  function replayClip() {
    const c = curClip();
    if (!c) return;
    seek(c.at);
    play();
  }

  function tick(ts) {
    if (!ed.playing) return;
    const dt = clamp((ts - ed.lastTs) / 1000, 0, 0.1);
    ed.lastTs = ts;
    const c = curClip();
    const v = video();
    // The recording is the master clock while it plays; the wall clock drives plates.
    if (c?.kind === 'live' && v && !v.paused && !v.seeking && v.readyState >= 2 && ed.t > c.at + c.overlap) {
      const tv = recToEd(c, v.currentTime);
      ed.t = Math.abs(tv - ed.t) < 0.8 ? Math.max(ed.t, tv) : ed.t + dt;
      if (v.currentTime >= c.recTo - 0.03) ed.t = Math.max(ed.t, c.at + c.dur - (ed.seq[c.i + 1]?.overlap || 0));
      ed.stallFor = 0;
    } else if (ed.stall && (ed.stallFor = (ed.stallFor || 0) + dt) < 1.2) {
      /* hold the clock briefly while a plate loads, then play on anyway */
    } else ed.t += dt;
    const lc = ed.loopClip;
    if (lc && ed.t >= lc.at + lc.dur - 0.02) ed.t = lc.at;
    if (ed.stopAt != null && ed.t >= ed.stopAt) {
      ed.t = ed.stopAt;
      pause();
      return;
    }
    if (ed.t >= ed.total) {
      ed.t = ed.total;
      pause();
      return;
    }
    renderFrame();
    paintHead(true);
    preview.sync(previewState(), ed.t, true);
    ed.raf = requestAnimationFrame(tick);
  }

  function paintTransport() {
    const btn = $('edPlay');
    if (btn) {
      btn.innerHTML = ed.playing ? ICONS.pause : ICONS.play;
      btn.setAttribute('aria-label', ed.playing ? 'Pause' : 'Play');
      btn.classList.toggle('is-playing', ed.playing);
    }
    $('edLoop')?.classList.toggle('is-on', ed.loop);
    $('edFx')?.classList.toggle('is-on', ed.fx);
    $('edSound')?.classList.toggle('is-on', ed.sound);
    $('stage')?.classList.toggle('is-ed-playing', ed.playing);
  }

  const resolveLiveCard = (mark) => resolveLiveCardFromPlates(mark, state.htmlPlates, ed.deck?.marks || []);

  /** Active chapter/caption under the playhead: mark + card + recording clock. */
  function liveHitAtPlayhead() {
    const c = curClip();
    if (c?.kind !== 'live') return null;
    const recT = edToRec(c, ed.t);
    const hits = liveMarksAtRecTime(ed.deck?.marks, recT, { recFrom: c.recFrom, recTo: c.recTo });
    if (!hits.length) return null;
    const mark = hits[0];
    const card = resolveLiveCard(mark);
    return card ? { mark, card, recT } : null;
  }

  const liveCardAtPlayhead = () => liveHitAtPlayhead()?.card || null;

  function marksInLiveClip(c) {
    if (c?.kind !== 'live') return [];
    return (ed.deck?.marks || []).filter((m) => cardMarkInClip(m, c));
  }

  /**
   * Keep the direction-true card HTML composited over the recording (motion seek while
   * playing/scrubbing; text mode owns the frame while editing).
   * Do not prefetch the next overlay into the shared plate iframe — that unloads the
   * current card every frame and blinks the stage.
   */
  function syncLiveCardComposite(hit) {
    const id = ed.textMode && ed.liveCardId ? ed.liveCardId : hit?.card?.id;
    if (!id) {
      ed.compositeCardId = null;
      ed.compositeHoldMs = null;
      ed.compositeSeekMs = null;
      return;
    }
    if (!plateReady(id)) {
      requestPlate(id, { reason: 'show' });
      return;
    }
    P.composite?.(true);
    if (ed.compositeCardId !== id) {
      ed.compositeCardId = id;
      ed.compositeHoldMs = null;
      ed.compositeSeekMs = null;
      if (!ed.textMode) P.motion();
      else P.composite?.(true);
      P.fit();
    }
    if (!ed.textMode && hit?.mark) {
      const holdMs = Math.round(cardMarkDuration(hit.mark) * 1000);
      const elapsed = cardElapsedMs(hit.mark, hit.recT);
      // Timeline / inspector length must drive exit CSS — HTML may still have the record default.
      if (ed.compositeHoldMs !== holdMs) {
        ed.compositeHoldMs = holdMs;
        ed.compositeSeekMs = null;
        const kind = hit.mark.kind === 'chapter' ? 'chapter' : 'caption';
        try {
          const doc = $('plateFrame')?.contentDocument;
          if (doc?.body) applyCardMotionToDocument(doc, kind, holdMs);
        } catch {
          /* cross-origin / unloaded */
        }
        // restart() declines (returns false) when the frame cannot re-run its intro; a plain seek
        // still parks the card at the right moment of the new timing.
        if (!(typeof P.restart === 'function' && P.restart(elapsed))) P.seek?.(elapsed);
        ed.compositeSeekMs = elapsed;
        return;
      }
      // Seek only when the card clock moves — per-frame seeks thrash CSS animations.
      if (ed.compositeSeekMs !== elapsed) {
        ed.compositeSeekMs = elapsed;
        P.seek?.(elapsed);
      }
    }
  }

  function paintClipChip() {
    const el = $('edClipChip');
    const c = curClip();
    if (!el || !c) return;
    const icon = c.kind === 'live' ? ICONS.film : ICONS[PLATE_ICON[c.plateId] || 'plate'];
    el.className = `ed-clip-chip ${c.kind}`;
    el.innerHTML = `${icon}<b>${escapeHtml(c.title)}</b><em>${c.kind === 'live' ? 'Recording' : escapeHtml(c.type || 'Plate')} · ${c.dur.toFixed(1)}s</em>`;
    const textBtn = $('edEditText');
    if (textBtn) {
      const card = c.kind === 'live' ? liveCardAtPlayhead() || (ed.liveCardId && { id: ed.liveCardId }) : null;
      const canPlate = c.kind === 'plate' && !ed.missing.has(c.plateId);
      const canCard = Boolean(card);
      textBtn.hidden = !(canPlate || canCard || ed.textMode);
      textBtn.title = canCard || ed.liveCardId
        ? 'Edit chapter/caption copy (opens the live-card template)'
        : 'Edit the words on this plate';
    }
  }

  function etlHeadWidth(scroll) {
    return scroll?.querySelector('.etl-heads')?.offsetWidth ||
      parseInt(getComputedStyle(document.documentElement).getPropertyValue('--etl-head'), 10) ||
      34;
  }

  function paintHead(follow = false) {
    const x = ed.t * ed.pps;
    const head = $('etlPlayhead');
    if (head) head.style.transform = `translateX(${x}px)`;
    const clock = $('edClock');
    if (clock) clock.innerHTML = `${fmtT(ed.t)} <span class="t-sep">/</span> ${fmtT(ed.total)}`;
    const scroll = $('etlScroll');
    if (scroll && head) {
      const left = scroll.scrollLeft;
      const w = Math.max(80, scroll.clientWidth - etlHeadWidth(scroll));
      // Flip the time badge to the left when the pin is near the right edge of the viewport
      head.classList.toggle('is-flip', x > left + w - 96);
      if (follow && ed.playing) {
        if (x < left + 20 || x > left + w - 60) scroll.scrollLeft = Math.max(0, x - w * 0.2);
      }
    }
  }

  // ─── Text editing on plates ──────────────────────────────────────────────────────────────
  function clearPlatePreviewTimers() {
    clearTimeout(stylePreviewTimer);
    stylePreviewTimer = 0;
  }

  function markPlateResync(plateId) {
    ed.needsPlateResync = plateId || ed.needsPlateResync || state.activePlateId || null;
  }

  function flushPlateResync() {
    const id = ed.needsPlateResync;
    ed.needsPlateResync = null;
    // Keep the playhead — deferred look/style paints should not shove you back to the open.
    if (id) refreshPlatePreview(id, { fromStart: false });
  }

  async function enterText(focusPath = null, { cardId = null } = {}) {
    const c = curClip();
    if (cardId || c?.kind === 'live') await ensureLiveCards(cardId || null);
    let card = cardId
      ? (state.htmlPlates || []).find((p) => p.id === cardId) || null
      : null;
    if (!card && c?.kind === 'live') card = liveCardAtPlayhead();
    // Explicit live-card edits win even if the playhead still sits on a neighboring plate.
    const plateId = card?.id || cardId || (c?.kind === 'plate' ? c.plateId : null);
    if (!plateId) {
      if (c?.kind === 'live' || cardId) {
        toast('No card at the playhead', 'Click a chapter or caption block on the timeline, then Edit text', 'warn');
      }
      return;
    }
    if (ed.playing) pause();
    clearPlatePreviewTimers();
    const gen = ++ed.textGen;
    ed.liveCardId = String(plateId).startsWith('overlay:') ? plateId : card?.id || null;
    document.body.classList.add('is-live-card');
    if (!plateReady(plateId)) await requestPlate(plateId);
    if (gen !== ed.textGen) return;
    if (!plateReady(plateId)) {
      // Wait for iframe + inline-edit arm (overlays can take a beat on first open).
      for (let i = 0; i < 40 && !plateReady(plateId); i++) {
        await new Promise((r) => setTimeout(r, 50));
        if (gen !== ed.textGen) return;
        if (!ed.loadingPlate) await requestPlate(plateId);
      }
    }
    if (!plateReady(plateId) && String(plateId).startsWith('overlay:')) {
      await ensureLiveCards(plateId);
      if (gen !== ed.textGen) return;
      await requestPlate(plateId);
      for (let i = 0; i < 20 && !plateReady(plateId); i++) {
        await new Promise((r) => setTimeout(r, 50));
        if (gen !== ed.textGen) return;
      }
    }
    if (!plateReady(plateId)) {
      const wantedCard = Boolean(cardId || ed.liveCardId);
      ed.liveCardId = null;
      if (c?.kind === 'live' || wantedCard) {
        toast('Card not ready', 'Open Direction → Apply live cards, then try again', 'warn');
      }
      return;
    }
    P.composite?.(true);
    ed.textMode = true;
    paintTextMode();
    renderFrame();
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      P.text?.({ onReady: done });
      // Safety if onReady never fires (plate already composed / missing frame).
      setTimeout(done, 400);
    });
    // Done / play / leave / a newer enterText won while we waited.
    if (gen !== ed.textGen || !ed.textMode) return;
    P.composite?.(true);
    if (focusPath) {
      P.focus?.(focusPath);
      syncPlateField(P.selection?.() || { path: focusPath });
    } else {
      syncPlateField(P.selection?.() || null);
    }
    paintTextMode();
    paintClipChip();
    if (ed.sel?.type === 'clip' || ed.sel?.type === 'card') renderInspector();
  }

  /** Jump to a chapter/caption mark and open its editable template (even from a plate playhead). */
  async function enterLiveCard(cardId, markT = null, markKey = null) {
    const markNum = markT != null ? Number(markT) : NaN;
    const mark =
      (markKey && (ed.deck?.marks || []).find((m) => (m.key || cardMarkKey(m)) === markKey)) ||
      (Number.isFinite(markNum) &&
        (ed.deck?.marks || []).find(
          (m) => (m.kind === 'chapter' || m.kind === 'caption') && Math.abs(m.t - markNum) < 0.08
        )) ||
      null;
    let c = curClip();
    const owns = (x) =>
      mark ? cardMarkInClip(mark, x) : Number.isFinite(markNum) && markNum >= x.recFrom - 0.05 && markNum < x.recTo;
    const owner = ed.seq.find((x) => x.kind === 'live' && owns(x));
    if (owner) c = owner;
    if (c?.kind === 'live' && (mark || Number.isFinite(markNum))) {
      if (ed.playing) pause();
      const prev = ed.seq[ed.seq.indexOf(c) - 1];
      // Past the plate's half of a plate→live join — landing on the card's first frames
      // hands the iframe to the outgoing plate and flashes it before the card returns.
      const edT = mark
        ? cardEditLandingEd(mark, c, { prevKind: prev?.kind || null, overlap: c.overlap || 0, toEd: (rec) => recToEd(c, rec) })
        : recToEd(c, markNum + 0.12);
      if (edT != null) seek(edT);
      select({ type: 'clip', id: c.id });
    }
    await ensureLiveCards(cardId || null);
    let id = cardId || null;
    if (!id) id = resolveLiveCard(mark)?.id || liveCardAtPlayhead()?.id || null;
    await enterText(null, { cardId: id || null });
    if (!ed.textMode) return;
    // Land on the main title field so chapter/caption edits start typing immediately.
    const first = (P.fields?.() || []).find((f) => f.path === 'title') || (P.fields?.() || [])[0];
    if (first?.path) {
      P.focus?.(first.path);
      syncPlateField(P.selection?.() || { path: first.path });
      paintTextMode();
    }
    showInspectorTab();
    flashHint('Editing card copy — Save, then Produce to bake into the master');
  }

  /** Click-to-edit from the motion stage: open text mode and land on that field. */
  async function enterTextFor(path) {
    const c = curClip();
    if (c?.kind === 'live') {
      const card = liveCardAtPlayhead();
      if (card) {
        await enterText(path, { cardId: card.id });
        if (!ed.textMode) return;
        showInspectorTab();
        flashHint(path ? `Editing “${path}”` : 'Editing card copy');
        return;
      }
    }
    if (c?.kind !== 'plate' && !ed.liveCardId) {
      const plate = ed.seq.find((x) => x.kind === 'plate' && plateReady(x.plateId));
      if (plate) {
        select({ type: 'clip', id: plate.id });
        seek(plate.at + Math.min(plate.dur * 0.55, Math.max(0.5, plate.dur - 1.6)));
      }
    }
    await enterText(path);
    if (!ed.textMode) return;
    showInspectorTab();
    flashHint(path ? `Editing “${path}”` : ed.liveCardId ? 'Editing card copy' : 'Editing text');
  }

  function exitText() {
    if (!ed.textMode) return;
    ed.textGen += 1;
    ed.textMode = false;
    ed.plateField = null;
    const wasLiveCard = ed.liveCardId;
    ed.liveCardId = null;
    if (P.ready()) P.motion();
    paintTextMode();
    // Look/style may have painted CSS while we were editing — rebuild motion honestly.
    if (ed.needsPlateResync) flushPlateResync();
    else if (P.ready() && !wasLiveCard) {
      const c = curClip();
      const ms = c?.kind === 'plate' && c.plateId === P.ready() ? Math.max(0, (ed.t - c.at) * 1000) : 0;
      P.restart?.(ms);
    }
    // Live cards: renderFrame re-composites and seeks the card under the playhead.
    if (wasLiveCard) {
      ed.compositeCardId = null;
      ed.compositeSeekMs = null;
    }
    renderFrame();
    paintClipChip();
    if (ed.sel?.type === 'clip') renderInspector();
  }

  function accentOf(detail) {
    if (detail == null) return null;
    if (typeof detail === 'object' && 'accent' in detail) return detail.accent;
    return detail;
  }

  /** The stage Accent button mirrors the selection in the plate: off, on, or mixed. */
  function paintAccentButton(detail) {
    const accent = accentOf(detail);
    const btn = $('edTextBar')?.querySelector('[data-text="accent"]');
    if (!btn) return;
    btn.disabled = accent == null;
    btn.setAttribute('aria-pressed', accent === 'on' ? 'true' : accent === 'mixed' ? 'mixed' : 'false');
    btn.title =
      accent == null
        ? 'Click into a text field, then select the words to accent'
        : accent === 'on'
          ? 'Remove the accent from the selected words'
          : 'Accent the selected words';
  }

  function syncPlateField(detail) {
    const d = detail && typeof detail === 'object' ? detail : null;
    const prev = ed.plateField?.path || null;
    ed.plateField = d?.path
      ? { path: d.path, kind: d.kind || 'text', source: d.source ?? '', dirty: Boolean(d.dirty), accent: d.accent ?? null }
      : null;
    paintAccentButton(d);
    paintFieldChips();
    const copyHost = curClip()?.kind === 'plate' || Boolean(ed.liveCardId);
    if ((ed.plateField?.path || null) !== prev && ed.sel?.type === 'clip' && copyHost) {
      const ta = document.querySelector('#inspectorRoot [data-field-src]');
      if (document.activeElement !== ta) renderInspector();
      else paintFieldPanelLive();
    } else if (ed.plateField && document.querySelector('#inspectorRoot [data-field-src]')) {
      paintFieldPanelLive();
    }
  }

  function paintFieldChips() {
    const path = ed.plateField?.path;
    document.querySelectorAll('#inspectorRoot [data-field]').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.field === path);
    });
  }

  function hotkeyMod() {
    return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  }

  function paintFieldPanelLive() {
    const f = ed.plateField;
    const pathEl = document.querySelector('#inspectorRoot [data-field-path]');
    const labelEl = document.querySelector('#inspectorRoot [data-field-label]');
    const kindEl = document.querySelector('#inspectorRoot [data-field-kind]');
    const ta = document.querySelector('#inspectorRoot [data-field-src]');
    const empty = document.querySelector('#inspectorRoot [data-field-empty]');
    const editor = document.querySelector('#inspectorRoot [data-field-editor]');
    if (!f) {
      if (empty) empty.hidden = false;
      if (editor) editor.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    if (editor) editor.hidden = false;
    if (pathEl) pathEl.textContent = f.path;
    if (labelEl) labelEl.textContent = fieldLabel(f.path);
    if (kindEl) kindEl.textContent = f.kind === 'lines' ? 'Multi-line' : 'Single line';
    if (ta && document.activeElement !== ta) {
      ta.value = f.source ?? '';
      ta.rows = f.kind === 'lines' ? 4 : 2;
    }
  }

  function fieldLabel(path) {
    const raw = String(path || '');
    const parts = raw.split('.');
    const last = parts[parts.length - 1] || raw;
    const pretty = last
      .replace(/([A-Z])/g, ' $1')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
    if (parts.length >= 3 && /^\d+$/.test(parts[1])) return `${pretty} · ${Number(parts[1]) + 1}`;
    if (parts.length === 2 && /^\d+$/.test(parts[0])) return `${pretty} · ${Number(parts[0]) + 1}`;
    return pretty || raw;
  }

  function renderPlateFields() {
    const fields = P.fields?.() || [];
    const active = ed.plateField;
    const editing = ed.textMode;
    const mod = hotkeyMod();
    const chips = fields.length
      ? `<div class="ins-field-nav" role="tablist" aria-label="Plate fields">${fields
          .map(
            (f) =>
              `<button type="button" role="tab" class="ins-field-tab${active?.path === f.path ? ' on' : ''}${f.dirty ? ' dirty' : ''}" data-field="${escapeHtml(f.path)}" aria-selected="${active?.path === f.path ? 'true' : 'false'}" title="${escapeHtml(f.path)}"><span>${escapeHtml(fieldLabel(f.path))}</span></button>`
          )
          .join('')}</div>`
      : `<p class="ins-note subtle">This plate has no editable fields yet.</p>`;
    const editor = active
      ? `<div class="ins-field-panel" data-field-editor>
          <header class="ins-field-panel-head">
            <strong data-field-label>${escapeHtml(fieldLabel(active.path))}</strong>
            <em data-field-kind>${active.kind === 'lines' ? 'Multi-line' : 'Single line'}</em>
          </header>
          <code class="sr-only" data-field-path>${escapeHtml(active.path)}</code>
          <textarea class="ins-textarea" data-field-src rows="${active.kind === 'lines' ? 4 : 2}" spellcheck="true" aria-label="${escapeHtml(fieldLabel(active.path))} copy">${escapeHtml(active.source || '')}</textarea>
          <div class="ins-field-tools">
            <button type="button" class="ins-btn" data-act="field-accent" title="Accent selected words (${mod}B)">${ICONS.sparkle}Accent</button>
            <button type="button" class="ins-btn ghost" data-act="field-focus">${ICONS.target}Show on stage</button>
          </div>
        </div>`
      : `<div class="ins-field-panel" data-field-editor hidden></div>
         <div class="ins-field-empty" data-field-empty>
           <strong>Edit on the plate</strong>
           <span>Click any word on the stage, or pick a field above.</span>
         </div>`;
    const keys = editing
      ? `<ul class="ins-hotkeys" aria-label="Shortcuts while editing">
          <li><kbd>Tab</kbd><span>Next field</span></li>
          <li><kbd>${mod}B</kbd><span>Accent</span></li>
          <li><kbd>Esc</kbd><span>Done</span></li>
        </ul>`
      : '';
    return section(
      'text',
      'Plate copy',
      `${chips}${editor}${keys}`,
      `<button type="button" class="ins-link${editing ? ' is-on' : ''}" data-act="text" aria-pressed="${editing ? 'true' : 'false'}">${
        editing ? 'Done editing' : 'Edit on stage'
      }</button>`
    );
  }

  const TB_POS_KEY = 'wts.edTextBar.pos';
  const TB_HIDE_KEY = 'wts.edTextBar.coachHidden';
  let textBarDrag = null;

  function textBarPos() {
    try {
      const raw = localStorage.getItem(TB_POS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) return { x: p.x, y: p.y };
    } catch {
      /* ignore */
    }
    return null;
  }

  function saveTextBarPos(x, y) {
    try {
      localStorage.setItem(TB_POS_KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y) }));
    } catch {
      /* ignore */
    }
  }

  function coachHidden() {
    try {
      return sessionStorage.getItem(TB_HIDE_KEY) === '1';
    } catch {
      return false;
    }
  }

  function setCoachHidden(on) {
    try {
      if (on) sessionStorage.setItem(TB_HIDE_KEY, '1');
      else sessionStorage.removeItem(TB_HIDE_KEY);
    } catch {
      /* ignore */
    }
  }

  /** Tip lives in #playerPlate (overflow clipped) — not inside .fhd-fit. */
  function textBarHost(bar = $('edTextBar')) {
    return bar?.parentElement || null;
  }

  /** Keep a dragged tip inside the stage when the window / panels / timeline resize. */
  function clampTextBarIntoHost(bar = $('edTextBar'), { persist = true } = {}) {
    if (!bar || bar.hidden || textBarDrag || !bar.classList.contains('is-placed')) return;
    const host = textBarHost(bar);
    if (!host || host.clientWidth < 40 || host.clientHeight < 40) return;
    const w = bar.offsetWidth || 240;
    const h = bar.offsetHeight || 36;
    const saved = textBarPos();
    let x = parseFloat(bar.style.getPropertyValue('--ed-tb-x'));
    let y = parseFloat(bar.style.getPropertyValue('--ed-tb-y'));
    if (!Number.isFinite(x)) x = saved?.x;
    if (!Number.isFinite(y)) y = saved?.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const nextX = clamp(x, 8, Math.max(8, host.clientWidth - w - 8));
    const nextY = clamp(y, 8, Math.max(8, host.clientHeight - h - 8));
    if (nextX === x && nextY === y) return;
    bar.style.setProperty('--ed-tb-x', `${nextX}px`);
    bar.style.setProperty('--ed-tb-y', `${nextY}px`);
    if (persist) saveTextBarPos(nextX, nextY);
  }

  function applyTextBarPlacement(bar, { preferTop = false } = {}) {
    if (!bar) return;
    const placed = textBarPos();
    bar.classList.toggle('is-placed', Boolean(placed));
    bar.classList.toggle('is-dock-top', !placed && preferTop);
    if (placed) {
      bar.style.setProperty('--ed-tb-x', `${placed.x}px`);
      bar.style.setProperty('--ed-tb-y', `${placed.y}px`);
      requestAnimationFrame(() => clampTextBarIntoHost(bar));
    } else {
      bar.style.removeProperty('--ed-tb-x');
      bar.style.removeProperty('--ed-tb-y');
    }
  }

  function wireTextBarChrome() {
    const bar = $('edTextBar');
    if (!bar || bar.dataset.tbWired) return;
    bar.dataset.tbWired = '1';
    const hostEl = () => textBarHost(bar);
    bar.addEventListener('pointerdown', (e) => {
      const grip = e.target.closest('[data-tb-grip]');
      // Allow dragging from the grip, or from empty tip chrome (not buttons/fields).
      const fromChrome =
        grip ||
        (e.target === bar ||
          e.target.classList?.contains('ed-tb-badge') ||
          e.target.classList?.contains('ed-tb-msg') ||
          e.target.classList?.contains('ed-tb-field'));
      if (!fromChrome || e.target.closest('button:not([data-tb-grip])')) return;
      e.preventDefault();
      const host = hostEl();
      const hr = host?.getBoundingClientRect();
      const br = bar.getBoundingClientRect();
      if (!hr) return;
      textBarDrag = {
        dx: e.clientX - br.left,
        dy: e.clientY - br.top,
        host,
      };
      bar.classList.add('is-dragging', 'is-placed');
      bar.classList.remove('is-dock-top');
      try {
        bar.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    bar.addEventListener('pointermove', (e) => {
      if (!textBarDrag) return;
      const hr = textBarDrag.host.getBoundingClientRect();
      const w = bar.offsetWidth;
      const h = bar.offsetHeight;
      const x = clamp(e.clientX - hr.left - textBarDrag.dx, 8, Math.max(8, hr.width - w - 8));
      const y = clamp(e.clientY - hr.top - textBarDrag.dy, 8, Math.max(8, hr.height - h - 8));
      bar.style.setProperty('--ed-tb-x', `${x}px`);
      bar.style.setProperty('--ed-tb-y', `${y}px`);
    });
    const endDrag = (e) => {
      if (!textBarDrag) return;
      const x = parseFloat(bar.style.getPropertyValue('--ed-tb-x'));
      const y = parseFloat(bar.style.getPropertyValue('--ed-tb-y'));
      if (Number.isFinite(x) && Number.isFinite(y)) saveTextBarPos(x, y);
      bar.classList.remove('is-dragging');
      textBarDrag = null;
      clampTextBarIntoHost(bar);
      try {
        bar.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', endDrag);
    bar.addEventListener('dblclick', (e) => {
      if (!e.target.closest('[data-tb-grip]') && e.target !== bar) return;
      try {
        localStorage.removeItem(TB_POS_KEY);
      } catch {
        /* ignore */
      }
      bar.classList.remove('is-placed');
      bar.style.removeProperty('--ed-tb-x');
      bar.style.removeProperty('--ed-tb-y');
      paintTextMode();
    });
    const host = hostEl();
    if (host && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => clampTextBarIntoHost(bar));
      ro.observe(host);
    }
    window.addEventListener('resize', () => clampTextBarIntoHost(bar));
  }

  function cardKindAtPlayhead() {
    const hit = liveHitAtPlayhead();
    if (hit?.mark?.kind === 'chapter' || hit?.mark?.kind === 'caption') return hit.mark.kind;
    if (ed.sel?.type === 'card') {
      const mark = (ed.deck?.marks || []).find((m) => (m.key || cardMarkKey(m)) === ed.sel.key);
      if (mark?.kind === 'chapter' || mark?.kind === 'caption') return mark.kind;
    }
    const id = ed.liveCardId || '';
    if (id.includes(':caption:')) return 'caption';
    if (id.includes(':chapter:')) return 'chapter';
    return null;
  }

  /** Every surface that says "editing text" reads ed.textMode from here. */
  function paintTextMode() {
    const editing = ed.textMode;
    const bar = $('edTextBar');
    if (bar) {
      const dirty = P.dirty();
      const c = curClip();
      const plateClip = c?.kind === 'plate' && !ed.missing.has(c?.plateId);
      const liveCard = c?.kind === 'live' ? liveCardAtPlayhead() : null;
      const cardSel = ed.sel?.type === 'card';
      const onCard = Boolean(ed.liveCardId || liveCard || cardSel);
      const cardKind = cardKindAtPlayhead();
      const hideCoach = coachHidden();
      const coach =
        !editing && !dirty && !ed.playing && !hideCoach && (plateClip || Boolean(liveCard) || cardSel);
      bar.hidden = !(editing || dirty || coach);
      bar.classList.toggle('is-dirty', dirty);
      bar.classList.toggle('is-editing', editing);
      bar.classList.toggle('is-coach', coach && !editing && !dirty);
      applyTextBarPlacement(bar, { preferTop: onCard && cardKind === 'caption' });
      const mod = hotkeyMod();
      const fieldName = ed.plateField?.path ? fieldLabel(ed.plateField.path) : '';
      const kindLabel = cardKind === 'chapter' ? 'chapter' : cardKind === 'caption' ? 'caption' : 'card';
      const badge = dirty ? 'Unsaved' : editing ? 'Editing' : 'Tip';
      const msg = dirty
        ? onCard
          ? 'Unsaved card copy — Save, then Produce to bake'
          : 'Plays with your changes'
        : editing
          ? fieldName
            ? ''
            : onCard
              ? `Click a field on the ${kindLabel}`
              : 'Click a field on the plate'
          : onCard
            ? `Edit the ${kindLabel} copy · drag this tip if it covers text`
            : 'Click text on the plate to edit';
      const grip = `<button type="button" class="ed-tb-grip" data-tb-grip title="Drag to move" aria-label="Drag tip">${icon('grip')}</button>`;
      const close =
        coach && !editing && !dirty
          ? `<button type="button" class="ed-tb-close" data-text="dismiss" title="Hide tip" aria-label="Hide tip">${ICONS.x}</button>`
          : '';
      const editBtn =
        !editing && !dirty && onCard
          ? `<button type="button" class="ed-pill-btn primary" data-text="edit-card" title="Edit ${kindLabel} copy on stage">${ICONS.plate}<span>Edit copy</span></button>`
          : '';
      const html = `${grip}<span class="ed-tb-badge">${badge}</span>${
        editing && fieldName ? `<span class="ed-tb-field">${escapeHtml(fieldName)}</span>` : ''
      }${msg ? `<span class="ed-tb-msg">${msg}</span>` : '<span class="ed-tb-spacer"></span>'}${
        editing
          ? `<span class="ed-tb-keys" aria-hidden="true"><i title="Next field"><kbd>Tab</kbd></i><i title="Accent selection"><kbd>${mod}B</kbd></i><i title="Done"><kbd>Esc</kbd></i></span>
             <button type="button" class="ed-pill-btn ed-accent-btn" data-text="accent" aria-pressed="false" disabled title="Accent the selected words (${mod}B)">${ICONS.sparkle}<span>Accent</span></button>`
          : ''
      }${editBtn}${
        dirty ? `<button type="button" class="ed-pill-btn" data-text="discard"><span>Discard</span></button><button type="button" class="ed-pill-btn primary" data-text="save"><span>Save</span></button>` : ''
      }${editing ? `<button type="button" class="ed-pill-btn primary" data-text="done"><span>Done</span></button>` : ''}${close}`;
      // Avoid rewriting the tip on every paint (resize/scrub) — that flickers like a hide.
      if (bar.dataset.tbHtml !== html) {
        bar.dataset.tbHtml = html;
        bar.innerHTML = html;
      }
      paintAccentButton(ed.plateField || P.selection?.() || P.accentState?.() || null);
      if (!bar.hidden) requestAnimationFrame(() => clampTextBarIntoHost(bar));
    }
    const transport = $('edEditText');
    if (transport) {
      transport.classList.toggle('is-on', editing);
      transport.setAttribute('aria-pressed', editing ? 'true' : 'false');
      transport.title = editing
        ? 'Done editing (Esc)'
        : ed.liveCardId || liveCardAtPlayhead()
          ? 'Edit chapter/caption copy'
          : 'Edit the words on this plate';
      const label = transport.querySelector('span');
      if (label) label.textContent = editing ? 'Done' : 'Edit text';
    }
    const inspector = document.querySelector('#inspectorRoot [data-act="text"]');
    if (inspector) {
      inspector.classList.toggle('is-on', editing);
      inspector.classList.toggle('on', editing);
      inspector.setAttribute('aria-pressed', editing ? 'true' : 'false');
      inspector.textContent = editing ? 'Done editing' : 'Edit on stage';
    }
    document.body.classList.toggle('is-editing-text', editing);
  }

  // ─── Timeline ────────────────────────────────────────────────────────────────────────────
  function renderTimeline() {
    const scroll = $('etlScroll');
    const canvas = $('etlCanvas');
    if (!scroll || !canvas || !ed.active) return;
    // Heads sit inside the scroll row — exclude their width from the fit math.
    const W = Math.max(200, scroll.clientWidth - etlHeadWidth(scroll) - 24);
    ed.pps = (W / Math.max(1, ed.total)) * ed.zoomScale;
    const width = Math.max(W, ed.total * ed.pps);
    canvas.style.width = `${width + 24}px`;
    $('etlDur') && ($('etlDur').textContent = fmtT(ed.total));
    renderRuler();
    renderClipsTrack();
    renderCardTracks();
    renderFxTracks();
    renderAudioTracks();
    paintSelection();
    paintHead();
    paintTools();
    paintClipChip();
  }

  function renderRuler() {
    const el = $('etlRuler');
    if (!el) return;
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];
    const step = steps.find((s) => s * ed.pps >= 64) || 120;
    const minor = step / (step >= 10 ? 5 : 2);
    const out = [];
    for (let t = 0; t <= ed.total + 1e-6; t += minor) {
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      out.push(`<i class="${major ? 'mj' : ''}" style="left:${t * ed.pps}px">${major ? `<span>${fmtRuler(Math.round(t * 10) / 10)}</span>` : ''}</i>`);
    }
    el.innerHTML = out.join('');
  }

  function plateInfo(id) {
    return (ed.deck?.plates || []).find((p) => p.id === id) || null;
  }

  function renderClipsTrack() {
    const el = $('etlClips');
    if (!el) return;
    const pps = ed.pps;
    const sel = ed.sel;
    const html = ed.seq.map((c, i) => {
      const [a, b] = visualSpan(i);
      const w = (b - a) * pps;
      const icon = c.kind === 'live' ? ICONS.film : ICONS[PLATE_ICON[c.plateId] || 'plate'];
      const info = c.kind === 'plate' ? plateInfo(c.plateId) : null;
      const styled = info && (Object.keys(info.style || {}).length || (info.overrides || []).length);
      const isSel = sel?.type === 'clip' && sel.id === c.id;
      return `<div class="etl-clip ${c.kind}${isSel ? ' is-sel' : ''}${i === ed.cur ? ' is-cur' : ''}${w < 96 ? ' is-narrow' : ''}" data-i="${i}" data-id="${escapeHtml(c.id)}" style="left:${a * pps}px;width:${Math.max(2, w - 2)}px" title="${escapeHtml(`${c.title} · ${c.dur.toFixed(1)}s · drag to move`)}">
        <span class="ec-ico">${icon}</span><span class="ec-t">${escapeHtml(c.title)}</span>${styled ? `<span class="ec-dot" title="Own style">${ICONS.palette}</span>` : ''}<span class="ec-d">${c.dur.toFixed(1)}s</span>
      </div>`;
    });
    const joins = ed.seq.slice(1).map((c) => {
      const pinned = c.join?.pinned;
      const style = joinStyle(c);
      const isSel = sel?.type === 'join' && sel.key === c.join?.key;
      return `<button type="button" class="etl-join${pinned ? ' is-pinned' : ''}${isSel ? ' is-sel' : ''}" data-join-i="${c.i}" style="left:${(c.at + c.overlap / 2) * pps}px" title="${escapeHtml(
        `${ed.deck.transitionStyles?.[style]?.label || style} · ${c.overlap.toFixed(2)}s${pinned ? ' · set by you' : ''} — click to change`
      )}" aria-label="Transition into ${escapeHtml(c.title)}">${T_GLYPH[style] || ICONS.transition}</button>`;
    });
    const from = ed.flipFrom;
    ed.flipFrom = null;
    el.innerHTML = html.join('') + joins.join('');
    if (from) slideClips(from, el);
  }

  const CARD_LANE_H = 26;
  const FX_LANE_H = 26;

  /**
   * Pack overlapping items into sub-lanes (by .t/.end) so overlapping blocks stack
   * instead of painting on top of each other. Segments that share a .key (one zoom
   * split across a crossfade, one ramp across two live clips) stay on the same row.
   */
  function packLanes(items) {
    const sorted = [...items].sort((a, b) => a.t - b.t || a.end - b.end);
    const lanes = [];
    for (const it of sorted) {
      let lane = lanes.findIndex((placed) =>
        !placed.some((p) => {
          const overlaps = it.t < p.end - 0.04 && p.t < it.end - 0.04;
          const same = it.key != null && p.key === it.key;
          return overlaps && !same;
        })
      );
      if (lane < 0) {
        lane = lanes.length;
        lanes.push([]);
      }
      lanes[lane].push({ t: it.t, end: it.end, key: it.key });
      it.lane = lane;
    }
    return { items: sorted, lanes: Math.max(1, lanes.length || 1) };
  }

  /** Match a track's height — and the icon beside it — to how many sub-lanes it holds. */
  function fitLane(track, headClass, lanes, { base = 30, laneH = FX_LANE_H } = {}) {
    const h = Math.max(base, 4 + lanes * laneH);
    track.style.height = `${h}px`;
    const head = document.querySelector(`.etl-head.${headClass}`);
    if (head) head.style.height = `${h}px`;
    return h;
  }

  function cardOwnerAt(recT) {
    return (
      ed.seq.find((x) => x.kind === 'live' && recT >= x.recFrom - 0.05 && recT < x.recTo) ||
      ed.seq.find((x) => x.kind === 'live' && recT >= x.recFrom - 0.05 && recT <= x.recTo + 0.05) ||
      null
    );
  }

  function renderCardTracks() {
    const chEl = $('etlChapters');
    const capEl = $('etlCaptions');
    const chHead = $('etlHeadChapters');
    const capHead = $('etlHeadCaptions');
    if (!chEl || !capEl) return;
    const pps = ed.pps;
    const sel = ed.sel;
    const onLive = live().exists && ed.seq.some((c) => c.kind === 'live');
    const paint = (kind, host, head) => {
      const marks = onLive
        ? (ed.deck?.marks || []).filter((m) => m.kind === kind && Number.isFinite(m.t))
        : [];
      const items = marks
        .map((m) => {
          const dur = cardMarkDuration(m);
          const segs = fxSegments(m.t, m.t + dur);
          if (!segs.length) return null;
          const a = segs[0].a;
          const b = segs[segs.length - 1].b;
          return {
            m,
            t: m.t,
            end: m.t + dur,
            a,
            b,
            key: m.key || cardMarkKey(m),
            card: resolveLiveCard(m),
            dur,
          };
        })
        .filter(Boolean);
      const packed = packLanes(items);
      const h = Math.max(CARD_LANE_H, packed.lanes * CARD_LANE_H + 4);
      host.style.height = `${h}px`;
      if (head) head.style.height = `${h}px`;
      host.innerHTML = packed.items
        .map((it) => {
          const on = sel?.type === 'card' && sel.key === it.key;
          const label = it.m.label || kind;
          const title = `${kind === 'chapter' ? 'Chapter' : 'Caption'} · ${label} · drag to move · edges trim · double-click to edit copy`;
          const top = 3 + it.lane * CARD_LANE_H;
          return `<button type="button" class="ec-card ${kind}${on ? ' is-on' : ''}" style="left:${it.a * pps}px;width:${Math.max(18, (it.b - it.a) * pps)}px;top:${top}px;height:${CARD_LANE_H - 6}px" data-mark-t="${it.m.t}" data-mark-dur="${it.dur}" data-mark-key="${escapeHtml(it.key)}" data-card-id="${escapeHtml(it.card?.id || '')}" data-card-kind="${kind}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"><i class="h l" data-edge="l"></i><span class="ec-card-t">${escapeHtml(label)}</span><i class="h r" data-edge="r"></i></button>`;
        })
        .join('');
      host.dataset.empty =
        onLive && !packed.items.length
          ? kind === 'chapter'
            ? 'Chapters · cards from the recording land here'
            : 'Captions · lower-thirds from the recording land here'
          : '';
    };
    paint('chapter', chEl, chHead);
    paint('caption', capEl, capHead);
  }

  /** Where every brick sits on screen right now, transforms included, by clip id. */
  function clipRects() {
    const out = new Map();
    for (const el of document.querySelectorAll('#etlClips .etl-clip')) out.set(el.dataset.id, el.getBoundingClientRect().left);
    return out;
  }

  /** Slide bricks from where they were into their new places, so a reorder reads as movement rather than a repaint. */
  function slideClips(from, host) {
    const moved = [];
    for (const el of host.querySelectorAll('.etl-clip')) {
      const was = from.get(el.dataset.id);
      if (was == null) continue;
      const dx = was - el.getBoundingClientRect().left;
      if (Math.abs(dx) < 0.5) continue;
      el.style.transition = 'none';
      el.style.transform = `translateX(${dx}px)`;
      moved.push(el);
    }
    if (!moved.length) return;
    host.classList.add('is-settling');
    void host.offsetWidth;
    for (const el of moved) {
      el.style.transition = '';
      el.style.transform = '';
    }
    clearTimeout(ed.settleTimer);
    ed.settleTimer = setTimeout(() => host.classList.remove('is-settling'), 340);
  }

  /** Every place an effect (recording range) shows on the cut — split by the live clips it crosses. */
  function fxSegments(from, to) {
    const out = [];
    for (const c of ed.seq) {
      if (c.kind !== 'live') continue;
      const a = Math.max(from, c.recFrom);
      const b = Math.min(to, c.recTo);
      if (b - a > 0.01) out.push({ clip: c, a: recToEd(c, a), b: recToEd(c, b) });
    }
    return out;
  }

  function renderFxTracks() {
    const speedEl = $('etlSpeed');
    const zoomEl = $('etlZoom');
    if (!speedEl || !zoomEl) return;
    const pps = ed.pps;
    const d = deckEdit();
    const sel = ed.sel;
    const pill = (cls, seg, attrs, label, handles, top) =>
      `<div class="fx ${cls}" ${attrs} style="left:${seg.a * pps}px;width:${Math.max(6, (seg.b - seg.a) * pps)}px;top:${top}px">${handles ? '<i class="h l"></i>' : ''}<span>${label}</span>${handles ? '<i class="h r"></i>' : ''}</div>`;
    const conflicts = ed.deck?.conflicts || [];
    const speedItems = live().exists
      ? d.speed.flatMap((r, i) => {
          const warn = conflicts.some((c) => c.from === r.from && c.to === r.to);
          return fxSegments(r.from, r.to).map((seg) => ({
            key: `ramp:${i}`,
            t: seg.a,
            end: seg.b,
            render: (top) =>
              pill(
                `ramp ${r.rate < 1 ? 'slow' : 'fast'}${sel?.type === 'ramp' && sel.i === i ? ' is-sel' : ''}${warn ? ' is-warn' : ''}`,
                seg,
                `data-ramp="${i}" title="${fmtRate(r.rate)} · ${fmtT(r.from)}–${fmtT(r.to)} in the recording${warn ? ' · covers a chapter card' : ''}"`,
                `${r.rate < 1 ? ICONS.slow : ICONS.speed}${fmtRate(r.rate)}`,
                true,
                top
              ),
          }));
        })
      : [];
    const speedPacked = packLanes(speedItems);
    fitLane(speedEl, 'speed', speedPacked.lanes);
    speedEl.innerHTML = speedPacked.items.map((it) => it.render(4 + it.lane * FX_LANE_H)).join('');
    const shots = live().exists ? ed.deck.zoomShots || [] : [];
    // Zoom skips, zoom shots, and the magnifier can all land on the same stretch of time
    // (e.g. a manual zoom drawn over an auto one, or a magnifier under a "no zoom" skip),
    // so pack them into lanes the same way overlapping chapter/caption cards are, rather
    // than letting them paint on top of each other.
    const zoomItems = [];
    d.zoomSkips.forEach((s, i) => {
      fxSegments(s.from, s.to).forEach((seg) => {
        zoomItems.push({
          key: `skip:${i}`,
          t: seg.a,
          end: seg.b,
          render: (top) => pill(`skip${sel?.type === 'skip' && sel.i === i ? ' is-sel' : ''}`, seg, `data-skip="${i}" title="No auto zoom here"`, `${ICONS.noZoom}No zoom`, true, top),
        });
      });
    });
    shots.forEach((s) => {
      fxSegments(s.start, s.end).forEach((seg) => {
        zoomItems.push({
          key: `shot:${shotKey(s)}`,
          t: seg.a,
          end: seg.b,
          render: (top) =>
            pill(
              `shot ${s.source}${sel?.type === 'zoom' && sel.key === shotKey(s) ? ' is-sel' : ''}`,
              seg,
              `data-shot="${escapeHtml(shotKey(s))}" title="${s.source === 'auto' ? 'Auto zoom (follows the clicks) — drag to take over' : 'Your zoom'} · ${s.zoom.toFixed(2)}×"`,
              `${ICONS.zoom}${s.source === 'auto' ? 'Auto ' : ''}${s.zoom.toFixed(2)}×`,
              s.source !== 'auto',
              top
            ),
        });
      });
    });
    (live().exists ? lensItems() : []).forEach((l) => {
      fxSegments(l.t, l.t + l.dur).forEach((seg) => {
        zoomItems.push({
          key: l.key,
          t: seg.a,
          end: seg.b,
          render: (top) =>
            pill(
              `lens ${l.source}${sel?.type === 'lens' && sel.key === l.key ? ' is-sel' : ''}`,
              seg,
              `data-lens="${escapeHtml(l.key)}" title="${l.source === 'off' ? 'Recorded magnifier — switched off' : l.source === 'auto' ? 'Recorded magnifier — drag to take over' : 'Your magnifier'} · ${l.dur.toFixed(1)}s"`,
              `${l.source === 'off' ? ICONS.lensOff : ICONS.lens}${l.source === 'off' ? 'Off' : `${(l.zoom || 2).toFixed(1)}×`}`,
              l.source === 'edit',
              top
            ),
        });
      });
    });
    const zoomPacked = packLanes(zoomItems);
    fitLane(zoomEl, 'zoom', zoomPacked.lanes);
    zoomEl.innerHTML = zoomPacked.items.map((it) => it.render(4 + it.lane * FX_LANE_H)).join('');
    const onLive = live().exists && ed.seq.some((c) => c.kind === 'live');
    speedEl.dataset.empty = onLive && !speedEl.innerHTML ? 'Speed · drag across a recording clip to speed it up or slow it down' : '';
    zoomEl.dataset.empty = onLive && !zoomEl.innerHTML ? 'Zoom & magnify · drag across a recording clip to zoom in or magnify a detail' : '';
    renderCuts();
  }

  /** Recording spans left after cuts. A sliver under 0.35s is absorbed. An empty result keeps the original span. */
  function keptSpans(from, to, cuts) {
    let spans = [[from, to]];
    for (const c of cuts || []) {
      const next = [];
      for (const [a, b] of spans) {
        const lo = Math.max(a, c.from);
        const hi = Math.min(b, c.to);
        if (hi - lo < 0.01) {
          next.push([a, b]);
          continue;
        }
        if (lo - a >= 0.35) next.push([a, lo]);
        if (b - hi >= 0.35) next.push([hi, b]);
      }
      spans = next;
    }
    return spans.length ? spans : [[from, to]];
  }

  /** Where a removed stretch sits on the cut: its right edge is the splice, and it reaches back by the time it took out. */
  function cutBlocks() {
    const cuts = deckEdit().cuts || [];
    const seq = ed.seq;
    const toClean = ed.clock?.toClean || ((t) => t);
    return cuts.map((cut, i) => {
      const after = seq.find((c) => c.kind === 'live' && c.recFrom >= cut.to - 0.04);
      const before = [...seq].reverse().find((c) => c.kind === 'live' && c.recTo <= cut.from + 0.04);
      const splice = after ? after.at : before ? before.at + before.dur : seq[0]?.at || 0;
      const removed = Math.max(0.2, toClean(cut.to) - toClean(cut.from));
      return { i, from: cut.from, to: cut.to, splice, removed };
    });
  }

  function renderCuts() {
    const el = $('etlCuts');
    if (!el) return;
    const pps = ed.pps;
    const sel = ed.sel;
    const blocks = cutBlocks();
    const cutItems = blocks.map((c) => {
      const left = Math.max(0, c.splice - c.removed);
      const on = sel?.type === 'cut' && sel.i === c.i;
      const label = `−${(c.to - c.from).toFixed(1)}s`;
      return {
        key: `cut:${c.i}`,
        t: left,
        end: left + c.removed,
        html: `<div class="fx cut${on ? ' is-sel' : ''}" data-cut="${c.i}" title="Cut · ${fmtT(c.from)}–${fmtT(c.to)} removed from the recording · drag the ends to change it · ⌫ restores it" style="left:${left * pps}px;width:${Math.max(8, c.removed * pps)}px;top:__TOP__px"><i class="h l"></i><span>${CUT_ICON}${label}</span><i class="h r"></i></div>`,
      };
    });
    const cutPacked = packLanes(cutItems);
    fitLane(el, 'cut', cutPacked.lanes);
    el.innerHTML = cutPacked.items.map((it) => it.html.replace('__TOP__', String(4 + it.lane * FX_LANE_H))).join('');
    const onLive = live().exists && ed.seq.some((c) => c.kind === 'live');
    el.dataset.empty = onLive && !blocks.length ? 'Cut · drag across this row to remove a stretch of the recording' : '';
  }

  function renderAudioTracks() {
    const voiceEl = $('etlVoice');
    const musicEl = $('etlMusic');
    if (!voiceEl || !musicEl) return;
    const pps = ed.pps;
    const audio = ed.deck?.audio;
    const clips = audio?.voiceClips || [];
    const sel = ed.sel;
    const VOICE_LANE_H = 30;
    const voiceItems = clips.map((c) => {
      const on = sel?.type === 'voice' && sel.key === c.key;
      const name = c.key.length > 22 ? `${c.key.slice(0, 20)}…` : c.key;
      const long = c.long > 0.1;
      const speaking = ed.regenerating === c.key;
      const tip = [c.text || c.key];
      if (speaking) tip.push('Speaking this line again…');
      if (c.take > 1 || c.takes > 1) tip.push(`Take ${c.take || 1} of ${Math.max(c.take || 1, c.takes || 1)}`);
      if (c.textOverride) tip.push('Rewritten from the script');
      if (c.trimStart || c.trimEnd) tip.push(`Trimmed ${(c.trimStart + c.trimEnd).toFixed(1)}s · drag the ends`);
      tip.push('Drag to move it');
      if (long) tip.push(`Runs ${c.long.toFixed(1)}s past its window on this cut`);
      if (c.moved) tip.push(`Moves here on the next render (the mix has it at ${fmtT(c.writtenStart)})`);
      // Fades shade the ends of the pill in proportion; trims show as handles.
      const w = Math.max(8, c.dur * pps);
      const fi = c.fadeIn ? Math.min(100, (c.fadeIn / Math.max(0.01, c.dur)) * 100).toFixed(1) : 0;
      const fo = c.fadeOut ? Math.min(100, (c.fadeOut / Math.max(0.01, c.dur)) * 100).toFixed(1) : 0;
      const cls = `fx voice${c.mute ? ' is-mute' : ''}${on ? ' is-sel' : ''}${c.moved ? ' is-moved' : ''}${long ? ' is-long' : ''}${c.trimStart || c.trimEnd ? ' is-trimmed' : ''}${c.textOverride || (c.speed && Math.abs(c.speed - 1) > 0.01) ? ' is-regen' : ''}${c.take > 1 ? ' is-take' : ''}${speaking ? ' is-speaking' : ''}`;
      // A take past the first wears its number ahead of the name, so a narrow pill still shows it;
      // a line being spoken again says so in place of its name.
      const badge = c.take > 1 ? `<b class="take" aria-label="Take ${c.take}">${c.take}</b>` : '';
      const label = speaking ? `${ICONS.sparkle}Speaking…` : `${long ? ICONS.warn : ICONS.mic}${badge}${escapeHtml(name)}`;
      return {
        key: c.key,
        t: c.start,
        end: c.start + c.dur,
        html: `<div class="${cls}" data-voice="${escapeHtml(c.key)}" title="${escapeHtml(tip.join(' · '))}" style="--fi:${fi}%;--fo:${fo}%;left:${c.start * pps}px;width:${w}px;top:__TOP__px"><i class="h l" title="Trim the head"></i><span>${label}</span><i class="h r" title="Trim the tail"></i></div>`,
      };
    });
    const voicePacked = packLanes(voiceItems);
    fitLane(voiceEl, 'voice', voicePacked.lanes, { base: 34, laneH: VOICE_LANE_H });
    voiceEl.innerHTML = voicePacked.items.map((it) => it.html.replace('__TOP__', String(4 + it.lane * VOICE_LANE_H))).join('');
    const music = audioDesk().music;
    const bedDur = audio?.music?.durationSec || ed.total;
    const from = Math.max(0, music.offset || 0);
    // Loop-to-fill covers the whole cut; otherwise the bar stops where the file ends.
    const to = Math.min(ed.total, music.loop ? ed.total : (music.offset || 0) + bedDur);
    const bedOn = sel?.type === 'music' || sel?.type === 'mix';
    const short = Boolean(audio?.music && ed.total - ((music.offset || 0) + bedDur) > 0.35);
    const bedSrc = audio?.music?.source;
    const bedLabel = music.mute
      ? 'Muted'
      : music.loop && short
        ? 'Music · looped'
        : bedSrc === 'upload'
          ? 'Music · upload'
          : 'Music';
    const rideItems = (music.rides || [])
      .map((r, i) => ({
        key: `ride:${i}`,
        t: r.from,
        end: Math.min(r.to, ed.total),
        i,
        r,
      }))
      .filter((it) => it.r.from < ed.total);
    const ridePacked = packLanes(rideItems);
    const musicH = fitLane(musicEl, 'music', ridePacked.lanes, { base: 34 });
    const bed =
      audio?.music && to > from
        ? `<div class="music-bed${music.mute ? ' is-mute' : ''}${music.loop && short ? ' is-loop' : ''}${bedSrc === 'upload' ? ' is-upload' : ''}${bedOn ? ' is-sel' : ''}" style="left:${from * pps}px;width:${Math.max(12, (to - from) * pps)}px${ridePacked.lanes > 1 ? `;top:4px;height:${musicH - 8}px` : ''}"><i class="h l" title="Fade in"></i><span>${ICONS.music}${bedLabel}</span><i class="h r" title="Fade out"></i></div>`
        : '';
    const rides = ridePacked.items
      .map((it) => {
        const top = 4 + it.lane * FX_LANE_H;
        return `<div class="fx ride${sel?.type === 'ride' && sel.i === it.i ? ' is-sel' : ''}" data-ride="${it.i}" title="${it.r.gainDb > 0 ? '+' : ''}${it.r.gainDb} dB · drag the ends to retime" style="left:${it.r.from * pps}px;width:${Math.max(8, (Math.min(it.r.to, ed.total) - it.r.from) * pps)}px;top:${top}px"><i class="h l"></i><span>${it.r.gainDb > 0 ? '+' : ''}${it.r.gainDb} dB</span><i class="h r"></i></div>`;
      })
      .join('');
    musicEl.innerHTML = bed + rides;
    voiceEl.dataset.empty = !clips.length
      ? 'Voice · Mix builds narration, or Voice in the toolbar to add a line'
      : '';
    musicEl.dataset.empty = audio?.music ? '' : 'Music · compose with ElevenLabs or upload an MP3';
  }

  function paintSelection() {
    const el = $('etlSel');
    if (!el) return;
    const s = ed.sel;
    if (s?.type !== 'range') {
      el.hidden = true;
      return;
    }
    const c = ed.seq.find((x) => x.id === s.clipId);
    if (!c) {
      el.hidden = true;
      return;
    }
    const a = recToEd(c, s.from);
    const b = recToEd(c, s.to);
    el.hidden = false;
    el.style.left = `${a * ed.pps}px`;
    el.style.width = `${Math.max(2, (b - a) * ed.pps)}px`;
    el.dataset.label = `${(b - a).toFixed(1)}s`;
  }

  function paintTools() {
    const c = curClip();
    const onLive = c?.kind === 'live' && live().exists;
    const tip = onLive ? '' : ' — move the playhead onto a recording clip';
    const sp = $('etlAddSpeed');
    const zm = $('etlAddZoom');
    if (sp) {
      sp.disabled = !onLive && ed.sel?.type !== 'range';
      sp.title = `Speed up a stretch (S)${tip}`;
    }
    if (zm) {
      zm.disabled = !onLive;
      zm.title = `Zoom in at the playhead (Z)${tip}`;
    }
    const mg = $('etlAddLens');
    if (mg) {
      mg.disabled = !onLive && ed.sel?.type !== 'range';
      mg.title = `Magnify a detail at the playhead (M)${tip}`;
    }
    const vo = $('etlAddVoice');
    if (vo) vo.title = 'Add a voice line at the playhead';
    const cut = $('etlAddCut');
    if (cut) {
      cut.disabled = !onLive && ed.sel?.type !== 'range';
      cut.title = ed.sel?.type === 'range' ? 'Cut the selected stretch out of the recording (C)' : `Cut 2s from the playhead (C)${tip}`;
    }
    if ($('etlUndo')) $('etlUndo').disabled = !ed.undo.length;
    if ($('etlRedo')) $('etlRedo').disabled = !ed.redo.length;
    paintContext();
  }

  function paintContext() {
    const el = $('etlContext');
    if (!el) return;
    const s = ed.sel;
    if (s?.type === 'range') {
      const len = s.to - s.from;
      el.innerHTML = `<span class="ctx-label">${len.toFixed(1)}s selected</span>
        <span class="ctx-group" role="group" aria-label="Speed">${[1.5, 2, 3]
          .map((r) => `<button type="button" class="ctx-btn" data-range-rate="${r}" title="Play this stretch ${r}× faster">${ICONS.speed}${fmtRate(r)}</button>`)
          .join('')}<button type="button" class="ctx-btn" data-range-rate="0.5" title="Slow this stretch down">${ICONS.slow}0.5×</button></span>
        <button type="button" class="ctx-btn" data-range-zoom title="Zoom in over this stretch">${ICONS.zoom}Zoom</button>
        <button type="button" class="ctx-btn" data-range-lens title="Magnify a detail over this stretch">${ICONS.lens}Magnify</button>
        <button type="button" class="ctx-btn cut" data-range-cut title="Remove this stretch from the recording">${CUT_ICON}Cut</button>
        <button type="button" class="ctx-btn" data-range-skip title="Keep the whole screen here — no auto zoom">${ICONS.noZoom}No zoom</button>
        <button type="button" class="ctx-btn icon" data-range-clear title="Clear selection (Esc)">${ICONS.x}</button>`;
      return;
    }
    el.innerHTML = flashText
      ? `<span class="ctx-hint flash">${ICONS.check}${escapeHtml(flashText)}</span>`
      : `<span class="ctx-hint">Drag across the <b>speed</b>, <b>zoom</b> or <b>cut</b> row to pick a stretch · click a block to edit it</span>`;
  }

  let flashText = '';
  let flashTimer = 0;
  function flashHint(text) {
    flashText = text;
    clearTimeout(flashTimer);
    paintContext();
    flashTimer = setTimeout(() => {
      flashText = '';
      if (ed.sel?.type !== 'range') paintContext();
    }, 1800);
  }

  // ─── Timeline pointer ────────────────────────────────────────────────────────────────────
  function edFromEvent(e) {
    const rect = $('etlCanvas').getBoundingClientRect();
    return clamp((e.clientX - rect.left) / ed.pps, 0, ed.total);
  }

  function liveClipAtEd(t) {
    const i = visualIndexAt(t);
    const c = ed.seq[i];
    return c?.kind === 'live' ? c : null;
  }

  function fxItem(target) {
    const d = deckEdit();
    if (target.dataset.ramp != null) {
      const i = Number(target.dataset.ramp);
      const r = d.speed[i];
      return r && { kind: 'ramp', i, from: r.from, to: r.to, min: ed.deck.ranges.minRampSec };
    }
    if (target.dataset.skip != null) {
      const i = Number(target.dataset.skip);
      const s = d.zoomSkips[i];
      return s && { kind: 'skip', i, from: s.from, to: s.to, min: 0.5 };
    }
    if (target.dataset.lens != null) {
      const l = lensByKey(target.dataset.lens);
      return l && { kind: 'lens', key: l.key, lens: l, from: l.t, to: r3(l.t + l.dur), min: ed.deck.ranges.minLensSec || 1, auto: l.source === 'auto', fixed: l.source === 'off' };
    }
    if (target.dataset.shot != null) {
      const shot = (ed.deck.zoomShots || []).find((s) => shotKey(s) === target.dataset.shot);
      return shot && { kind: 'zoom', key: shotKey(shot), shot, from: shot.start, to: shot.end, min: ed.deck.ranges.minZoomSec, auto: shot.source === 'auto' };
    }
    return null;
  }

  function wireTimeline() {
    const canvas = $('etlCanvas');
    if (!canvas) return;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const t = edFromEvent(e);
      const cardHit = e.target.closest('.ec-card');
      if (cardHit) {
        e.stopPropagation();
        if (ed.playing) pause();
        const edge = e.target.closest('[data-edge]')?.dataset?.edge || null;
        const key = cardHit.dataset.markKey;
        const markT = Number(cardHit.dataset.markT);
        const markDur = Number(cardHit.dataset.markDur);
        const clip = cardOwnerAt(markT) || liveClipAtEd(t) || curClip();
        // Soft-select without re-rendering (keeps the node alive for drag).
        setSelection({ type: 'card', key, cardId: cardHit.dataset.cardId || null, markT, markDur, clipId: clip?.id });
        document.querySelectorAll('.ec-card.is-on').forEach((n) => n.classList.toggle('is-on', n === cardHit));
        showInspectorTab();
        renderInspector();
        canvas.setPointerCapture(e.pointerId);
        ed.drag = {
          type: 'card',
          edge: edge || 'move',
          key,
          cardId: cardHit.dataset.cardId || null,
          clip,
          start: markT,
          dur: markDur,
          x0: e.clientX,
          t0: t,
          el: cardHit,
          moved: false,
        };
        return;
      }
      const markHit = e.target.closest('.ec-mark');
      if (markHit) {
        e.stopPropagation();
        if (ed.playing) pause();
        const clipEl = markHit.closest('.etl-clip');
        const clip = clipEl ? ed.seq[Number(clipEl.dataset.i)] : curClip();
        if (clip) select({ type: 'clip', id: clip.id });
        enterLiveCard(markHit.dataset.cardId || null, markHit.dataset.markT, markHit.dataset.markKey || null);
        return;
      }
      const join = e.target.closest('.etl-join');
      if (join) {
        const c = ed.seq[Number(join.dataset.joinI)];
        if (c?.join) select({ type: 'join', key: c.join.key, i: c.i });
        return;
      }
      const voiceHit = e.target.closest('[data-voice]');
      const rideHit = e.target.closest('[data-ride]');
      const bedHit = e.target.closest('.music-bed');
      if (voiceHit || rideHit || bedHit) {
        canvas.setPointerCapture(e.pointerId);
        if (voiceHit) {
          const clip = (ed.deck?.audio?.voiceClips || []).find((c) => c.key === voiceHit.dataset.voice);
          // `written` is the line's place on this cut before any nudge (the projection, see projectAudio).
          // The ends trim the clip; the body moves it.
          const edge = e.target.classList.contains('h') ? (e.target.classList.contains('l') ? 'l' : 'r') : 'move';
          if (clip) ed.drag = { type: 'voice', edge, key: clip.key, clip, start: clip.start, written: r3(clip.start - (clip.nudge || 0)), dur: clip.dur, x0: e.clientX, t0: t, el: voiceHit, moved: false };
        } else if (rideHit) {
          const i = Number(rideHit.dataset.ride);
          const ride = audioDesk().music.rides[i];
          const edge = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'move';
          if (ride) ed.drag = { type: 'ride', i, from: ride.from, to: ride.to, edge, x0: e.clientX, t0: t, el: rideHit, moved: false };
        } else if (e.target.classList.contains('h')) {
          ed.drag = { type: 'fade', edge: e.target.classList.contains('l') ? 'in' : 'out', fade: e.target.classList.contains('l') ? audioDesk().music.fadeIn : audioDesk().music.fadeOut, x0: e.clientX, t0: t, moved: false };
        } else {
          ed.drag = { type: 'slip', offset: audioDesk().music.offset || 0, x0: e.clientX, t0: t, el: bedHit, moved: false };
        }
        return;
      }
      const cutEl = e.target.closest('[data-cut]');
      const fxEl = e.target.closest('.fx');
      const lane = e.target.closest('.etl-track');
      canvas.setPointerCapture(e.pointerId);
      if (cutEl) {
        const block = cutBlocks().find((c) => c.i === Number(cutEl.dataset.cut));
        if (!block) return;
        const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'move';
        ed.drag = { type: 'cut', i: block.i, mode, from: block.from, to: block.to, splice: block.splice, removed: block.removed, x0: e.clientX, t0: t, el: cutEl, moved: false };
        return;
      }
      if (fxEl) {
        const item = fxItem(fxEl);
        const c = liveClipAtEd(t);
        if (!item || !c) return;
        const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'move';
        ed.drag = { type: 'fx', item, clip: c, mode, x0: e.clientX, t0: t, from: item.from, to: item.to, el: fxEl, moved: false };
        return;
      }
      if (lane && (lane.id === 'etlSpeed' || lane.id === 'etlZoom' || lane.id === 'etlCuts')) {
        const c = liveClipAtEd(t);
        if (c) {
          ed.drag = { type: 'range', lane: lane.id, clip: c, a: edToRec(c, t), x0: e.clientX, t0: t, moved: false };
          return;
        }
      }
      // Empty voice lane click: seek + open the Add voice inspector (no scrub drag).
      if (lane?.id === 'etlVoice' && !voiceHit) {
        if (ed.playing) pause();
        seek(t);
        ed.sel = null;
        renderInspector();
        flashHint('Add voice at the playhead');
        return;
      }
      const clipEl = e.target.closest('.etl-clip');
      if (ed.playing) pause();
      ed.drag = { type: 'scrub', clipI: clipEl ? Number(clipEl.dataset.i) : null, x0: e.clientX, moved: false };
      seek(t);
    });
    canvas.addEventListener('pointermove', (e) => {
      const g = ed.drag;
      if (!g) return;
      if (Math.abs(e.clientX - g.x0) > 3) g.moved = true;
      const t = edFromEvent(e);
      if (g.type === 'scrub') {
        if (g.clipI != null && Math.abs(e.clientX - g.x0) > 8) {
          g.type = 'clip';
          g.from = g.clipI;
          liftClip(g);
        } else if (g.moved) seek(t);
      } else if (g.type === 'clip') {
        dragClip(g, e.clientX - g.x0);
      } else if (g.type === 'range' && g.moved) {
        const b = edToRec(g.clip, clamp(t, g.clip.at, g.clip.at + g.clip.dur));
        ed.sel = { type: 'range', clipId: g.clip.id, from: r3(Math.min(g.a, b)), to: r3(Math.max(g.a, b)) };
        paintSelection();
        seek(recToEd(g.clip, b));
      } else if (g.type === 'cut' && g.moved) dragCut(g, t);
      else if (g.type === 'fx' && g.moved && !g.item.fixed) dragFx(g, t);
      else if (g.type === 'card' && g.moved) dragCard(g, t);
      else if (g.moved && (g.type === 'voice' || g.type === 'ride' || g.type === 'slip' || g.type === 'fade')) dragAudio(g, t);
    });
    const finish = async (e) => {
      const g = ed.drag;
      ed.drag = null;
      if (!g) return;
      if (g.type === 'scrub') {
        if (!g.moved && g.clipI != null) {
          const clip = ed.seq[g.clipI];
          if (clip) {
            // Keep stage and selection in sync — selecting a brick outside the playhead felt broken.
            if (ed.t < clip.at || ed.t >= clip.at + clip.dur - 1e-4) {
              seek(clip.at + Math.min(0.15, Math.max(0.05, clip.dur * 0.2)));
            }
            select({ type: 'clip', id: clip.id });
          }
        }
      } else if (g.type === 'clip') {
        await dropClip(g);
      } else if (g.type === 'range') {
        if (g.lane === 'etlCuts' && g.moved && ed.sel?.type === 'range' && ed.sel.to - ed.sel.from >= 0.2) {
          await addCut(ed.sel.from, ed.sel.to);
        } else if (!g.moved || !ed.sel || ed.sel.type !== 'range' || ed.sel.to - ed.sel.from < 0.2) {
          seek(g.t0);
          select({ type: 'clip', id: g.clip.id });
        } else {
          renderInspector();
          paintTools();
        }
      } else if (g.type === 'cut') {
        if (!g.moved) select({ type: 'cut', i: g.i });
        else await commitCut(g);
      } else if (g.type === 'fx') {
        if (!g.moved || g.item.fixed) selectFx(g.item);
        else await commitFx(g);
      } else if (g.type === 'card') {
        if (!g.moved) {
          const owner = g.clip || cardOwnerAt(g.start);
          if (owner) seek(recToEd(owner, g.start + 0.12));
          await ensureLiveCards(g.cardId || null);
          // Bring the tip back so Edit copy is one click away (it was often dismissed / covering captions).
          setCoachHidden(false);
          select({
            type: 'card',
            key: g.key,
            cardId: g.cardId || null,
            markT: g.start,
            markDur: g.dur,
            clipId: owner?.id,
          });
          paintTextMode();
        } else await commitCard(g);
      } else if (g.type === 'voice' || g.type === 'ride' || g.type === 'slip' || g.type === 'fade') {
        if (!g.moved) {
          if (g.type === 'voice') select({ type: 'voice', key: g.key });
          else if (g.type === 'ride') select({ type: 'ride', i: g.i });
          else select({ type: 'music' });
          if (g.type === 'voice') seek(g.start + 0.05);
        } else await commitAudio(g);
      }
      void e;
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('dblclick', (e) => {
      const cardHit = e.target.closest('.ec-card');
      if (cardHit) {
        e.preventDefault();
        enterLiveCard(cardHit.dataset.cardId || null, cardHit.dataset.markT, cardHit.dataset.markKey || null);
        return;
      }
      const fxEl = e.target.closest('.fx');
      if (fxEl) {
        const item = fxItem(fxEl);
        if (item) seek(recToEd(liveClipAtEd(edFromEvent(e)) || curClip(), item.from + 0.02));
      }
    });
    $('etlScroll')?.addEventListener(
      'wheel',
      (e) => {
        if (!(e.metaKey || e.ctrlKey)) return;
        e.preventDefault();
        const scroll = $('etlScroll');
        const at = edFromEvent(e);
        const px = e.clientX - scroll.getBoundingClientRect().left - etlHeadWidth(scroll);
        setScale(ed.zoomScale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
        scroll.scrollLeft = at * ed.pps - px;
      },
      { passive: false }
    );
  }

  /** Pick a brick up: remember where every brick sits so the others can slide out of its way. */
  function liftClip(g) {
    const host = $('etlClips');
    g.el = host?.querySelector(`.etl-clip[data-i="${g.from}"]`) || null;
    g.els = [...(host?.querySelectorAll('.etl-clip') || [])];
    g.span = ed.seq.map((_, i) => visualSpan(i).map((v) => v * ed.pps));
    g.w = g.span[g.from][1] - g.span[g.from][0];
    g.at = g.from;
    g.ids = ed.seq.map((c) => c.id);
    host?.classList.add('is-reordering');
    g.el?.classList.add('is-lift');
  }

  /** The lifted brick rides with the pointer; its centre picks the slot, and the bricks in between slide over. */
  function dragClip(g, dx) {
    if (!g.el) return;
    g.el.style.transform = `translateX(${dx}px)`;
    const [a, b] = g.span[g.from];
    const mid = (a + b) / 2 + dx;
    let at = 0;
    for (let i = 0; i < ed.seq.length; i++) {
      if (i === g.from) continue;
      const [sa, sb] = g.span[i];
      if (mid < (sa + sb) / 2) break;
      at++;
    }
    if (at === g.at) return;
    g.at = at;
    const ids = ed.seq.map((c) => c.id);
    const [id] = ids.splice(g.from, 1);
    ids.splice(at, 0, id);
    g.ids = ids;
    for (const el of g.els) {
      const i = Number(el.dataset.i);
      if (i === g.from) continue;
      let shift = 0;
      if (at > g.from && i > g.from && i <= at) shift = -g.w;
      else if (at < g.from && i >= at && i < g.from) shift = g.w;
      el.style.transform = shift ? `translateX(${shift}px)` : '';
    }
  }

  /** Let go: a new slot saves and the bricks glide from where they are into the saved cut; the same slot eases home. */
  async function dropClip(g) {
    const host = $('etlClips');
    const id = ed.seq[g.from]?.id;
    if (g.at !== g.from && id) {
      ed.flipFrom = clipRects();
      setSelection({ type: 'clip', id });
      const r = await commitOrder(g.ids, 'Sequence reordered');
      host?.classList.remove('is-reordering');
      if (r) {
        paintTools();
        showInspectorTab();
      } else settleClips(g);
      return;
    }
    host?.classList.remove('is-reordering');
    settleClips(g);
  }

  function settleClips(g) {
    const host = $('etlClips');
    host?.classList.add('is-settling');
    g.el?.classList.remove('is-lift');
    g.el?.classList.add('is-home');
    for (const el of g.els || []) el.style.transform = '';
    clearTimeout(ed.settleTimer);
    ed.settleTimer = setTimeout(() => {
      host?.classList.remove('is-settling');
      g.el?.classList.remove('is-home');
    }, 340);
  }

  /** Save a sequence. The rendered order stores nothing, so moving a clip back clears the override. */
  function commitOrder(ids, hint) {
    const natural = ed.deck?.naturalIds || [];
    const same = ids.length === natural.length && ids.every((id, i) => id === natural[i]);
    return postDeck({ order: same ? [] : ids }, { hint });
  }

  /** Full recording span covered by live bricks — captions/chapters can move across sections. */
  function liveRecSpan() {
    const lives = ed.seq.filter((x) => x.kind === 'live');
    if (!lives.length) return { from: 0, to: 0 };
    return {
      from: Math.min(...lives.map((x) => x.recFrom)),
      to: Math.max(...lives.map((x) => x.recTo)),
    };
  }

  function dragCard(g, t) {
    const c = g.clip?.kind === 'live' ? g.clip : cardOwnerAt(g.start);
    if (!c || c.kind !== 'live') return;
    const span = liveRecSpan();
    const owner = liveClipAtEd(t) || c;
    const rec = clamp(
      ed.clock.fromClean(ed.clock.toClean(owner.recFrom) + (clamp(t, owner.at, owner.at + owner.dur) - owner.at)),
      span.from,
      span.to
    );
    const [minDur] = ed.deck?.ranges?.cardDur || [0.4, 30];
    let from = g.start;
    let dur = g.dur;
    if (g.edge === 'move') {
      from = clamp(rec - g.dur * 0.15, span.from, Math.max(span.from, span.to - g.dur));
    } else if (g.edge === 'l') {
      const end = g.start + g.dur;
      from = clamp(rec, span.from, end - minDur);
      dur = end - from;
    } else if (g.edge === 'r') {
      const end = clamp(rec, g.start + minDur, span.to);
      dur = end - g.start;
      from = g.start;
    }
    g.newT = r3(from);
    g.newDur = r3(dur);
    const segs = fxSegments(from, from + dur);
    if (segs.length && g.el) {
      g.el.style.left = `${segs[0].a * ed.pps}px`;
      g.el.style.width = `${Math.max(18, (segs[segs.length - 1].b - segs[0].a) * ed.pps)}px`;
    }
    const seekClip = ed.seq.find((x) => x.kind === 'live' && from >= x.recFrom - 0.05 && from < x.recTo) || owner;
    seek(recToEd(seekClip, from + 0.12));
  }

  async function commitCard(g) {
    if (g.newT == null && g.newDur == null) return;
    const row = {
      key: g.key,
      t: g.newT != null ? g.newT : g.start,
      dur: g.newDur != null ? g.newDur : g.dur,
    };
    return saveCardTiming(row, {
      cardId: g.cardId,
      clipId: g.clip?.id,
      hint: g.edge === 'move' ? 'Card moved' : 'Card length changed',
    });
  }

  /** Persist start + on-screen length into `edit.cards` (produce bake reads the same). */
  async function saveCardTiming(row, { cardId = null, clipId = null, hint = 'Card timing updated' } = {}) {
    if (!row?.key) return null;
    const [lo, hi] = ed.deck?.ranges?.cardDur || [0.4, 30];
    const next = {
      key: row.key,
      t: r3(Number(row.t)),
      dur: r3(clamp(Number(row.dur), lo, hi)),
    };
    if (!Number.isFinite(next.t) || !Number.isFinite(next.dur)) return null;
    const cards = [...(deckEdit().cards || [])];
    const i = cards.findIndex((c) => c.key === next.key);
    if (i >= 0) cards[i] = { ...cards[i], ...next };
    else cards.push(next);
    const r = await postDeck({ cards }, { hint });
    if (r) {
      select({ type: 'card', key: next.key, cardId, markT: next.t, markDur: next.dur, clipId });
      // Reload so --x-out / --hold match the new length (server rebuilt overlay HTML).
      if (cardId) {
        ed.stalePlates.add(cardId);
        ed.compositeCardId = null;
        ed.compositeHoldMs = null;
        ed.compositeSeekMs = null;
        await requestPlate(cardId, { reason: 'show', force: true });
      }
      paintTools();
    }
    return r;
  }

  async function moveClip(id, dir) {
    const i = ed.seq.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ed.seq.length) return;
    const ids = ed.seq.map((c) => c.id);
    const [item] = ids.splice(i, 1);
    ids.splice(j, 0, item);
    ed.flipFrom = clipRects();
    setSelection({ type: 'clip', id });
    const r = await commitOrder(ids, dir < 0 ? 'Moved earlier' : 'Moved later');
    if (r) {
      paintTools();
      showInspectorTab();
    }
  }

  function dragAudio(g, t) {
    const dt = t - g.t0;
    const [olo, ohi] = ed.deck?.ranges?.musicOffset || [-20, 20];
    if (g.type === 'voice' && g.edge === 'move') {
      // Anywhere on the cut: dropping a line past another one is how they get reordered.
      const start = clamp(g.start + dt, 0, Math.max(0, ed.total - g.dur));
      g.newStart = r3(start);
      g.el.style.left = `${start * ed.pps}px`;
      g.el.style.zIndex = '4';
      seek(Math.min(start + 0.05, ed.total));
    } else if (g.type === 'voice') {
      const c = g.clip;
      const minSec = ed.deck?.ranges?.voiceMinSec || 0.3;
      if (g.edge === 'l') {
        // Trimming the head moves the start by the same amount, so the words that stay keep their place.
        const trimStart = clamp(r3(c.trimStart + dt), 0, r3(c.full - c.trimEnd - minSec));
        const delta = trimStart - c.trimStart;
        g.newTrimStart = trimStart;
        g.newNudge = r3((c.nudge || 0) + delta);
        g.el.style.left = `${(c.start + delta) * ed.pps}px`;
        g.el.style.width = `${Math.max(8, (c.dur - delta) * ed.pps)}px`;
        seek(Math.min(c.start + delta + 0.05, ed.total));
      } else {
        const trimEnd = clamp(r3(c.trimEnd - dt), 0, r3(c.full - c.trimStart - minSec));
        g.newTrimEnd = trimEnd;
        const dur = c.full - c.trimStart - trimEnd;
        g.el.style.width = `${Math.max(8, dur * ed.pps)}px`;
        seek(Math.min(c.start + dur, ed.total));
      }
    } else if (g.type === 'slip') {
      const offset = clamp(r3(g.offset + dt), olo, ohi);
      g.newOffset = offset;
      const bedDur = ed.deck?.audio?.music?.durationSec || ed.total;
      const from = Math.max(0, offset);
      const to = Math.min(ed.total, audioDesk().music.loop ? ed.total : offset + bedDur);
      g.el.style.left = `${from * ed.pps}px`;
      g.el.style.width = `${Math.max(12, (to - from) * ed.pps)}px`;
    } else if (g.type === 'fade') {
      g.newFade = r3(clamp(g.fade + (g.edge === 'in' ? dt : -dt), 0, 8));
    } else if (g.type === 'ride') {
      const len = g.to - g.from;
      let from = g.from;
      let to = g.to;
      if (g.edge === 'move') {
        from = clamp(g.from + dt, 0, Math.max(0, ed.total - len));
        to = from + len;
      } else if (g.edge === 'l') from = clamp(g.from + dt, 0, g.to - 0.4);
      else to = clamp(g.to + dt, g.from + 0.4, ed.total);
      g.newFrom = r3(from);
      g.newTo = r3(to);
      g.el.style.left = `${from * ed.pps}px`;
      g.el.style.width = `${Math.max(8, (to - from) * ed.pps)}px`;
      seek(g.edge === 'r' ? to : from);
    }
  }

  async function commitAudio(g) {
    if (g.type === 'voice' && g.newStart != null) {
      await withVoice(g.key, { at: g.newStart, nudge: 0 }, 'Line moved');
      select({ type: 'voice', key: g.key });
    } else if (g.type === 'voice' && g.newTrimStart != null) {
      await withVoice(g.key, { trimStart: g.newTrimStart, nudge: g.newNudge }, 'Head trimmed');
      select({ type: 'voice', key: g.key });
    } else if (g.type === 'voice' && g.newTrimEnd != null) {
      await withVoice(g.key, { trimEnd: g.newTrimEnd }, 'Tail trimmed');
      select({ type: 'voice', key: g.key });
    } else if (g.type === 'slip' && g.newOffset != null) {
      await withMusic({ offset: g.newOffset }, 'Music slipped');
      select({ type: 'music' });
    } else if (g.type === 'fade' && g.newFade != null) {
      await withMusic({ [g.edge === 'in' ? 'fadeIn' : 'fadeOut']: g.newFade });
      select({ type: 'music' });
    } else if (g.type === 'ride' && g.newFrom != null) {
      const rides = audioDesk().music.rides.map((r, i) => (i === g.i ? { ...r, from: g.newFrom, to: g.newTo } : r));
      await withMusic({ rides }, 'Ride moved');
      select({ type: 'ride', i: g.i });
    }
  }

  function dragCut(g, t) {
    const dt = t - g.t0;
    const min = 0.2;
    const liveDur = live().durationSec || 1e9;
    const toClean = ed.clock?.toClean || ((n) => n);
    const fromClean = ed.clock?.fromClean || ((n) => n);
    const cleanLen = Math.max(min, toClean(g.to) - toClean(g.from));
    let from = g.from;
    let to = g.to;
    if (g.mode === 'move') {
      const cleanFrom = clamp(toClean(g.from) + dt, 0, Math.max(0, toClean(liveDur) - cleanLen));
      from = fromClean(cleanFrom);
      to = fromClean(cleanFrom + cleanLen);
    } else if (g.mode === 'l') {
      from = fromClean(clamp(toClean(g.from) + dt, 0, toClean(g.to) - min));
    } else {
      to = fromClean(clamp(toClean(g.to) + dt, toClean(g.from) + min, toClean(liveDur)));
    }
    g.newFrom = r3(Math.min(from, to));
    g.newTo = r3(Math.max(from, to));
    const removed = Math.max(min, toClean(g.newTo) - toClean(g.newFrom));
    const left = g.mode === 'r' ? g.splice - g.removed : g.mode === 'move' ? g.splice - g.removed + dt : g.splice - removed;
    g.el.style.left = `${Math.max(0, left) * ed.pps}px`;
    g.el.style.width = `${Math.max(8, (g.mode === 'move' ? g.removed : removed) * ed.pps)}px`;
    g.el.classList.add('is-drag');
  }

  async function commitCut(g) {
    const from = g.newFrom ?? g.from;
    const to = g.newTo ?? g.to;
    if (!(to - from >= 0.2)) return;
    const cuts = (deckEdit().cuts || []).map((c, i) => (i === g.i ? { from: r3(from), to: r3(to) } : c));
    const r = await postDeck({ cuts }, { hint: 'Cut adjusted' });
    if (!r) return;
    const i = (deckEdit().cuts || []).findIndex((c) => Math.abs(c.from - from) < 0.05 && Math.abs(c.to - to) < 0.05);
    if (i >= 0) select({ type: 'cut', i });
  }

  function dragFx(g, t) {
    const c = g.clip;
    const dt = t - g.t0;
    const len = g.to - g.from;
    let from = g.from;
    let to = g.to;
    const lo = c.recFrom;
    const hi = c.recTo;
    // Ramps never overlap each other.
    let nlo = lo;
    let nhi = hi;
    if (g.item.kind === 'ramp') {
      for (const [i, r] of deckEdit().speed.entries()) {
        if (i === g.item.i) continue;
        if (r.to <= g.from + 1e-3) nlo = Math.max(nlo, r.to);
        if (r.from >= g.to - 1e-3) nhi = Math.min(nhi, r.from);
      }
    }
    const startEd = recToEd(c, Math.max(g.from, lo));
    const endEd = recToEd(c, Math.min(g.to, hi));
    if (g.mode === 'move') {
      from = clamp(edToRec(c, startEd + dt), nlo, nhi - len);
      to = from + len;
    } else if (g.mode === 'l') {
      from = clamp(edToRec(c, startEd + dt), nlo, g.to - g.item.min);
    } else {
      to = clamp(edToRec(c, endEd + dt), g.from + g.item.min, nhi);
    }
    g.newFrom = r3(from);
    g.newTo = r3(to);
    const a = recToEd(c, Math.max(from, lo));
    const b = recToEd(c, Math.min(to, hi));
    g.el.style.left = `${a * ed.pps}px`;
    g.el.style.width = `${Math.max(6, (b - a) * ed.pps)}px`;
    g.el.classList.add('is-drag');
    seek(g.mode === 'r' ? b : a);
  }

  async function commitFx(g) {
    const d = deckEdit();
    const from = g.newFrom ?? g.from;
    const to = g.newTo ?? g.to;
    const it = g.item;
    if (it.kind === 'ramp') {
      await postDeck({ speed: d.speed.map((r, i) => (i === it.i ? { ...r, from, to } : r)) });
      ed.sel = { type: 'ramp', i: deckEdit().speed.findIndex((r) => Math.abs(r.from - from) < 0.01) };
    } else if (it.kind === 'skip') {
      await postDeck({ zoomSkips: d.zoomSkips.map((s, i) => (i === it.i ? { from, to } : s)) });
    } else if (it.kind === 'lens') {
      if (it.auto) await adoptLens(it.lens, { t: from, dur: r3(to - from) });
      else await postDeck({ lenses: d.lenses.map((l) => (l.id === it.lens.id ? { ...l, t: from, dur: r3(to - from) } : l)) });
    } else if (it.kind === 'zoom') {
      if (it.auto) await adoptShot(it.shot, { t: from, dur: to - from });
      else await postDeck({ zooms: d.zooms.map((z) => (z.id === it.shot.id ? { ...z, t: from, dur: r3(to - from) } : z)) });
    }
    renderTimeline();
    renderInspector();
  }

  // ─── Edits ───────────────────────────────────────────────────────────────────────────────
  async function addRamp(from, to, rate) {
    const speed = [...deckEdit().speed.filter((r) => r.to <= from + 0.001 || r.from >= to - 0.001), { from: r3(from), to: r3(to), rate }];
    const r = await postDeck({ speed }, { hint: `${fmtRate(rate)} speed added` });
    if (r) {
      const i = deckEdit().speed.findIndex((x) => Math.abs(x.from - from) < 0.01);
      if (i >= 0) select({ type: 'ramp', i });
    }
  }

  async function addZoomAt(t, dur = 3.5, zoom) {
    const c = ed.seq.find((x) => x.kind === 'live' && t >= x.recFrom && t <= x.recTo) || curClip();
    if (!c || c.kind !== 'live') return;
    const levels = ed.deck.zoomLevels || {};
    const level = zoom || levels[ed.deck.camera?.zoom] || 1.6;
    const start = clamp(t, c.recFrom, Math.max(c.recFrom, c.recTo - ed.deck.ranges.minZoomSec));
    const length = clamp(dur, ed.deck.ranges.minZoomSec, c.recTo - start);
    const id = `z${Math.round(start * 10)}`;
    const zooms = [...deckEdit().zooms.filter((z) => z.id !== id), { id, t: r3(start), dur: r3(length), zoom: level, x: liveW() / 2, y: liveH() / 2 }];
    const r = await postDeck({ zooms }, { hint: 'Zoom added — drag the box on the stage to aim it' });
    if (r) {
      select({ type: 'zoom', key: id });
      seek(recToEd(c, start + Math.min(1, length / 2)));
    }
  }

  /** A new magnifier, aimed at the nearest click or typing in the clip when there is one. */
  async function addLensAt(t, dur = 2.6) {
    const c = ed.seq.find((x) => x.kind === 'live' && t >= x.recFrom && t <= x.recTo) || curClip();
    if (!c || c.kind !== 'live') return;
    const min = ed.deck.ranges.minLensSec || 1;
    const start = clamp(t, c.recFrom, Math.max(c.recFrom, c.recTo - min));
    const length = clamp(dur, min, Math.max(min, c.recTo - start));
    const W = liveW();
    const H = liveH();
    const near = (ed.deck.marks || [])
      .filter((m) => (m.kind === 'click' || m.kind === 'type') && Number.isFinite(m.x) && m.t >= c.recFrom && m.t <= c.recTo)
      .sort((a, b) => Math.abs(a.t - start - length / 2) - Math.abs(b.t - start - length / 2))[0];
    const aim = near && Math.abs(near.t - start - length / 2) < 4 ? { x: Math.round(near.x), y: Math.round(near.y) } : { x: W / 2, y: H / 2 };
    const id = `m${Math.round(start * 10)}`;
    const lenses = [...deckEdit().lenses.filter((l) => l.id !== id), { id, t: r3(start), dur: r3(length), ...aim, w: 220, h: 56 }];
    const r = await postDeck({ lenses }, { hint: near ? 'Magnifier added on the nearest click — drag it on the stage to aim' : 'Magnifier added — drag it on the stage to aim' });
    if (r) {
      select({ type: 'lens', key: `edit:${id}` });
      seek(recToEd(c, start + Math.min(1.1, length / 2)));
    }
  }

  async function adoptLens(lens, over = {}) {
    const t = r3(over.t ?? lens.t);
    const id = `m${Math.round(t * 10)}`;
    const d = deckEdit();
    const lenses = [
      ...d.lenses.filter((l) => l.id !== id),
      {
        id,
        t,
        dur: r3(over.dur ?? lens.dur),
        x: Math.round(over.x ?? lens.rect.x + lens.rect.w / 2),
        y: Math.round(over.y ?? lens.rect.y + lens.rect.h / 2),
        w: Math.round(over.w ?? lens.rect.w),
        h: Math.round(over.h ?? lens.rect.h),
        ...(lens.label ? { label: lens.label } : {}),
      },
    ];
    const lensOff = [...new Set([...d.lensOff, r3(lens.t)])];
    const r = await postDeck({ lenses, lensOff }, { hint: 'That magnifier is yours now' });
    if (r) select({ type: 'lens', key: `edit:${id}` });
  }

  async function adoptShot(shot, over = {}) {
    const W = liveW();
    const H = liveH();
    const p = shot.points?.[0] || { cx: W / 2, cy: H / 2 };
    const zoom = over.zoom ?? shot.zoom;
    const aim = clampZoomCenter(over.x ?? p.cx, over.y ?? p.cy, { zoom, width: W, height: H });
    const id = `z${Math.round((over.t ?? shot.start) * 10)}`;
    const d = deckEdit();
    const zooms = [
      ...d.zooms.filter((z) => z.id !== id),
      { id, t: r3(over.t ?? shot.start), dur: r3(over.dur ?? shot.end - shot.start), zoom, x: aim.cx, y: aim.cy },
    ];
    const zoomSkips = [...d.zoomSkips, { from: shot.start, to: shot.end }];
    const r = await postDeck({ zooms, zoomSkips }, { hint: 'That zoom is yours now' });
    if (r) select({ type: 'zoom', key: id });
  }

  async function omitClip(id) {
    if (!id || ed.seq.length <= 1) {
      toast('Keep at least one section', 'The cut needs something to play', 'warn');
      return null;
    }
    const d = deckEdit();
    const omit = [...new Set([...(d.omit || []), id])];
    const order = (d.order || []).filter((x) => x !== id);
    return postDeck({ omit, order }, { hint: 'Section removed from the cut' });
  }

  async function restoreOmitted(id) {
    const d = deckEdit();
    const omit = (d.omit || []).filter((x) => x !== id);
    const r = await postDeck({ omit }, { hint: 'Section restored' });
    if (r) {
      const c = ed.seq.find((x) => x.id === id) || curClip();
      if (c) seek(c.at + Math.min(0.12, c.dur * 0.25));
      select(c ? { type: 'clip', id: c.id } : null);
    }
    return r;
  }

  async function removeSelected() {
    const s = ed.sel;
    const d = deckEdit();
    if (!s) return;
    if (s.type === 'clip') {
      const r = await omitClip(s.id);
      if (r) {
        // Follow the remapped playhead — do not yank selection to the first clip.
        const pick = curClip() || ed.seq[0] || null;
        select(pick ? { type: 'clip', id: pick.id } : null);
      }
      return;
    }
    if (s.type === 'cut') {
      await postDeck({ cuts: (d.cuts || []).filter((_, i) => i !== s.i) }, { hint: 'Stretch restored' });
      const c = curClip();
      select(c ? { type: 'clip', id: c.id } : null);
      return;
    }
    if (s.type === 'ramp') await postDeck({ speed: d.speed.filter((_, i) => i !== s.i) }, { hint: 'Speed change removed' });
    else if (s.type === 'skip') await postDeck({ zoomSkips: d.zoomSkips.filter((_, i) => i !== s.i) }, { hint: 'Auto zoom allowed again' });
    else if (s.type === 'zoom') {
      const shot = selectedShot();
      if (!shot) return;
      if (shot.source === 'auto') await postDeck({ zoomSkips: [...d.zoomSkips, { from: shot.start, to: shot.end }] }, { hint: 'Auto zoom removed' });
      else await postDeck({ zooms: d.zooms.filter((z) => z.id !== shot.id) }, { hint: 'Zoom removed' });
    } else if (s.type === 'ride') {
      const rides = audioDesk().music.rides.filter((_, i) => i !== s.i);
      await withMusic({ rides }, 'Ride removed');
    } else if (s.type === 'voice') {
      await withVoice(s.key, { mute: true }, 'Line muted');
    } else if (s.type === 'lens') {
      const l = selectedLens();
      if (!l || l.source === 'off') return;
      if (l.source === 'auto') await postDeck({ lensOff: [...d.lensOff, r3(l.t)] }, { hint: 'Recorded magnifier switched off' });
      else await postDeck({ lenses: d.lenses.filter((x) => x.id !== l.id) }, { hint: 'Magnifier removed' });
    } else if (s.type !== 'range') return;
    const c = curClip();
    select(c ? { type: 'clip', id: c.id } : null);
  }

  async function addCut(from, to) {
    if (!(to - from >= 0.2)) {
      toast('Cut is too short', 'Drag a longer stretch — at least 0.2s', 'warn');
      return null;
    }
    const cuts = [...(deckEdit().cuts || []), { from: r3(from), to: r3(to) }];
    const r = await postDeck({ cuts }, { hint: `${(to - from).toFixed(1)}s cut from the recording` });
    if (r) {
      const i = (deckEdit().cuts || []).findIndex((c) => c.from <= from + 0.05 && c.to >= to - 0.05);
      if (i >= 0) select({ type: 'cut', i });
    }
    return r;
  }

  function toolCut() {
    const s = ed.sel;
    if (s?.type === 'range') return addCut(s.from, s.to);
    const c = curClip();
    if (c?.kind !== 'live') return toast('Move onto the recording', 'Cuts remove a stretch of the screen recording', 'warn');
    const from = edToRec(c, ed.t);
    const to = Math.min(c.recTo, from + 2);
    if (to - from < 0.35) return toast('Too close to the end', 'Move the playhead earlier, or drag the stretch on the Cut row', 'warn');
    return addCut(from, to);
  }

  function toolSpeed() {
    const s = ed.sel;
    if (s?.type === 'range') return addRamp(s.from, s.to, 2);
    const c = curClip();
    if (c?.kind !== 'live') return;
    const from = edToRec(c, ed.t);
    const to = Math.min(c.recTo, from + 4);
    if (to - from < ed.deck.ranges.minRampSec) return toast('Too close to the end', 'Move the playhead earlier in the clip', 'warn');
    return addRamp(from, to, 2);
  }

  function toolZoom() {
    const s = ed.sel;
    if (s?.type === 'range') return addZoomAt(s.from, s.to - s.from);
    const c = curClip();
    if (c?.kind !== 'live') return;
    return addZoomAt(edToRec(c, ed.t));
  }

  function toolLens() {
    const s = ed.sel;
    if (s?.type === 'range') return addLensAt(s.from, s.to - s.from);
    const c = curClip();
    if (c?.kind !== 'live') return;
    return addLensAt(edToRec(c, ed.t));
  }

  /** Create a blank ad-lib voice line at the playhead and select it. */
  async function toolVoice() {
    if (ed.playing) pause();
    return addVoiceLine({ text: '' });
  }

  // ─── Selection ───────────────────────────────────────────────────────────────────────────
  /** Change what is selected without painting — for callers whose next deck paint draws it. */
  function setSelection(sel) {
    ed.sel = sel;
    ed.aim = null;
    ed.aimZoom = null;
    ed.lensAim = null;
  }

  function select(sel) {
    setSelection(sel);
    renderClipsTrack();
    renderCardTracks();
    renderFxTracks();
    renderAudioTracks();
    paintSelection();
    paintTools();
    paintZoomBox();
    paintLensBox();
    renderFrame();
    paintTextMode();
    renderInspector();
    showInspectorTab();
  }

  function selectFx(item) {
    if (item.kind === 'ramp') select({ type: 'ramp', i: item.i });
    else if (item.kind === 'skip') select({ type: 'skip', i: item.i });
    else if (item.kind === 'lens') {
      select({ type: 'lens', key: item.key });
      const c = ed.seq.find((x) => x.kind === 'live' && item.from >= x.recFrom - 0.01 && item.from <= x.recTo);
      if (c) seek(recToEd(c, item.from + Math.min(1.1, (item.to - item.from) / 2)));
    } else {
      select({ type: 'zoom', key: item.key });
      const c = ed.seq.find((x) => x.kind === 'live' && item.from >= x.recFrom - 0.01 && item.from <= x.recTo);
      if (c) seek(recToEd(c, item.shot.points?.[0]?.t ?? item.from + Math.min(1, (item.to - item.from) / 2)));
    }
  }

  function showInspectorTab() {
    const tab = document.querySelector('.tools-panel .ptab[data-right="inspector"]');
    if (tab && !tab.classList.contains('active')) tab.click();
  }

  // ─── Status ──────────────────────────────────────────────────────────────────────────────
  function paintStatus() {
    const el = $('edStatus');
    if (!el || !ed.deck) return;
    const picture = ed.deck.stale || ed.dirtyRender;
    const mix = Boolean(ed.deck.audioStale);
    el.hidden = false;
    el.className = `ed-status${picture || mix ? ' is-stale' : ''}`;
    const renderBtn = `<button type="button" class="ed-render" data-act="render" title="Render the video with these edits">${ICONS.render}Render</button>`;
    const mixBtn = `<button type="button" class="ed-render" data-act="mix" title="Mix voice and music with these levels">${ICONS.music}Mix</button>`;
    el.innerHTML = picture
      ? `<span class="ed-dot"></span><span class="ed-status-text">Not in the video yet</span>${renderBtn}${mix ? mixBtn : ''}`
      : mix
        ? `<span class="ed-dot"></span><span class="ed-status-text">Not in the mix yet</span>${mixBtn}`
        : `${ICONS.check}<span class="ed-status-text">Video is up to date</span>`;
    el.title = ed.deck.summary || '';
  }

  // ─── Inspector ───────────────────────────────────────────────────────────────────────────
  const section = (icon, title, body, extra = '') =>
    `<section class="ins-sec"><header>${ICONS[icon] || (typeof icon === 'string' && icon.includes('<svg') ? icon : '')}<strong>${title}</strong>${extra}</header><div class="ins-body">${body}</div></section>`;
  const segBtns = (attr, values, current, label = (v) => v) =>
    `<div class="ins-seg">${values.map((v) => `<button type="button" ${attr}="${v}" class="${String(current) === String(v) ? 'on' : ''}">${label(v)}</button>`).join('')}</div>`;

  function renderInspector() {
    const root = $('inspectorRoot');
    if (!root) return;
    if (!ed.deck) {
      root.innerHTML = `<p class="panel-lede">Loading the cut…</p>`;
      return;
    }
    const s = ed.sel;
    let html = '';
    if (!s) html = renderEmpty();
    else if (s.type === 'clip') {
      const c = ed.seq.find((x) => x.id === s.id);
      html = !c ? renderEmpty() : c.kind === 'plate' ? renderPlate(c) : renderLive(c);
    } else if (s.type === 'ramp') html = renderRamp(s.i);
    else if (s.type === 'zoom') html = renderZoom();
    else if (s.type === 'skip') html = renderSkip(s.i);
    else if (s.type === 'lens') html = renderLens();
    else if (s.type === 'voice') html = renderVoice();
    else if (s.type === 'music' || s.type === 'mix') html = renderMusic();
    else if (s.type === 'ride') html = renderRide();
    else if (s.type === 'join') html = renderJoin(s.i);
    else if (s.type === 'range') html = renderRange(s);
    else if (s.type === 'cut') html = renderCut(s.i);
    else if (s.type === 'card') html = renderCardSel(s);
    root.innerHTML = html;
    wireInspector();
  }

  const head = (icon, kind, title, sub, actions = '') =>
    `<div class="ins-head ${kind}"><span class="ins-ico">${icon}</span><div><strong>${escapeHtml(title)}</strong><em>${sub}</em></div>${actions}</div>`;

  function renderEmpty() {
    const omitted = ed.deck?.omitted || [];
    const restore =
      omitted.length > 0
        ? `<div class="ins-omitted"><strong>Removed from the cut</strong>${omitted
            .map(
              (o) =>
                `<button type="button" class="ins-item" data-act="restore-omit" data-omit-id="${escapeHtml(o.id)}">${
                  o.kind === 'live' ? ICONS.film : ICONS.plate
                }<span><b>${escapeHtml(o.title || o.id)}</b><em>${escapeHtml(o.kind)}${o.type ? ` · ${escapeHtml(o.type)}` : ''}</em></span><i>Restore</i></button>`
            )
            .join('')}</div>`
        : '';
    return `<div class="ins-empty">${ZEN_ART.pointer}<strong>Click anything on the timeline 👆</strong>
      <ul>
        <li>${ICONS.plate}<span><b>A plate</b> — click text on the stage to edit it, or change colours and motion</span></li>
        <li>${ICONS.film}<span><b>A recording clip</b> — speed, zoom and cursor · drag aim boxes on the stage</span></li>
        <li>${ICONS.plate}<span><b>A chapter or caption</b> — own rows under clips · look &amp; reveal on the right · double-click to edit copy</span></li>
        <li>${T_GLYPH.dissolve}<span><b>A diamond</b> — the transition between two clips</span></li>
        <li>${ICONS.speed}<span><b>Drag across the speed, zoom or cut row</b> to pick a stretch — a drag on Cut removes it</span></li>
        <li>${ICONS.lens}<span><b>Magnify</b> — a loupe over a small detail, like a total or a badge</span></li>
        <li>${ICONS.mic}<span><b>A voice line or the music</b> — move it, set its level, shape the master</span></li>
      </ul>
      ${renderAddVoice()}
      <p class="ins-keys"><kbd>Space</kbd> play · <kbd>⌫</kbd> remove section or effect · <kbd>R</kbd> replay · <kbd>S</kbd> speed · <kbd>Z</kbd> zoom · <kbd>M</kbd> magnify · <kbd>C</kbd> cut · <kbd>⌘Z</kbd> undo</p>
      ${restore}</div>`;
  }

  /** Add a free-standing voice line at the playhead — upload, mic, or ElevenLabs. */
  function renderAddVoice() {
    const at = fmtT(ed.t);
    return section(
      'mic',
      'Add voice',
      `<textarea class="ins-text" data-voice-add-text rows="2" maxlength="600" spellcheck="true" aria-label="Optional line to speak" placeholder="Optional words to speak (or leave blank and upload / record)"></textarea>
      <div class="ins-pair voice-add">
        <button type="button" class="ins-btn" data-act="voice-add-eleven" title="Speak with ElevenLabs at the playhead">${ICONS.sparkle}Speak</button>
        <button type="button" class="ins-btn" data-act="voice-add-upload" title="Add a line and attach an MP3">${ICONS.upload}Upload MP3</button>
        <button type="button" class="ins-btn" data-act="voice-add-mic" title="Add a line and record from the mic">${ICONS.mic}Record</button>
      </div>
      <p class="ins-note subtle">Lands at the playhead (${at}). Upload or record skips ElevenLabs; Speak needs words above.</p>`
    );
  }

  function clipRemoveBtn(c) {
    const alone = ed.seq.length <= 1;
    return `<button type="button" class="ins-icon danger" data-act="remove" title="${
      alone ? 'Keep at least one section' : 'Remove from the cut (⌫)'
    }" ${alone ? 'disabled' : ''}>${ICONS.trash}</button>`;
  }

  function placeSection(c) {
    return section(
      'motion',
      'Place',
      `<div class="ins-pair">
        <button type="button" class="ins-btn" data-act="clip-earlier" ${c.i <= 0 ? 'disabled' : ''}>${ICONS.undo}Earlier</button>
        <button type="button" class="ins-btn" data-act="clip-later" ${c.i >= ed.seq.length - 1 ? 'disabled' : ''}>Later${ICONS.redo}</button>
      </div>
      <p class="ins-note subtle">Drag the block to reorder. Use the trash or <kbd>⌫</kbd> to pull it out of the cut — restore it anytime from the empty inspector.</p>`
    );
  }

  function renderPlate(c) {
    const info = plateInfo(c.plateId);
    const missing = ed.missing.has(c.plateId);
    const styleCount = Object.keys(info?.style || {}).length;
    return (
      head(
        ICONS[PLATE_ICON[c.plateId] || 'plate'],
        'plate',
        c.title,
        `${escapeHtml(info?.type || c.type || 'plate')} · ${c.dur.toFixed(1)}s`,
        clipRemoveBtn(c)
      ) +
      placeSection(c) +
      (missing
        ? `<p class="ins-note">${ICONS.warn} No preview for this plate yet — run Preview plates or Render.</p>`
        : renderPlateFields() +
          section('motion', 'Look', renderLook(info), (info?.overrides || []).length ? `<button type="button" class="ins-link" data-act="look-reset">Use video look</button>` : '') +
          section('palette', 'Colours & motion', renderStyle(c.plateId, info), styleCount ? `<button type="button" class="ins-link" data-act="style-reset">Reset all</button>` : '')) +
      renderJoinsFor(c)
    );
  }

  function renderJoinsFor(c) {
    const inC = c.i > 0 ? c : null;
    const outC = ed.seq[c.i + 1] || null;
    const row = (x, label) => {
      if (!x?.join) return '';
      const st = joinStyle(x);
      return `<button type="button" class="ins-join" data-goto-join="${x.i}">${T_GLYPH[st] || ICONS.transition}<span><b>${label}</b><em>${escapeHtml(ed.deck.transitionStyles?.[st]?.label || st)} · ${x.overlap.toFixed(2)}s${x.join.pinned ? ' · yours' : ''}</em></span><i>›</i></button>`;
    };
    const rows = row(inC, 'Transition in') + row(outC, 'Transition out');
    return rows ? section('transition', 'Transitions', rows) : '';
  }

  function renderLook(info) {
    const m = info?.motion || {};
    const o = state.video?.motionOptions || {};
    const sel = (key, values, labels = {}, current) =>
      `<select class="ins-select" data-look="${key}"><option value="">Video default</option>${(values || [])
        .map((v) => `<option value="${v}" ${current === v ? 'selected' : ''}>${escapeHtml(labels[v] || v)}</option>`)
        .join('')}</select>`;
    const row = (label, control) => `<label class="ins-row"><span>${label}</span>${control}</label>`;
    return (
      row('Background', sel('atmosphere', o.atmospheres, o.atmosphereLabels, m.atmosphere)) +
      row('Title reveal', sel('titleReveal', o.titleReveals, {}, m.titleReveal)) +
      row('Depth', sel('depth', o.depths, {}, m.depth)) +
      row('Energy', sel('energy', o.energies, {}, m.energy)) +
      row(
        'Sheen',
        `<select class="ins-select" data-look="sheen"><option value="">Video default</option><option value="on" ${m.sheen === true ? 'selected' : ''}>On</option><option value="off" ${m.sheen === false ? 'selected' : ''}>Off</option></select>`
      )
    );
  }

  function liveVarValue(name) {
    try {
      const doc = $('plateFrame')?.contentDocument;
      if (!doc?.documentElement) return '';
      return getComputedStyle(doc.documentElement).getPropertyValue(name).trim();
    } catch {
      return '';
    }
  }

  function toHex(color) {
    const c = String(color || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(c)) return `#${[...c.slice(1)].map((ch) => ch + ch).join('')}`.toLowerCase();
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const [r, g, b] = m[1].split(/[\s,/]+/).map(Number);
      if ([r, g, b].every(Number.isFinite)) return `#${[r, g, b].map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('')}`;
    }
    return '#000000';
  }

  function renderStyle(id, info) {
    const plateType = info?.type || id;
    const groups = (ed.deck.styleGroups || []).filter((g) => {
      if (g.only?.length && !g.only.includes(id)) return false;
      if (g.onlyTypes?.length && !g.onlyTypes.includes(plateType)) return false;
      return true;
    });
    const style = info?.style || {};
    const ready = plateReady(id);
    if (!ready) return `<p class="ins-note">Loading the plate…</p>`;
    const palette = groups.find((g) => g.id === 'palette');
    const rest = groups.filter((g) => g !== palette);
    const swatches = palette
      ? `<div class="ins-swatches">${palette.vars
          .map((v) => {
            const set = style[v.name] != null;
            const hex = toHex(style[v.name] ?? liveVarValue(v.name));
            return `<label class="sw${set ? ' is-set' : ''}" title="${escapeHtml(v.label)}${set ? ' · changed — right-click to reset' : ''}" data-var="${v.name}"><input type="color" value="${hex}" data-var-color="${v.name}" aria-label="${escapeHtml(v.label)}" /><i style="background:${hex}"></i><span>${escapeHtml(v.label)}</span></label>`;
          })
          .join('')}</div>`
      : '';
    const rows = rest
      .map((g) => {
        const n = g.vars.filter((v) => style[v.name] != null).length;
        const body = g.vars
          .map((v) => {
            const set = style[v.name] != null;
            const current = style[v.name] ?? liveVarValue(v.name);
            const reset = set ? `<button type="button" class="var-reset" data-var-reset="${v.name}" title="Back to the brand value">${ICONS.reset}</button>` : '<i class="var-reset"></i>';
            if (v.type === 'toggle') {
              const on = String(current).trim() !== '0' && current !== '';
              return `<div class="var-row${set ? ' is-set' : ''}" data-var="${v.name}"><span>${escapeHtml(v.label)}</span><label class="ins-switch"><input type="checkbox" data-var-toggle="${v.name}" ${on ? 'checked' : ''} aria-label="${escapeHtml(v.label)}" /><i></i></label>${reset}</div>`;
            }
            const num = parseFloat(current);
            const val = Number.isFinite(num) ? num : v.min;
            return `<div class="var-row${set ? ' is-set' : ''}" data-var="${v.name}"><span>${escapeHtml(v.label)}</span><input type="range" min="${v.min}" max="${v.max}" step="${v.step}" value="${val}" data-var-range="${v.name}" data-unit="${v.unit || ''}" aria-label="${escapeHtml(v.label)}" /><output>${val}${v.unit || ''}</output>${reset}</div>`;
          })
          .join('');
        return `<details class="var-group"${n ? ' open' : ''}><summary>${ICONS[g.icon] || ''}${escapeHtml(g.label)}${n ? `<em>${n}</em>` : ''}</summary>${body}</details>`;
      })
      .join('');
    return `${swatches}${rows}<p class="ins-note subtle">Changes show on the stage instantly and render the same way.</p>`;
  }

  function renderLiveCards(c) {
    const marks = marksInLiveClip(c);
    if (!marks.length) return '';
    const at = ed.liveCardId || liveCardAtPlayhead()?.id || null;
    const rows = marks
      .map((m) => {
        const card = resolveLiveCard(m);
        const id = card?.id || '';
        const on = id && (at === id || (ed.textMode && ed.liveCardId === id));
        const kind = m.kind === 'chapter' ? 'Chapter' : 'Caption';
        const key = m.key || cardMarkKey(m);
        return `<button type="button" class="ins-item${on ? ' is-on' : ''}" data-edit-card="${escapeHtml(id)}" data-mark-t="${m.t}" data-mark-key="${escapeHtml(key)}">${ICONS.plate}<span><b>${escapeHtml(m.label || kind)}</b><em>${kind} · at ${fmtT(Math.max(0, m.t - c.recFrom))}${
          id ? '' : ' · will rebuild'
        }</em></span><i>${ed.textMode && ed.liveCardId === id ? 'Editing' : 'Edit'}</i></button>`;
      })
      .join('');
    const fields = ed.textMode && ed.liveCardId ? renderPlateFields() : '';
    return (
      section(
        'plate',
        'Cards',
        `${rows}<p class="ins-note subtle">${
          ed.deck?.live?.overlaysMode === 'clean'
            ? 'Stage shows the live Direction look. Save copy · Produce bakes into the master.'
            : 'Stage shows the live Direction look (covers the burned take). Save copy · Re-record once for a clean master, then Produce bakes.'
        }</p>`
      ) + fields
    );
  }

  function renderLive(c) {
    const d = deckEdit();
    const ramps = d.speed.map((r, i) => ({ r, i })).filter(({ r }) => r.to > c.recFrom && r.from < c.recTo);
    const shots = (ed.deck.zoomShots || []).filter((s) => s.end > c.recFrom && s.start < c.recTo);
    const recLen = c.recTo - c.recFrom;
    const cam = ed.deck.camera || {};
    const cur = ed.deck.cursor || {};
    const speedRows = ramps.length
      ? ramps
          .map(({ r, i }) => `<button type="button" class="ins-item" data-goto-ramp="${i}">${r.rate < 1 ? ICONS.slow : ICONS.speed}<span><b>${fmtRate(r.rate)}</b><em>${fmtT(r.from - c.recFrom)}–${fmtT(r.to - c.recFrom)} of the clip</em></span><i>›</i></button>`)
          .join('')
      : `<p class="ins-note">Plays at normal speed.</p>`;
    const zoomRows = shots.length
      ? shots
          .map((s) => `<button type="button" class="ins-item" data-goto-shot="${escapeHtml(shotKey(s))}">${ICONS.zoom}<span><b>${s.zoom.toFixed(2)}× ${s.source === 'auto' ? '<small>auto</small>' : ''}</b><em>at ${fmtT(Math.max(0, s.start - c.recFrom))} for ${(s.end - s.start).toFixed(1)}s</em></span><i>›</i></button>`)
          .join('')
      : `<p class="ins-note">${cam.zoom === 'off' ? 'Auto zoom is off.' : 'No zooms in this clip.'}</p>`;
    const trim = (d.trims || []).find((t) => t.id === c.id) || {};
    const rawLen = Math.max(0.4, (c.recTo - c.recFrom) + (trim.trimStart || 0) + (trim.trimEnd || 0));
    const maxHead = Math.max(0, r3(rawLen - 0.4 - (trim.trimEnd || 0)));
    const maxTail = Math.max(0, r3(rawLen - 0.4 - (trim.trimStart || 0)));
    const trimSection = section(
      'motion',
      'Trim',
      `<div class="var-row${trim.trimStart ? ' is-set' : ''}"><span>Trim head</span><input type="range" min="0" max="${maxHead}" step="0.05" value="${trim.trimStart || 0}" data-live-trim="trimStart" aria-label="Trim the head of this recording clip" /><output>${(trim.trimStart || 0).toFixed(2)}s</output><button type="button" class="var-reset" data-live-trim-reset="trimStart" title="Back to 0" ${trim.trimStart ? '' : 'hidden'}>${ICONS.reset}</button></div>
      <div class="var-row${trim.trimEnd ? ' is-set' : ''}"><span>Trim tail</span><input type="range" min="0" max="${maxTail}" step="0.05" value="${trim.trimEnd || 0}" data-live-trim="trimEnd" aria-label="Trim the tail of this recording clip" /><output>${(trim.trimEnd || 0).toFixed(2)}s</output><button type="button" class="var-reset" data-live-trim-reset="trimEnd" title="Back to 0" ${trim.trimEnd ? '' : 'hidden'}>${ICONS.reset}</button></div>
      <div class="ins-pair">
        <button type="button" class="ins-btn" data-act="trim-head-playhead" title="Drop everything before the playhead in this clip">Head to playhead</button>
        <button type="button" class="ins-btn" data-act="trim-tail-playhead" title="Drop everything after the playhead in this clip">Tail from playhead</button>
      </div>
      <p class="ins-note subtle">Cuts bad waits or login bleed from this section without re-recording. Render to bake the trim into the cut.</p>`
    );
    return (
      head(
        ICONS.film,
        'live',
        c.title,
        `Recording · ${c.dur.toFixed(1)}s${Math.abs(c.dur - recLen) > 0.05 ? ` <s>${recLen.toFixed(1)}s</s>` : ''}`,
        clipRemoveBtn(c)
      ) +
      placeSection(c) +
      trimSection +
      renderLiveCards(c) +
      section(
        'speed',
        'Speed',
        `${speedRows}<div class="ins-quick"><span>Whole clip</span>${segBtns('data-clip-rate', [1, 1.25, 1.5, 2], ramps.length === 1 && ramps[0].r.from <= c.recFrom + 0.05 && ramps[0].r.to >= c.recTo - 0.05 ? ramps[0].r.rate : ramps.length ? '' : 1, fmtRate)}</div>`
      ) +
      section(
        'zoom',
        'Zoom',
        `<div class="ins-quick"><span>Auto zoom</span>${segBtns('data-cam-zoom', ['off', 'subtle', 'bold'], cam.zoom || 'off', (v) => v[0].toUpperCase() + v.slice(1))}</div>${zoomRows}
        <button type="button" class="ins-btn wide" data-act="add-zoom">${ICONS.plus}Zoom in at the playhead</button>`
      ) +
      section(
        'speed',
        'Motion',
        `<div class="ins-quick"><span>Curve</span>${segBtns('data-cam-curve', Object.keys(ed.deck.curves || { glide: 1, smooth: 1, cinematic: 1, snappy: 1 }), cam.curve || 'glide', (v) => ed.deck.curves?.[v]?.label || v)}</div>
        <div class="ins-quick"><span>Length</span>${segBtns('data-cam-motion', Object.keys(ed.deck.motions || { unhurried: 1, natural: 1, swift: 1 }), cam.motion || 'natural', (v) => ed.deck.motions?.[v]?.label || v)}</div>
        <p class="ins-note subtle">${escapeHtml(ed.deck.curves?.[cam.curve || 'glide']?.hint || '')}. Shapes every push-in, pan and the magnifier's open and close; the stage previews it live.</p>`
      ) +
      section(
        'lens',
        'Magnifier',
        `${
          lensItems()
            .filter((l) => l.t < c.recTo && l.t + l.dur > c.recFrom)
            .map(
              (l) =>
                `<button type="button" class="ins-item" data-goto-lens="${escapeHtml(l.key)}">${l.source === 'off' ? ICONS.lensOff : ICONS.lens}<span><b>${escapeHtml(l.label || 'Magnifier')} ${l.source === 'auto' ? '<small>recorded</small>' : l.source === 'off' ? '<small>off</small>' : ''}</b><em>at ${fmtT(Math.max(0, l.t - c.recFrom))} for ${l.dur.toFixed(1)}s</em></span><i>›</i></button>`
            )
            .join('') || '<p class="ins-note">A loupe that blows up a small detail without moving the camera.</p>'
        }<button type="button" class="ins-btn wide" data-act="add-lens">${ICONS.plus}Magnify at the playhead</button>`
      ) +
      renderJoinsFor(c) +
      `<details class="ins-sec ins-next"><summary>${ICONS.cursor}<strong>Cursor &amp; pace</strong><em>next recording</em></summary><div class="ins-body">
        <p class="ins-note">The pointer and the tempo are captured while recording, so these apply when you record again.</p>
        <div class="ins-quick"><span>Cursor</span>${segBtns('data-cursor-style', ['classic', 'arrow', 'dot'], cur.style || 'classic', (v) => v[0].toUpperCase() + v.slice(1))}</div>
        <div class="ins-quick"><span>Size</span>${segBtns('data-cursor-size', ['s', 'm', 'l'], cur.size || 'm', (v) => v.toUpperCase())}</div>
        <div class="ins-quick"><span>Pace</span>${segBtns('data-pace', ['calm', 'steady', 'brisk', 'quick'], ed.deck.pace || 'steady', (v) => v[0].toUpperCase() + v.slice(1))}</div>
        <button type="button" class="ins-btn wide" data-act="record">${ICONS.film}Record again</button>
      </div></details>`
    );
  }

  function renderRamp(i) {
    const r = deckEdit().speed[i];
    if (!r) return renderEmpty();
    const [lo, hi] = ed.deck.ranges.speed;
    const hit = (ed.deck.conflicts || []).find((c) => c.from === r.from && c.to === r.to);
    const len = r.to - r.from;
    return (
      head(r.rate < 1 ? ICONS.slow : ICONS.speed, 'speed', r.rate < 1 ? 'Slow motion' : 'Speed up', `${len.toFixed(1)}s of recording plays in <b>${(len / r.rate).toFixed(1)}s</b>`, `<button type="button" class="ins-icon danger" data-act="remove" title="Remove (⌫)">${ICONS.trash}</button>`) +
      section(
        'speed',
        'Speed',
        `<div class="ins-big"><output id="insRateOut">${fmtRate(r.rate)}</output><input type="range" min="${lo}" max="${hi}" step="0.05" value="${r.rate}" data-ramp-rate aria-label="Speed" /></div>
        ${segBtns('data-ramp-preset', SPEED_PRESETS.filter((v) => v >= lo && v <= hi), r.rate, fmtRate)}
        ${hit ? `<p class="ins-warn">${ICONS.warn}Covers ${hit.marks.map((m) => `“${escapeHtml(m.label || m.kind)}”`).join(', ')} — chapter cards and captions play faster too.</p>` : ''}
        <p class="ins-note subtle">Drag the ends of the block on the timeline to change where it starts and stops.</p>`
      ) +
      `<button type="button" class="ins-btn wide ghost" data-act="preview-sel">${ICONS.replay}Watch it</button>`
    );
  }

  function renderZoom() {
    const shot = selectedShot();
    if (!shot) return renderEmpty();
    const auto = shot.source === 'auto';
    const [lo, hi] = ed.deck.ranges.zoom;
    const len = shot.end - shot.start;
    const remove = `<button type="button" class="ins-icon danger" data-act="remove" title="Remove (⌫)">${ICONS.trash}</button>`;
    if (auto) {
      return (
        head(ICONS.zoom, 'zoom', 'Auto zoom', `${shot.zoom.toFixed(2)}× · ${len.toFixed(1)}s · follows the clicks`, remove) +
        section(
          'zoom',
          'Zoom',
          `<p class="ins-note">Added automatically where the pointer clicked. Take it over to aim, resize or retime it — or remove it to keep the whole screen.</p>
          <button type="button" class="ins-btn wide primary" data-act="adopt">${ICONS.target}Take over this zoom</button>`
        ) +
        `<button type="button" class="ins-btn wide ghost" data-act="preview-sel">${ICONS.replay}Watch it</button>`
      );
    }
    return (
      head(ICONS.zoom, 'zoom', 'Zoom', `${shot.zoom.toFixed(2)}× · ${len.toFixed(1)}s`, remove) +
      section(
        'zoom',
        'Zoom',
        `<div class="ins-big"><output id="insZoomOut">${shot.zoom.toFixed(2)}×</output><input type="range" min="${lo}" max="${hi}" step="0.05" value="${shot.zoom}" data-shot-zoom aria-label="Zoom level" /></div>
        ${segBtns('data-zoom-preset', ZOOM_PRESETS.filter((v) => v >= lo && v <= hi), shot.zoom, (v) => `${v}×`)}
        <p class="ins-note">${ICONS.target} The stage shows the push-in as you change strength. Drag to aim; drag the corners to zoom further in or out.</p>`
      ) +
      `<button type="button" class="ins-btn wide ghost" data-act="preview-sel">${ICONS.replay}Watch it</button>`
    );
  }

  function renderLens() {
    const l = selectedLens();
    if (!l) return renderEmpty();
    const remove = `<button type="button" class="ins-icon danger" data-act="remove" title="Remove (⌫)">${ICONS.trash}</button>`;
    const watch = `<button type="button" class="ins-btn wide ghost" data-act="preview-sel">${ICONS.replay}Watch it</button>`;
    if (l.source === 'off') {
      return (
        head(ICONS.lensOff, 'lens', 'Magnifier off', `${escapeHtml(l.label)} · ${l.dur.toFixed(1)}s · recorded`) +
        section('lens', 'Magnifier', `<p class="ins-note">The recording asked for a loupe here; you switched it off, so the frame stays as it is.</p><button type="button" class="ins-btn wide primary" data-act="lens-on">${ICONS.lens}Turn it back on</button>`)
      );
    }
    if (l.source === 'auto') {
      return (
        head(ICONS.lens, 'lens', escapeHtml(l.label), `Recorded · ${l.zoom.toFixed(1)}× · ${l.dur.toFixed(1)}s`, remove) +
        section(
          'lens',
          'Magnifier',
          `<p class="ins-note">The flow asked for this loupe while recording${l.path?.length > 1 ? ' and it follows the pointer' : ''}. Take it over to aim, resize or retime it — or remove it to keep the frame clean.</p>
          <button type="button" class="ins-btn wide primary" data-act="adopt-lens">${ICONS.target}Take over this magnifier</button>`
        ) +
        watch
      );
    }
    const own = deckLens(l) || {};
    const [lo, hi] = ed.deck.ranges.lensZoom || [1.2, 2.4];
    const w = own.w ?? l.rect.w;
    const h = own.h ?? l.rect.h;
    // The loupe caps at 540px, so a wide area can only take so much strength — the slider
    // stops where the render would start ignoring it, and the readout is what the loupe draws.
    const ceiling = r3(clamp(lensZoomCeiling(Math.max(w, h)), lo, hi));
    const loupe = lensLoupe(Math.max(w, h), own.zoom);
    const z = Math.min(own.zoom ?? loupe.zoom, ceiling);
    return (
      head(ICONS.lens, 'lens', escapeHtml(l.label || 'Magnifier'), `${loupe.zoom.toFixed(1)}× · ${l.dur.toFixed(1)}s · loupe ${loupe.diameter}px`, remove) +
      section(
        'lens',
        'Strength',
        `<div class="ins-big"><output id="insLensOut">${loupe.zoom.toFixed(2)}×${own.zoom ? '' : ' auto'}</output><input type="range" min="${lo}" max="${ceiling}" step="0.05" value="${z}" data-lens-zoom aria-label="Magnification" ${ceiling - lo < 0.05 ? 'disabled' : ''} /></div>
        <div class="ins-seg"><button type="button" data-lens-preset="" class="${own.zoom ? '' : 'on'}">Auto</button>${LENS_PRESETS.filter((v) => v >= lo && v <= hi)
          .map((v) => `<button type="button" data-lens-preset="${v}" class="${own.zoom === v ? 'on' : ''}" ${v > ceiling + 1e-6 ? 'disabled' : ''}>${v}×</button>`)
          .join('')}</div>
        <p class="ins-note" data-lens-cap>${ceiling < hi - 1e-6 ? `Up to ${ceiling.toFixed(2)}× for a ${Math.round(Math.max(w, h))}px area — shrink the area for a stronger loupe.` : ''}</p>`
      ) +
      section(
        'target',
        'Area',
        `<div class="var-row"><span>Width</span><input type="range" min="16" max="800" step="2" value="${w}" data-lens-size="w" aria-label="Magnified width" /><output>${w}px</output><i class="var-reset"></i></div>
        <div class="var-row"><span>Height</span><input type="range" min="12" max="400" step="2" value="${h}" data-lens-size="h" aria-label="Magnified height" /><output>${h}px</output><i class="var-reset"></i></div>
        <p class="ins-note">${ICONS.target} Drag the loupe on the stage to aim it; a bigger area gets a gentler, wider loupe.</p>`
      ) +
      watch
    );
  }

  function dbSlider(attr, value, label) {
    const [lo, hi] = ed.deck?.ranges?.gain || [-18, 12];
    return `<div class="ins-big"><output>${Number(value).toFixed(1)} dB</output><input type="range" min="${lo}" max="${hi}" step="0.5" value="${value}" ${attr} aria-label="${label}" /></div>`;
  }

  function renderVoice() {
    const clip = (ed.deck?.audio?.voiceClips || []).find((c) => c.key === ed.sel?.key);
    if (!clip) return renderEmpty();
    const [nlo, nhi] = ed.deck?.ranges?.nudge || [-6, 6];
    const nudge = clip.nudge || 0;
    const fit = [];
    if (clip.long > 0.1) fit.push(`Runs ${clip.long.toFixed(1)}s past its window on this cut — shorten the line or give the step more time.`);
    if (clip.late > 1.5) fit.push(`Starts ${clip.late.toFixed(1)}s late: the previous line runs over.`);
    const moved = clip.moved ? `<p class="ins-note">Moves to ${fmtT(clip.start - nudge)} on the next render — the mix has it at ${fmtT(clip.writtenStart)}.</p>` : '';
    const ranges = ed.deck?.ranges || {};
    const [fadeLo, fadeHi] = ranges.voiceFade || [0, 2];
    const [spLo, spHi] = ranges.voiceSpeed || [0.8, 1.3];
    const minSec = ranges.voiceMinSec || 0.3;
    const textMax = ranges.voiceTextMax || 600;
    const full = clip.full || clip.dur;
    const shaped = clip.trimStart || clip.trimEnd || clip.fadeIn || clip.fadeOut;
    const take = clip.take || 1;
    const takes = Math.max(take, clip.takes || 1);
    const mode = ed.deck?.audio?.narrator?.mode || 'live';
    const shown = clip.textOverride || clip.text || '';
    const rewritten = !!clip.textOverride && clip.written && clip.textOverride !== clip.written;
    const speeds = [];
    for (let s = spLo; s <= spHi + 1e-6; s = r3(s + 0.05)) speeds.push(r3(s));
    const speed = clip.speed || clip.spokenSpeed || 1;
    const busy = ed.regenerating === clip.key;
    const cached = new Set(clip.cachedTakes || []);
    // The line differs from the script: another take, other words, or another pace.
    const altered = take > 1 || !!clip.textOverride || (clip.speed != null && Math.abs(clip.speed - 1) > 0.01);
    const sources = clip.takeSources || {};
    const sourceLabel = (src) => (src === 'mic' ? 'mic' : src === 'upload' ? 'upload' : src === 'eleven' ? 'ElevenLabs' : '');
    const chips = [];
    for (let n = 1; n <= takes; n++) {
      const isOn = n === take;
      const ready = cached.has(n);
      const src = sources[String(n)] || (isOn ? clip.source : null);
      const srcTip = sourceLabel(src);
      chips.push(
        `<button type="button" class="take-chip${isOn ? ' is-on' : ''}${ready ? ' is-cached' : ''}${src === 'mic' || src === 'upload' ? ' is-custom' : ''}" data-take="${n}" aria-pressed="${isOn}" ${busy ? 'disabled' : ''} title="Take ${n}${srcTip ? ` · ${srcTip}` : ''}${isOn ? ' · playing' : ready ? ' · ready, switches at once' : ' · spoken again on switch'}">${n}${src === 'mic' ? '<i>m</i>' : src === 'upload' ? '<i>↑</i>' : ''}</button>`
      );
    }
    const recording = ed.micRecord?.key === clip.key;
    const curSrc = sources[String(take)] || clip.source;
    const srcNote = curSrc === 'mic' ? 'This take is a mic recording.' : curSrc === 'upload' ? 'This take is an uploaded MP3.' : '';
    const voiceNote =
      mode === 'missing-key'
        ? narratorKeyNote(mode)
        : mode === 'stub'
          ? 'Voice runs in stub mode: takes are silent placeholders of the right length. You can still upload or record a take.'
          : `Regenerate speaks a new take with ${escapeHtml(ed.deck?.audio?.narrator?.name || 'the narrator')}; Upload or Record attaches your own audio. Earlier takes stay a click away.`;
    const kindLabel = clip.kind === 'adlib' ? 'ad-lib' : clip.kind || 'line';
    return (
      head(ICONS.mic, 'voice', clip.key, `${escapeHtml(kindLabel)} · ${clip.dur.toFixed(1)}s${take > 1 ? ` · take ${take}` : ''}${clip.mute ? ' · muted' : ''}${curSrc === 'mic' || curSrc === 'upload' ? ` · ${curSrc}` : ''}`, `<button type="button" class="ins-icon danger" data-act="voice-mute" title="${clip.mute ? 'Unmute' : 'Mute'}">${clip.mute ? ICONS.mic : ICONS.trash}</button>`) +
      section(
        'text',
        'Line',
        `<textarea class="ins-text" data-voice-text rows="3" maxlength="${textMax}" spellcheck="true" aria-label="What this line says" placeholder="What this line says">${escapeHtml(shown)}</textarea>
        ${rewritten ? `<p class="ins-note subtle">Written: “${escapeHtml(clip.written)}” <button type="button" class="ins-link" data-act="voice-text-written">use it</button></p>` : ''}
        <div class="ins-regen">
          <button type="button" class="ins-btn primary${busy ? ' is-busy' : ''}" data-act="voice-regen" ${busy || recording ? 'disabled' : ''}>${ICONS.sparkle}<span>${busy ? 'Speaking…' : 'Regenerate'}</span></button>
        </div>
        <div class="ins-pair voice-source">
          <button type="button" class="ins-btn" data-act="voice-upload" ${busy || recording ? 'disabled' : ''} title="Attach an MP3 as a new take">${ICONS.upload}Upload MP3</button>
          <button type="button" class="ins-btn${recording ? ' is-rec' : ''}" data-act="voice-mic" ${busy ? 'disabled' : ''} title="${recording ? 'Stop and save' : 'Record a new take from the mic'}">${recording ? ICONS.stop : ICONS.mic}<span>${recording ? 'Stop' : 'Record'}</span></button>
        </div>
        <div class="take-row">
          <span class="take-label">${takes > 1 ? 'Takes' : 'Take'}</span>
          <div class="take-chips" role="group" aria-label="Takes">${chips.join('')}</div>
          ${altered ? `<button type="button" class="ins-link take-revert" data-act="voice-revert" ${busy || recording ? 'disabled' : ''} title="The script's words, natural pace, take 1">${ICONS.reset}Revert</button>` : ''}
        </div>
        <div class="var-row"><span>Pace</span><select data-voice-speed aria-label="Speaking pace">${speeds.map((s) => `<option value="${s}" ${Math.abs(s - speed) < 0.01 ? 'selected' : ''}>${s.toFixed(2)}× ${s < 0.97 ? 'slower' : s > 1.03 ? 'quicker' : 'natural'}</option>`).join('')}</select><output></output><i class="var-reset"></i></div>
        <p class="ins-note subtle">${voiceNote}${srcNote ? ` ${srcNote}` : ''}</p>
        ${fit.map((n) => `<p class="ins-warn">${ICONS.warn}${escapeHtml(n)}</p>`).join('')}${(clip.notes || [])
          .filter((n) => !/^long by|^starts .* late/.test(n) || !fit.length)
          .map((n) => `<p class="ins-warn">${ICONS.warn}${escapeHtml(n)}</p>`)
          .join('')}${moved}`
      ) +
      section(
        'motion',
        'Shape',
        `<div class="var-row${clip.trimStart ? ' is-set' : ''}"><span>Trim head</span><input type="range" min="0" max="${Math.max(0, r3(full - minSec))}" step="0.05" value="${clip.trimStart || 0}" data-voice-shape="trimStart" aria-label="Trim the head" /><output>${(clip.trimStart || 0).toFixed(2)}s</output><button type="button" class="var-reset" data-voice-shape-reset="trimStart" title="Back to 0" ${clip.trimStart ? '' : 'hidden'}>${ICONS.reset}</button></div>
        <div class="var-row${clip.trimEnd ? ' is-set' : ''}"><span>Trim tail</span><input type="range" min="0" max="${Math.max(0, r3(full - minSec))}" step="0.05" value="${clip.trimEnd || 0}" data-voice-shape="trimEnd" aria-label="Trim the tail" /><output>${(clip.trimEnd || 0).toFixed(2)}s</output><button type="button" class="var-reset" data-voice-shape-reset="trimEnd" title="Back to 0" ${clip.trimEnd ? '' : 'hidden'}>${ICONS.reset}</button></div>
        <div class="var-row${clip.fadeIn ? ' is-set' : ''}"><span>Fade in</span><input type="range" min="${fadeLo}" max="${fadeHi}" step="0.05" value="${clip.fadeIn || 0}" data-voice-shape="fadeIn" aria-label="Fade in" /><output>${(clip.fadeIn || 0).toFixed(2)}s</output><button type="button" class="var-reset" data-voice-shape-reset="fadeIn" title="Back to 0" ${clip.fadeIn ? '' : 'hidden'}>${ICONS.reset}</button></div>
        <div class="var-row${clip.fadeOut ? ' is-set' : ''}"><span>Fade out</span><input type="range" min="${fadeLo}" max="${fadeHi}" step="0.05" value="${clip.fadeOut || 0}" data-voice-shape="fadeOut" aria-label="Fade out" /><output>${(clip.fadeOut || 0).toFixed(2)}s</output><button type="button" class="var-reset" data-voice-shape-reset="fadeOut" title="Back to 0" ${clip.fadeOut ? '' : 'hidden'}>${ICONS.reset}</button></div>
        <p class="ins-note subtle">The clip is ${full.toFixed(1)}s as spoken${shaped ? `; ${clip.dur.toFixed(1)}s plays` : ''}. Drag the ends of the block on the timeline to trim; the head trim keeps the remaining words where they are.</p>
        ${shaped ? `<button type="button" class="ins-btn wide ghost" data-act="voice-shape-reset">Whole take, no fades</button>` : ''}`
      ) +
      section('speed', 'Level', dbSlider('data-voice-gain', clip.gainDb || 0, 'Voice level') + `<p class="ins-note subtle">0 dB is the fitted line. The mix uses this on top of the narration loudness.</p>`) +
      section(
        'motion',
        'Timing',
        `<div class="ins-big"><output>${nudge > 0 ? '+' : ''}${nudge.toFixed(2)}s</output><input type="range" min="${nlo}" max="${nhi}" step="0.05" value="${nudge}" data-voice-nudge aria-label="Nudge the line" /></div>
        <p class="ins-note subtle">Drag the block anywhere on the timeline — past another line is a new order. This slider trims that position by a few seconds.</p>
        ${clip.at != null ? `<p class="ins-note">Plays at ${fmtT(clip.start)}.</p>` : ''}
        ${clip.at != null || nudge ? `<button type="button" class="ins-btn wide ghost" data-act="voice-reset">Back to where the line belongs</button>` : ''}`
      ) +
      `<button type="button" class="ins-btn wide ghost" data-act="preview-sel">${ICONS.replay}Listen</button>`
    );
  }

  function masterSlider(key, label, unit = '') {
    const range = ed.deck?.ranges?.master?.[key];
    if (!range) return '';
    const value = ed.deck.audio?.levels?.[key] ?? ed.deck.audio?.defaults?.[key] ?? range[0];
    const shown = key === 'duckRatio' ? (ed.deck.audio?.levels?.duck?.ratio ?? value) : value;
    return `<div class="var-row"><span>${label}</span><input type="range" min="${range[0]}" max="${range[1]}" step="${key === 'duckRatio' ? 0.5 : 0.5}" value="${shown}" data-master="${key}" aria-label="${label}" /><output>${Number(shown).toFixed(1)}${unit}</output><i class="var-reset"></i></div>`;
  }

  /** Narrator picker: the ElevenLabs voices on the account, with a listen button and a per-video pick. */
  function renderNarrator() {
    const n = ed.deck?.audio?.narrator;
    if (!n) return '';
    const list = ed.voices;
    const stale = n.stale ? `<p class="ins-warn">${ICONS.warn}The mix was spoken by ${escapeHtml(n.built?.name || 'another narrator')}. Mix speaks every line again with ${escapeHtml(n.name)}.</p>` : '';
    const source = n.source === 'video' ? 'picked for this video' : 'from the brand';
    let picker;
    if (n.mode !== 'live') {
      picker = `<p class="ins-note subtle" data-narrator-key>${narratorKeyNote(n.mode)}</p>`;
    } else if (!list) {
      picker = `<p class="ins-note subtle">Loading the voices on the account…</p>`;
    } else if (list.error) {
      picker = `<p class="ins-warn">${ICONS.warn}${escapeHtml(list.error)} <button type="button" class="ins-link" data-act="narrators-reload">try again</button></p>`;
    } else {
      const want = ed.narratorPick || n.voiceId;
      const options = list.map((v) => `<option value="${escapeHtml(v.voiceId)}" ${v.voiceId === want ? 'selected' : ''}>${escapeHtml(v.name)}${v.voiceId === n.voiceId ? ' · current' : ''}${v.category === 'cloned' ? ' · cloned' : ''}${v.labels?.accent ? ` · ${escapeHtml(v.labels.accent)}` : ''}</option>`);
      if (!list.some((v) => v.voiceId === n.voiceId)) options.unshift(`<option value="${escapeHtml(n.voiceId)}" ${n.voiceId === want ? 'selected' : ''}>${escapeHtml(n.name)} · current</option>`);
      const picked = list.find((v) => v.voiceId === want);
      const sub = picked ? [picked.labels?.gender, picked.labels?.age, picked.labels?.accent, picked.labels?.use_case || picked.labels?.description].filter(Boolean).join(' · ') : '';
      picker = `<div class="narrator-pick">
          <select data-narrator aria-label="Narrator">${options.join('')}</select>
          <button type="button" class="ins-icon" data-act="narrator-listen" title="Hear a sample" ${picked?.previewUrl ? '' : 'disabled'}>${ICONS.play}</button>
        </div>
        ${sub ? `<p class="ins-note subtle">${escapeHtml(sub)}</p>` : ''}
        <div class="ins-pair">
          <button type="button" class="ins-btn primary" data-act="narrator-use" ${(ed.narratorPick || n.voiceId) === n.voiceId ? 'disabled' : ''}>${ICONS.mic}Use voice</button>
          <button type="button" class="ins-btn ghost" data-act="narrator-brand" ${n.source === 'video' ? '' : 'disabled'}>Brand voice</button>
        </div>`;
    }
    return section('mic', 'Narrator', `<p class="ins-quote">${escapeHtml(n.name)} <em class="ins-dim">· ${source} · ${escapeHtml(n.model || '')}</em></p>${stale}${picker}`);
  }

  async function loadNarrators(force = false) {
    if (ed.voices && !force) return;
    try {
      const r = await api(`/api/video/${encodeURIComponent(slug())}/narrators${force ? '?force=1' : ''}`);
      ed.voices = r.voices || [];
    } catch (err) {
      ed.voices = { error: err.message || 'Could not list the voices' };
      ed.voices.map = () => [];
      ed.voices.some = () => false;
      ed.voices.find = () => null;
    }
    if (ed.sel?.type === 'music' || ed.sel?.type === 'mix') renderInspector();
  }

  function renderMusic() {
    const music = audioDesk().music;
    const bed = ed.deck?.audio?.music;
    const [olo, ohi] = ed.deck?.ranges?.musicOffset || [-20, 20];
    const shortBy = bed ? ed.total - ((music.offset || 0) + bed.durationSec) : 0;
    const short = shortBy > 0.35;
    const src = bed?.source;
    const srcLabel = src === 'upload' ? 'upload' : src === 'stub' ? 'stub' : src === 'eleven' ? 'ElevenLabs' : '';
    const busy = ed.regenerating === 'music';
    const cutSec = ed.total > 0 ? ed.total.toFixed(0) : '—';
    const prompt = ed.deck?.audio?.musicPrompt || bed?.prompt || '';
    if (ed.deck?.audio?.narrator?.mode === 'live' && !ed.voices) loadNarrators();
    return (
      head(
        ICONS.music,
        'music',
        music.mute ? 'Music off' : 'Music',
        bed
          ? `${bed.durationSec.toFixed(0)}s bed${short ? ` · ${shortBy.toFixed(0)}s short` : ''}${srcLabel ? ` · ${srcLabel}` : ''}`
          : 'No bed yet',
        `<button type="button" class="ins-icon danger" data-act="music-mute" title="${music.mute ? 'Unmute' : 'Mute'}">${music.mute ? ICONS.music : ICONS.trash}</button>`
      ) +
      renderNarrator() +
      section(
        'text',
        'Bed',
        `${src === 'upload' ? `<p class="ins-note subtle">This bed is an uploaded track. Compose replaces it with ElevenLabs music sized to the cut (${cutSec}s).</p>` : `<p class="ins-note subtle">Upload your own track, or describe the sound and compose with ElevenLabs to the length of this cut (${cutSec}s). Brand styles still apply underneath.</p>`}
        <textarea class="ins-text" data-music-prompt rows="2" maxlength="500" spellcheck="true" aria-label="Music prompt" placeholder="Describe the music — e.g. warm electric piano, soft pulse, optimistic SaaS underscore, no vocals">${escapeHtml(prompt)}</textarea>
        <div class="ins-pair voice-source">
          <button type="button" class="ins-btn" data-act="music-upload" ${busy ? 'disabled' : ''} title="Replace the bed with an uploaded MP3">${ICONS.upload}Upload MP3</button>
          <button type="button" class="ins-btn primary${busy ? ' is-busy' : ''}" data-act="music-compose" ${busy ? 'disabled' : ''} title="Compose a new bed sized to this cut from the prompt, then mix">${ICONS.sparkle}<span>${busy ? 'Working…' : bed ? 'Compose to fit' : 'Compose music'}</span></button>
        </div>
        ${short ? `<p class="ins-warn">${ICONS.warn}The bed is ${shortBy.toFixed(0)}s shorter than this cut — loop it, upload a longer track, or compose to fit.</p>` : ''}`
      ) +
      section(
        'speed',
        'Level',
        dbSlider('data-music-gain', music.gainDb || 0, 'Music level') +
          `<div class="ins-quick ins-quick--pair"><span>At the playhead</span><div class="ins-pair"><button type="button" class="ins-btn" data-act="ride" data-ride-db="-6">${ICONS.music}Softer</button><button type="button" class="ins-btn" data-act="ride" data-ride-db="4">${ICONS.music}Louder</button></div></div>
          <p class="ins-note subtle">Softer and louder add a ride on the music row. Drag a ride to move it.</p>`
      ) +
      section(
        'motion',
        'Length & fades',
        `<label class="ins-check"><input type="checkbox" data-music-loop ${music.loop ? 'checked' : ''} ${bed ? '' : 'disabled'} /> Loop to fill the cut</label>
        <p class="ins-note subtle">${music.loop ? 'Mix repeats the bed under the whole delivery. Turn this off to leave the tail silent, or Compose to fit for a new bed.' : short ? 'Loop fills with repeats; Compose to fit writes a new bed for this length.' : 'When the bed runs out early, Mix pads with silence — loop it, or compose a longer bed.'}</p>
        <div class="var-row"><span>Fade in</span><input type="range" min="0" max="8" step="0.1" value="${music.fadeIn}" data-fade="fadeIn" aria-label="Fade in" /><output>${music.fadeIn.toFixed(1)}s</output><i class="var-reset"></i></div>
        <div class="var-row"><span>Fade out</span><input type="range" min="0" max="8" step="0.1" value="${music.fadeOut}" data-fade="fadeOut" aria-label="Fade out" /><output>${music.fadeOut.toFixed(1)}s</output><i class="var-reset"></i></div>
        <div class="var-row"><span>Slip</span><input type="range" min="${olo}" max="${ohi}" step="0.1" value="${music.offset || 0}" data-music-offset aria-label="Slip the music" /><output>${(music.offset || 0) > 0 ? '+' : ''}${Number(music.offset || 0).toFixed(1)}s</output><i class="var-reset"></i></div>
        <p class="ins-note subtle">Drag the music bar to slip it. The ends are the fades.</p>`
      ) +
      section(
        'palette',
        'Master',
        `${masterSlider('voiceLufs', 'Narration', ' LUFS')}${masterSlider('plateLufs', 'Music on titles', ' LUFS')}${masterSlider('bedLufs', 'Music under the demo', ' LUFS')}${masterSlider('duckRatio', 'Dip under voice', '×')}${masterSlider('targetLufs', 'Master loudness', ' LUFS')}${masterSlider('truePeakDb', 'True peak', ' dB')}
        <p class="ins-note subtle">These are the levels the mix renders to. What you hear now follows them; Mix writes them into the master.</p>
        <button type="button" class="ins-btn wide ghost" data-act="master-reset">Back to the brand mix</button>`
      )
    );
  }

  function renderRide() {
    const ride = audioDesk().music.rides[ed.sel?.i];
    if (!ride) return renderEmpty();
    return (
      head(ICONS.music, 'music', ride.gainDb < 0 ? 'Softer music' : 'Louder music', `${(ride.to - ride.from).toFixed(1)}s · ${ride.gainDb > 0 ? '+' : ''}${ride.gainDb} dB`, `<button type="button" class="ins-icon danger" data-act="ride-remove" title="Remove (⌫)">${ICONS.trash}</button>`) +
      section('speed', 'Level', dbSlider('data-ride-gain', ride.gainDb, 'Ride level') + `<p class="ins-note subtle">Drag the ends... the block itself moves. It sits on top of the bed level.</p>`)
    );
  }

  function renderSkip(i) {
    const s = deckEdit().zoomSkips[i];
    if (!s) return renderEmpty();
    return (
      head(ICONS.noZoom, 'skip', 'No auto zoom', `${(s.to - s.from).toFixed(1)}s keeps the whole screen`, `<button type="button" class="ins-icon danger" data-act="remove" title="Remove (⌫)">${ICONS.trash}</button>`) +
      `<p class="ins-note pad">Auto zooms are skipped in this stretch. Remove it to let them back in.</p>`
    );
  }

  function renderJoin(i) {
    const c = ed.seq[i];
    const prev = ed.seq[i - 1];
    if (!c?.join || !prev) return renderEmpty();
    const styles = ed.deck.transitionStyles || {};
    const pinned = c.join.pinned || {};
    const current = pinned.style || '';
    const dflt = ed.deck.transitions?.style || 'directed';
    const [lo, hi] = ed.deck.ranges.transitionDuration;
    const tiles = [['', `Video default`, dflt], ...Object.entries(styles).filter(([id]) => id !== 'directed').map(([id, s]) => [id, s.label, id])]
      .map(
        ([id, label, glyph]) =>
          `<button type="button" class="t-tile${current === id ? ' on' : ''}" data-join-style="${id}" title="${escapeHtml(id ? styles[id]?.hint || '' : `Follows the video (${styles[dflt]?.label || dflt})`)}">${T_GLYPH[glyph] || ICONS.transition}<span>${escapeHtml(label)}</span></button>`
      )
      .join('');
    return (
      head(T_GLYPH[joinStyle(c)] || ICONS.transition, 'join', 'Transition', `${escapeHtml(prev.title)} → ${escapeHtml(c.title)}${c.join.card ? ' · onto a chapter card' : ''}`) +
      section('transition', 'Style', `<div class="t-grid">${tiles}</div>`) +
      section(
        'motion',
        'Length',
        `<div class="ins-big"><output id="insJoinOut">${c.overlap.toFixed(2)}s</output><input type="range" min="${lo}" max="${hi}" step="0.05" value="${pinned.duration ?? c.overlap}" data-join-dur aria-label="Transition length" /></div>`,
        c.join.pinned ? `<button type="button" class="ins-link" data-act="join-reset">Use video default</button>` : ''
      ) +
      `<button type="button" class="ins-btn wide ghost" data-act="preview-join">${ICONS.replay}Watch the transition</button>`
    );
  }

  function renderCut(i) {
    const cut = (deckEdit().cuts || [])[i];
    if (!cut) return renderEmpty();
    const sec = cut.to - cut.from;
    return (
      head(CUT_ICON, 'cut', `${sec.toFixed(1)}s removed`, `${fmtT(cut.from)}–${fmtT(cut.to)} of the recording`, `<button type="button" class="ins-icon danger" data-act="remove" title="Restore this stretch (⌫)">${ICONS.trash}</button>`) +
      section(
        CUT_ICON,
        'This stretch',
        `<p class="ins-note">Gone from the cut. Playback and the render skip it, and everything after closes up. Drag either end on the Cut row to take more or give some back.</p><button type="button" class="ins-btn wide" data-act="preview-cut">${ICONS.replay}Watch the join</button>`
      )
    );
  }

  function renderRange(s) {
    const len = s.to - s.from;
    return (
      head(ICONS.sparkle, 'range', `${len.toFixed(1)}s selected`, `in “${escapeHtml(ed.seq.find((c) => c.id === s.clipId)?.title || 'recording')}”`) +
      section(CUT_ICON, 'Cut', `<button type="button" class="ins-btn wide primary" data-range-cut>${CUT_ICON}Cut this stretch out</button><p class="ins-note subtle">Removes it from the recording. Playback skips it and the render closes the gap.</p>`) +
      section('speed', 'Speed', `${segBtns('data-range-rate', [0.5, 0.75, 1.5, 2, 3], '', fmtRate)}<p class="ins-note subtle">Faster skips the slow parts; slower lets a detail breathe.</p>`) +
      section('zoom', 'Zoom', `<button type="button" class="ins-btn wide" data-range-zoom>${ICONS.zoom}Zoom in over this stretch</button><button type="button" class="ins-btn wide" data-range-lens>${ICONS.lens}Magnify a detail here</button><button type="button" class="ins-btn wide ghost" data-range-skip>${ICONS.noZoom}Keep the whole screen (no auto zoom)</button>`)
    );
  }

  // ─── Inspector wiring ────────────────────────────────────────────────────────────────────
  /**
   * After Look / style / Direction paints the live plate, rebuild its animations at the current
   * playhead offset. Live edits must update the view without yanking you back to the clip start.
   * Pass `{ fromStart: true }` only for an explicit reset-from-open.
   *
   * Uses the plate id (not only the playhead clip) so a Look pick still resyncs when the
   * playhead sits on a live stretch with that plate still loaded in the iframe.
   */
  function refreshPlatePreview(id, { fromStart = false } = {}) {
    const plateId = id || state.activePlateId || null;
    if (!plateId) return;
    if (ed.textMode || ed.loadingPlate === plateId) {
      markPlateResync(plateId);
      return;
    }
    const clip = plateClipFor(ed.seq, plateId, curClip());
    const onPlate = playheadOnPlate(curClip(), plateId);
    const frameReady = P.ready() === plateId;
    if (!frameReady && !plateReady(plateId)) {
      markPlateResync(plateId);
      return;
    }
    if (ed.playing && onPlate) pause();
    if (shouldParkPlayheadAtClipStart(fromStart, onPlate) && clip) {
      ed.t = clip.at;
      paintHead();
    }
    const ms = previewClockMs(clip, ed.t, { fromStart, onPlate });
    if (typeof P.restart === 'function') P.restart(ms);
    else {
      P.motion?.();
      P.seek?.(ms);
    }
    if (onPlate) renderFrame();
    if (ed.needsPlateResync === plateId) ed.needsPlateResync = null;
  }

  function scheduleStylePreview(id) {
    clearTimeout(stylePreviewTimer);
    stylePreviewTimer = setTimeout(() => refreshPlatePreview(id), 220);
  }

  function applyVar(name, value) {
    try {
      const doc = $('plateFrame')?.contentDocument;
      if (!doc?.documentElement) return;
      if (value == null || value === '') doc.documentElement.style.removeProperty(name);
      else doc.documentElement.style.setProperty(name, value);
    } catch {
      /* same-origin plates only */
    }
  }

  function queueStyle(id, name, value) {
    ed.pendingStyle.set(name, value);
    scheduleStylePreview(id);
    clearTimeout(ed.styleTimers.get(id));
    ed.styleTimers.set(
      id,
      setTimeout(async () => {
        const style = Object.fromEntries(ed.pendingStyle);
        ed.pendingStyle.clear();
        try {
          const r = await api(`/api/video/${encodeURIComponent(slug())}/plates/${encodeURIComponent(id)}/style`, { method: 'POST', body: { style } });
          const info = plateInfo(id);
          if (info) info.style = r.style || {};
          if (r.plates) state.htmlPlates = r.plates;
          ed.dirtyRender = true;
          paintStatus();
          markStyleRows(id);
          renderClipsTrack();
          refreshPlatePreview(id);
        } catch (err) {
          toast('Style not saved', err.message, 'err');
        }
      }, 380)
    );
  }

  function markStyleRows(id) {
    const style = plateInfo(id)?.style || {};
    document.querySelectorAll('#inspectorRoot [data-var]').forEach((row) => {
      const set = style[row.dataset.var] != null;
      row.classList.toggle('is-set', set);
      const slot = row.querySelector('.var-reset');
      if (slot && row.classList.contains('var-row')) {
        slot.outerHTML = set ? `<button type="button" class="var-reset" data-var-reset="${row.dataset.var}" title="Back to the brand value">${ICONS.reset}</button>` : '<i class="var-reset"></i>';
      }
    });
  }

  async function resetVar(id, name) {
    try {
      const r = await api(`/api/video/${encodeURIComponent(slug())}/plates/${encodeURIComponent(id)}/style`, { method: 'POST', body: { style: { [name]: null } } });
      const info = plateInfo(id);
      if (info) info.style = r.style || {};
      ed.dirtyRender = true;
      applyVar(name, null);
      await reloadPlate(id);
      refreshPlatePreview(id);
    } catch (err) {
      toast('Reset failed', err.message, 'err');
    }
  }

  async function plateApi(id, path, body, okMsg, { reload = true } = {}) {
    try {
      const r = await api(`/api/video/${encodeURIComponent(slug())}/plates/${encodeURIComponent(id)}/${path}`, { method: 'POST', body });
      const info = plateInfo(id);
      if (info) {
        if (path === 'motion') {
          info.motion = r.motion || {};
          info.overrides = r.overrides || [];
        } else info.style = r.style || {};
      }
      if (r.plates) state.htmlPlates = r.plates;
      ed.dirtyRender = true;
      paintStatus();
      if (reload) await reloadPlate(id);
      if (okMsg) flashHint(okMsg);
      return r;
    } catch (err) {
      toast('Not saved', err.message, 'err');
      return null;
    }
  }

  // ─── Look (per-plate motion overrides) ──────────────────────────────────────────────────
  // The pick lands on the live plate the moment it is made: energy, depth and sheen are CSS
  // variables, a title reveal is an attribute. The server rebuild runs behind it and the frame
  // reloads only when the markup itself changed (another atmosphere shader, cascade letters).
  const LOOK_KEYS = ['atmosphere', 'titleReveal', 'depth', 'energy', 'sheen'];
  let lookGen = 0;
  const normAtm = (a) => (!a || a === 'none' ? 'none' : a);

  function plateDoc(id) {
    if (!plateReady(id)) return null;
    try {
      return $('plateFrame')?.contentDocument || null;
    } catch {
      return null;
    }
  }

  function frameLook(doc) {
    const title = doc?.querySelector('.title[data-reveal]');
    let atmosphere = null;
    try {
      atmosphere = doc?.defaultView?.__plateRuntime?.field ?? null;
    } catch {
      /* same-origin plates only */
    }
    return { atmosphere, titleReveal: title ? title.dataset.reveal : null };
  }

  /** The look a key resolves to on this plate: its override, or the video's motion. */
  function lookValue(info, key) {
    const own = info?.motion?.[key];
    const vid = state.video?.motion || {};
    if (key === 'sheen') {
      const v = own ?? vid.sheen;
      return v === false ? 'off' : 'on';
    }
    return own ?? vid[key] ?? null;
  }

  function paintLook(doc, vars, titleReveal) {
    if (!doc) return;
    for (const [name, value] of Object.entries(vars || {})) applyVar(name, value);
    if (titleReveal) doc.querySelectorAll('.title[data-reveal]').forEach((t) => (t.dataset.reveal = titleReveal));
  }

  /** Paint CSS look tokens onto the live frame (Direction panel and Look share this). */
  function paintLookVars(vars, titleReveal) {
    try {
      paintLook($('plateFrame')?.contentDocument, vars, titleReveal);
      refreshPlatePreview(state.activePlateId || curClip()?.plateId);
    } catch {
      /* same-origin plates only */
    }
  }

  /** Does moving a title from `from` to `to` need new markup? Cascade builds letters; open and close build lines. */
  const revealNeedsMarkup = (id, from, to) => from !== to && (id === 'open' || id === 'close' || from === 'cascade' || to === 'cascade');

  /** Resolved look of a patch laid on the plate's current overrides — what the frame should show right now. */
  function guessLook(info, patch) {
    const next = patch.reset ? Object.fromEntries(LOOK_KEYS.map((k) => [k, null])) : patch;
    const out = Object.fromEntries(LOOK_KEYS.map((k) => [k, lookValue(info, k)]));
    for (const [key, raw] of Object.entries(next)) {
      if (!LOOK_KEYS.includes(key)) continue;
      out[key] = raw == null || raw === '' ? lookValue({ motion: {} }, key) : raw;
    }
    return out;
  }

  async function changeLook(id, patch) {
    const gen = ++lookGen;
    const info = plateInfo(id);
    const table = state.video?.motionOptions?.lookVars || {};
    const was = { atmosphere: lookValue(info, 'atmosphere'), titleReveal: lookValue(info, 'titleReveal') };
    const want = guessLook(info, patch);

    // 1. Optimistic paint from the table that shipped with the video — the pick shows this frame.
    const doc = plateDoc(id);
    if (doc) {
      const vars = {};
      for (const key of ['energy', 'depth', 'sheen', 'titleReveal']) Object.assign(vars, table[key]?.[want[key]] || {});
      paintLook(doc, vars, revealNeedsMarkup(id, was.titleReveal, want.titleReveal) ? null : want.titleReveal);
      refreshPlatePreview(id);
    }

    // 2. Save; the response carries the resolved look, so the frame ends on exactly what render will use.
    const r = await plateApi(id, 'motion', patch, patch.reset ? 'Back to the video look' : 'Look updated', { reload: false });
    if (!r || gen !== lookGen) return;
    const look = { ...want, ...(r.look || {}) };
    // Let a reload already in flight land first; several quick picks share one.
    while (ed.loadingPlate === id && gen === lookGen) await new Promise((done) => setTimeout(done, 40));
    if (gen !== lookGen) return;
    const after = plateDoc(id);
    const onStage = frameLook(after);
    // Reload when the pick needs new markup, or when the frame on stage is already out of date
    // (stale HTML from an earlier rebuild that skipped the load).
    const markupChanged =
      normAtm(look.atmosphere) !== normAtm(was.atmosphere) ||
      normAtm(look.atmosphere) !== normAtm(onStage.atmosphere) ||
      revealNeedsMarkup(id, was.titleReveal, look.titleReveal) ||
      (onStage.titleReveal != null && look.titleReveal != null && onStage.titleReveal !== look.titleReveal && revealNeedsMarkup(id, onStage.titleReveal, look.titleReveal));
    if (after && !markupChanged) {
      paintLook(after, look.vars || {}, look.titleReveal);
      refreshPlatePreview(id);
    } else if (
      canReloadPlateFrame({
        dirty: P.dirty(),
        activePlateId: state.activePlateId,
        plateId: id,
        playheadPlateId: curClip()?.plateId || null,
      })
    ) {
      await reloadPlate(id);
      refreshPlatePreview(id);
    }
    // Off stage, or the HTML itself changed while the playhead sits elsewhere: the next visit shows the rebuilt plate.
    else {
      ed.stalePlates.add(id);
      markPlateResync(id);
    }
    if (gen !== lookGen) return;
    if (ed.sel?.type === 'clip' && ed.seq.find((c) => c.id === ed.sel.id)?.plateId === id) renderInspector();
  }

  /** Every plate's HTML changed (Direction, palette, Apply motion) — drop the ready cache and reload the one on stage. */
  function invalidatePlates() {
    for (const c of ed.seq || []) if (c.plateId) ed.stalePlates.add(c.plateId);
    lookGen += 1;
    clearPlatePreviewTimers();
    const id = state.activePlateId || curClip()?.plateId;
    if (ed.active && id) return reloadPlate(id);
    return null;
  }

  function previewRange(fromEd, toEd) {
    seek(Math.max(0, fromEd - 0.8));
    play();
    ed.stopAt = Math.min(ed.total, toEd + 0.8);
  }

  function wireInspector() {
    const root = $('inspectorRoot');
    const s = ed.sel;
    const d = deckEdit();
    const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, (e) => fn(el, e)));
    const act = (name, fn) => root.querySelector(`[data-act="${name}"]`)?.addEventListener('click', fn);

    act('remove', removeSelected);
    on('[data-act="restore-omit"]', 'click', (el) => restoreOmitted(el.dataset.omitId));
    act('voice-mute', () => {
      const clip = (ed.deck?.audio?.voiceClips || []).find((c) => c.key === s?.key);
      if (clip) withVoice(clip.key, { mute: !clip.mute }, clip.mute ? 'Line back in' : 'Line muted');
    });
    act('voice-reset', () => s?.key && withVoice(s.key, { nudge: 0, at: null }, 'Back to where the line belongs'));
    act('clip-earlier', () => ed.sel?.type === 'clip' && moveClip(ed.sel.id, -1));
    act('clip-later', () => ed.sel?.type === 'clip' && moveClip(ed.sel.id, 1));
    const setLiveTrim = (id, patch) => {
      const clip = ed.seq.find((c) => c.id === id && c.kind === 'live');
      if (!clip) return Promise.resolve();
      const cur = { ...(d.trims || []).find((t) => t.id === id) };
      const next = { id, trimStart: cur.trimStart || 0, trimEnd: cur.trimEnd || 0, ...patch };
      if (!next.trimStart) delete next.trimStart;
      if (!next.trimEnd) delete next.trimEnd;
      const trims = (d.trims || []).filter((t) => t.id !== id);
      if (next.trimStart || next.trimEnd) trims.push(next);
      return postDeck({ trims }, { hint: 'Recording clip trimmed' });
    };
    on('[data-live-trim]', 'input', (el) => {
      const out = el.parentElement?.querySelector('output');
      if (out) out.textContent = `${Number(el.value).toFixed(2)}s`;
    });
    on('[data-live-trim]', 'change', (el) => {
      const key = el.dataset.liveTrim;
      const clip = ed.sel?.type === 'clip' ? ed.seq.find((c) => c.id === ed.sel.id) : null;
      if (!clip || clip.kind !== 'live') return;
      setLiveTrim(clip.id, { [key]: r3(Number(el.value) || 0) });
    });
    on('[data-live-trim-reset]', 'click', (el) => {
      const clip = ed.sel?.type === 'clip' ? ed.seq.find((c) => c.id === ed.sel.id) : null;
      if (!clip || clip.kind !== 'live') return;
      setLiveTrim(clip.id, { [el.dataset.liveTrimReset]: 0 });
    });
    act('trim-head-playhead', () => {
      const clip = ed.sel?.type === 'clip' ? ed.seq.find((c) => c.id === ed.sel.id) : null;
      if (!clip || clip.kind !== 'live') return;
      const cur = (d.trims || []).find((t) => t.id === clip.id) || {};
      const rawFrom = clip.recFrom - (cur.trimStart || 0);
      const recT = edToRec(clip, ed.t);
      const head = r3(Math.max(0, Math.min(recT - rawFrom, (clip.recTo + (cur.trimEnd || 0)) - rawFrom - 0.4)));
      setLiveTrim(clip.id, { trimStart: head });
    });
    act('trim-tail-playhead', () => {
      const clip = ed.sel?.type === 'clip' ? ed.seq.find((c) => c.id === ed.sel.id) : null;
      if (!clip || clip.kind !== 'live') return;
      const cur = (d.trims || []).find((t) => t.id === clip.id) || {};
      const rawTo = clip.recTo + (cur.trimEnd || 0);
      const recT = edToRec(clip, ed.t);
      const tail = r3(Math.max(0, Math.min(rawTo - recT, rawTo - (clip.recFrom - (cur.trimStart || 0)) - 0.4)));
      setLiveTrim(clip.id, { trimEnd: tail });
    });
    act('music-mute', () => withMusic({ mute: !audioDesk().music.mute }, audioDesk().music.mute ? 'Music back in' : 'Music muted'));
    act('music-compose', () => {
      const prompt = root.querySelector('[data-music-prompt]')?.value ?? '';
      ctx.requestMusicFit?.({ prompt });
    });
    act('music-upload', () => pickMusicFile());
    on('[data-music-loop]', 'change', (el) => withMusic({ loop: el.checked }, el.checked ? 'Music loops to fill the cut' : 'Music ends with the bed'));
    act('master-reset', () => postAudio({ ...audioDesk(), master: {} }, 'Back to the brand mix'));
    act('ride-remove', () => {
      const rides = audioDesk().music.rides.filter((_, i) => i !== s?.i);
      withMusic({ rides }, 'Ride removed').then(() => select({ type: 'music' }));
    });
    root.querySelectorAll('[data-act="ride"]').forEach((el) =>
      el.addEventListener('click', () => {
        const db = Number(el.dataset.rideDb);
        const from = r3(ed.t);
        const to = r3(Math.min(ed.total, from + 4));
        if (to - from < 0.4) return;
        const rides = [...audioDesk().music.rides, { from, to, gainDb: db }];
        withMusic({ rides }, db < 0 ? 'Softer there' : 'Louder there');
      })
    );
    act('record', () => ctx.requestMake?.('full'));
    act('text', () => (ed.textMode ? exitText() : enterText()));
    on('[data-edit-card]', 'click', (el) => {
      if (ed.textMode && ed.liveCardId && ed.liveCardId === el.dataset.editCard) exitText();
      else enterLiveCard(el.dataset.editCard || null, el.dataset.markT, el.dataset.markKey || null);
    });
    act('field-focus', () => ed.plateField?.path && enterTextFor(ed.plateField.path));
    act('field-accent', () => {
      if (!ed.textMode) enterText(ed.plateField?.path);
      else P.accent?.();
    });
    on('[data-field]', 'click', (el) => enterTextFor(el.dataset.field));
    on('[data-field-src]', 'input', (el) => {
      const path = ed.plateField?.path;
      if (!path) return;
      P.setField?.(path, el.value);
      ed.plateField = { ...ed.plateField, source: el.value, dirty: true };
      paintTextMode();
      paintFieldChips();
    });
    act('add-zoom', toolZoom);
    act('adopt', () => selectedShot() && adoptShot(selectedShot()));
    act('add-lens', toolLens);
    act('adopt-lens', () => selectedLens() && adoptLens(selectedLens()));
    act('lens-on', () => {
      const l = selectedLens();
      if (l) postDeck({ lensOff: d.lensOff.filter((t) => Math.abs(t - l.t) > 0.0005) }, { hint: 'Recorded magnifier back on' }).then((r) => r && select({ type: 'lens', key: `auto:${l.t}` }));
    });
    act('preview-sel', () => {
      if (s?.type === 'ramp') {
        const seg = fxSegments(d.speed[s.i].from, d.speed[s.i].to)[0];
        if (seg) previewRange(seg.a, seg.b);
      } else if (s?.type === 'voice') {
        const clip = (ed.deck?.audio?.voiceClips || []).find((c) => c.key === s.key);
        if (clip) previewRange(clip.start, clip.start + clip.dur);
      } else if (s?.type === 'ride') {
        const ride = audioDesk().music.rides[s.i];
        if (ride) previewRange(ride.from, ride.to);
      } else if (s?.type === 'lens') {
        const l = selectedLens();
        const seg = l && fxSegments(l.t, l.t + l.dur)[0];
        if (seg) previewRange(seg.a, seg.b);
      } else if (s?.type === 'zoom') {
        const shot = selectedShot();
        const seg = shot && fxSegments(shot.start, shot.end)[0];
        if (seg) {
          ed.sel = { ...s };
          previewRange(seg.a, seg.b);
        }
      }
    });
    act('preview-join', () => {
      const c = ed.seq[s.i];
      if (c) previewRange(c.at - 0.6, c.at + c.overlap + 0.4);
    });
    on('[data-goto-join]', 'click', (el) => {
      const c = ed.seq[Number(el.dataset.gotoJoin)];
      if (c?.join) select({ type: 'join', key: c.join.key, i: c.i });
    });
    on('[data-goto-ramp]', 'click', (el) => select({ type: 'ramp', i: Number(el.dataset.gotoRamp) }));
    on('[data-goto-lens]', 'click', (el) => {
      const l = lensByKey(el.dataset.gotoLens);
      if (l) selectFx({ kind: 'lens', key: l.key, lens: l, from: l.t, to: l.t + l.dur });
    });
    on('[data-goto-shot]', 'click', (el) => {
      const shot = (ed.deck.zoomShots || []).find((x) => shotKey(x) === el.dataset.gotoShot);
      if (shot) selectFx({ kind: 'zoom', key: shotKey(shot), shot, from: shot.start, to: shot.end });
    });

    // Live clip
    on('[data-clip-rate]', 'click', (el) => {
      const c = ed.seq.find((x) => x.id === s?.id);
      if (!c) return;
      const rate = Number(el.dataset.clipRate);
      const speed = d.speed.filter((r) => r.to <= c.recFrom + 0.001 || r.from >= c.recTo - 0.001);
      if (rate !== 1) speed.push({ from: r3(c.recFrom), to: r3(c.recTo), rate });
      postDeck({ speed }, { hint: rate === 1 ? 'Normal speed' : `Whole clip at ${fmtRate(rate)}` });
    });
    on('[data-cam-zoom]', 'click', async (el) => {
      await ctx.saveDirection?.({ camera: { zoom: el.dataset.camZoom } }, { quiet: true });
      await refresh();
    });
    on('[data-cam-curve]', 'click', async (el) => {
      await ctx.saveDirection?.({ camera: { curve: el.dataset.camCurve } }, { quiet: true });
      await refresh();
    });
    on('[data-cam-motion]', 'click', async (el) => {
      await ctx.saveDirection?.({ camera: { motion: el.dataset.camMotion } }, { quiet: true });
      await refresh();
    });
    on('[data-cursor-style]', 'click', (el) => ctx.saveDirection?.({ cursor: { style: el.dataset.cursorStyle } }, { quiet: true }).then(refresh));
    on('[data-cursor-size]', 'click', (el) => ctx.saveDirection?.({ cursor: { size: el.dataset.cursorSize } }, { quiet: true }).then(refresh));
    on('[data-pace]', 'click', (el) => ctx.saveDirection?.({ pace: el.dataset.pace }, { quiet: true }).then(refresh));

    // Ramp
    const setRampRate = (rate) => postDeck({ speed: d.speed.map((r, i) => (i === s.i ? { ...r, rate } : r)) });
    on('[data-ramp-rate]', 'input', (el) => ($('insRateOut').textContent = fmtRate(el.value)));
    on('[data-ramp-rate]', 'change', (el) => setRampRate(Number(el.value)));
    on('[data-ramp-preset]', 'click', (el) => setRampRate(Number(el.dataset.rampPreset)));

    // Zoom — strength paints the stage at once; the save lands when the slider settles.
    const shot = selectedShot();
    const setZoom = (zoom) => shot && postDeck({ zooms: d.zooms.map((z) => (z.id === shot.id ? { ...z, zoom } : z)) });
    on('[data-shot-zoom]', 'input', (el) => {
      $('insZoomOut').textContent = `${Number(el.value).toFixed(2)}×`;
      ed.aimZoom = Number(el.value);
      paintZoomBox();
      renderFrame();
    });
    on('[data-shot-zoom]', 'change', (el) => {
      // Keep aimZoom until the deck save lands — clearing early flashes the old strength on stage.
      const zoom = Number(el.value);
      ed.aimZoom = zoom;
      setZoom(zoom)?.finally(() => {
        ed.aimZoom = null;
      });
    });
    on('[data-zoom-preset]', 'click', (el) => {
      const zoom = Number(el.dataset.zoomPreset);
      ed.aimZoom = zoom;
      if ($('insZoomOut')) $('insZoomOut').textContent = `${zoom.toFixed(2)}×`;
      paintZoomBox();
      renderFrame();
      setZoom(zoom)?.finally(() => {
        ed.aimZoom = null;
      });
    });

    // Magnifier
    const lens = selectedLens();
    const own = lens?.source === 'edit' ? deckLens(lens) : null;
    const [lensLo, lensHi] = ed.deck?.ranges?.lensZoom || [1.2, 2.4];
    const saveLens = (patch) => own && postDeck({ lenses: d.lenses.map((l) => (l.id === own.id ? { ...l, ...patch } : l)) });
    // The aim carries every pending slider value, so strength and area preview together.
    const previewLens = (patch) => {
      if (!own) return;
      const base = ed.lensAim || { ...lensTarget(lens), zoom: own.zoom };
      ed.lensAim = { ...base, ...patch };
      renderFrame();
      paintLensBox();
      syncLensStrength();
    };
    const lensSizeNow = () => {
      const a = ed.lensAim;
      return Math.max(a?.w ?? own?.w ?? lens?.rect.w ?? 24, a?.h ?? own?.h ?? lens?.rect.h ?? 24);
    };
    const lensCeiling = () => r3(clamp(lensZoomCeiling(lensSizeNow()), lensLo, lensHi));
    /** Strength slider, readout, presets and the cap note follow the area the loupe has to cover. */
    function syncLensStrength() {
      const zoomEl = root.querySelector('[data-lens-zoom]');
      if (!zoomEl || !own) return;
      const ceiling = lensCeiling();
      const want = ed.lensAim ? ed.lensAim.zoom : own.zoom;
      const loupe = lensLoupe(lensSizeNow(), want);
      zoomEl.max = String(ceiling);
      zoomEl.disabled = ceiling - lensLo < 0.05;
      if (want != null && Number(zoomEl.value) !== Math.min(want, ceiling)) zoomEl.value = String(Math.min(want, ceiling));
      const out = $('insLensOut');
      if (out) out.textContent = `${loupe.zoom.toFixed(2)}×${want == null ? ' auto' : ''}`;
      root.querySelectorAll('[data-lens-preset]').forEach((b) => {
        const v = Number(b.dataset.lensPreset);
        b.disabled = Boolean(v) && v > ceiling + 1e-6;
      });
      const cap = root.querySelector('[data-lens-cap]');
      if (cap) {
        cap.textContent =
          ceiling < lensHi - 1e-6
            ? `Up to ${ceiling.toFixed(2)}× for a ${Math.round(lensSizeNow())}px area — shrink the area for a stronger loupe.`
            : '';
      }
    }
    on('[data-lens-zoom]', 'input', (el) => previewLens({ zoom: Number(el.value) }));
    on('[data-lens-zoom]', 'change', (el) => {
      const zoom = Math.min(Number(el.value), lensCeiling());
      previewLens({ zoom });
      saveLens({ zoom })?.finally(() => {
        ed.lensAim = null;
      });
    });
    on('[data-lens-preset]', 'click', (el) => {
      const zoom = el.dataset.lensPreset ? Number(el.dataset.lensPreset) : undefined;
      if (zoom) {
        if (zoom > lensCeiling() + 1e-6) return;
        previewLens({ zoom });
        saveLens({ zoom }).finally(() => {
          ed.lensAim = null;
        });
      } else if (own) {
        const { zoom: _drop, ...rest } = own;
        previewLens({ zoom: undefined });
        postDeck({ lenses: d.lenses.map((l) => (l.id === own.id ? rest : l)) }).finally(() => {
          ed.lensAim = null;
        });
      }
    });
    on('[data-lens-size]', 'input', (el) => {
      el.parentElement.querySelector('output').textContent = `${el.value}px`;
      previewLens({ [el.dataset.lensSize]: Number(el.value) });
    });
    on('[data-lens-size]', 'change', (el) => {
      const patch = { [el.dataset.lensSize]: Number(el.value) };
      previewLens(patch);
      // A wider area lowers the ceiling; keep the stored strength at a value the loupe can draw.
      const ceiling = lensCeiling();
      if (own?.zoom != null && own.zoom > ceiling + 1e-6) patch.zoom = ceiling;
      saveLens(patch)?.finally(() => {
        ed.lensAim = null;
      });
    });

    // Join
    const joinC = s?.type === 'join' ? ed.seq[s.i] : null;
    const saveJoin = (entry) => {
      const transitions = { ...(d.transitions || {}) };
      if (Object.keys(entry).length) transitions[joinC.join.key] = entry;
      else delete transitions[joinC.join.key];
      return postDeck({ transitions });
    };
    on('[data-join-style]', 'click', async (el) => {
      if (!joinC) return;
      const pinned = { ...(joinC.join.pinned || {}) };
      if (el.dataset.joinStyle) pinned.style = el.dataset.joinStyle;
      else delete pinned.style;
      await saveJoin(pinned);
      const c = ed.seq[s.i];
      if (c) previewRange(c.at - 0.6, c.at + c.overlap + 0.4);
    });
    on('[data-join-dur]', 'input', (el) => ($('insJoinOut').textContent = `${Number(el.value).toFixed(2)}s`));
    on('[data-join-dur]', 'change', (el) => joinC && saveJoin({ ...(joinC.join.pinned || {}), duration: Number(el.value) }));
    act('join-reset', () => joinC && saveJoin({}));

    // Card on-screen length (same edit.cards path as timeline edge drags).
    const cardSel = s?.type === 'card' ? s : null;
    const cardKind = (() => {
      if (!cardSel?.key) return null;
      const mark = (ed.deck?.marks || []).find((m) => (m.key || cardMarkKey(m)) === cardSel.key);
      return mark?.kind === 'chapter' ? 'chapter' : mark?.kind === 'caption' ? 'caption' : null;
    })();
    on('[data-card-dur]', 'input', (el) => {
      if ($('insCardDurOut')) $('insCardDurOut').textContent = `${Number(el.value).toFixed(1)}s`;
    });
    on('[data-card-dur]', 'change', (el) => {
      if (!cardSel?.key) return;
      const mark = (ed.deck?.marks || []).find((m) => (m.key || cardMarkKey(m)) === cardSel.key);
      saveCardTiming(
        { key: cardSel.key, t: cardSel.markT ?? mark?.t ?? 0, dur: Number(el.value) },
        { cardId: cardSel.cardId, clipId: cardSel.clipId, hint: 'Card length changed' }
      );
    });

    async function saveCardOverlays(patch, hint) {
      if (!slug()) return;
      try {
        const r = await api(`/api/video/${encodeURIComponent(slug())}/overlays`, { method: 'POST', body: patch });
        if (r?.plates) state.htmlPlates = r.plates;
        if (state.video) {
          state.video.overlays = r.overlays;
          state.video.direction = r.direction || state.video.direction;
          state.video.htmlPlates = r.plates || state.video.htmlPlates;
        }
        ctx.renderOverlays?.(r.overlays);
        for (const p of r.plates || state.htmlPlates || []) {
          if (p.liveCard || String(p.id || '').startsWith('overlay:')) ed.stalePlates.add(p.id);
        }
        const activeId = ed.liveCardId || ed.compositeCardId || cardSel?.cardId || null;
        ed.compositeCardId = null;
        ed.compositeSeekMs = null;
        if (activeId) await requestPlate(activeId, { reason: 'show' });
        toast('Live card look', hint || r.overlays?.preset || 'saved');
        renderInspector();
      } catch (err) {
        toast('Live cards failed', err.message, 'err');
      }
    }

    // Background trio (atmosphere · backdrop · opacity) saves for the card's chapter unless the
    // scope is "All chapters"; preset, entrance, ornaments, seat and text are always video-wide.
    const lookChapterNo = Number(liveCardRow(cardSel)?.chapterNo) || 0;
    const chapterScoped = () => lookChapterNo && ed.lookScope !== 'video';
    const scopeHint = () => (chapterScoped() ? `chapter ${lookChapterNo}` : 'all chapters');
    const backgroundPatch = (slotPatch) => (chapterScoped() ? { chapterNo: lookChapterNo, [cardKind]: slotPatch } : { [cardKind]: slotPatch });

    on('[data-look-scope]', 'click', (el) => {
      ed.lookScope = el.dataset.lookScope === 'video' ? 'video' : 'chapter';
      renderInspector();
    });
    act('look-apply-all', () => {
      if (!cardKind || !lookChapterNo) return;
      saveCardOverlays({ applyToAll: true, chapterNo: lookChapterNo, slot: cardKind }, `Chapter ${lookChapterNo} ${cardKind} background → all chapters`);
    });
    act('look-follow-video', () => {
      if (!cardKind || !lookChapterNo) return;
      saveCardOverlays({ reset: true, chapterNo: lookChapterNo, slot: cardKind }, `Chapter ${lookChapterNo} ${cardKind} · follows the video`);
    });

    on('[data-overlay-preset]', 'change', (el) => {
      if (!cardKind) return;
      saveCardOverlays({ preset: el.value }, `Preset · ${el.value}`);
    });
    on('[data-overlay]', 'change', (el) => {
      if (!cardKind) return;
      const key = el.dataset.overlay;
      if (!key) return;
      if (key === 'atmosphere') {
        saveCardOverlays(backgroundPatch({ atmosphere: el.value }), `${cardKind} · background ${el.value} · ${scopeHint()}`);
        return;
      }
      saveCardOverlays({ [cardKind]: { [key]: el.value } }, `${cardKind} · ${key}`);
    });
    on('[data-overlay-backdrop]', 'change', (el) => {
      if (!cardKind) return;
      const v = el.value;
      if (v === 'custom') {
        // Hand off to the swatch; the colour input's change saves the hex.
        const picker = root.querySelector('[data-overlay-backdrop-color]');
        if (picker) {
          picker.click();
          return;
        }
      }
      // Video-wide "auto" is the default (cleared); for one chapter it is an explicit choice that
      // can override a coloured video backdrop, so it is stored as-is.
      const backdrop = v === 'auto' && !chapterScoped() ? null : v;
      saveCardOverlays(backgroundPatch({ backdrop }), `${cardKind} · backdrop ${v} · ${scopeHint()}`);
    });
    on('[data-overlay-backdrop-color]', 'input', (el) => {
      const sw = el.closest('.ins-swatch');
      if (sw) {
        sw.style.setProperty('--sw', el.value);
        sw.classList.remove('is-off');
      }
    });
    on('[data-overlay-backdrop-color]', 'change', (el) => {
      if (!cardKind) return;
      saveCardOverlays(backgroundPatch({ backdrop: el.value }), `${cardKind} · backdrop ${el.value} · ${scopeHint()}`);
    });
    on('[data-overlay-backdrop-opacity]', 'input', (el) => {
      const out = el.parentElement?.querySelector('output');
      if (out) out.textContent = `${el.value}%`;
    });
    on('[data-overlay-backdrop-opacity]', 'change', (el) => {
      if (!cardKind) return;
      saveCardOverlays(backgroundPatch({ backdropOpacity: Number(el.value) }), `${cardKind} · backdrop ${el.value}% · ${scopeHint()}`);
    });
    on('[data-overlay-bool]', 'click', (el) => {
      if (!cardKind) return;
      const key = el.dataset.overlayBool;
      if (!key) return;
      const forced = el.dataset.bool;
      const on = forced != null ? forced === 'on' : !el.classList.contains('on');
      saveCardOverlays({ [cardKind]: { [key]: on } }, `${cardKind} · ${key} ${on ? 'on' : 'off'}`);
    });

    // Range
    const rangeC = s?.type === 'range' ? s : null;
    on('[data-range-rate]', 'click', (el) => rangeC && addRamp(rangeC.from, rangeC.to, Number(el.dataset.rangeRate)));
    on('[data-range-zoom]', 'click', () => rangeC && addZoomAt(rangeC.from, rangeC.to - rangeC.from));
    on('[data-range-cut]', 'click', () => rangeC && addCut(rangeC.from, rangeC.to));
    act('preview-cut', () => {
      const cut = ed.sel?.type === 'cut' ? cutBlocks().find((c) => c.i === ed.sel.i) : null;
      if (cut) previewRange(Math.max(0, cut.splice - 0.2), cut.splice + 0.9);
    });
    on('[data-range-lens]', 'click', () => rangeC && addLensAt(rangeC.from, rangeC.to - rangeC.from));
    on('[data-range-skip]', 'click', async () => {
      if (!rangeC) return;
      const r = await postDeck({ zoomSkips: [...d.zoomSkips, { from: rangeC.from, to: rangeC.to }] }, { hint: 'No auto zoom in that stretch' });
      if (r) select(null);
    });

    // Audio desk. Sliders preview while dragging and save when released.
    const outOf = (el) => el.parentElement?.querySelector('output');
    on('[data-voice-gain]', 'input', (el) => {
      if (outOf(el)) outOf(el).textContent = `${Number(el.value).toFixed(1)} dB`;
      ed.hear = { voice: { key: s.key, gainDb: Number(el.value) } };
      if (ed.playing) preview.play(previewState(), ed.t);
      else preview.sync(previewState(), ed.t, false);
    });
    on('[data-voice-gain]', 'change', (el) => withVoice(s.key, { gainDb: Number(el.value) }));
    on('[data-voice-nudge]', 'input', (el) => {
      if (outOf(el)) outOf(el).textContent = `${Number(el.value) > 0 ? '+' : ''}${Number(el.value).toFixed(2)}s`;
    });
    on('[data-voice-nudge]', 'change', (el) => withVoice(s.key, { nudge: Number(el.value) }, 'Line moved'));

    // Per-line shape: trims and fades. Trim keeps at least ranges.voiceMinSec of speech.
    on('[data-voice-shape]', 'input', (el) => {
      if (outOf(el)) outOf(el).textContent = `${Number(el.value).toFixed(2)}s`;
    });
    on('[data-voice-shape]', 'change', (el) => {
      const clip = voiceClip(s.key);
      if (!clip) return;
      const k = el.dataset.voiceShape;
      let v = Number(el.value);
      const minSec = ed.deck?.ranges?.voiceMinSec || 0.3;
      if (k === 'trimStart') v = clamp(v, 0, r3(clip.full - clip.trimEnd - minSec));
      if (k === 'trimEnd') v = clamp(v, 0, r3(clip.full - clip.trimStart - minSec));
      const patch = { [k]: r3(v) };
      // The head trim moves the start by the same amount, so the words that stay keep their place.
      if (k === 'trimStart') patch.nudge = r3((clip.nudge || 0) + (v - clip.trimStart));
      withVoice(s.key, patch, { trimStart: 'Head trimmed', trimEnd: 'Tail trimmed', fadeIn: 'Fade in set', fadeOut: 'Fade out set' }[k]).then(() => listenLine(voiceClip(s.key)));
    });
    on('[data-voice-shape-reset]', 'click', (el) => {
      const clip = voiceClip(s.key);
      const k = el.dataset.voiceShapeReset;
      const patch = { [k]: 0 };
      if (k === 'trimStart' && clip) patch.nudge = r3((clip.nudge || 0) - clip.trimStart);
      withVoice(s.key, patch);
    });
    act('voice-shape-reset', () => {
      const clip = voiceClip(s.key);
      withVoice(s.key, { trimStart: 0, trimEnd: 0, fadeIn: 0, fadeOut: 0, nudge: r3((clip?.nudge || 0) - (clip?.trimStart || 0)) }, 'Whole take');
    });

    // The line itself: rewrite, pace, takes. Regenerate sends the textarea as it stands.
    const lineBody = () => {
      const clip = voiceClip(s.key);
      const text = root.querySelector('[data-voice-text]')?.value.replace(/\s+/g, ' ').trim() || '';
      const speed = Number(root.querySelector('[data-voice-speed]')?.value || clip?.speed || 1);
      const body = { speed };
      const written = (clip?.written || '').replace(/\s+/g, ' ').trim();
      const effective = (clip?.textOverride || clip?.text || '').replace(/\s+/g, ' ').trim();
      // Matching the script clears a rewrite. Matching what already speaks leaves the desk alone
      // (do not invent a text override — that would remint every take's cache key).
      if (written && text === written) body.text = '';
      else if (text !== effective) body.text = text;
      return body;
    };
    const markDirty = () => {
      const clip = voiceClip(s.key);
      if (!clip) return;
      const b = lineBody();
      const effective = (clip.textOverride || clip.text || '').replace(/\s+/g, ' ').trim();
      const written = (clip.written || '').replace(/\s+/g, ' ').trim();
      const nextText = Object.prototype.hasOwnProperty.call(b, 'text') ? b.text : effective;
      const dirty =
        (nextText || written) !== effective || Math.abs(b.speed - (clip.speed || clip.spokenSpeed || 1)) > 0.01;
      root.querySelector('[data-act="voice-regen"]')?.classList.toggle('is-dirty', dirty);
      const label = root.querySelector('[data-act="voice-regen"] span');
      if (label && !ed.regenerating) label.textContent = dirty ? 'Regenerate with changes' : 'Regenerate';
    };
    on('[data-voice-text]', 'input', markDirty);
    on('[data-voice-text]', 'keydown', (el, e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        root.querySelector('[data-act="voice-regen"]')?.click();
      }
    });
    on('[data-voice-speed]', 'change', markDirty);
    act('voice-text-written', () => {
      const ta = root.querySelector('[data-voice-text]');
      const clip = voiceClip(s.key);
      if (ta && clip) {
        ta.value = clip.written;
        markDirty();
        ta.focus();
      }
    });
    act('voice-regen', () => {
      const clip = voiceClip(s.key);
      if (!clip || ed.regenerating) return;
      const b = lineBody();
      const effective = (clip.textOverride || clip.text || '').trim();
      const written = (clip.written || '').trim();
      const nextText = Object.prototype.hasOwnProperty.call(b, 'text') ? b.text : effective;
      const changed =
        (nextText || written) !== effective || Math.abs(b.speed - (clip.speed || clip.spokenSpeed || 1)) > 0.01;
      // Every Regenerate adds a take — same words or a rewrite — so prior performances stay a click away.
      regenerateLine(s.key, { ...b, newTake: true }, changed ? 'New take with your changes' : 'New take ready');
    });
    on('[data-take]', 'click', (el) => {
      const clip = voiceClip(s.key);
      if (!clip || ed.regenerating) return;
      const take = clamp(Number(el.dataset.take), 1, Math.max(clip.take || 1, clip.takes || 1));
      if (take !== (clip.take || 1)) regenerateLine(s.key, { take }, `Take ${take}`);
    });
    // Back to the script: its words, natural pace, take 1. Those takes stay in the cache, so this is free.
    act('voice-revert', () => {
      const clip = voiceClip(s.key);
      if (!clip || ed.regenerating) return;
      regenerateLine(s.key, { text: '', speed: 1, take: 1 }, 'Back to the script');
    });
    act('voice-upload', () => {
      if (!s?.key || ed.regenerating || ed.micRecord) return;
      pickVoiceFile(s.key);
    });
    act('voice-mic', () => {
      if (!s?.key || ed.regenerating) return;
      toggleMicRecord(s.key);
    });

    // Add a free-standing line from the empty inspector (or after deselecting).
    const addText = () => (root.querySelector('[data-voice-add-text]')?.value || '').replace(/\s+/g, ' ').trim();
    act('voice-add-eleven', async () => {
      const text = addText();
      if (!text) {
        toast('Nothing to speak', 'Write the line first, or use Upload / Record instead.', 'warn');
        return;
      }
      await addVoiceLine({ text, via: 'eleven' });
    });
    act('voice-add-upload', async () => {
      const r = await addVoiceLine({ text: addText() });
      if (r?.key) pickVoiceFile(r.key);
    });
    act('voice-add-mic', async () => {
      const r = await addVoiceLine({ text: addText() });
      if (r?.key) toggleMicRecord(r.key);
    });

    // Narrator (in the Mix panel).
    on('[data-narrator]', 'change', (el) => {
      ed.narratorPick = el.value;
      renderInspector();
    });
    act('narrator-listen', () => {
      const n = ed.deck?.audio?.narrator;
      const picked = Array.isArray(ed.voices) ? ed.voices.find((v) => v.voiceId === (ed.narratorPick || n?.voiceId)) : null;
      if (!picked?.previewUrl) return;
      if (ed.sample) {
        ed.sample.pause();
        if (ed.sample.src === picked.previewUrl) {
          ed.sample = null;
          return;
        }
      }
      if (ed.playing) pause();
      ed.sample = new Audio(picked.previewUrl);
      ed.sample.play().catch(() => toast('Sample did not play', 'The browser blocked the preview; click once more.', 'warn'));
    });
    act('narrators-reload', () => loadNarrators(true));
    act('narrator-use', async () => {
      const n = ed.deck?.audio?.narrator;
      const picked = Array.isArray(ed.voices) ? ed.voices.find((v) => v.voiceId === ed.narratorPick) : null;
      if (!picked || picked.voiceId === n?.voiceId) return;
      await setNarrator({ voiceId: picked.voiceId, name: picked.name }, `${picked.name} narrates this video`);
    });
    act('narrator-brand', () => setNarrator({ reset: true }, 'Back to the brand narrator'));
    on('[data-music-gain]', 'input', (el) => {
      if (outOf(el)) outOf(el).textContent = `${Number(el.value).toFixed(1)} dB`;
      ed.hear = { music: { gainDb: Number(el.value) } };
      preview.audition(previewState(), ed.t);
    });
    on('[data-music-gain]', 'change', (el) => {
      if (!ed.playing) preview.pause();
      withMusic({ gainDb: Number(el.value) });
    });
    on('[data-fade]', 'input', (el) => {
      if (outOf(el)) outOf(el).textContent = `${Number(el.value).toFixed(1)}s`;
    });
    on('[data-fade]', 'change', (el) => withMusic({ [el.dataset.fade]: Number(el.value) }));
    on('[data-music-offset]', 'input', (el) => {
      const n = Number(el.value);
      if (outOf(el)) outOf(el).textContent = `${n > 0 ? '+' : ''}${n.toFixed(1)}s`;
    });
    on('[data-music-offset]', 'change', (el) => withMusic({ offset: Number(el.value) }, 'Music slipped'));
    on('[data-ride-gain]', 'input', (el) => {
      if (outOf(el)) outOf(el).textContent = `${Number(el.value).toFixed(1)} dB`;
    });
    on('[data-ride-gain]', 'change', (el) => {
      const rides = audioDesk().music.rides.map((r, i) => (i === s.i ? { ...r, gainDb: Number(el.value) } : r));
      withMusic({ rides });
    });
    on('[data-master]', 'input', (el) => {
      const n = Number(el.value);
      const unit = el.dataset.master === 'duckRatio' ? '×' : el.dataset.master === 'truePeakDb' ? ' dB' : ' LUFS';
      if (outOf(el)) outOf(el).textContent = `${n.toFixed(1)}${unit}`;
      ed.hear = { master: { [el.dataset.master]: n } };
      preview.audition(previewState(), ed.t);
    });
    on('[data-master]', 'change', (el) => {
      if (!ed.playing) preview.pause();
      withMaster({ [el.dataset.master]: Number(el.value) }, 'Master updated');
    });

    // Plate
    const plateC = s?.type === 'clip' ? ed.seq.find((x) => x.id === s.id && x.kind === 'plate') : null;
    if (!plateC) return;
    const id = plateC.plateId;
    on('[data-look]', 'change', (el) => changeLook(id, { [el.dataset.look]: el.value === '' ? null : el.value }));
    act('look-reset', () => changeLook(id, { reset: true }));
    act('style-reset', async () => {
      await plateApi(id, 'style', { reset: true }, 'Back to the brand values');
      refreshPlatePreview(id);
    });
    on('[data-var-color]', 'input', (el) => {
      el.nextElementSibling.style.background = el.value;
      applyVar(el.dataset.varColor, el.value);
      queueStyle(id, el.dataset.varColor, el.value);
    });
    on('.sw', 'contextmenu', (el, e) => {
      e.preventDefault();
      if (el.classList.contains('is-set')) resetVar(id, el.dataset.var);
    });
    on('[data-var-range]', 'input', (el) => {
      const v = `${el.value}${el.dataset.unit || ''}`;
      el.parentElement.querySelector('output').textContent = v;
      applyVar(el.dataset.varRange, v);
      queueStyle(id, el.dataset.varRange, v);
    });
    on('[data-var-toggle]', 'change', (el) => {
      const v = el.checked ? '1' : '0';
      applyVar(el.dataset.varToggle, v);
      queueStyle(id, el.dataset.varToggle, v);
    });
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-var-reset]');
      if (btn) resetVar(id, btn.dataset.varReset);
    });
  }

  // ─── Plate reloads (server rebuilt the HTML) ─────────────────────────────────────────────
  async function reloadPlate(id) {
    ed.missing.delete(id);
    const c = curClip();
    const clip = plateClipFor(ed.seq, id, c);
    if (
      !canReloadPlateFrame({
        dirty: P.dirty(),
        activePlateId: state.activePlateId,
        plateId: id,
        playheadPlateId: c?.plateId || null,
      })
    ) {
      // Unsaved copy on stage, or the iframe is showing something else: pick up on the next visit.
      ed.stalePlates.add(id);
      markPlateResync(id);
      return;
    }
    if (ed.loadingPlate === id) {
      markPlateResync(id);
      return;
    }
    ed.stalePlates.delete(id);
    ed.loadingPlate = id;
    paintLoading();
    clearPlatePreviewTimers();
    // force: true — the ready-cache must not keep a frame built before this look/palette change.
    const ok = await P.load(id, { force: true });
    ed.loadingPlate = null;
    paintLoading();
    if (shouldBlacklistPlateLoad(ok, { activePlateId: state.activePlateId, requestedId: id })) {
      ed.missing.add(id);
      return;
    }
    if (ok !== true) return;
    if (ed.textMode) {
      // Load arms studio-edit; stay in text mode and resync motion when Done lands.
      markPlateResync(id);
      paintTextMode();
    } else {
      // Keep the playhead — a look/atmosphere reload should land on the same beat, not the open.
      const onPlate = playheadOnPlate(curClip(), id);
      const ms = onPlate && clip ? Math.max(0, Math.round((ed.t - clip.at) * 1000)) : 0;
      P.motion();
      P.restart?.(ms);
      if (ed.needsPlateResync === id) ed.needsPlateResync = null;
    }
    if (playheadOnPlate(curClip(), id)) renderFrame();
    if (ed.sel?.type === 'clip' && ed.seq.find((x) => x.id === ed.sel.id)?.plateId === id) renderInspector();
  }

  // ─── Entry points ────────────────────────────────────────────────────────────────────────
  async function onEnter({ programT } = {}) {
    ed.active = true;
    document.body.classList.add('is-editor');
    // Always re-fetch: desk, takes and voice meta can change on disk or via API while Program is open.
    await refresh();
    // Warm live-card HTML so chapter/caption clicks don't race a first rebuild.
    await ensureLiveCards();
    if (programT != null && ed.deck?.scenes?.length) {
      const i = ed.deck.scenes.findIndex((s) => programT >= s.start - 0.05 && programT < s.end);
      const c = ed.seq[i];
      if (c) ed.t = c.at + clamp(programT - ed.deck.scenes[i].start, 0, c.dur);
    }
    if (!ed.sel) {
      const c = curClip();
      if (c) ed.sel = { type: 'clip', id: c.id };
    }
    renderTimeline();
    renderFrame();
    renderInspector();
    paintStatus();
    paintTransport();
    paintTextMode();
    showInspectorTab();
    requestAnimationFrame(() => {
      renderTimeline();
      P.fit();
    });
  }

  function onLeave() {
    if (!ed.active) return;
    pause();
    preview.pause();
    clearPlatePreviewTimers();
    ed.textGen += 1;
    if (ed.textMode) exitText();
    ed.needsPlateResync = null;
    ed.active = false;
    document.body.classList.remove('is-editor');
    const tab = document.querySelector('.tools-panel .ptab[data-right="inspector"]');
    if (tab?.classList.contains('active')) document.querySelector('.tools-panel .ptab[data-right="feedback"]')?.click();
  }

  async function openClip(match) {
    if (!ed.deck) await refresh();
    const c = ed.seq.find(match);
    if (!c) return false;
    if (state.monitorMode !== 'plate') ctx.setMonitorMode('plate');
    else if (!ed.active) await onEnter();
    ed.t = c.kind === 'plate' ? c.at + Math.min(c.dur * 0.55, Math.max(0.5, c.dur - 1.6)) : c.at + c.overlap + 0.05;
    select({ type: 'clip', id: c.id });
    renderFrame();
    paintHead();
    const scroll = $('etlScroll');
    if (scroll) scroll.scrollLeft = Math.max(0, c.at * ed.pps - 40);
    return true;
  }

  const openPlate = (plateId) => openClip((c) => c.plateId === plateId);
  const selectLive = (scene) => openClip((c) => c.id === scene?.id) || openClip((c) => c.kind === 'live');

  function setScale(v) {
    ed.zoomScale = clamp(v, 1, 24);
    const input = $('etlScale');
    if (input) input.value = String(Math.log2(ed.zoomScale));
    renderTimeline();
  }

  // ─── Wiring ──────────────────────────────────────────────────────────────────────────────
  function wire() {
    const v = video();
    if (v) {
      v.muted = true;
      v.addEventListener('seeked', () => {
        if (!ed.active) return;
        const next = planAfterSeeked({
          currentTime: v.currentTime || 0,
          wantRec: ed.wantRec,
          playing: ed.playing,
        });
        if (next.action === 'seek') {
          try {
            if (typeof v.fastSeek === 'function') v.fastSeek(next.wantRec);
            else v.currentTime = next.wantRec;
          } catch {
            /* ignore */
          }
          return;
        }
        if (next.action === 'paint') renderFrame();
      });
      v.addEventListener('loadeddata', () => ed.active && renderFrame());
    }
    $('edPlay')?.addEventListener('click', toggle);
    $('edToStart')?.addEventListener('click', () => {
      if (ed.playing) pause();
      seek(0);
      if ($('etlScroll')) $('etlScroll').scrollLeft = 0;
    });
    $('edReplay')?.addEventListener('click', replayClip);
    $('edLoop')?.addEventListener('click', () => {
      ed.loop = !ed.loop;
      ed.loopClip = ed.loop && ed.playing ? curClip() : null;
      paintTransport();
      flashHint(ed.loop ? 'Looping this clip' : 'Loop off');
    });
    $('edSound')?.addEventListener('click', () => {
      ed.sound = !ed.sound;
      preview.setEnabled(ed.sound);
      if (ed.sound && ed.playing) preview.play(previewState(), ed.t);
      else if (!ed.sound) preview.pause();
      paintTransport();
      flashHint(ed.sound ? 'Sound on' : 'Sound off');
    });
    $('etlMix')?.addEventListener('click', () => select({ type: 'mix' }));
    $('edFx')?.addEventListener('click', () => {
      ed.fx = !ed.fx;
      paintTransport();
      renderFrame();
      flashHint(ed.fx ? 'Showing zoom and transitions' : 'Showing the plain recording');
    });
    $('edEditText')?.addEventListener('click', () => (ed.textMode ? exitText() : enterText(ed.plateField?.path || null)));
    $('edFullscreen')?.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await $('stage').requestFullscreen();
      } catch {
        /* unsupported */
      }
    });
    // The Accent button must not steal focus from the plate, or the selection it acts on is gone.
    $('edTextBar')?.addEventListener('mousedown', (e) => {
      if (e.target.closest('[data-text="accent"]')) e.preventDefault();
    });
    wireTextBarChrome();
    window.addEventListener('plate-selection', (e) => syncPlateField(e.detail));
    window.addEventListener('plate-canvas-edit', (e) => {
      const path = e.detail?.path;
      if (path) enterTextFor(path);
      else enterText();
    });
    window.addEventListener('plate-canvas-done', () => {
      if (ed.textMode) exitText();
    });
    $('edTextBar')?.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-text]');
      if (!b) return;
      if (b.dataset.text === 'dismiss') {
        setCoachHidden(true);
        paintTextMode();
        return;
      }
      if (b.dataset.text === 'edit-card') {
        const hit = liveHitAtPlayhead();
        const cardId =
          ed.liveCardId ||
          hit?.card?.id ||
          (ed.sel?.type === 'card' ? ed.sel.cardId : null) ||
          null;
        const markT = ed.sel?.type === 'card' ? ed.sel.markT : hit?.mark?.t;
        const markKey = ed.sel?.type === 'card' ? ed.sel.key : hit?.mark?.key || null;
        await enterLiveCard(cardId, markT, markKey);
        return;
      }
      if (b.dataset.text === 'accent') {
        P.accent?.();
        return;
      }
      if (b.dataset.text === 'save') await P.save();
      else if (b.dataset.text === 'discard') await P.discard();
      if (b.dataset.text !== 'done' && b.dataset.text !== 'save' && b.dataset.text !== 'discard') return;
      if (ed.textMode) exitText();
      else paintTextMode();
    });
    $('edStatus')?.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="mix"]')) {
        ctx.requestAudio?.();
        return;
      }
      if (!e.target.closest('[data-act="render"]')) return;
      ed.dirtyRender = false;
      ctx.requestMake?.('quick');
    });
    $('etlAddSpeed')?.addEventListener('click', toolSpeed);
    $('etlAddCut')?.addEventListener('click', toolCut);
    $('etlAddZoom')?.addEventListener('click', toolZoom);
    $('etlAddLens')?.addEventListener('click', toolLens);
    $('etlAddVoice')?.addEventListener('click', toolVoice);
    $('etlUndo')?.addEventListener('click', undo);
    $('etlRedo')?.addEventListener('click', redo);
    $('etlFit')?.addEventListener('click', () => setScale(1));
    $('etlScale')?.addEventListener('input', (e) => setScale(2 ** Number(e.target.value)));
    $('etlContext')?.addEventListener('click', (e) => {
      const s = ed.sel;
      const b = e.target.closest('button');
      if (!b || s?.type !== 'range') return;
      if (b.dataset.rangeRate) addRamp(s.from, s.to, Number(b.dataset.rangeRate));
      else if (b.dataset.rangeZoom != null) addZoomAt(s.from, s.to - s.from);
      else if (b.dataset.rangeLens != null) addLensAt(s.from, s.to - s.from);
      else if (b.dataset.rangeCut != null) addCut(s.from, s.to);
      else if (b.dataset.rangeSkip != null)
        postDeck({ zoomSkips: [...deckEdit().zoomSkips, { from: s.from, to: s.to }] }, { hint: 'No auto zoom in that stretch' }).then((r) => r && select(null));
      else if (b.dataset.rangeClear != null) select(null);
    });
    wireTimeline();
    wireZoomBox();
    wireLensBox();
    const obs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => ed.active && renderTimeline()) : null;
    if (obs && $('etlScroll')) obs.observe($('etlScroll'));

    window.addEventListener(
      'keydown',
      (e) => {
        if (!ed.active || state.monitorMode !== 'plate') return;
        const tag = e.target?.tagName || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
        if (document.querySelector('dialog[open]')) return;
        const mod = e.metaKey || e.ctrlKey;
        const k = e.key.toLowerCase();
        let handled = true;
        if (mod && k === 'z') (e.shiftKey ? redo : undo)();
        else if (mod && k === 'y') redo();
        else if (mod) handled = false;
        else if (e.code === 'Space') toggle();
        else if (k === 'r') replayClip();
        else if (k === 's') toolSpeed();
        else if (k === 'c') toolCut();
        else if (k === 'z') toolZoom();
        else if (k === 'm') toolLens();
        else if (k === 'l') $('edLoop')?.click();
        else if (k === 'home') seek(0);
        else if (k === 'end') seek(ed.total);
        else if (k === 'arrowleft' || k === 'arrowright') {
          if (ed.playing) pause();
          seek(ed.t + (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30), { follow: true });
        } else if (k === 'backspace' || k === 'delete') removeSelected();
        else if (k === 'escape') {
          if (ed.textMode) exitText();
          else select(null);
        } else handled = false;
        if (handled) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true
    );
  }

  wire();

  return {
    refresh,
    resetForProject,
    onEnter,
    onLeave,
    openPlate,
    selectLive,
    reloadPlate,
    invalidatePlates,
    paintLookVars,
    renderClips: () => ed.active && renderTimeline(),
    renderInspector,
    onPlateDirty: () => paintTextMode(),
    get active() {
      return ed.active;
    },
    get deck() {
      return ed.deck;
    },
    get selection() {
      return ed.sel;
    },
    markDirty() {
      ed.dirtyRender = true;
      paintStatus();
    },
  };
}

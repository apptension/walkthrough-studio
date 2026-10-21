import { paintAgentStream } from './agentStream.js';
import { ask, noteToast } from './ask.js';
import { getMarkMode, initFavicon, setFaviconMode } from './favicon.js';
import { initHelp } from './help.js';
import { initBranch } from './branch.js';
import { initProjects } from './projects.js';
import { initSelects } from './selects.js';
import { describeJob } from './progress.js';
import { initWorkflow } from './workflow.js';
import { initEditor } from './editor.js';
import { mountZen, zen } from './zen.js';
import { accentState, fieldSource, fromElement, parseSource, positionAt, toHtml, toggleAccent } from './copyEdit.js';
import { needsProgramRestore, normalizeMonitorMode } from './monitorMode.js';
import { criticFindingMarkup, directorNoteForFinding } from './criticFindings.js';
import { firstShortHold } from './voiceHold.js';
import { capturedTour, recordFailureAction, recordFailureNote } from './recordFailure.js';

const $ = (id) => document.getElementById(id);
let workflow = null;
let editor = null;
const state = {
  slug: null,
  video: null,
  cues: [],
  chapters: [],
  duration: 0,
  ytText: '',
  scrubbing: false,
  lastChapter: null,
  chapterTimer: null,
  poll: null,
  elapsedTimer: null,
  jobId: null,
  job: null,
  activityExpanded: false,
  activityDismissed: false,
  compare: false,
  pipeline: null,
  motionApplied: false,
  platesPreviewed: false,
  previewingPlate: null,
  monitorMode: 'program', // program | plate | compare
  htmlPlates: [],
  activePlateId: null,
  proposalOpen: false,
  scenes: [],
  currentScene: null,
  editingPlateId: null,
  plateDirty: false,
  plateEditBound: false,
  plateReplayTimer: null,
  action: null,
  queue: [],
  jobBusy: false, // exclusive: one kit/agent job at a time
  renderLogExpanded: false,
  pipelineStartedAt: null,
  activeSurface: null, // 'render' | 'session'
  workAbort: null, // AbortController for the active watchJob
  stopRequested: false,
};

const PLATE_EDIT_CSS = `
/*
  Composed static edit mode.
  Seeking mid-timeline freezes rise/mask/wipe/trace mid-reveal → sliced glyphs & half-drawn logos.
  Here we disable every reveal mechanism and force the finished visual state.
*/
body.studio-edit .black { display: none !important; }
body.studio-edit .grain { opacity: 0.22 !important; animation: none !important; }
body.studio-edit .sweep { display: none !important; } /* decorative pass — not needed to edit */

/* Kill motion on all nodes; we paint the final composed frame via CSS below */
body.studio-edit *,
body.studio-edit *::before,
body.studio-edit *::after {
  animation: none !important;
  animation-play-state: paused !important;
  transition: none !important;
}

/* —— Reveal masks / rises / wipes → fully open —— */
body.studio-edit .mask,
body.studio-edit .mask.word,
body.studio-edit .title-line,
body.studio-edit .line-exit,
body.studio-edit .copy-exit,
body.studio-edit .title-exit,
body.studio-edit .steps-exit,
body.studio-edit .lockup-exit,
body.studio-edit .compose,
body.studio-edit .flood,
body.studio-edit .head {
  overflow: visible !important;
  clip-path: none !important;
  -webkit-mask-image: none !important;
  mask-image: none !important;
  opacity: 1 !important;
  filter: none !important;
  transform: none !important;
  translate: none !important;
}
body.studio-edit .rise,
body.studio-edit .word,
body.studio-edit .letter,
body.studio-edit .wipe-l,
body.studio-edit .wipe-r,
body.studio-edit .logo-img,
body.studio-edit .title,
body.studio-edit [data-edit] {
  overflow: visible !important;
  clip-path: none !important;
  -webkit-clip-path: none !important;
  opacity: 1 !important;
  filter: none !important;
  transform: none !important;
  translate: none !important;
  visibility: visible !important;
  will-change: auto !important;
}

/* Scale / grow entrances that start at 0 without an animation */
body.studio-edit .dot { transform: scale(1) !important; opacity: 1 !important; }
body.studio-edit .track,
body.studio-edit .track-fill { transform: scaleX(1) !important; opacity: 1 !important; }
body.studio-edit .step-label,
body.studio-edit .step-note,
body.studio-edit .platform { opacity: 1 !important; transform: none !important; filter: none !important; }

/* Keep title lines on one row so a narrow preview can't wrap accent words into the steps */
body.studio-edit .title .mask,
body.studio-edit .title .rise,
body.studio-edit .title .mask.word {
  white-space: nowrap !important;
}

/* Logo draw / trace: finish every stroke + fill (no mid-draw fragments) */
body.studio-edit .draw,
body.studio-edit .trace,
body.studio-edit .logo path,
body.studio-edit .logo .piece,
body.studio-edit .logo .trace,
body.studio-edit .logo .draw,
body.studio-edit svg .draw,
body.studio-edit svg .trace {
  stroke-dashoffset: 0 !important;
  stroke-dasharray: 1 !important;
  fill-opacity: 1 !important;
  stroke-opacity: 0 !important;
  opacity: 1 !important;
  filter: none !important;
  transform: none !important;
  translate: none !important;
  clip-path: none !important;
}

/* Open plate: keep the post-lift lockup so title isn't buried under the hero logo */
body.studio-edit .open-plate .lockup,
body.studio-edit body[data-plate="open"] .lockup,
body.studio-edit .lockup {
  /* default close/features: identity; open overrides via --open-lift-* when set */
  transform: translateY(var(--open-lift-y, 0)) scale(var(--open-lift-scale, 1)) !important;
  opacity: 1 !important;
  filter: none !important;
}
/* Close / interstitial lockups should sit naturally (no open-lift vars) */
body.studio-edit .lockup-exit .lockup {
  transform: none !important;
}

/* Content chrome fully visible */
body.studio-edit .eyebrow, body.studio-edit .title, body.studio-edit .sub,
body.studio-edit .body, body.studio-edit .card, body.studio-edit .stat,
body.studio-edit .j-step, body.studio-edit .j-body, body.studio-edit .step,
body.studio-edit .bullet, body.studio-edit .platform,
body.studio-edit .title-line, body.studio-edit .label,
body.studio-edit .note, body.studio-edit .quote, body.studio-edit .author,
body.studio-edit .role, body.studio-edit .value, body.studio-edit .step-label,
body.studio-edit .step-note, body.studio-edit .j-label, body.studio-edit .j-note,
body.studio-edit .dot, body.studio-edit .mark, body.studio-edit .stars,
body.studio-edit .star, body.studio-edit .meta, body.studio-edit .num,
body.studio-edit .badge, body.studio-edit .t-card, body.studio-edit .logo {
  opacity: 1 !important;
  filter: none !important;
  visibility: visible !important;
}

/*
  Live chapter / caption overlays (overlays.css): many nodes default to opacity:0 / scale(0)
  and only appear via CSS animation. Cancelling animations for edit left .content at 0 →
  blank white/transparent stage with no copy. Finish the readable hold state here.
*/
/*
  Live chapter / caption overlays (overlays.css). Nodes start at opacity 0 and only appear
  via animation; cancelling that for edit used to leave a blank card. Finish the held frame
  the render shows: blurred blobs, the ghost number on its centered seat, drift at its rest.
*/
body.studio-edit .wt-ch .dim,
body.studio-edit .wt-ch .lift,
body.studio-edit .wt-ch .content,
body.studio-edit .wt-ch .line,
body.studio-edit .wt-ch .title > span,
body.studio-edit .wt-ch .title > span > span,
body.studio-edit .wt-cap .seat,
body.studio-edit .wt-cap .txt,
body.studio-edit .wt-cap .title > span,
body.studio-edit .wt-cap .rail {
  opacity: 1 !important;
  visibility: visible !important;
}
body.studio-edit .wt-ch .blob {
  opacity: 1 !important;
  visibility: visible !important;
}
body.studio-edit .wt-ch .blob.warm {
  transform: translate(70px, -36px) scale(1.08) !important;
}
body.studio-edit .wt-ch .blob.cool {
  transform: translate(-60px, 28px) scale(1.06) !important;
}
body.studio-edit .wt-ch .bloom {
  opacity: 1 !important;
  visibility: visible !important;
  transform: scale(1) !important;
}
body.studio-edit .wt-ch .ghost {
  opacity: 1 !important;
  visibility: visible !important;
  transform: translate(-50%, -54%) scale(1) !important;
}
body.studio-edit .wt-ch .wave-field,
body.studio-edit .wt-ch .wave-haze,
body.studio-edit .wt-cap .wave-field {
  opacity: 1 !important;
  visibility: visible !important;
  transform: translate(2%, -2%) scale(1.08) !important;
}
body.studio-edit .wt-cap .card {
  opacity: 1 !important;
  visibility: visible !important;
  transform: translateY(0) scale(1) !important;
}
body.studio-edit .wt-ch .rail-top,
body.studio-edit .wt-ch .line,
body.studio-edit .wt-cap .timer {
  opacity: 1 !important;
  visibility: visible !important;
  transform: scaleX(1) !important;
}
body.studio-edit .wt-cap .num {
  transform: scale(1) !important;
  opacity: 1 !important;
}
body.studio-edit .wt-ch .eyebrow::before,
body.studio-edit .wt-ch .eyebrow::after {
  opacity: 0.65 !important;
  transform: scaleX(1) !important;
}
/* Chapter dim is the ink field the render holds after the fade-in. */
body.studio-edit .wt-ch .dim {
  opacity: 1 !important;
}

/*
  Fields keep the plate's own type: gradient accents, weights, colours. Only the caret and the
  selection get a Studio colour so they read on background-clipped text.
*/
body.studio-edit [data-edit] { caret-color: var(--gold, #c8f54c) !important; }
body.studio-edit [data-edit]::selection,
body.studio-edit [data-edit] *::selection { background: rgba(66, 242, 114, 0.35); }
/* Open sub: beats render as one inline run (the flex gap would swallow the spaces). */
body.studio-edit .sub[data-edit] { display: block !important; text-align: center !important; }
body.studio-edit .sub[data-edit] .sep { opacity: 1 !important; animation: none !important; }
/* Count-up numbers sit on their final value while editing. */
body.studio-edit [data-count] { visibility: visible !important; }

/* Carousel / cascade: every quote visible */
body.studio-edit .flood[data-mode="carousel"],
body.studio-edit .flood[data-mode="cascade"] {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  grid-auto-rows: minmax(0, auto) !important;
  gap: 14px !important;
  align-content: center !important;
  overflow: auto !important;
  max-height: 100% !important;
}
body.studio-edit .flood[data-mode="carousel"] .t-slot,
body.studio-edit .flood[data-mode="cascade"] .t-slot {
  position: relative !important;
  grid-column: auto !important;
  grid-row: auto !important;
  width: 100% !important;
  height: auto !important;
  max-height: none !important;
  z-index: 1 !important;
  opacity: 1 !important;
  transform: none !important;
  filter: none !important;
  animation: none !important;
  clip-path: none !important;
}
body.studio-edit .flood[data-mode="carousel"] .t-card,
body.studio-edit .flood[data-mode="cascade"] .t-card {
  max-height: none !important;
  overflow: visible !important;
}

body.studio-edit [data-edit] {
  outline: 1.5px dashed rgba(66, 242, 114, 0.5);
  outline-offset: 4px;
  cursor: text;
  border-radius: 4px;
  min-width: 0.5ch;
  position: relative;
  z-index: 5;
}
body.studio-edit [data-edit]:hover {
  outline-color: rgba(66, 242, 114, 0.9);
  background: rgba(66, 242, 114, 0.1);
}
body.studio-edit [data-edit]:focus,
body.studio-edit [data-edit].is-focused {
  outline: 2px solid #42f272;
  outline-offset: 3px;
  background: rgba(66, 242, 114, 0.14);
}
body.studio-edit [data-edit].is-focused::before {
  content: attr(data-edit);
  position: absolute;
  top: -17px;
  left: 0;
  z-index: 30;
  padding: 2px 6px;
  border-radius: 4px;
  font: 600 10px/1.2 ui-sans-serif, system-ui, sans-serif;
  letter-spacing: 0.02em;
  color: #0a0a0a;
  background: #42f272 linear-gradient(90deg, #fffe25 0%, #c6f24a 34%, #42f272 72%) left center / calc(100% + 2px) 100% no-repeat;
  white-space: nowrap;
  pointer-events: none;
  text-transform: none;
}
/* The ghost number is a positioned layer behind the title. data-edit's relative seat would
   pull it into the column, and overlays.css turns clicks off. Keep the seat, take clicks
   on the part of the digits the title doesn't cover. */
body.studio-edit .wt-ch .ghost[data-edit] {
  position: absolute !important;
  z-index: 1;
  pointer-events: auto !important;
  user-select: text;
}
`;

/** Motion-mode affordance: every editable field looks clickable without freezing the plate. */
const PLATE_PEEK_CSS = `
body[data-motion="1"] [data-edit] {
  cursor: text;
  outline: 1.5px dashed transparent;
  outline-offset: 4px;
  border-radius: 4px;
  transition: outline-color .12s ease, background .12s ease;
  position: relative;
  z-index: 4;
}
body[data-motion="1"] [data-edit]:hover {
  outline-color: rgba(66, 242, 114, 0.75);
  background: rgba(66, 242, 114, 0.1);
}
body[data-motion="1"] [data-edit]:hover::after {
  content: 'Edit';
  position: absolute;
  top: -16px;
  left: 0;
  z-index: 30;
  padding: 2px 6px;
  border-radius: 4px;
  font: 600 10px/1.2 ui-sans-serif, system-ui, sans-serif;
  color: #0a0a0a;
  background: #42f272 linear-gradient(90deg, #fffe25 0%, #c6f24a 34%, #42f272 72%) left center / calc(100% + 2px) 100% no-repeat;
  pointer-events: none;
  white-space: nowrap;
}
body[data-motion="1"] .wt-ch .ghost[data-edit] {
  position: absolute;
  z-index: 1;
  pointer-events: auto;
}
`;

/** Parse a CSS time custom property (e.g. `--black-out: 5.7s`) from the plate document. */
function plateCssSec(doc, name) {
  const el = doc.documentElement;
  const raw =
    getComputedStyle(el).getPropertyValue(name).trim() ||
    getComputedStyle(doc.body).getPropertyValue(name).trim() ||
    getComputedStyle(doc.querySelector('.stage') || el).getPropertyValue(name).trim();
  if (!raw) return null;
  const m = String(raw).trim().match(/^(-?[\d.]+)(m?s)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2].toLowerCase() === 'ms' ? n / 1000 : n;
}

/**
 * Peak composition time: fully entered, just before the first fade-out / exit / black-out.
 * Prefers explicit --hold-from/--hold-until when set; otherwise earliest exit − slack.
 */
function plateEditPeakSec(doc) {
  const dur = Number(doc.body.dataset.duration) || plateCssSec(doc, '--dur') || 6;
  const blackOut = plateCssSec(doc, '--black-out') ?? Math.max(0.5, dur - 0.7);
  const holdFrom = plateCssSec(doc, '--hold-from');
  const holdUntil = plateCssSec(doc, '--hold-until');

  const exitCandidates = [
    plateCssSec(doc, '--x-compose'),
    plateCssSec(doc, '--x-copy'),
    plateCssSec(doc, '--x-title'),
    plateCssSec(doc, '--x-steps'),
    plateCssSec(doc, '--x-logo'),
    plateCssSec(doc, '--x-card'),
    blackOut,
  ].filter((n) => Number.isFinite(n) && n > 0.2);

  // Scan running animations for exit/fadeOut delays (templates sometimes hardcode them)
  const EXIT_RE = /fadeOut|exit|carOut|copyLineOut|blackOut|dissolve|exitUp|exitScale/i;
  try {
    for (const a of doc.getAnimations?.() || []) {
      const name = a.animationName || '';
      if (!EXIT_RE.test(name)) continue;
      const timing = a.effect?.getTiming?.() || {};
      const delay = typeof timing.delay === 'number' ? timing.delay / 1000 : 0;
      if (delay > 0.2) exitCandidates.push(delay);
    }
  } catch {
    /* ignore */
  }

  const earliestExit = exitCandidates.length ? Math.min(...exitCandidates) : blackOut;
  let peak;
  if (
    Number.isFinite(holdFrom) &&
    Number.isFinite(holdUntil) &&
    holdUntil > holdFrom + 0.12 &&
    !(holdFrom === 0 && holdUntil === 0)
  ) {
    // Mid-hold, but never past the first exit
    peak = Math.min((holdFrom + holdUntil) / 2, earliestExit - 0.12);
  } else {
    // Just before fade-out — entrances on most plates finish by ~1.6–2.2s
    peak = Math.max(1.85, earliestExit - 0.16);
  }
  // Stay inside the plate, before black-out starts eating the frame
  peak = Math.min(peak, blackOut - 0.1, dur - 0.25);
  return Math.max(0.8, peak);
}

/** Seek every CSS animation to the peak composition frame and pause. */
function freezePlateAtPeak(doc, peakSec) {
  const ms = peakSec * 1000;
  const anims = typeof doc.getAnimations === 'function' ? doc.getAnimations() : [];
  for (const a of anims) {
    try {
      const timing = a.effect?.getComputedTiming?.();
      const end = timing ? timing.endTime : null;
      // Entrance anims: park at their finished state if the peak is past them
      if (Number.isFinite(end) && end > 0 && ms >= end) {
        a.currentTime = Math.max(0, end - 1);
      } else {
        a.currentTime = Math.min(ms, Number.isFinite(end) && end > 0 ? end - 1 : ms);
      }
      a.pause();
    } catch {
      try {
        a.currentTime = ms;
        a.pause();
      } catch {
        /* ignore */
      }
    }
  }
  return anims.length;
}

const REVEAL_STYLE_PROPS = [
  'overflow',
  'clip-path',
  '-webkit-clip-path',
  'opacity',
  'filter',
  'transform',
  'translate',
  'visibility',
  'will-change',
  'stroke-dashoffset',
  'stroke-dasharray',
  'fill-opacity',
  'stroke-opacity',
  'mask-image',
  '-webkit-mask-image',
];

function forceStyle(el, styles) {
  if (!el?.style) return;
  el.dataset.studioReveal = '1';
  for (const [prop, value] of Object.entries(styles)) {
    el.style.setProperty(prop, value, 'important');
  }
}

function forceAll(doc, selector, styles) {
  doc.querySelectorAll(selector).forEach((el) => forceStyle(el, styles));
}

/**
 * Composed static edit frame.
 * Timeline seek alone freezes mask/rise/wipe/trace mid-reveal (sliced glyphs, half-drawn logos).
 * Cancelling animations snaps SVG draws back to empty base styles. Inline !important finishes
 * every reveal so the editor always shows the readable end state.
 */
function composePlateForEdit(doc) {
  if (!doc?.body) return;

  // 1) Kill running animations so they cannot keep writing mid-keyframe values
  for (const a of doc.getAnimations?.() || []) {
    try {
      a.cancel();
    } catch {
      /* ignore */
    }
  }

  // 2) Open every clip / overflow gate
  forceAll(
    doc,
    '.mask, .mask.word, .title-line, .line-exit, .copy-exit, .title-exit, .steps-exit, .lockup-exit, .compose, .flood, .head, .title, [data-edit]',
    {
      overflow: 'visible',
      'clip-path': 'none',
      '-webkit-clip-path': 'none',
      'mask-image': 'none',
      '-webkit-mask-image': 'none',
      opacity: '1',
      filter: 'none',
      visibility: 'visible',
      'will-change': 'auto',
    }
  );

  // 3) Finish rises / wipes / letters / image logos
  forceAll(doc, '.rise, .word, .letter, .wipe-l, .wipe-r, .logo-img', {
    overflow: 'visible',
    'clip-path': 'none',
    '-webkit-clip-path': 'none',
    opacity: '1',
    filter: 'none',
    transform: 'none',
    translate: 'none',
    visibility: 'visible',
    'will-change': 'auto',
  });

  // 4) Finish SVG draw / trace builds
  forceAll(doc, '.draw, .trace, .logo path, .logo .piece, svg .draw, svg .trace', {
    'stroke-dashoffset': '0',
    'stroke-dasharray': '1',
    'fill-opacity': '1',
    'stroke-opacity': '0',
    opacity: '1',
    filter: 'none',
    transform: 'none',
    translate: 'none',
    'clip-path': 'none',
  });

  // 5) Scale / grow entrances that default to 0
  forceAll(doc, '.dot', { transform: 'scale(1)', opacity: '1' });
  forceAll(doc, '.track, .track-fill', { transform: 'scaleX(1)', opacity: '1' });
  forceAll(doc, '.step-label, .step-note, .platform, .eyebrow, .sub, .body, .card, .stat, .t-card, .badge', {
    opacity: '1',
    filter: 'none',
    transform: 'none',
    visibility: 'visible',
  });

  // 6) Live chapter / caption overlays — parent .content/.card default opacity:0
  const isOverlay = String(doc.body.dataset.cardId || state.activePlateId || '').startsWith('overlay:');
  if (isOverlay || doc.querySelector('.wt-ch, .wt-cap')) {
    // Freeze the held frame. filter/transform:none here used to sharpen the blobs
    // (stylesheet blur is 100px) and drop the ghost number off its centered seat.
    // Drift and bloom land on the keyframe they hold after the intro (templates/overlays.css).
    forceAll(doc, '.wt-ch .lift, .wt-ch .content, .wt-cap .seat, .wt-cap .txt, .wt-cap .title > span', {
      opacity: '1',
      visibility: 'visible',
    });
    forceAll(doc, '.wt-ch .blob.warm', {
      opacity: '1',
      visibility: 'visible',
      transform: 'translate(70px, -36px) scale(1.08)',
    });
    forceAll(doc, '.wt-ch .blob.cool', {
      opacity: '1',
      visibility: 'visible',
      transform: 'translate(-60px, 28px) scale(1.06)',
    });
    forceAll(doc, '.wt-ch .bloom', { opacity: '1', visibility: 'visible', transform: 'scale(1)' });
    forceAll(doc, '.wt-ch .ghost', {
      opacity: '1',
      visibility: 'visible',
      transform: 'translate(-50%, -54%) scale(1)',
    });
    forceAll(doc, '.wt-ch .wave-field, .wt-ch .wave-haze, .wt-cap .wave-field', {
      opacity: '1',
      visibility: 'visible',
      transform: 'translate(2%, -2%) scale(1.08)',
    });
    forceAll(doc, '.wt-cap .card', {
      opacity: '1',
      visibility: 'visible',
      transform: 'translateY(0) scale(1)',
    });
    forceAll(doc, '.wt-ch .dim', { opacity: '1', visibility: 'visible' });
    // Eyebrow ticks are pseudos, so the inline pass can't reach them. Held pose is wtRuleIn's end.
    let held = doc.getElementById('studio-overlay-held');
    if (!held) {
      held = doc.createElement('style');
      held.id = 'studio-overlay-held';
      doc.head.appendChild(held);
    }
    held.textContent =
      '.wt-ch .eyebrow::before,.wt-ch .eyebrow::after{opacity:.65!important;transform:scaleX(1)!important}';
    forceAll(doc, '.wt-ch .line, .wt-ch .rail-top, .wt-cap .timer', {
      opacity: '1',
      transform: 'scaleX(1)',
      visibility: 'visible',
    });
    forceAll(doc, '.wt-cap .num', { opacity: '1', transform: 'scale(1)', visibility: 'visible' });
    forceAll(doc, '.wt-ch .title > span > span, .wt-ch .title > span', {
      opacity: '1',
      transform: 'none',
      filter: 'none',
      visibility: 'visible',
    });
  }

  // 7) Open-plate lockup: keep post-lift seat when vars exist; otherwise identity
  const root = doc.documentElement;
  const liftY = getComputedStyle(root).getPropertyValue('--open-lift-y').trim();
  const liftS = getComputedStyle(root).getPropertyValue('--open-lift-scale').trim();
  doc.querySelectorAll('.lockup').forEach((el) => {
    if (liftY || liftS) {
      forceStyle(el, {
        transform: `translateY(${liftY || '0'}) scale(${liftS || '1'})`,
        opacity: '1',
        filter: 'none',
      });
    } else {
      forceStyle(el, { transform: 'none', opacity: '1', filter: 'none' });
    }
  });
}

/** Clear inline reveal overrides (replay / leave edit). */
function clearPlateRevealOverrides(doc) {
  if (!doc) return;
  doc.getElementById('studio-overlay-held')?.remove();
  doc.querySelectorAll('[data-studio-reveal]').forEach((el) => {
    for (const prop of REVEAL_STYLE_PROPS) {
      el.style.removeProperty(prop);
    }
    delete el.dataset.studioReveal;
  });
}

/** @deprecated alias — keep older refs working */
Object.defineProperty(state, 'renderBusy', {
  get() {
    return this.jobBusy;
  },
  set(v) {
    this.jobBusy = v;
  },
});

const PIPE_ICONS = {
  record: `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>`,
  plates: `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z"/></svg>`,
  produce: `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M4 6h16v12H4V6zm2 2v8h12V8H6z"/></svg>`,
  audio: `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>`,
  deliver: `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg>`,
  preview: `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>`,
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function qsSlug() {
  return new URLSearchParams(location.search).get('slug');
}

function setSlug(slug) {
  state.slug = slug;
  const u = new URL(location.href);
  u.searchParams.set('slug', slug);
  history.replaceState(null, '', u);
}

function fmt(sec) {
  if (!Number.isFinite(sec)) return '00:00:00';
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function fmtShort(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const ICONS = {
  play: `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>`,
  compare: `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M10 3H3v18h7V3zm2 0v18h7V3h-7zM8 7v2H5V7h3zm0 4v2H5v-2h3zm0 4v2H5v-2h3zm11-8v2h-3V7h3zm0 4v2h-3v-2h3zm0 4v2h-3v-2h3z"/></svg>`,
  restore: `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>`,
  preview: `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>`,
};

function iconBtn(act, verId, label) {
  return `<button type="button" class="btn icon-only" data-ver="${verId}" data-act="${act}" title="${label}" aria-label="${label}">${ICONS[act] || ''}</button>`;
}

function toast(title, detail = '', kind = 'ok') {
  noteToast();
  const el = document.createElement('div');
  el.className = `toast ${kind === 'err' ? 'err' : kind === 'warn' ? 'warn' : ''}`;
  el.innerHTML = `<i class="dot"></i><div><b>${escapeHtml(title)}</b>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</div>`;
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  }, 3200);
}

let booting = true;
let busyGen = 0;

function setBootStatus(text) {
  const el = $('bootStatus');
  if (el && text) el.textContent = text;
}

function dismissBoot() {
  booting = false;
  const el = $('bootLoader');
  if (!el) return;
  el.classList.add('is-leaving');
  el.setAttribute('aria-busy', 'false');
  setTimeout(() => el.remove(), 520);
}

/** Option label without custom-select chrome that can leak into textContent. */
function labelFor(opt) {
  if (!opt) return '';
  const attr = (opt.getAttribute?.('label') || '').trim();
  if (attr) return attr;
  if (typeof opt.label === 'string' && opt.label.trim() && opt.label !== opt.value) return opt.label.trim();
  const clone = opt.cloneNode(true);
  clone.querySelectorAll?.('*').forEach((n) => n.remove());
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

function sequenceName(slug) {
  const sel = $('slugSelect');
  const opt = sel && [...sel.options].find((o) => o.value === slug);
  return labelFor(opt) || slug || '';
}

/** Full-screen while the app boots. After that, a workspace veil once a load is actually noticeable. */
function setBusy(on, label = 'Opening sequence', detail = '') {
  if (booting) {
    if (on) setBootStatus(detail || label);
    return;
  }
  const el = $('busyOverlay');
  if (!el) return;
  const labelEl = $('busyLabel');
  const detailEl = $('busyDetail');
  if (labelEl && label) labelEl.textContent = label;
  if (detailEl) detailEl.textContent = detail || '';
  const gen = ++busyGen;
  if (on) {
    setTimeout(() => {
      if (gen !== busyGen) return;
      el.hidden = false;
    }, 160);
    return;
  }
  if (el.hidden) return;
  el.classList.add('is-leaving');
  setTimeout(() => {
    if (gen !== busyGen) return;
    el.hidden = true;
    el.classList.remove('is-leaving');
  }, 220);
}

function buttonBusy(btn, on) {
  if (!btn) return;
  btn.classList.toggle('busy', on);
  btn.disabled = !!on;
}

function activePlayer() {
  return state.compare ? $('playerA') : $('player');
}

/**
 * Start a program video from a click. A play() issued before the file can
 * play, or from the last frame, rejects and the button looks dead.
 */
function startPlayback(el) {
  if (!el) return;
  if (!el.currentSrc && !el.getAttribute('src')) {
    toast('Nothing to play', 'Render a sequence first', 'warn');
    return;
  }
  const atEnd = el.ended || (Number.isFinite(el.duration) && el.duration > 0 && el.currentTime >= el.duration - 0.05);
  if (atEnd) {
    try { el.currentTime = 0; } catch { /* metadata not in yet */ }
  }
  const go = () => {
    const pending = el.play();
    pending?.catch?.((err) => {
      if (err?.name === 'AbortError') return;
      el.addEventListener('canplay', () => el.play().catch(() => {}), { once: true });
    });
  };
  if (el.readyState >= 2) go();
  else el.addEventListener('canplay', go, { once: true });
}

function cueAt(t) {
  return state.cues.find((c) => t >= c.start && t < c.end) || null;
}

function chapterAt(t) {
  let cur = null;
  for (const c of state.chapters) if (c.start <= t + 0.05) cur = c;
  return cur;
}

function updateTransport() {
  const player = activePlayer();
  const t = player.currentTime || 0;
  const d = player.duration || state.duration || 0;
  state.duration = d;
  const clock = $('clock');
  if (clock) clock.innerHTML = `${fmtShort(t)} <span class="t-sep">/</span> ${fmtShort(d)}`;
  const pct = d > 0 ? (t / d) * 100 : 0;
  const head = $('timelinePlayhead');
  if (head) {
    head.style.left = `${pct}%`;
    head.classList.toggle('is-flip', pct > 82);
  }
  $('timelineFill').style.width = `${pct}%`;
  const playing = !player.paused && !player.ended;
  $('btnPlay').classList.toggle('is-playing', playing);

  if (player.buffered?.length) {
    try {
      const end = player.buffered.end(player.buffered.length - 1);
      $('timelineBuf').style.width = `${d > 0 ? (end / d) * 100 : 0}%`;
    } catch {
      /* ignore */
    }
  }

  const cue = cueAt(t);
  const overlay = $('captionOverlay');
  if ($('togCaptions').checked && cue && !state.compare) {
    if (overlay.textContent !== cue.text) overlay.textContent = cue.text;
    overlay.classList.add('on');
  } else overlay.classList.remove('on');

  const ch = chapterAt(t);
  document.querySelectorAll('#chapterStrip button').forEach((btn) => {
    btn.classList.toggle('active', ch && btn.dataset.start === String(ch.start));
  });
  if (ch && state.lastChapter !== ch.start) {
    state.lastChapter = ch.start;
    const toastEl = $('chapterToast');
    toastEl.textContent = ch.title || '';
    toastEl.classList.add('on');
    clearTimeout(state.chapterTimer);
    state.chapterTimer = setTimeout(() => toastEl.classList.remove('on'), 1400);
  }

  if (state.compare) {
    const b = $('playerB');
    if (Math.abs((b.currentTime || 0) - t) > 0.35) b.currentTime = t;
  }

  updateSceneFromTime(t);
}

function renderTimeline(chapters, duration) {
  const d = duration || state.duration || 1;
  const tlDur = $('tlDuration');
  if (tlDur) tlDur.textContent = d > 0 ? fmtShort(d) : '—';

  const ruler = $('timelineRuler');
  if (ruler) {
    ruler.innerHTML = '';
    const step = d > 180 ? 30 : d > 60 ? 10 : 5;
    for (let t = 0; t <= d; t += step) {
      const tick = document.createElement('div');
      tick.className = `tl-tick${t % (step * 2) === 0 ? ' major' : ''}`;
      tick.style.left = `${(t / d) * 100}%`;
      if (t % (step * 2) === 0 || step >= 30) {
        const lab = document.createElement('span');
        lab.textContent = fmtShort(t);
        tick.appendChild(lab);
      }
      ruler.appendChild(tick);
    }
  }

  const marks = $('timelineMarks');
  marks.innerHTML = '';
  for (const c of chapters || []) {
    const el = document.createElement('div');
    el.className = 'tl-mark';
    el.style.left = `${(c.start / d) * 100}%`;
    el.title = c.title || '';
    marks.appendChild(el);
  }
  const regions = $('timelineRegions');
  regions.innerHTML = '';
  const pts = [...(chapters || [])].sort((a, b) => a.start - b.start);
  const scenes = (state.scenes || []).filter((s) => s.dur > 0);
  if (scenes.length) {
    regions.classList.add('is-edit');
    for (const s of scenes) {
      const el = document.createElement('div');
      const isActivePlate =
        state.monitorMode === 'plate' && s.editable && s.plateId === state.activePlateId;
      const isActiveLive = state.monitorMode === 'plate' && !s.editable && editor?.selection?.kind === 'live' && editor.selection.scene?.id === s.id;
      el.className = `tl-region ${s.kind === 'plate' ? 'plate' : 'live'}${isActivePlate || isActiveLive ? ' is-active' : ''}${
        s.editable || s.kind === 'live' ? ' is-clickable' : ''
      }`;
      el.style.left = `${(s.start / d) * 100}%`;
      el.style.width = `${Math.max(0, (s.dur / d) * 100)}%`;
      el.title = s.editable
        ? `${s.title} · ${fmtShort(s.start)}–${fmtShort(s.end)} · click to edit this plate`
        : `${s.title} · ${fmtShort(s.start)}–${fmtShort(s.end)} · click to edit speed, zoom and transitions`;
      el.dataset.sceneId = s.id;
      if (s.plateId) el.dataset.plateId = s.plateId;
      regions.appendChild(el);
      if (s.transitionIn?.dur) {
        const x = document.createElement('div');
        x.className = `tl-xfade${s.transitionIn.card ? ' card' : ''}`;
        x.style.left = `${(s.start / d) * 100}%`;
        x.style.width = `${Math.max(0.25, (s.transitionIn.dur / d) * 100)}%`;
        x.title = `${s.transitionIn.type} ${s.transitionIn.dur.toFixed(2)}s → ${s.title}`;
        regions.appendChild(x);
      }
    }
  } else regions.classList.remove('is-edit');
  for (let i = 0; !scenes.length && i < pts.length; i++) {
    const start = pts[i].start;
    const end = i + 1 < pts.length ? pts[i + 1].start : d;
    const el = document.createElement('div');
    el.className = `tl-region ${i % 2 ? 'plate' : 'live'}`;
    el.style.width = `${Math.max(0, ((end - start) / d) * 100)}%`;
    regions.appendChild(el);
  }

  const chLane = $('timelineChapters');
  if (chLane) {
    chLane.innerHTML = pts
      .map((c, i) => {
        const end = i + 1 < pts.length ? pts[i + 1].start : d;
        const left = (c.start / d) * 100;
        const width = Math.max(0.8, ((end - c.start) / d) * 100);
        return `<div class="tl-ch-clip" style="left:${left}%;width:${width}%" title="${escapeHtml(c.title || '')}">${escapeHtml(c.title || '')}</div>`;
      })
      .join('');
  }

  const cueLane = $('timelineCues');
  if (cueLane) {
    cueLane.innerHTML = (state.cues || [])
      .map((c) => {
        const left = (c.start / d) * 100;
        const width = Math.max(0.4, ((Math.max(c.end, c.start + 0.4) - c.start) / d) * 100);
        return `<div class="tl-cue-clip" style="left:${left}%;width:${width}%" title="${escapeHtml(c.text || '')}"></div>`;
      })
      .join('');
  }

  $('chapterStrip').innerHTML = (chapters || [])
    .map(
      (c) =>
        `<button type="button" data-start="${c.start}" title="${escapeHtml(c.title || '')}"><span class="t">${fmtShort(
          c.start
        )}</span><span class="ch-title">${escapeHtml(c.title || 'Chapter')}</span></button>`
    )
    .join('');
}

function setStatus(kind, text) {
  $('statusLine').dataset.kind = kind;
  $('statusText').textContent = text;
}

function decideAction(v) {
  const f = v.freshness || {};
  const hasLive = Boolean(f.liveAt);
  const hasDelivery = Boolean(v.hasDelivery || f.deliveryAt);
  const plateBad = Boolean(f.plateHealth?.bad);

  if (v.recordFailure) {
    const retry = recordFailureAction();
    return {
      kind: 'warn',
      status: 'Record failed',
      title: v.recordFailure.reason,
      reason: v.recordFailure.next,
      detail: v.recordFailure.url,
      primary: { label: retry.label, mode: retry.mode },
      secondary: null,
      makeLabel: retry.label,
    };
  }

  if (!hasLive && !hasDelivery) {
    return {
      kind: 'warn',
      status: 'Not rendered',
      title: 'Render your first sequence',
      reason: 'Records the app, cuts it with the plates, adds voice and music, and exports, in one pass.',
      primary: { label: 'Render', mode: 'full' },
      secondary: null,
      makeLabel: 'Render',
    };
  }
  if (f.needsRecord) {
    return {
      kind: 'warn',
      status: 'Needs re-record',
      title: 'Re-record the app',
      reason: 'The flow changed since the last recording, so the footage no longer matches the script.',
      detail: f.reason,
      primary: { label: 'Re-record & Render', mode: 'full' },
      secondary: { label: 'Render without re-record', mode: 'quick' },
      makeLabel: 'Re-record',
    };
  }
  if (plateBad) {
    return {
      kind: 'warn',
      status: 'Plate check failed',
      title: 'Re-render the brand plates',
      reason: 'A plate failed its frame check. Re-rendering makes its motion frame-accurate.',
      detail: f.reason,
      primary: { label: 'Re-render plates', mode: 'plates' },
      secondary: { label: 'Full Render', mode: 'quick' },
      makeLabel: 'Plates',
    };
  }
  if (!hasDelivery || f.stale) {
    return {
      kind: 'warn',
      status: 'Out of date',
      title: 'Render to see your changes',
      reason: 'Sources changed since the last render, so Program is behind.',
      detail: f.reason,
      primary: { label: 'Render', mode: 'quick' },
      secondary: { label: 'Re-record first', mode: 'full' },
      makeLabel: 'Render',
    };
  }
  return {
    kind: 'ok',
    status: 'Up to date',
    title: null,
    reason: null,
    primary: null,
    secondary: null,
    makeLabel: 'Render',
  };
}

/** Crossfade panel bodies (left / right tabs). Stacked via CSS grid; respects reduced motion. */
let panelSwapGen = 0;
const PANEL_MS = 320;
function swapPanelBodies(next, group) {
  const bodies = (group || []).filter(Boolean);
  if (!next || !bodies.includes(next)) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clear = (el) => el.classList.remove('is-panel-leave', 'is-panel-enter', 'is-panel-ready');
  const visible = bodies.filter((el) => !el.hidden && el !== next);
  // Prefer the panel still entering from a prior swap so a fast re-click doesn't leave two up.
  const current = visible.find((el) => el.classList.contains('is-panel-enter') || el.classList.contains('is-panel-ready')) || visible[0];
  if (!current || reduced) {
    bodies.forEach((el) => {
      el.hidden = el !== next;
      clear(el);
    });
    return;
  }
  const gen = ++panelSwapGen;
  bodies.forEach((el) => {
    if (el === current || el === next) return;
    el.hidden = true;
    clear(el);
  });
  next.hidden = false;
  clear(next);
  next.classList.add('is-panel-enter');
  current.classList.remove('is-panel-enter', 'is-panel-ready');
  current.classList.add('is-panel-leave');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (gen !== panelSwapGen) return;
      next.classList.add('is-panel-ready');
    });
  });
  setTimeout(() => {
    if (gen !== panelSwapGen) return;
    current.hidden = true;
    clear(current);
    next.classList.remove('is-panel-enter');
    // Keep ready briefly so card stagger can finish, then drop the class.
    setTimeout(() => {
      if (gen === panelSwapGen) next.classList.remove('is-panel-ready');
    }, 420);
  }, PANEL_MS);
}

function showLeftTab(id) {
  document.querySelectorAll('.project-panel .ptab').forEach((t) => {
    const on = t.dataset.left === id;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const map = { render: $('leftRender'), versions: $('leftVersions'), media: $('leftMedia') };
  swapPanelBodies(map[id], Object.values(map));
  $('projectPanel')?.classList.toggle('is-render-focus', id === 'render');
}

function setRenderMode(on, mode = 'render') {
  document.body.classList.toggle('is-rendering', !!on);
  if (on) {
    showLeftTab('render');
    setFaviconMode(mode === 'record' ? 'record' : mode === 'export' ? 'export' : 'render');
  } else if (!state.jobBusy && !state.queue.length) {
    setFaviconMode('idle');
  }
}

function renderActionCard(v) {
  const holdWarn = $('voiceHoldWarn');
  if (holdWarn) {
    const message = firstShortHold(v?.script?.scenes);
    holdWarn.hidden = !message;
    holdWarn.textContent = message;
  }
  const failure = $('recordFailure');
  if (failure) {
    const info = v?.recordFailure;
    failure.hidden = !info;
    const shot = $('recordFailureShot');
    if (info && shot) shot.src = info.screenshot;
    if ($('recordFailureReason')) $('recordFailureReason').textContent = info?.reason || '';
    if ($('recordFailureUrl')) $('recordFailureUrl').textContent = info?.url || '';
    if ($('recordFailureNext')) $('recordFailureNext').textContent = info?.next || '';
  }
  const action = decideAction(v);
  state.action = action;
  setStatus(action.kind, action.status);
  if ($('btnMakeLabel')) $('btnMakeLabel').textContent = action.makeLabel;
  else if ($('btnMake')) $('btnMake').textContent = action.makeLabel;

  const pill = $('renderStatusPill');
  const headline = $('renderHeadline');
  const reason = $('renderReason');
  if (!pill || !headline || !reason) return;

  if (state.renderBusy) {
    pill.className = 'render-pill run';
    pill.textContent = 'Rendering';
    return;
  }

  const target = $('recordTargetForm');
  if (target && v?.freshness) {
    target.hidden = !v.freshness.liveAt && !v.freshness.startUrl;
    const url = $('recordStartUrl');
    const login = $('recordLoginRequired');
    if (url && document.activeElement !== url) url.value = v.freshness.startUrl || '';
    if (login && document.activeElement !== login) login.checked = Boolean(v.freshness.loginRequired);
    const versions = $('cleanupVersions');
    if (versions) {
      const ids = (v.versions || []).map((ver) => ver.id).join(',');
      if (versions.dataset.ids !== ids) {
        versions.dataset.ids = ids;
        versions.innerHTML = (v.versions || [])
          .map(
            (ver) =>
              `<label class="tog"><input type="checkbox" value="${escapeHtml(ver.id)}" /><span>${escapeHtml(ver.displayName || ver.name || ver.id)}</span></label>`
          )
          .join('');
      }
    }
  }

  if (!action.title) {
    pill.className = 'render-pill ok';
    pill.textContent = 'Up to date';
    headline.textContent = 'Program matches your sources';
    reason.title = '';
    reason.textContent = 'Watch it, give feedback, or approve the cut from the stage bar.';
    const primary = $('btnActionPrimary');
    if (primary) {
      primary.hidden = false;
      primary.dataset.mode = 'quick';
      const lab = primary.querySelector('.cta-label');
      if (lab) lab.textContent = 'Render again';
    }
    if ($('btnActionSecondary')) $('btnActionSecondary').hidden = true;
    return;
  }

  pill.className = `render-pill ${action.kind === 'ok' ? 'ok' : 'warn'}`;
  pill.textContent = action.status;
  headline.textContent = action.title;
  reason.textContent = action.reason || '';
  reason.title = action.detail || '';

  const primary = $('btnActionPrimary');
  if (primary && action.primary) {
    primary.hidden = false;
    primary.dataset.mode = action.primary.mode;
    const lab = primary.querySelector('.cta-label');
    if (lab) lab.textContent = action.primary.label;
  }
  const secondary = $('btnActionSecondary');
  if (secondary) {
    if (action.secondary) {
      secondary.hidden = false;
      secondary.dataset.mode = action.secondary.mode;
      const lab = secondary.querySelector('.cta-label');
      if (lab) lab.textContent = action.secondary.label;
    } else {
      secondary.hidden = true;
    }
  }
}

function renderSteps(steps) {
  const ol = $('actionSteps');
  const idle = $('pipelineIdle');
  if (!ol) return;
  if (!steps?.length) {
    ol.hidden = true;
    ol.innerHTML = '';
    if (idle) idle.hidden = false;
    return;
  }
  ol.hidden = false;
  if (idle) idle.hidden = true;
  ol.innerHTML = steps
    .map((s) => {
      const st = s.status || 'todo';
      const mark = st === 'done' ? '✓' : st === 'run' ? '…' : st === 'fail' ? '!' : '○';
      const ico = PIPE_ICONS[s.id] || PIPE_ICONS.produce;
      return `<li class="${st}" data-step-id="${escapeHtml(s.id)}">
        <span class="pip-ico">${ico}</span>
        <span class="pip-label">${escapeHtml(s.label)}</span>
        <span class="pip-mark">${mark}</span>
      </li>`;
    })
    .join('');
}

function setStep(id, status) {
  if (!state.pipeline) return;
  const s = state.pipeline.find((x) => x.id === id);
  if (s) s.status = status;
  renderSteps(state.pipeline);
}

function updateQueueBadge() {
  const n = state.queue.length;
  const badge = $('queueBadge');
  if (!badge) return;
  badge.hidden = n === 0;
  badge.textContent = String(n);
  updateStopButtons();
}

function renderQueue() {
  const list = $('jobQueue');
  const empty = $('queueEmpty');
  if (!list) return;
  updateQueueBadge();
  if (!state.queue.length) {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  list.innerHTML = state.queue
    .map(
      (q, i) => `<li data-qid="${escapeHtml(q.qid)}">
      <span class="q-num">${i + 1}</span>
      <span class="q-label">${escapeHtml(q.label)}</span>
      <button type="button" class="queue-remove" data-remove-qid="${escapeHtml(q.qid)}" title="Remove" aria-label="Remove"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </li>`
    )
    .join('');
}

function enqueueJob(item, { silent = false } = {}) {
  const entry = {
    qid: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    // Bind the sequence at enqueue time — switching projects mid-queue must not retarget the job.
    slug: item.slug || state.slug || null,
    label: item.label,
    kind: item.kind,
    mode: item.mode,
    step: item.step,
    force: item.force,
    goal: item.goal,
    note: item.note,
    plateId: item.plateId,
    motion: item.motion,
    presets: item.presets,
  };
  if (!entry.slug) {
    toast('No sequence open', 'Pick a project before queuing work', 'warn');
    return null;
  }
  state.queue.push(entry);
  renderQueue();
  if (!silent) {
    const when = state.jobBusy ? 'after current job' : 'starting…';
    toast(state.jobBusy ? 'Queued' : 'Starting', `${entry.label} · ${when}`);
  }
  if (entry.kind === 'improve') {
    document.querySelector('.tools-panel .ptab[data-right="feedback"]')?.click();
  } else {
    showLeftTab('render');
  }
  drainQueue();
  return entry;
}

function isCancelError(err) {
  const m = String(err?.message || err || '');
  return /cancelled|canceled|aborted|stopped/i.test(m);
}

function beginWorkAbort() {
  try {
    state.workAbort?.abort();
  } catch {
    /* ignore */
  }
  state.workAbort = new AbortController();
  return state.workAbort.signal;
}

function updateStopButtons() {
  const busy = state.jobBusy || state.queue.length > 0;
  ['btnStopWork', 'btnStopSession', 'btnStopRender'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.hidden = !busy;
    el.disabled = false;
  });
}

/**
 * Stop the running job (agent/kit), clear the queue, abort local watchers.
 * @param {{ reason?: string, silent?: boolean }} [opts]
 */
async function stopAllWork({ reason = 'Stopped', silent = false } = {}) {
  state.stopRequested = true;
  state.queue = [];
  renderQueue();
  try {
    state.workAbort?.abort();
  } catch {
    /* ignore */
  }
  const id = state.jobId;
  try {
    if (id) await api(`/api/jobs/${id}/cancel`, { method: 'POST', body: {} });
    else await api('/api/jobs/cancel-all', { method: 'POST', body: {} });
  } catch {
    /* ignore — process may already be gone */
  }
  state.jobBusy = false;
  state.activeSurface = null;
  state.pipelineStartedAt = null;
  buttonBusy($('btnExport'), false);
  buttonBusy($('btnMake'), false);
  buttonBusy($('btnImprove'), false);
  buttonBusy($('btnActionPrimary'), false);
  buttonBusy($('btnActionSecondary'), false);
  setRenderMode(false);
  setStatus('warn', reason);
  if ($('renderLiveTitle')) $('renderLiveTitle').textContent = reason;
  if ($('renderLiveMeta')) $('renderLiveMeta').textContent = 'Queue cleared';
  if ($('renderSpinner')) $('renderSpinner').hidden = true;
  if ($('sessionTitle')) $('sessionTitle').textContent = reason;
  if ($('sessionMeta')) $('sessionMeta').textContent = 'Ready for new work';
  if ($('sessionSpinner')) $('sessionSpinner').hidden = true;
  updateStopButtons();
  if (!silent) toast(reason, 'Running job stopped · queue cleared', 'warn');
}

async function drainQueue() {
  if (state.jobBusy) return;
  if (state.stopRequested) {
    state.stopRequested = false;
    updateStopButtons();
    return;
  }
  const next = state.queue.shift();
  renderQueue();
  if (!next) {
    updateStopButtons();
    return;
  }
  state.jobBusy = true;
  state.stopRequested = false;
  updateStopButtons();
  const signal = beginWorkAbort();
  const isRender = next.kind === 'make' || next.kind === 'step';
  if (isRender) {
    const fav =
      next.kind === 'make' && next.mode === 'full'
        ? 'record'
        : next.kind === 'step' && next.step === 'deliver'
          ? 'export'
          : next.kind === 'step' && next.step === 'record'
            ? 'record'
            : 'render';
    setRenderMode(true, fav);
  } else if (next.kind === 'improve') {
    setFaviconMode('draft');
  }
  try {
    if (next.kind === 'make') await runMakePipeline(next.mode, { signal, slug: next.slug });
    else if (next.kind === 'step') {
      setStatus('run', `${next.label}…`);
      buttonBusy($('btnExport'), next.step === 'deliver');
      updateRenderLive({
        status: 'running',
        kind: 'kit',
        step: next.step,
        slug: next.slug || state.slug,
        activity: '',
        startedAt: new Date().toISOString(),
        log: [],
        events: [],
      });
      await runJobPromise(next.step, next.force, { signal, presets: next.presets, slug: next.slug });
      if (signal.aborted || state.stopRequested) throw new Error('cancelled');
      const stillHere = !next.slug || next.slug === state.slug;
      if (next.step === 'export') {
        if (stillHere) await loadVideo(state.slug);
        setFaviconMode('ok');
        toast('Formats ready', `${state.video?.exports?.length || 0} file(s) in Deliver · run Export to add them to the zip`, 'ok');
      } else if (next.step === 'deliver') {
        if (stillHere) {
          await loadVideo(state.slug);
          syncHandoffDownloadLinks(state.video);
        }
        setFaviconMode('ok');
        toast(
          'Export ready',
          state.video?.handoffZipUrl ? 'Pack + zip ready — Download in Media or Deliver' : 'deliverables/ folder updated'
        );
      } else {
        setFaviconMode('ok');
        toast('Done', next.label);
        if (stillHere) {
          await loadVideo(state.slug);
          if (next.step === 'audio' || next.step === 'music' || next.step === 'mix') await editor?.refresh?.();
        }
      }
      setStatus(state.action?.kind || 'ok', state.action?.status || 'Up to date');
    } else if (next.kind === 'improve') {
      await runImproveJob(next, { signal });
      setFaviconMode('ok');
    }
  } catch (err) {
    if (isCancelError(err) || state.stopRequested) {
      setStatus('warn', 'Stopped');
      if (!state.stopRequested) toast('Stopped', next.label, 'warn');
      setFaviconMode('idle');
    } else {
      toast(next.label, err.message, 'err');
      setStatus('warn', 'Job failed');
      setFaviconMode('err');
    }
  } finally {
    state.jobBusy = false;
    state.activeSurface = null;
    buttonBusy($('btnExport'), false);
    buttonBusy($('btnMake'), false);
    buttonBusy($('btnImprove'), false);
    if (!state.queue.length) setRenderMode(false);
    if (state.video) renderActionCard(state.video);
    updateStopButtons();
    if (state.stopRequested) {
      state.stopRequested = false;
      state.queue = [];
      renderQueue();
      return;
    }
    drainQueue();
  }
}

/**
 * Poll one server job without stealing another waiter's timer.
 * @param {string} jobId
 * @param {{ onUpdate?: (job: object) => void, surface?: 'render'|'session', signal?: AbortSignal }} [opts]
 */
function watchJob(jobId, opts = {}) {
  const surface = opts.surface || 'render';
  const signal = opts.signal || state.workAbort?.signal;
  return new Promise((resolve, reject) => {
    let timer = null;
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      signal?.removeEventListener?.('abort', onAbort);
      fn(arg);
    };
    const onAbort = () => {
      finish(reject, new Error('cancelled'));
      if (jobId) api(`/api/jobs/${jobId}/cancel`, { method: 'POST', body: {} }).catch(() => {});
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener?.('abort', onAbort);
    const tick = async () => {
      try {
        if (signal?.aborted || state.stopRequested) {
          finish(reject, new Error('cancelled'));
          return;
        }
        const job = await api(`/api/jobs/${jobId}`);
        state.job = job;
        state.jobId = jobId;
        if (job.question && state.jobAsk !== job.question.id) {
          state.jobAsk = job.question.id;
          const answer = await ask({
            kind: job.question.field === 'confirm' ? 'confirm' : 'prompt',
            job: true,
            secret: job.question.field === 'password',
            title: job.question.prompt,
            label: job.question.field === 'password' ? 'Password' : 'Email',
            ok: 'Continue',
          });
          await api(`/api/jobs/${jobId}/answer`, {
            method: 'POST',
            body: { cancel: answer == null, value: answer },
          }).catch(() => {});
        }
        if (opts.onUpdate) opts.onUpdate(job);
        else showActivityDock(job, { surface });
        if (
          job.status === 'done' ||
          job.status === 'failed' ||
          job.status === 'needs-agent' ||
          job.status === 'cancelled' ||
          job.status === 'waiting'
        ) {
          if (job.status === 'done') finish(resolve, job);
          else if (job.status !== 'waiting') finish(reject, new Error(job.message || job.status));
        }
      } catch (err) {
        finish(reject, err);
      }
    };
    timer = setInterval(tick, 700);
    tick();
  });
}

function stageList(stages) {
  return stages
    .map(
      (s) => `<li class="${s.state}">
        <span class="work-mark" aria-hidden="true"></span>
        <span class="work-copy"><strong>${escapeHtml(s.label)}</strong><em>${escapeHtml(s.detail)}</em></span>
      </li>`
    )
    .join('');
}

/** Fill one activity surface (render bay or session rail) from a job. */
function paintWork(prefix, job) {
  const view = describeJob(job);
  const running = job.status === 'running' || job.status === 'queued' || job.status === 'cancelling' || job.status === 'waiting';
  if ($(`${prefix}Spinner`)) $(`${prefix}Spinner`).hidden = !running;
  if ($(`${prefix}Art`)) $(`${prefix}Art`).hidden = true;
  $('renderLiveCard')?.classList.toggle('is-idle', false);
  if (prefix === 'session') $('sessionProgress')?.classList.remove('is-idle');
  if ($(`${prefix}Title`)) $(`${prefix}Title`).textContent = view.title;
  if ($(`${prefix}Meta`)) $(`${prefix}Meta`).textContent = view.summary;
  const phase = $(`${prefix}Phase`);
  if (phase) {
    phase.hidden = false;
    phase.textContent = view.statusLabel;
    phase.className = `badge ${view.badge}`.trim();
  }
  const now = $(`${prefix}Now`);
  if (now) {
    const failed = job.status === 'failed' || job.status === 'needs-agent';
    const streamed = job.kind === 'improve' && (job.stream?.entries || []).length > 0;
    now.hidden = !view.now || streamed || (view.stages.length > 0 && !failed);
    now.textContent = view.now;
  }
  const bar = $(prefix === 'renderLive' ? 'renderLiveBar' : 'sessionBar');
  if (bar) {
    bar.hidden = !view.stages.length;
    bar.firstElementChild.style.width = `${Math.round(view.progress * 100)}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(view.progress * 100)));
  }
  const stages = $(prefix === 'renderLive' ? 'renderStages' : 'sessionStages');
  if (stages) {
    stages.hidden = !view.stages.length;
    stages.innerHTML = stageList(view.stages);
    const active = stages.querySelector('li.run, li.fail');
    if (active) {
      const top = active.offsetTop;
      const bottom = top + active.offsetHeight;
      if (top < stages.scrollTop) stages.scrollTop = top;
      else if (bottom > stages.scrollTop + stages.clientHeight) stages.scrollTop = bottom - stages.clientHeight;
    }
  }
  return view;
}

function updateRenderLive(job) {
  if (!job) return;
  const running = job.status === 'running' || job.status === 'queued';
  const view = paintWork('renderLive', job);

  if (running && $('renderHeadline')) {
    $('renderHeadline').textContent = view.title;
    if ($('renderReason')) $('renderReason').textContent = view.summary;
    const pill = $('renderStatusPill');
    if (pill) {
      pill.className = 'render-pill run';
      pill.textContent = view.statusLabel;
    }
  }
  if ($('renderLiveElapsed')) {
    $('renderLiveElapsed').hidden = false;
    $('renderLiveElapsed').textContent = fmt(elapsedSec(job));
  }
  paintAgentStream($('renderLiveStream'), job, { variant: 'bay' });
  if ($('renderLiveLog')) {
    const lines = (job.log || []).map((l) => (typeof l === 'string' ? l : l.line)).join('\n');
    $('renderLiveLog').textContent = lines.slice(-8000);
    $('renderLiveLog').hidden = !state.renderLogExpanded;
    if (state.renderLogExpanded) $('renderLiveLog').scrollTop = $('renderLiveLog').scrollHeight;
  }
  if ($('btnRenderLogToggle')) {
    $('btnRenderLogToggle').hidden = !(job.log || []).length;
    $('btnRenderLogToggle').textContent = state.renderLogExpanded ? 'Hide log' : 'Show log';
  }
  if ($('renderElapsed') && state.pipelineStartedAt) {
    $('renderElapsed').hidden = false;
    const sec = Math.max(0, Math.floor((Date.now() - state.pipelineStartedAt) / 1000));
    $('renderElapsed').textContent = fmt(sec);
  }
}

async function loadCaptions(slug) {
  try {
    const data = await api(`/api/video/${encodeURIComponent(slug)}/captions`);
    state.cues = data.clips || [];
  } catch {
    state.cues = [];
  }
}

/**
 * Point `#player` at the delivery master when Program is showing a plate preview
 * (or any other non-master src). Returns true when a reload was started.
 */
function ensureProgramMaster({ force = false, play = false, preserveTime = true } = {}) {
  const deliveryUrl = state.video?.deliveryUrl;
  const player = $('player');
  if (!player || !deliveryUrl) return false;
  const playerSrc = player.currentSrc || player.getAttribute('src') || '';
  if (
    !needsProgramRestore({
      monitorMode: 'program',
      previewingPlate: state.previewingPlate,
      playerSrc,
      deliveryUrl,
      force,
    })
  ) {
    return false;
  }
  const t = preserveTime ? Number(player.currentTime) || 0 : 0;
  state.previewingPlate = null;
  player.pause?.();
  player.src = `${deliveryUrl}${deliveryUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
  player.classList.remove('hidden');
  $('noVideo')?.classList.remove('show');
  const afterLoad = () => {
    if (preserveTime && t > 0.05) {
      try {
        player.currentTime = Math.min(t, player.duration || t);
      } catch {
        /* ignore */
      }
    }
    if (play) startPlayback(player);
    updateTransport();
  };
  if (player.readyState >= 1) afterLoad();
  else player.addEventListener('loadedmetadata', afterLoad, { once: true });
  setMonitorLabel('Program');
  return true;
}

function setMonitorMode(mode, { keepPreview = false } = {}) {
  mode = normalizeMonitorMode(mode);
  if (mode !== 'plate' && state.plateDirty) {
    // Leaving plate mode with unsaved edits — keep dirty until save/discard; warn once.
    if (!$('plateEditBar')?.dataset.warnOnce) {
      toast('Unsaved plate edits', 'Save or Discard before leaving Plate HTML', 'warn');
      if ($('plateEditBar')) $('plateEditBar').dataset.warnOnce = '1';
    }
  }
  state.monitorMode = mode;
  state.compare = mode === 'compare';
  $('playerSingle').hidden = mode !== 'program';
  $('playerPlate').hidden = mode !== 'plate';
  $('playerCompare').hidden = mode !== 'compare';
  const monitor = document.querySelector('.monitor');
  if (monitor) monitor.dataset.mode = mode === 'compare' ? 'compare' : mode;
  document.querySelectorAll('.mode-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.mode === (mode === 'compare' ? 'program' : mode));
  });
  if (mode !== 'plate') editor?.onLeave();
  if (mode === 'program') {
    setMonitorLabel(state.previewingPlate && keepPreview ? 'Preview' : 'Program');
    $('platePicker').hidden = true;
    if ($('plateEditBar')) $('plateEditBar').hidden = true;
    if ($('captionOverlay')) $('captionOverlay').hidden = false;
    editor?.onLeave();
    if (!keepPreview) ensureProgramMaster();
  } else if (mode === 'plate') {
    setMonitorLabel('Editor', 'Changes save as you go · Render to bake them into the video');
    $('platePicker').hidden = true;
    if ($('plateEditBar')) $('plateEditBar').hidden = true;
    const programT = $('player').currentTime || 0;
    editor?.onEnter({ programT });
    if ($('captionOverlay')) {
      $('captionOverlay').classList.remove('on');
      $('captionOverlay').hidden = true;
    }
    $('player').pause();
    $('playerA')?.pause?.();
    ensureFhdFitObserver();
    requestAnimationFrame(() => requestAnimationFrame(fitFhdPreview));
  } else {
    setMonitorLabel('Compare', 'A/B against a saved version');
    $('platePicker').hidden = true;
    if ($('plateEditBar')) $('plateEditBar').hidden = true;
    if ($('captionOverlay')) $('captionOverlay').hidden = false;
    $('player').pause();
  }
  highlightTimelinePlate(state.activePlateId);
  syncTimelineLock();
  updateTransport();
  updatePlateEditChrome();
  updateSceneFromTime(activePlayer().currentTime || 0);
}

/** Lock scrubbing while the plate editor is open; plate tips stay clickable to switch. */
function syncTimelineLock() {
  const shell = document.querySelector('.timeline-shell');
  const locked = state.monitorMode === 'plate';
  if (shell) shell.classList.toggle('is-plate-locked', locked);
  if ($('tlLockHint')) $('tlLockHint').hidden = !locked;
  const tlLabelText = $('tlLabel')?.querySelector('span') || $('tlLabel');
  if (tlLabelText) tlLabelText.textContent = locked ? 'Editor' : 'Timeline';
  const tl = $('timeline');
  if (tl) {
    tl.setAttribute('aria-disabled', locked ? 'true' : 'false');
    tl.tabIndex = locked ? -1 : 0;
  }
}

function highlightTimelinePlate(plateId) {
  document.querySelectorAll('#timelineRegions .tl-region').forEach((el) => {
    const on = state.monitorMode === 'plate' && plateId && el.dataset.plateId === plateId;
    el.classList.toggle('is-active', on);
  });
}

function syncTimelineToPlate(plateId) {
  const scene = (state.scenes || []).find((s) => s.plateId === plateId || s.id === plateId);
  if (!scene) {
    highlightTimelinePlate(plateId);
    return;
  }
  const player = $('player');
  player.pause();
  const t = Math.min(scene.end - 0.05, scene.start + 0.08);
  try {
    player.currentTime = t;
  } catch {
    /* ignore seek before metadata */
  }
  state.currentScene = scene;
  updateSceneFromTime(t);
  highlightTimelinePlate(plateId);
  // Re-paint regions so is-active sticks after renderTimeline
  const d = player.duration || state.duration || 0;
  if (d > 0) {
    const pct = (t / d) * 100;
    $('timelineFill').style.width = `${pct}%`;
    const head = $('timelinePlayhead');
    if (head) {
      head.style.left = `${pct}%`;
      head.classList.toggle('is-flip', pct > 82);
    }
  }
  const clock = $('clock');
  if (clock) clock.innerHTML = `${fmtShort(t)} <span class="t-sep">/</span> ${fmtShort(d)}`;
}

function updatePlateEditChrome() {
  editor?.onPlateDirty();
  const bar = $('plateEditBar');
  if (!bar) return;
  const dirty = state.plateDirty;
  bar.classList.toggle('is-dirty', dirty);
  if ($('btnPlateSaveCopy')) $('btnPlateSaveCopy').disabled = !dirty;
  if ($('btnPlateDiscardEdits')) $('btnPlateDiscardEdits').disabled = !dirty;
  if ($('plateEditHint')) {
    $('plateEditHint').innerHTML = dirty
      ? `<strong>Unsaved changes</strong> · Replay to preview · Save writes to video.config.json`
      : `Click text to edit · Replay previews motion · <kbd>*</kbd>word<kbd>*</kbd> for accent`;
  }
  if ($('btnPlateReplay')) $('btnPlateReplay').disabled = false;
}

function setCompare(on) {
  const versions = state.video?.versions || [];
  if (on && !versions.length) {
    toast('Save a snapshot first', 'Then use Compare', 'warn');
    $('togCompare').checked = false;
    return;
  }
  $('togCompare').checked = on;
  if (on) {
    setMonitorMode('compare');
    syncCompare();
  } else {
    // previewingPlate is a URL stand-in on the Program player — not “open the Editor”.
    // Only return to plate mode when a draft proposal is still waiting for HTML review.
    const backToPlate = Boolean(state.proposalOpen && (state.htmlPlates || []).length);
    setMonitorMode(backToPlate ? 'plate' : 'program');
  }
}

function setThinkStep(active) {
  const order = ['think', 'edit', 'html', 'preview', 'approve'];
  const idx = order.indexOf(active);
  const apply = (sel) => {
    document.querySelectorAll(sel).forEach((li) => {
      const i = order.indexOf(li.dataset.step);
      li.classList.remove('run', 'done');
      if (idx < 0) return;
      if (i < idx) li.classList.add('done');
      else if (i === idx) li.classList.add('run');
    });
  };
  apply('#thinkSteps li');
  apply('#sessionPipe li');
}

function setSessionIdle() {
  const rail = $('sessionRail');
  if (!rail || state.proposalOpen) return;
  rail.classList.remove('is-running', 'is-done', 'is-failed');
  if ($('sessionSpinner')) $('sessionSpinner').hidden = true;
  if ($('sessionTitle')) $('sessionTitle').textContent = 'Agent’s off the clock 💤';
  if ($('sessionMeta')) $('sessionMeta').textContent = 'Apply a note and its progress shows here.';
  if ($('sessionArt')) $('sessionArt').hidden = false;
  $('sessionProgress')?.classList.add('is-idle');
  if ($('sessionNow')) {
    $('sessionNow').hidden = true;
    $('sessionNow').textContent = '';
  }
  if ($('sessionElapsed')) $('sessionElapsed').hidden = true;
  if ($('sessionPhase')) $('sessionPhase').hidden = true;
  if ($('btnSessionLog')) $('btnSessionLog').hidden = true;
  paintAgentStream($('sessionStream'), null, { variant: 'rail' });
  if ($('sessionLog')) {
    $('sessionLog').hidden = true;
    $('sessionLog').textContent = '';
  }
}

function resetThinkSteps() {
  document.querySelectorAll('#thinkSteps li, #sessionPipe li').forEach((li) => li.classList.remove('run', 'done'));
  setSessionIdle();
}

function showProposal(opts = {}) {
  state.proposalOpen = true;
  const decide = $('sessionDecide');
  if (decide) {
    decide.hidden = false;
    decide.setAttribute('aria-live', 'assertive');
  }
  $('proposalTitle').textContent = opts.title || 'Ready to decide';
  $('proposalReason').textContent =
    opts.reason ||
    'Review live plate HTML in Program, then choose Discard, Approve plate, or Approve & render full.';
  const steps = $('proposalSteps');
  if (steps) {
    const list = opts.steps || [];
    steps.hidden = !list.length;
    steps.innerHTML = list
      .map((s) => `<li class="${escapeHtml(s.status || '')}">${escapeHtml(s.label || '')}</li>`)
      .join('');
  }
  const rail = $('sessionRail');
  if (rail) {
    rail.classList.remove('is-running', 'is-failed');
    rail.classList.add('is-done', 'decision-mode');
    rail.classList.remove('show-work');
    rail.scrollTop = 0;
  }
  if ($('btnProposalWork')) {
    $('btnProposalWork').textContent = 'View agent work';
    $('btnProposalWork').setAttribute('aria-expanded', 'false');
  }
  if ($('btnReviewProposal')) {
    const review = opts.review || 'preview';
    $('btnReviewProposal').dataset.review = review;
    const strong = $('btnReviewProposal').querySelector('strong');
    const detail = $('btnReviewProposal').querySelector('em');
    if (strong) strong.textContent = opts.reviewLabel || (review === 'script' ? 'Review script & voice' : 'Review preview');
    if (detail) {
      detail.textContent =
        opts.reviewDetail ||
        (review === 'script' ? 'Open the changed story and narration' : 'Bring the proposed plate into focus');
    }
  }
  if ($('sessionSpinner')) $('sessionSpinner').hidden = true;
  if ($('sessionTitle')) $('sessionTitle').textContent = 'Preview ready';
  if ($('sessionMeta')) $('sessionMeta').textContent = 'Choose a path below';
  document.querySelector('.tools-panel .ptab[data-right="feedback"]')?.click();
  requestAnimationFrame(() => {
    if (rail) rail.scrollTop = 0;
    decide?.focus({ preventScroll: true });
  });
}

function hideProposal() {
  state.proposalOpen = false;
  if ($('sessionDecide')) $('sessionDecide').hidden = true;
  if ($('btnApprovePlate')) $('btnApprovePlate').hidden = true;
  if ($('proposalSteps')) {
    $('proposalSteps').hidden = true;
    $('proposalSteps').innerHTML = '';
  }
  $('sessionRail')?.classList.remove('decision-mode', 'show-work');
  if ($('btnProposalWork')) {
    $('btnProposalWork').textContent = 'View agent work';
    $('btnProposalWork').setAttribute('aria-expanded', 'false');
  }
  setSessionIdle();
}

function renderPlateQcBanner(plates) {
  const el = $('plateQcBanner');
  if (!el) return;
  const bad = (plates || []).filter((p) => p.encode && p.encode.ok === false);
  const clipped = (plates || []).filter((p) => (p.encode?.notes || []).some((n) => n.startsWith('Copy clips')));
  if (!bad.length) {
    el.hidden = !clipped.length;
    el.innerHTML = clipped.length
      ? `<strong>Copy too long</strong> — ${escapeHtml(clipped.map((p) => p.label || p.id).join(', '))}: text clips even at the smallest size. Shorten the copy on the plate (click text to edit).`
      : '';
    return;
  }
  el.hidden = false;
  const names = bad.map((p) => p.label || p.id).join(', ');
  el.innerHTML = `<strong>Plate encode QC</strong> — ${escapeHtml(names)} need a clean re-render (hold/frame gate). <button type="button" class="btn tiny" id="btnPlateQcFix">Re-render plates</button>`;
  $('btnPlateQcFix')?.addEventListener(
    'click',
    () => {
      requestMake('plates');
      showLeftTab('render');
    },
    { once: true }
  );
}

function renderHtmlPlatePicker(plates) {
  state.htmlPlates = plates || [];
  const list = $('platePickerList');
  if (!list) return;
  if (editor) {
    // The Editor's clip strip lists plates and live slices together.
    editor.renderClips();
    renderPlateQcBanner(state.htmlPlates);
    return;
  }
  if (!state.htmlPlates.length) {
    list.innerHTML = '';
    $('platePicker').hidden = true;
    renderPlateQcBanner([]);
    return;
  }
  list.innerHTML = state.htmlPlates
    .map((p) => {
      const enc = p.encode || {};
      const bad = enc.ok === false;
      const notes = enc.notes || [];
      const title = bad
        ? `Encode QC: ${(enc.warnings || [enc.status || 'bad']).join(', ')}`
        : enc.ok
          ? `QC ok · ${enc.snapped || '?'} snaps${notes.length ? `\n${notes.join('\n')}` : ''}`
          : '';
      const accent = (currentPlateConfig(p.id)?.overrides || []).length > 0;
      const live = Boolean(p.liveCard);
      const tip = live ? `${p.kind === 'chapter' ? 'Chapter card' : 'Caption'} · click to preview & edit` : title;
      return `<button type="button" data-plate-id="${escapeHtml(p.id)}" title="${escapeHtml(tip)}${accent ? ' · own accent' : ''}" class="${
        state.activePlateId === p.id ? 'active' : ''
      }${bad ? ' plate-qc-bad' : ''}${notes.length ? ' plate-type-note' : ''}${accent ? ' plate-accented' : ''}${live ? ' plate-live-card' : ''}">${escapeHtml(p.label || p.id)}${bad ? ' · QC' : ''}${
        accent ? '<i class="accent-dot" aria-hidden="true"></i>' : ''
      }</button>`;
    })
    .join('');
  if (state.monitorMode === 'plate') $('platePicker').hidden = false;
  renderPlateQcBanner(state.htmlPlates);
}

function fitFhdPreview(attempt = 0) {
  const fit = $('fhdFit');
  const canvas = $('fhdCanvas');
  if (!fit || !canvas) return;
  if ($('playerPlate')?.hidden) return;
  const pad = document.body.classList.contains('is-editor') ? 0 : 8;
  const rw = fit.clientWidth - pad * 2;
  const rh = fit.clientHeight - pad * 2;
  // Layout not ready yet (plate pane still 0×0) — retry a few frames
  if ((rw < 32 || rh < 32) && attempt < 30) {
    requestAnimationFrame(() => fitFhdPreview(attempt + 1));
    return;
  }
  // Always show the full 1920×1080 delivery frame — never crop
  const scale = Math.min(Math.max(rw, 1) / 1920, Math.max(rh, 1) / 1080);
  canvas.style.transform = `scale(${scale})`;
  const badge = fit.querySelector('.fhd-badge');
  if (badge) badge.textContent = `1920×1080 · ${Math.round(scale * 100)}%`;
}

function ensureFhdFitObserver() {
  if (state._fhdObs || typeof ResizeObserver === 'undefined') return;
  const fit = $('fhdFit');
  const stage = $('stage');
  if (!fit) return;
  state._fhdObs = new ResizeObserver(() => fitFhdPreview());
  state._fhdObs.observe(fit);
  if (stage) state._fhdObs.observe(stage);
  window.addEventListener('resize', fitFhdPreview);
}

function showPlateHtml(plate) {
  if (!plate) return;
  setMonitorMode('plate');
  editor?.openPlate(plate.id);
}

/**
 * Load a plate into the editor stage. Resolves once the copy is armed for inline edit, so the
 * editor can switch it to motion (seekable) or text mode. Unsaved copy is the caller's business.
 */
/**
 * Load a plate into the editor stage.
 * Resolves `true` when armed, `false` on hard failure, `'cancelled'` when a newer load stole the iframe
 * (callers must not treat cancel as “plate missing”).
 */
function loadPlateFrame(plateId, { force = false } = {}) {
  const plate = (state.htmlPlates || []).find((p) => p.id === plateId);
  if (!plate?.htmlUrl) return Promise.resolve(false);
  if (!force && state.activePlateId === plateId && state.plateFrameReady === plateId) return Promise.resolve(true);
  state.activePlateId = plateId;
  // Bust cache so Direction look / copy rebuilds show up when compositing over the take.
  state.previewingPlate = `${plate.htmlUrl.split('?')[0]}?t=${Date.now()}`;
  state.plateDirty = false;
  state.plateEditBound = false;
  state.plateFrameReady = null;
  updatePlateEditChrome();
  const frame = $('plateFrame');
  const token = (state.plateLoadToken = (state.plateLoadToken || 0) + 1);
  return new Promise((resolve) => {
    frame.onload = () => {
      if (token !== state.plateLoadToken) return resolve('cancelled');
      fitFhdPreview();
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          enablePlateInlineEdit(frame, {
            onReady: () => {
              if (token !== state.plateLoadToken) return resolve('cancelled');
              state.plateFrameReady = plateId;
              if (String(plateId).startsWith('overlay:')) plateSetLiveComposite(true);
              resolve(true);
            },
          })
        )
      );
    };
    frame.onerror = () => {
      if (token !== state.plateLoadToken) return resolve('cancelled');
      resolve(false);
    };
    frame.src = plate.htmlUrl.split('?')[0] + `?t=${Date.now()}`;
  });
}

/**
 * Force every CSS animation on the plate to rebuild. Changing look tokens (depth, energy,
 * reveal, atmosphere) while animations sit mid-seek leaves a frozen half-reveal — calling this
 * then seeking makes the stage match what a real render will show.
 */
function recreatePlateAnimations(doc) {
  if (!doc?.body) return;
  doc.getElementById('studio-anim-reset')?.remove();
  const reset = doc.createElement('style');
  reset.id = 'studio-anim-reset';
  reset.textContent = '*,*::before,*::after{animation:none!important}';
  doc.head.appendChild(reset);
  void doc.body.offsetHeight;
  reset.remove();
  void doc.body.offsetHeight;
}

/**
 * Mark overlay HTML for transparent composite over the recording (Editor + bake).
 * Chrome paints an opaque white iframe canvas when the parent page is color-scheme: dark
 * and the card document does not opt into the same scheme — the caption then hides the take.
 */
function plateSetLiveComposite(on = true) {
  const doc = plateFrameDoc();
  if (!doc?.body) return false;
  const overlay = String(doc.body.dataset.cardId || state.activePlateId || '').startsWith('overlay:');
  const frame = $('plateFrame');
  if (on && overlay) {
    doc.body.dataset.composite = '1';
    // Both sides of the embed declare the same scheme, so the canvas stays transparent.
    doc.documentElement.style.colorScheme = 'dark';
    if (frame) frame.style.colorScheme = 'dark';
    doc.documentElement.style.background = 'transparent';
    doc.body.style.background = 'transparent';
    const stage = doc.querySelector('.preview-stage');
    if (stage) stage.style.background = 'transparent';
  } else {
    delete doc.body.dataset.composite;
    doc.documentElement.style.colorScheme = '';
    if (frame) frame.style.colorScheme = '';
    doc.documentElement.style.background = '';
    doc.body.style.background = '';
  }
  return true;
}

/** Leave the composed edit frame so the plate's own animations can be stepped; copy (and unsaved edits) stay in the DOM. */
function plateMotionMode() {
  const doc = plateFrameDoc();
  if (!doc?.body) return false;
  plateSetLiveComposite(true);
  if (doc.body.dataset.motion === '1') {
    ensurePlatePeekStyle(doc);
    bindPlateCanvasPick(doc);
    return true;
  }
  try {
    doc.activeElement?.blur?.();
  } catch {
    /* ignore */
  }
  // Untouched copy gets the template's reveal markup back so titles rise and cascade again;
  // edited copy keeps its canonical markup until Save rebuilds the plate.
  restorePlateEdits(doc, snapshotPlateEdits(doc), { motion: true });
  doc.body.classList.remove('studio-edit');
  clearPlateRevealOverrides(doc);
  const editStyle = doc.getElementById('studio-edit-style');
  if (editStyle) editStyle.disabled = true;
  doc.querySelectorAll('[data-edit]').forEach((el) => {
    el.removeAttribute('contenteditable');
    el.classList.remove('is-focused');
    if (el.dataset.edit) el.title = `Click to edit “${el.dataset.edit}”`;
  });
  // composePlateForEdit cancelled every animation; a one-frame `animation: none` re-creates them.
  recreatePlateAnimations(doc);
  doc.body.dataset.motion = '1';
  ensurePlatePeekStyle(doc);
  bindPlateCanvasPick(doc);
  return true;
}

/** Step the plate to ms on its own clock (CSS animations + WebGL atmosphere + count-ups). */
function plateSeek(ms) {
  const frame = $('plateFrame');
  const doc = frame?.contentDocument;
  if (!doc?.body || doc.body.dataset.motion !== '1') return;
  const t = Math.max(0, Number(ms) || 0);
  for (const a of doc.getAnimations?.() || []) {
    try {
      a.pause();
      a.currentTime = t;
    } catch {
      /* ignore */
    }
  }
  const runtime = frame.contentWindow?.__plateRuntime || frame.contentWindow?.__plateField;
  try {
    runtime?.renderAt?.(t);
  } catch {
    /* ignore */
  }
}

/**
 * Rebuild plate animations and land on `ms` (offset into the plate; 0 = open).
 * Used after Look / style / Direction changes so CSS tokens reflow without freezing mid-reveal.
 * Callers pass the current playhead offset so live edits keep your place.
 * No-ops while the composed text-edit frame is up — callers exit text mode first.
 */
function plateRestart(ms = 0) {
  const doc = plateFrameDoc();
  if (!doc?.body) return false;
  if (doc.body.classList.contains('studio-edit')) return false;
  // Drop a half-applied recreate style if a prior call was interrupted mid-flight.
  doc.getElementById('studio-anim-reset')?.remove();
  if (doc.body.dataset.motion !== '1') plateMotionMode();
  else recreatePlateAnimations(doc);
  plateSeek(ms);
  return true;
}

/** Back to the composed, editable frame (text editing). */
function plateTextMode(opts = {}) {
  const frame = $('plateFrame');
  const doc = frame?.contentDocument;
  if (!doc?.body) {
    opts.onReady?.();
    return;
  }
  const snapshot = snapshotPlateEdits(doc);
  delete doc.body.dataset.motion;
  enablePlateInlineEdit(frame, { snapshot, onReady: opts.onReady });
}

/** Reload the active plate's HTML after a server-side rebuild (look / style reset). */
function reloadActivePlate(plateId) {
  if (state.monitorMode !== 'plate') return;
  editor?.reloadPlate(plateId);
}

function plateFrameDoc() {
  try {
    return $('plateFrame')?.contentDocument || null;
  } catch {
    return null;
  }
}

/** Markup each field had before Studio armed it, so Replay runs the template's own reveal on untouched copy. */
const plateOriginalMarkup = new WeakMap(); // Document → Map<path, html>

const fieldKind = (el) => el.dataset.editKind || 'text';
const fieldOpts = (el) => ({ kind: fieldKind(el), beats: el.dataset.editBeats === '1' });
const fieldRaw = (el) => (el.getAttribute('data-edit-raw') ?? '').replace(/&#10;/g, '\n');
const blockNode = (n) =>
  n?.nodeType === 1 && (n.tagName === 'DIV' || n.tagName === 'P' || n.ownerDocument.defaultView.getComputedStyle(n).display === 'block');

/** Remember the template markup once, before the canonical edit markup replaces it. */
function learnField(el) {
  if (el.dataset.editArmed === '1') return;
  const doc = el.ownerDocument;
  if (!plateOriginalMarkup.has(doc)) plateOriginalMarkup.set(doc, new Map());
  const originals = plateOriginalMarkup.get(doc);
  if (!originals.has(el.dataset.edit)) originals.set(el.dataset.edit, el.innerHTML);
}

/**
 * Canonical edit markup: the field's own CSS on plain nodes — one <div> per title line, accents
 * as the tag the template paints them with (`data-edit-accent`), beats keeping their `·` colour.
 * What the user sees is what the plate renders after Save, gradient included.
 */
function renderFieldChars(el, chars) {
  el.innerHTML = toHtml(chars, {
    tag: el.dataset.editAccent || 'span',
    lines: fieldKind(el) === 'lines',
    sep: el.dataset.editBeats === '1',
  });
}
const renderField = (el, source) => renderFieldChars(el, parseSource(source));

/** The config value this field holds right now (`*accent*` markers, lines joined with \n). */
function fieldSourceOf(el) {
  return fieldSource(fromElement(el, { isBlock: blockNode }).chars, fieldOpts(el));
}

/** Selection inside an editable field, as char offsets on that field. */
function plateSelection() {
  const doc = plateFrameDoc();
  if (!doc?.body?.classList.contains('studio-edit')) return null;
  const sel = doc.getSelection();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const el = (node.nodeType === 1 ? node : node.parentElement)?.closest?.('[data-edit]');
  if (!el) return null;
  const { chars, offsets } = fromElement(el, {
    isBlock: blockNode,
    marks: [
      [range.startContainer, range.startOffset],
      [range.endContainer, range.endOffset],
    ],
  });
  return { el, chars, start: Math.min(...offsets), end: Math.max(...offsets) };
}

/** 'on' | 'off' | 'mixed' for the selected words, null when no field is selected. */
function currentAccentState() {
  const s = plateSelection();
  return s ? accentState(s.chars, s.start, s.end) : null;
}

/** Active field + accent for the editor inspector and Accent button. */
function plateSelectionDetail() {
  const doc = plateFrameDoc();
  const focused = doc?.activeElement?.closest?.('[data-edit]') || null;
  const s = plateSelection();
  const el = focused || s?.el || null;
  if (!el) return { accent: null, path: null, kind: null, source: null, dirty: false };
  return {
    accent: s ? accentState(s.chars, s.start, s.end) : null,
    path: el.dataset.edit || null,
    kind: fieldKind(el),
    source: el.dataset.editArmed === '1' ? fieldSourceOf(el) : fieldRaw(el),
    dirty: el.dataset.dirty === '1',
  };
}

function notifyPlateSelection() {
  window.dispatchEvent(new CustomEvent('plate-selection', { detail: plateSelectionDetail() }));
}

function ensurePlatePeekStyle(doc) {
  if (!doc?.head) return;
  let peek = doc.getElementById('studio-peek-style');
  if (!peek) {
    peek = doc.createElement('style');
    peek.id = 'studio-peek-style';
    doc.head.appendChild(peek);
  }
  peek.textContent = PLATE_PEEK_CSS;
}

/** Motion → text: a click on any `[data-edit]` asks the parent Studio to enter edit mode on that field. */
function bindPlateCanvasPick(doc) {
  if (!doc?.body || doc.body.dataset.canvasPick === '1') return;
  doc.body.dataset.canvasPick = '1';
  doc.addEventListener(
    'pointerdown',
    (e) => {
      if (doc.body.classList.contains('studio-edit')) return;
      if (doc.body.dataset.motion !== '1') return;
      const el = e.target?.closest?.('[data-edit]');
      const path = el?.dataset?.edit;
      if (!path) return;
      e.preventDefault();
      e.stopPropagation();
      const detail = { path };
      try {
        window.parent?.dispatchEvent?.(new CustomEvent('plate-canvas-edit', { detail }));
      } catch {
        /* cross-origin shouldn't happen for same-origin plates */
      }
      window.dispatchEvent(new CustomEvent('plate-canvas-edit', { detail }));
    },
    true
  );
}

/** Focus a field after text mode is armed; returns false if the path is missing. */
function focusPlateField(path) {
  const doc = plateFrameDoc();
  if (!doc?.body?.classList.contains('studio-edit') || !path) return false;
  const el = [...doc.querySelectorAll('[data-edit]')].find((n) => n.dataset.edit === path);
  if (!el) return false;
  doc.querySelectorAll('[data-edit].is-focused').forEach((n) => n.classList.remove('is-focused'));
  el.classList.add('is-focused');
  el.focus({ preventScroll: false });
  try {
    const range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    /* some plates use complex trees; focus alone is enough */
  }
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  notifyPlateSelection();
  return true;
}

function listPlateFields() {
  const doc = plateFrameDoc();
  if (!doc) return [];
  return [...doc.querySelectorAll('[data-edit]')].map((el) => ({
    path: el.dataset.edit,
    kind: fieldKind(el),
    source: el.dataset.editArmed === '1' ? fieldSourceOf(el) : fieldRaw(el),
    dirty: el.dataset.dirty === '1',
  }));
}

function setPlateFieldSource(path, source) {
  const doc = plateFrameDoc();
  if (!doc?.body?.classList.contains('studio-edit') || !path) return false;
  const el = [...doc.querySelectorAll('[data-edit]')].find((n) => n.dataset.edit === path);
  if (!el) return false;
  learnField(el);
  renderField(el, source == null ? '' : String(source));
  el.dataset.editArmed = '1';
  markFieldDirty(el);
  notifyPlateSelection();
  return true;
}

function selectFieldRange(el, start, end) {
  const doc = el.ownerDocument;
  const a = positionAt(el, start, { isBlock: blockNode });
  const b = positionAt(el, end, { isBlock: blockNode });
  const range = doc.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  const sel = doc.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function markFieldDirty(el) {
  el.dataset.dirty = '1';
  state.plateDirty = true;
  updatePlateEditChrome();
}

/** Accent the selected words (a caret takes its word); accented words lose it. Stage button and ⌘B. */
function toggleFieldAccent() {
  const s = plateSelection();
  if (!s) {
    toast('Select words first', 'Click into a text field, then Accent or ⌘B', 'warn');
    return false;
  }
  const r = toggleAccent(s.chars, s.start, s.end);
  if (!r) return false;
  renderFieldChars(s.el, r.chars);
  s.el.focus({ preventScroll: true });
  selectFieldRange(s.el, r.start, r.end);
  markFieldDirty(s.el);
  notifyPlateSelection();
  return true;
}

/** Typed `*word*` becomes an accent on the spot; the caret stays on the same character. */
function absorbTypedAccents(el) {
  const sel = el.ownerDocument.getSelection();
  if (!sel?.rangeCount) return;
  const range = sel.getRangeAt(0);
  const { chars, offsets } = fromElement(el, { isBlock: blockNode, marks: [[range.endContainer, range.endOffset]] });
  const plain = chars.map((c) => c.ch).join('');
  const re = /\*([^*\n]+)\*/g;
  const removed = [];
  let m;
  while ((m = re.exec(plain))) removed.push(m.index, m.index + m[0].length - 1);
  if (!removed.length) return;
  let on = false;
  const marked = [];
  for (let i = 0; i < chars.length; i++) {
    if (removed.includes(i)) {
      on = !on;
      continue;
    }
    marked.push({ ch: chars[i].ch, accent: on || chars[i].accent });
  }
  renderFieldChars(el, marked);
  const caret = offsets[0] - removed.filter((i) => i < offsets[0]).length;
  selectFieldRange(el, caret, caret);
}

function bindPlateEditDelegation(doc) {
  if (doc.body.dataset.editDelegated === '1') return;
  doc.body.dataset.editDelegated = '1';
  doc.body.addEventListener('input', (e) => {
    const el = e.target?.closest?.('[data-edit]');
    if (!el) return;
    markFieldDirty(el);
    absorbTypedAccents(el);
    notifyPlateSelection();
  });
  doc.body.addEventListener('keydown', (e) => {
    const el = e.target?.closest?.('[data-edit]');
    if (!el) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleFieldAccent();
    } else if (e.key === 'Tab') {
      const fields = [...doc.querySelectorAll('[data-edit]')];
      if (fields.length < 2) return;
      e.preventDefault();
      const i = fields.indexOf(el);
      const next = fields[(i + (e.shiftKey ? -1 : 1) + fields.length) % fields.length];
      focusPlateField(next.dataset.edit);
    } else if (e.key === 'Enter' && fieldKind(el) !== 'lines') {
      // Single-line copy: a line break has nowhere to go in the config.
      e.preventDefault();
    } else if (e.key === 'Escape') {
      el.blur();
      window.parent?.dispatchEvent?.(new CustomEvent('plate-canvas-done'));
    }
  });
  doc.body.addEventListener('focusin', (e) => {
    const el = e.target?.closest?.('[data-edit]');
    doc.querySelectorAll('[data-edit].is-focused').forEach((n) => n.classList.remove('is-focused'));
    if (el) el.classList.add('is-focused');
    notifyPlateSelection();
  });
  doc.addEventListener('selectionchange', notifyPlateSelection);
  doc.body.addEventListener('focusout', () => setTimeout(notifyPlateSelection, 0));
}

function armPlateEditables(doc) {
  doc.querySelectorAll('[data-edit]').forEach((el) => {
    learnField(el);
    if (el.dataset.editArmed !== '1') {
      el.dataset.editArmed = '1';
      renderField(el, fieldRaw(el));
    }
    el.setAttribute('contenteditable', 'plaintext-only');
    if (!el.isContentEditable) el.setAttribute('contenteditable', 'true');
    el.spellcheck = true;
  });
}

function snapshotPlateEdits(doc) {
  return [...doc.querySelectorAll('[data-edit]')].map((el) => ({
    path: el.dataset.edit,
    source: el.dataset.editArmed === '1' ? fieldSourceOf(el) : fieldRaw(el),
    dirty: el.dataset.dirty === '1',
  }));
}

/**
 * Put copy back after a rebuild or clone. With `motion`, untouched fields get the template's own
 * reveal markup back so Replay animates them; edited fields show their canonical markup.
 */
function restorePlateEdits(doc, snapshot, { motion = false } = {}) {
  if (!snapshot?.length) return;
  const byPath = Object.fromEntries(snapshot.map((s) => [s.path, s]));
  const originals = plateOriginalMarkup.get(doc);
  doc.querySelectorAll('[data-edit]').forEach((el) => {
    const s = byPath[el.dataset.edit];
    if (!s) return;
    learnField(el);
    if (motion && !s.dirty) {
      const orig = originals?.get(el.dataset.edit);
      if (orig != null) el.innerHTML = orig;
      delete el.dataset.editArmed;
      delete el.dataset.dirty;
      return;
    }
    renderField(el, s.source);
    el.dataset.editArmed = '1';
    if (s.dirty) el.dataset.dirty = '1';
    else delete el.dataset.dirty;
  });
  if (snapshot.some((s) => s.dirty)) {
    state.plateDirty = true;
    updatePlateEditChrome();
  }
}

function enablePlateInlineEdit(frame, { attempt = 0, snapshot = null, onReady = null } = {}) {
  const doc = frame?.contentDocument;
  if (!doc?.body) {
    onReady?.();
    return;
  }
  // Wait for first paint / animations so layout + SVG pathLength exist
  const ready = (doc.getAnimations?.() || []).length > 0 || attempt >= 6;
  if (!ready) {
    setTimeout(() => enablePlateInlineEdit(frame, { attempt: attempt + 1, snapshot, onReady }), 40);
    return;
  }

  const peakSec = plateEditPeakSec(doc);

  // Always refresh edit CSS (module may have updated since the iframe first loaded)
  let editStyle = doc.getElementById('studio-edit-style');
  if (!editStyle) {
    editStyle = doc.createElement('style');
    editStyle.id = 'studio-edit-style';
    doc.head.appendChild(editStyle);
  }
  editStyle.textContent = PLATE_EDIT_CSS;
  editStyle.disabled = false;
  ensurePlatePeekStyle(doc);

  doc.body.classList.add('studio-edit');
  doc.body.dataset.editPeak = peakSec.toFixed(2);
  if (String(doc.body.dataset.cardId || state.activePlateId || '').startsWith('overlay:')) {
    doc.body.dataset.composite = '1';
  }

  bindPlateEditDelegation(doc);
  bindPlateCanvasPick(doc);
  armPlateEditables(doc);
  doc.querySelectorAll('[data-edit]').forEach((el) => {
    if (el.dataset.edit) el.removeAttribute('title');
  });
  if (snapshot) restorePlateEdits(doc, snapshot);

  // Composed static frame — after copy restore, so mask/rise HTML is finished open
  composePlateForEdit(doc);
  requestAnimationFrame(() => {
    if (snapshot) restorePlateEdits(doc, snapshot);
    composePlateForEdit(doc);
    state.plateEditBound = true;
    onReady?.();
  });
}

/**
 * Replay plate motion in-place — keeps unsaved inline edits.
 * Does not reload the iframe (that would wipe dirty copy).
 */
function replayPlateInline() {
  const frame = $('plateFrame');
  const doc = frame?.contentDocument;
  if (!doc?.body) {
    toast('No plate loaded', '', 'warn');
    return;
  }
  if (state.plateReplayTimer) {
    clearTimeout(state.plateReplayTimer);
    state.plateReplayTimer = null;
  }

  // Blur any active editor so we snapshot final text
  try {
    doc.activeElement?.blur?.();
  } catch {
    /* ignore */
  }
  const snapshot = snapshotPlateEdits(doc);
  const peakSec = plateEditPeakSec(doc);
  const peakMs = Math.round(peakSec * 1000);

  // Let real motion play (including carousel waves) with current copy
  doc.body.classList.remove('studio-edit');
  clearPlateRevealOverrides(doc);
  const editStyle = doc.getElementById('studio-edit-style');
  if (editStyle) editStyle.disabled = true;
  doc.querySelectorAll('[data-edit]').forEach((el) => el.removeAttribute('contenteditable'));

  // Restart CSS animations without losing DOM text: clone the stage
  const stage = doc.querySelector('.stage');
  if (stage) {
    restorePlateEdits(doc, snapshot, { motion: true });
    // Clone drops data-studio-reveal inline styles so CSS animations can run clean
    stage.replaceWith(stage.cloneNode(true));
  } else {
    for (const a of doc.getAnimations?.() || []) {
      try {
        a.cancel();
      } catch {
        /* ignore */
      }
    }
    // Force reflow + play fresh if any remain
    void doc.body.offsetHeight;
    for (const a of doc.getAnimations?.() || []) {
      try {
        a.currentTime = 0;
        a.play();
      } catch {
        /* ignore */
      }
    }
  }

  // Re-apply snapshot onto cloned nodes immediately (clone already has text; dirty flags)
  restorePlateEdits(doc, snapshot, { motion: true });
  setMonitorLabel(
    state.activePlateId ? `Plate · ${(state.htmlPlates || []).find((p) => p.id === state.activePlateId)?.label || state.activePlateId}` : 'Plate HTML',
    state.plateDirty ? 'Replaying with unsaved edits…' : 'Replaying…'
  );
  if ($('btnPlateReplay')) buttonBusy($('btnPlateReplay'), true);

  state.plateReplayTimer = setTimeout(() => {
    state.plateReplayTimer = null;
    enablePlateInlineEdit(frame, { snapshot });
    buttonBusy($('btnPlateReplay'), false);
    setMonitorLabel(
      state.activePlateId
        ? `Plate · ${(state.htmlPlates || []).find((p) => p.id === state.activePlateId)?.label || state.activePlateId}`
        : 'Plate HTML',
      state.plateDirty ? 'Unsaved edits · Replay anytime · Save when ready' : 'Inline edit · timeline paused on this plate'
    );
  }, Math.max(700, peakMs));
}

function collectPlateEdits() {
  const doc = plateFrameDoc();
  if (!doc) return {};
  const fields = {};
  doc.querySelectorAll('[data-edit][data-dirty="1"]').forEach((el) => {
    const path = el.dataset.edit;
    if (!path) return;
    fields[path] = fieldSourceOf(el);
  });
  return fields;
}

async function savePlateCopyEdits() {
  const plateId = state.activePlateId;
  if (!plateId) return;
  const fields = collectPlateEdits();
  if (!Object.keys(fields).length) {
    toast('Nothing to save', 'Edit a text field first', 'warn');
    return;
  }
  buttonBusy($('btnPlateSaveCopy'), true);
  try {
    const r = await api(`/api/video/${state.slug}/plates/${encodeURIComponent(plateId)}/copy`, {
      method: 'POST',
      body: { fields },
    });
    state.plateDirty = false;
    state.htmlPlates = r.plates || state.htmlPlates;
    renderHtmlPlatePicker(state.htmlPlates);
    editor?.markDirty();
    await editor?.reloadPlate(plateId);
    const live = String(plateId).startsWith('overlay:');
    toast('Text saved', live ? `${Object.keys(fields).length} field(s) → flow.mjs` : `${Object.keys(fields).length} field(s) updated on the plate`);
    setStatus(
      'warn',
      live
        ? 'Live card copy updated — preview is live · Produce to bake into the master'
        : 'Plate copy updated — Approve plate or Render full when ready'
    );
    updatePlateEditChrome();
  } catch (err) {
    toast('Save failed', err.message, 'err');
  } finally {
    buttonBusy($('btnPlateSaveCopy'), false);
  }
}

async function discardPlateCopyEdits() {
  const plateId = state.activePlateId;
  if (!plateId) return;
  state.plateDirty = false;
  await editor?.reloadPlate(plateId);
  updatePlateEditChrome();
}

async function openPlateFromScene(scene) {
  if (!scene?.editable) return;
  if (!state.htmlPlates?.some((p) => p.id === scene.plateId)) {
    await rebuildPlateHtmlPreview({ selectFirst: false, plateId: scene.plateId });
  }
  const plate = (state.htmlPlates || []).find((p) => p.id === scene.plateId);
  if (plate) showPlateHtml(plate);
  else toast('No HTML yet', 'Rebuild plates first', 'warn');
}

function renderScenes(scenes) {
  state.scenes = scenes || [];
  const chips = $('sceneChips');
  if (!chips) return;
  const plates = state.scenes.filter((s) => s.editable);
  chips.innerHTML = plates.length
    ? plates
        .map(
          (s) =>
            `<button type="button" data-scene-id="${escapeHtml(s.id)}" title="${escapeHtml(s.title)} · ${fmtShort(
              s.start
            )}">${escapeHtml(s.title)}</button>`
        )
        .join('')
    : zen('film', 'No chapters yet 🎞️', 'Render once to build the scene list.', { mini: true });
  updateSceneFromTime(activePlayer().currentTime || 0);
}

function updateSceneFromTime(t) {
  const scenes = state.scenes || [];
  if (!scenes.length) {
    state.currentScene = null;
    if ($('sceneTitle')) {
      $('sceneKind').textContent = '—';
      $('sceneKind').className = 'scene-kind';
      $('sceneTitle').textContent = 'No scenes yet';
      $('sceneHint').textContent = 'Make a video once so scenes appear';
      $('btnEditScene').disabled = true;
      if ($('btnAskAiScene')) $('btnAskAiScene').disabled = true;
      $('btnMotionScene').disabled = true;
    }
    return;
  }
  let cur = scenes.find((s) => t >= s.start - 0.05 && t < s.end - 0.02) || scenes[scenes.length - 1];
  // In plate editor, keep the scene bar pinned to the plate being edited
  if (state.monitorMode === 'plate' && state.activePlateId) {
    const pinned = scenes.find((s) => s.plateId === state.activePlateId);
    if (pinned) cur = pinned;
  } else if (state.editingPlateId) {
    const locked = scenes.find((s) => s.plateId === state.editingPlateId);
    if (locked && state.proposalOpen) cur = locked;
  }
  state.currentScene = cur;
  const kind = $('sceneKind');
  kind.textContent = cur.kind === 'plate' ? 'Plate' : 'Live';
  kind.className = `scene-kind ${cur.kind}`;
  $('sceneTitle').textContent = cur.title;
  $('sceneHint').textContent = cur.editable
    ? state.monitorMode === 'plate'
      ? `${fmtShort(cur.start)}–${fmtShort(cur.end)} · click text to edit · Replay / Save · timeline locked`
      : `${fmtShort(cur.start)}–${fmtShort(cur.end)} · Edit plate for copy, look and style · Ask AI for agent help`
    : `${fmtShort(cur.start)}–${fmtShort(cur.end)} · Edit clip for speed, zoom and transitions`;
  $('btnEditScene').disabled = false;
  if ($('btnAskAiScene')) $('btnAskAiScene').disabled = !cur.editable;
  $('btnMotionScene').disabled = !cur.editable;
  if ($('btnEditScene')) {
    const editingPlate = state.monitorMode === 'plate' && cur.editable && cur.plateId === state.activePlateId;
    const editingLive = state.monitorMode === 'plate' && !cur.editable && editor?.selection?.kind === 'live' && editor.selection.scene?.id === cur.id;
    const editing = editingPlate || editingLive;
    $('btnEditScene').classList.toggle('primary', !editing);
    if ($('btnEditSceneLabel')) $('btnEditSceneLabel').textContent = editing ? 'Editing…' : cur.editable ? 'Edit plate' : 'Edit clip';
  }
  document.querySelectorAll('#sceneChips button').forEach((b) => {
    b.classList.toggle('active', b.dataset.sceneId === cur.id);
  });
}

/** Open the inline plate editor for the current (or given) plate scene. */
async function editCurrentPlate(scene = state.currentScene) {
  if (scene && !scene.editable && scene.kind === 'live') {
    editor?.selectLive(scene);
    return;
  }
  if (!scene?.editable) {
    toast('Pick a clip', 'Click a plate or live slice on the timeline, or a chip below', 'warn');
    return;
  }
  try {
    await openPlateFromScene(scene);
    toast('Plate editor', 'Click text to edit · Replay keeps unsaved changes · Save when ready');
  } catch (err) {
    toast('Could not open plate', err.message, 'err');
  }
}

/**
 * Prepare AI feedback for this plate — does NOT start the agent.
 * Opens the plate for context, focuses Feedback, and waits for Apply.
 */
async function askAiForCurrentScene({ motion = false } = {}) {
  const scene = state.currentScene;
  if (!scene?.editable) {
    toast('Pick a plate', 'Click a plate tip on the timeline first', 'warn');
    return;
  }
  state.editingPlateId = scene.plateId;
  try {
    await openPlateFromScene(scene);
  } catch {
    /* still open feedback even if HTML missing */
  }
  document.querySelector('.tools-panel .ptab[data-right="feedback"]')?.click();
  const note = $('improveNote');
  if (note) {
    const prefix = motion
      ? `Motion on “${scene.title}”: `
      : `On the “${scene.title}” plate: `;
    if (!note.value.trim()) {
      note.value = prefix;
    } else if (!note.value.includes(scene.title)) {
      note.value = `${prefix}${note.value.trim()}`;
    }
    note.focus();
    const len = note.value.length;
    note.setSelectionRange(len, len);
  }
  // Mark which improve goal / plate the next Apply should use
  if ($('btnImprove')) {
    $('btnImprove').dataset.improve = motion ? 'motion' : 'scene';
    $('btnImprove').dataset.plateId = scene.plateId;
    $('btnImprove').textContent = motion ? `Apply motion · ${scene.title}` : `Apply feedback · ${scene.title}`;
  }
  toast('Describe the change', 'Then click Apply — nothing runs until you do', 'info');
}

/** Open Motion panel for templates — does not enqueue an agent job. */
function openMotionForCurrentScene() {
  const scene = state.currentScene;
  if (scene?.editable) state.editingPlateId = scene.plateId;
  document.querySelector('.tools-panel .ptab[data-right="motion"]')?.click();
  toast('Motion templates', 'Pick a template, Preview plates, then Approve — or Ask AI for a note', 'info');
}

/** @deprecated — kept for any leftover callers; opens editor */
async function previewCurrentScene() {
  return editCurrentPlate();
}

function improveCurrentScene({ motion = false } = {}) {
  // Legacy auto-run path — prefer askAiForCurrentScene so the user confirms
  askAiForCurrentScene({ motion });
}

async function approvePlateOnly() {
  const plateId = state.editingPlateId || state.currentScene?.plateId;
  if (!plateId) {
    toast('No plate selected', '', 'warn');
    return;
  }
  if (state.jobBusy) {
    toast('Busy', 'Wait for the current job, or it will conflict — try again when Ready', 'warn');
    return;
  }
  buttonBusy($('btnApprovePlate'), true);
  state.jobBusy = true;
  try {
    await api(`/api/video/${state.slug}/draft/approve`, { method: 'POST', body: {} });
    hideProposal();
    setStatus('run', `Encoding plate ${plateId}…`);
    state.activeSurface = 'render';
    showLeftTab('render');
    const r = await api(`/api/video/${state.slug}/scenes/${encodeURIComponent(plateId)}/render`, {
      method: 'POST',
      body: { scope: 'plate' },
    });
    await watchJob(r.job.id, { surface: 'render' });
    await loadVideo(state.slug);
    hideProposal();
    resetThinkSteps();
    state.editingPlateId = null;
    $('btnApprovePlate').hidden = true;
    // Preview the freshly encoded plate MP4 in Program (keepPreview so we don't wipe it with the master).
    const scene = state.scenes.find((s) => s.plateId === plateId);
    if (scene?.mp4Url) {
      playPlatePreview(scene.mp4Url, scene.title || plateId);
    } else {
      setMonitorMode('program');
    }
    toast('Plate encoded', 'Full video still uses old cut until you Render full');
    setStatus('warn', 'Plate updated — Render full when ready');
    showLeftTab('render');
    if ($('renderStatusPill')) {
      $('renderStatusPill').className = 'render-pill warn';
      $('renderStatusPill').textContent = 'Plate updated';
    }
    if ($('renderHeadline')) $('renderHeadline').textContent = 'Plate changed — update the master?';
    if ($('renderReason')) {
      $('renderReason').textContent =
        'This plate MP4 is new. Render stitches plates + live + audio into the Program master.';
    }
    const primary = $('btnActionPrimary');
    if (primary) {
      primary.hidden = false;
      primary.dataset.mode = 'quick';
      const lab = primary.querySelector('.cta-label');
      if (lab) lab.textContent = 'Render full video';
    }
    if ($('btnActionSecondary')) $('btnActionSecondary').hidden = true;
  } catch (err) {
    toast('Plate render failed', err.message, 'err');
  } finally {
    buttonBusy($('btnApprovePlate'), false);
    state.jobBusy = false;
    state.activeSurface = null;
    drainQueue();
  }
}

async function rebuildPlateHtmlPreview({ selectFirst = true, plateId = null } = {}) {
  setThinkStep('html');
  setStatus('run', 'Rebuilding plate HTML…');
  const r = await api(`/api/video/${state.slug}/plates/rebuild-html`, { method: 'POST', body: {} });
  // Drop the ready-cache: the same plate id now points at new HTML (bg, atmosphere, palette).
  state.plateFrameReady = null;
  renderHtmlPlatePicker(r.plates || []);
  if (r.motion && state.video) state.video.motion = r.motion;
  renderMotionMeta(r.motion);
  const plates = r.plates || [];
  const target =
    (plateId && plates.find((p) => p.id === plateId)) ||
    (selectFirst ? plates[0] : null) ||
    (state.activePlateId && plates.find((p) => p.id === state.activePlateId)) ||
    null;
  if (editor?.active) {
    // Editor owns the stage: force-reload the plate on the playhead so Look/Direction land live.
    await editor.invalidatePlates();
  } else if (target) {
    setThinkStep('preview');
    showPlateHtml(target);
  }
  return r;
}

/** Return a plate only when the note itself names one; ambient UI selection never narrows smart scope. */
function inferPlateIdFromFeedback(note) {
  const n = String(note || '').toLowerCase();
  const scenes = (state.scenes || []).filter((s) => s.editable);

  for (const s of scenes) {
    const needles = [s.plateId, s.id, s.title, s.type]
      .filter(Boolean)
      .map((x) => String(x).toLowerCase());
    if (needles.some((k) => k.length >= 3 && n.includes(k))) return s.plateId;
  }

  if (/\b(intro(?:duction)?|opening|open plate|brand open)\b/.test(n)) return 'open';
  if (/\b(close|outro|ending|end plate|summary plate)\b/.test(n)) return 'close';

  // Logo size/position without a named plate → open (Introduction)
  if (/\b(logo|lockup)\b/.test(n) && /\b(small(?:er)?|big(?:ger)?|large(?:r)?|high(?:er)?|low(?:er)?|up|down|size|position)\b/.test(n)) {
    return 'open';
  }

  return null;
}

async function previewPlateAfterEdit(plateId) {
  await rebuildPlateHtmlPreview({ selectFirst: !plateId, plateId });
  await loadVideo(state.slug);
  const plates = state.htmlPlates?.length
    ? state.htmlPlates
    : (await api(`/api/video/${state.slug}/plates`)).plates;
  renderHtmlPlatePicker(plates || []);
  const plate =
    (plateId && (plates || []).find((p) => p.id === plateId)) ||
    (plates || []).find((p) => p.id === state.activePlateId) ||
    (plates || [])[0];
  if (plate) {
    state.editingPlateId = plate.id;
    showPlateHtml(plate); // cache-bust src → animations replay from t=0
  }
  return plate;
}

function syncCompare() {
  const v = state.video;
  if (!v?.deliveryUrl) return;
  const t = $('player').currentTime || 0;
  $('playerA').src = v.deliveryUrl + `?t=${Date.now()}`;
  $('playerA').muted = false;
  const id = $('compareSelect').value;
  const empty = $('compareEmpty');
  if (id) {
    empty.hidden = true;
    $('playerB').hidden = false;
    $('playerB').src = `/version-media/${state.slug}/${id}/${state.slug}.mp4`;
  } else {
    empty.hidden = false;
    $('playerB').removeAttribute('src');
    $('playerB').hidden = true;
  }
  const seek = () => {
    try {
      $('playerA').currentTime = t;
      if (id) $('playerB').currentTime = t;
    } catch {
      /* ignore */
    }
  };
  $('playerA').addEventListener('loadedmetadata', seek, { once: true });
  if (id) $('playerB').addEventListener('loadedmetadata', seek, { once: true });
}

function renderQc(qc) {
  const badge = $('qcBadge');
  if (!qc) {
    badge.textContent = '—';
    badge.className = 'badge';
    $('qcBox').innerHTML = zen('checklist', 'No checks yet ✅', 'Render or Export once and the quality report lands here.');
    return;
  }
  badge.textContent = qc.status;
  badge.className = `badge ${qc.status}`;
  const findings = (qc.findings || []).slice(0, 6);
  $('qcBox').innerHTML = findings.length
    ? findings
        .map((f) => `<div class="qc-item ${f.severity}"><span class="tag">${f.severity}</span>${escapeHtml(f.message)}</div>`)
        .join('')
    : zen('checklist', 'All clear 🎉', 'Nothing to flag in the last render.', { mini: true });
}

function clockShort(sec) {
  if (!Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function syncHandoffDownloadLinks(v) {
  const zipUrl = v?.handoffZipUrl;
  for (const id of ['btnDownloadHandoff', 'linkHandoffZip']) {
    const el = $(id);
    if (!el) continue;
    if (zipUrl) {
      el.hidden = false;
      el.href = `${zipUrl}?t=${Date.now()}&download=1`;
      el.setAttribute('download', `${v.slug}-handoff.zip`);
    } else {
      el.hidden = true;
      el.removeAttribute('href');
    }
  }
  if ($('mediaHandoffHint')) {
    $('mediaHandoffHint').textContent = zipUrl
      ? 'Pack ready — MP4, poster, captions, chapters, QC stills.'
      : 'Export builds the pack · Download zip when ready.';
  }
}

function renderHandoff(v) {
  const d = v.deliver;
  const badge = $('handoffBadge');
  syncHandoffDownloadLinks(v);
  if (!d) {
    badge.hidden = true;
    $('handoffBox').innerHTML = zen('box', 'No pack yet 📦', 'Export builds the poster, captions, chapters and stills.');
    $('btnCopyYt').disabled = !v.youtubeChaptersUrl;
    $('linkReadme').hidden = true;
    return;
  }
  badge.hidden = false;
  badge.className = 'badge ok';
  badge.textContent = 'Ready';
  const stillN = Array.isArray(d.stills) ? d.stills.length : 0;
  $('handoffBox').innerHTML = `<div><strong>${clockShort(d.durationSec)}</strong> · ${d.sizeMB} MB · ${d.chapterCount} chapters${
    stillN ? ` · ${stillN} stills` : ''
  }${d.posterSource === 'manual' ? ' · poster set in Studio' : ''}</div>`;
  $('btnCopyYt').disabled = !v.youtubeChaptersUrl;
  if (d.readmeUrl) {
    $('linkReadme').hidden = false;
    $('linkReadme').href = d.readmeUrl;
  } else $('linkReadme').hidden = true;
}

function renderPoster(v) {
  if (v?.posterUrl) {
    $('posterImg').hidden = false;
    $('posterImg').src = v.posterUrl + `?t=${Date.now()}`;
    $('posterEmpty').hidden = true;
  } else {
    $('posterImg').hidden = true;
    $('posterEmpty').hidden = false;
  }
  const line = $('posterMetaLine');
  if (line) {
    const pm = v?.posterMeta;
    if (pm && Number.isFinite(pm.atSec)) {
      line.hidden = false;
      line.textContent = `Frame ${clockShort(pm.atSec)} · ${pm.source === 'manual' ? 'set in Studio' : 'auto on Export'}`;
    } else {
      line.hidden = true;
    }
  }
  if ($('btnSetPoster')) $('btnSetPoster').disabled = !v?.hasDelivery;
}

async function setPosterFromCurrentFrame() {
  const v = state.video;
  if (!v?.hasDelivery) {
    toast('No delivery yet', 'Render the sequence first', 'warn');
    return;
  }
  if (state.monitorMode === 'plate') {
    toast('Switch to Program', 'Scrub to the frame you want, then Set poster', 'warn');
    setMonitorMode('program');
    return;
  }
  const atSec = activePlayer().currentTime || 0;
  buttonBusy($('btnSetPoster'), true);
  try {
    const r = await api(`/api/video/${state.slug}/poster`, {
      method: 'POST',
      body: { atSec },
    });
    if (r.summary) {
      state.video = { ...state.video, ...r.summary };
    } else {
      state.video.posterUrl = r.posterUrl;
      state.video.posterMeta = r.meta;
    }
    renderPoster(state.video);
    renderHandoff(state.video);
    toast('Poster set', `Frame at ${clockShort(atSec)}`);
    setStatus('ok', `Poster @ ${clockShort(atSec)}`);
  } catch (err) {
    toast('Poster failed', err.message, 'err');
  } finally {
    buttonBusy($('btnSetPoster'), false);
  }
}

async function downloadHandoffZip({ buildIfMissing = true } = {}) {
  buttonBusy($('btnBuildHandoffZip'), true);
  buttonBusy($('btnExportMedia'), true);
  try {
    if (!state.video?.deliver && buildIfMissing) {
      toast('Building handoff…', 'Poster, captions, stills, zip');
      enqueueJob({ kind: 'step', step: 'deliver', force: false, label: 'Export handoff pack' });
      return;
    }
    const r = await api(`/api/video/${state.slug}/deliverables/zip`, { method: 'POST', body: {} });
    state.video.handoffZipUrl = r.zipUrl;
    syncHandoffDownloadLinks(state.video);
    // Trigger browser download
    const a = document.createElement('a');
    a.href = `${r.zipUrl}?t=${Date.now()}&download=1`;
    a.download = `${state.slug}-handoff.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Downloading zip', `${r.sizeMB} MB`);
  } catch (err) {
    toast('Zip failed', err.message, 'err');
  } finally {
    buttonBusy($('btnBuildHandoffZip'), false);
    buttonBusy($('btnExportMedia'), false);
  }
}

function formatVersionWhen(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function versionDisplayName(ver) {
  if (ver.displayName) return ver.displayName;
  if (ver.name && ver.title) return `${ver.name} · ${ver.title}`;
  return ver.title || ver.label || ver.name || ver.id;
}

function renderVersions(v) {
  const versions = v.versions || [];
  const showCheckpoints = Boolean($('togShowCheckpoints')?.checked);
  const visible = showCheckpoints ? versions : versions.filter((ver) => ver.kind !== 'checkpoint');
  const releases = versions.filter((ver) => ver.kind !== 'checkpoint');
  const checkpoints = versions.filter((ver) => ver.kind === 'checkpoint');

  const countEl = $('versionCount');
  if (countEl) {
    if (!versions.length) countEl.textContent = 'No versions yet';
    else if (!showCheckpoints && checkpoints.length) {
      countEl.textContent = `${releases.length} version${releases.length === 1 ? '' : 's'} · ${checkpoints.length} checkpoint${checkpoints.length === 1 ? '' : 's'} hidden`;
    } else {
      countEl.textContent = `${versions.length} in history · latest ${versions[0]?.name || '—'}`;
    }
  }

  $('compareSelect').innerHTML = versions.length
    ? versions
        .map((ver) => {
          const mark = ver.kind === 'checkpoint' ? ' · checkpoint' : '';
          return `<option value="${ver.id}">${escapeHtml(versionDisplayName(ver))}${mark}</option>`;
        })
        .join('')
    : `<option value="">No versions</option>`;
  $('togCompare').disabled = !versions.length || !v.deliveryUrl;
  if (!versions.length && state.compare) setCompare(false);

  const list = $('versions');
  if (!list) return;
  if (!versions.length) {
    list.innerHTML = `<li class="version-empty">${zen('clapper', 'No versions yet 🎬', 'Finish a Render or click <strong>Save version</strong>. Every render also leaves a checkpoint.', { html: true })}</li>`;
    return;
  }
  if (!visible.length) {
    list.innerHTML = `<li class="version-empty">${zen('clapper', 'Only checkpoints so far 🎬', 'Turn on “Show pipeline checkpoints” or save a named version.')}</li>`;
    return;
  }

  list.innerHTML = visible
    .map((ver) => {
      const isLatestRelease = ver.kind !== 'checkpoint' && ver.id === releases[0]?.id;
      const when = formatVersionWhen(ver.createdAt);
      const dur = Number.isFinite(ver.durationSec) ? fmtShort(ver.durationSec) : '—';
      const size = ver.sizeMB != null ? `${ver.sizeMB} MB` : '';
      const qcLabel = { warn: 'QC warnings', fail: 'QC failed', bad: 'QC failed' }[ver.qcStatus];
      const chips = [
        ver.kind === 'checkpoint' ? '<span class="ver-chip muted">Checkpoint</span>' : '',
        isLatestRelease ? '<span class="ver-chip accent">Latest</span>' : '',
        ver.hasAudio ? '' : '<span class="ver-chip muted">Silent</span>',
        ver.hasCaptions ? '' : '<span class="ver-chip muted">No captions</span>',
        qcLabel ? `<span class="ver-chip qc-${escapeHtml(ver.qcStatus)}">${qcLabel}</span>` : '',
      ]
        .filter(Boolean)
        .join('');
      return `<li class="version-card ${ver.kind === 'checkpoint' ? 'is-checkpoint' : ''} ${isLatestRelease ? 'is-latest' : ''}" data-ver-id="${escapeHtml(ver.id)}">
        <div class="version-card-top">
          <span class="version-badge" title="Version number">${escapeHtml(ver.name || `v${ver.number || '?'}`)}</span>
          <div class="version-card-titles">
            <strong class="version-card-title">${escapeHtml(ver.title || ver.label || 'Snapshot')}</strong>
            <span class="version-card-meta" title="${escapeHtml(size)}">${escapeHtml([when, dur].filter(Boolean).join(' · '))}</span>
          </div>
        </div>
        ${chips ? `<div class="version-chips">${chips}</div>` : ''}
        ${ver.note && !/^(studio|cli|auto)/i.test(ver.note) ? `<p class="version-note">${escapeHtml(ver.note)}</p>` : ''}
        <div class="version-actions icon-actions">
          ${iconBtn('play', ver.id, `Play ${ver.name || ''}`)}
          ${iconBtn('compare', ver.id, `Compare ${ver.name || ''}`)}
          ${iconBtn('restore', ver.id, `Restore ${ver.name || ''}`)}
        </div>
      </li>`;
    })
    .join('');
}

function renderCritic(v) {
  const hint = $('criticHint');
  const link = $('criticLink');
  if (hint && link) {
    hint.hidden = !v.criticUrl;
    if (v.criticUrl) link.href = v.criticUrl;
  }
  const full = $('criticReportLink');
  if (full) {
    full.hidden = !v.criticUrl;
    if (v.criticUrl) full.href = v.criticUrl;
  }
}

/** Story section: purpose picker, framework and the spine with plate coverage. */
function renderStory(story) {
  const seg = $('storyPurpose');
  if (!seg || !story) return;
  seg.innerHTML = (story.options || [])
    .map(
      (o) => `<label title="${escapeHtml(o.framework)} — ${escapeHtml(o.hint)}"><input type="radio" name="storyPurpose" value="${o.id}" ${
        o.id === story.purpose ? 'checked' : ''
      } /><span>${escapeHtml(o.short || o.label)}</span></label>`
    )
    .join('');
  const badge = $('storyBadge');
  if (badge) {
    badge.hidden = story.explicit;
    badge.title = 'Guessed from the audience line — confirm it so every agent pass follows one spine.';
  }
  $('storyFramework').innerHTML = `<strong>${escapeHtml(story.label)}</strong> · ${escapeHtml(story.framework)}`;
  $('storySpine').innerHTML = (story.beats || [])
    .map(
      (b) => `<li class="${b.covered === false ? 'is-gap' : b.covered ? 'is-covered' : ''}" title="${escapeHtml(b.job)}">
        <span class="beat-dot" aria-hidden="true"></span>
        <strong>${escapeHtml(b.id)}</strong><em>${escapeHtml(b.where)}</em>${
          b.plates ? `<i>${b.covered ? 'plate in place' : `needs ${escapeHtml(b.plates.slice(0, 3).join(' / '))}`}</i>` : ''
        }
      </li>`
    )
    .join('');
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

/** Critic findings with one-click Fix (hands the finding to the agent as a director note). */
function renderCriticFindings(critic) {
  const box = $('criticFindings');
  const badge = $('criticBadge');
  if (!box || !badge) return;
  const apply = $('btnCriticApply');
  const run = $('btnCriticRun');
  if (!critic) {
    badge.textContent = '—';
    badge.className = 'badge';
    box.innerHTML = zen('loupe', 'Nothing reviewed yet 🔍', 'Run the critic to read narration and plates against the spine.');
    if (apply) apply.hidden = true;
    if (run) run.textContent = 'Run critic';
    return;
  }
  const n = critic.findings.length;
  badge.textContent = critic.stale ? 'stale' : n ? `${critic.high ? `${critic.high} high · ` : ''}${n}` : 'clean';
  badge.className = `badge ${critic.stale ? 'warn' : critic.high ? 'fail' : n ? 'warn' : 'ok'}`;
  badge.title = critic.stale ? 'Config or narration changed since this report — run again.' : `Reviewed ${new Date(critic.generatedAt).toLocaleString()}`;
  if (run) run.textContent = critic.stale ? 'Run critic again' : 'Run critic';
  if (apply) apply.hidden = !critic.findings.some((f) => f.severity === 'high' && /^narration:/.test(f.target));
  const findings = [...critic.findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  box.innerHTML = findings.length
    ? findings
        .map((f, i) => criticFindingMarkup(f, i))
        .join('')
    : `<p class="empty-inline">Clean — narration and plates follow the ${escapeHtml(critic.purpose || 'story')} spine.</p>`;
  box.__findings = findings;
}

async function runCriticFromStudio({ force = true } = {}) {
  const btn = $('btnCriticRun');
  buttonBusy(btn, true);
  try {
    await api(`/api/video/${state.slug}/critic`, { method: 'POST', body: { force } });
    await loadVideo(state.slug);
    document.querySelector('.tools-panel .ptab[data-right="review"]')?.click();
    toast('Critic done', `${state.video?.critic?.findings?.length ?? 0} finding(s)`);
  } catch (err) {
    toast('Critic failed', err.message, 'err');
  } finally {
    buttonBusy(btn, false);
  }
}

function fixFindingWithAi(f) {
  const note = directorNoteForFinding(f);
  const plate = /^([a-z0-9-]+)\.(title|copy|items|steps)/.exec(f.target)?.[1] || (/^(open|close)\./.test(f.target) ? f.target.split('.')[0] : null);
  const noteEl = $('improveNote');
  if (noteEl) noteEl.value = note;
  const btn = $('btnImprove');
  if (btn && plate) {
    btn.dataset.plateId = plate;
    btn.dataset.improve = 'plates';
  }
  document.querySelector('.tools-panel .ptab[data-right="feedback"]')?.click();
  startImprove(/^narration/.test(f.target) ? 'narration' : plate ? 'plates' : 'full');
}

/* ——— Plate accent (per-plate motion override) ——— */
function accentOptions(select, values, labels = {}) {
  if (!select) return;
  select.innerHTML = [`<option value="">Video default</option>`, ...values.map((v) => `<option value="${v}">${escapeHtml(labels[v] || v)}</option>`)].join('');
}

function currentPlateConfig(plateId) {
  if (!plateId) return null;
  if (plateId === 'open' || plateId === 'close') return { id: plateId, overrides: state.video?.plateAccents?.[plateId] || [] };
  return (state.video?.interstitials || []).find((i) => i.id === plateId) || null;
}

async function loadPlateAccent(plateId) {
  const pop = $('plateAccentPop');
  if (!pop) return;
  const opts = state.video?.motionOptions || {};
  accentOptions($('accentAtmosphere'), opts.atmospheres || [], opts.atmosphereLabels || {});
  accentOptions($('accentReveal'), opts.titleReveals || []);
  accentOptions($('accentDepth'), opts.depths || []);
  accentOptions($('accentEnergy'), opts.energies || []);
  let motion = {};
  try {
    const cfg = (await api(`/api/video/${state.slug}/config`)).config;
    motion = (plateId === 'open' || plateId === 'close' ? cfg[plateId]?.motion : cfg.interstitials?.find((i) => i.id === plateId)?.motion) || {};
  } catch {
    motion = {};
  }
  $('accentAtmosphere').value = motion.atmosphere || '';
  $('accentReveal').value = motion.titleReveal || '';
  $('accentDepth').value = motion.depth || '';
  $('accentEnergy').value = motion.energy || '';
  $('accentSheen').value = motion.sheen === true ? 'on' : motion.sheen === false ? 'off' : '';
  renderAccentState(Object.keys(motion));
}

function renderAccentState(keys) {
  const n = keys.filter((k) => ['atmosphere', 'titleReveal', 'depth', 'sheen', 'energy'].includes(k)).length;
  $('plateAccentState').textContent = n ? `${n} override${n > 1 ? 's' : ''} on this plate` : 'Follows the video';
  $('btnAccentReset').disabled = !n;
  $('btnPlateAccent').classList.toggle('is-on', n > 0);
}

async function savePlateAccent(patch) {
  const plateId = state.activePlateId;
  if (!plateId) return;
  try {
    // Optimistic CSS look while the rebuild runs (same tokens as Direction effects).
    if (!patch.reset) {
      const next = { ...(state.video?.motion || {}), ...patch };
      if (patch.sheen === 'on' || patch.sheen === true) next.sheen = true;
      if (patch.sheen === 'off' || patch.sheen === false) next.sheen = false;
      paintMotionLiveOptimistic(next);
    }
    const r = await api(`/api/video/${state.slug}/plates/${encodeURIComponent(plateId)}/motion`, { method: 'POST', body: patch });
    renderAccentState(Object.keys(r.motion || {}));
    await previewPlateAfterEdit(plateId);
    if (!$('plateAccentPop')?.hidden) loadPlateAccent(plateId);
    toast(patch.reset ? 'Plate follows the video' : 'Plate accent saved', plateId);
  } catch (err) {
    toast('Accent not saved', err.message, 'err');
  }
}

function togglePlateAccent(open) {
  const pop = $('plateAccentPop');
  const btn = $('btnPlateAccent');
  if (!pop || !btn) return;
  const next = open ?? pop.hidden;
  pop.hidden = !next;
  btn.setAttribute('aria-expanded', String(next));
  if (next) loadPlateAccent(state.activePlateId);
}

function wirePanelResize() {
  const root = document.documentElement;
  const stored = JSON.parse(localStorage.getItem('wt-studio-panels') || '{}');
  if (stored.left) root.style.setProperty('--left-w', `${stored.left}px`);
  if (stored.right) root.style.setProperty('--right-w', `${stored.right}px`);
  // Editor timeline height (Program uses the shorter --tl-h scrubber).
  // Floor 280 so chapter/caption rows + voice/music stay reachable after the extra lanes landed.
  const TL_MIN = 280;
  const TL_MAX = 620;
  const TL_DEFAULT = 400;
  let tl = Number(stored.tl);
  if (!Number.isFinite(tl)) {
    try {
      tl = Number(localStorage.getItem('wts.timeline.height'));
    } catch {
      tl = NaN;
    }
  }
  let tlExpanded = Number.isFinite(tl) && tl >= 180 && tl <= TL_MAX ? Math.round(Math.max(tl, TL_MIN)) : TL_DEFAULT;
  root.style.setProperty('--tl-h-editor', `${tlExpanded}px`);
  let tlCollapsed = !!stored.tlCollapsed;

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const readPx = (name, fallback) => parseInt(getComputedStyle(root).getPropertyValue(name), 10) || fallback;
  const save = () => {
    localStorage.setItem(
      'wt-studio-panels',
      JSON.stringify({
        left: readPx('--left-w', 220),
        right: readPx('--right-w', 280),
        tl: tlExpanded,
        tlCollapsed,
      })
    );
  };
  const syncTlToggle = () => {
    document.body.classList.toggle('tl-collapsed', tlCollapsed);
    for (const el of [$('etlToggle'), $('tlLabel')]) {
      if (!el) continue;
      el.setAttribute('aria-expanded', String(!tlCollapsed));
      el.title = tlCollapsed ? 'Expand the timeline' : 'Collapse the timeline';
    }
  };
  const setTlCollapsed = (next) => {
    if (!next && tlCollapsed) {
      root.style.setProperty('--tl-h-editor', `${tlExpanded}px`);
    }
    if (next && !tlCollapsed) {
      const cur = readPx('--tl-h-editor', tlExpanded);
      if (cur >= 180) tlExpanded = cur;
    }
    tlCollapsed = next;
    syncTlToggle();
    save();
    if (editor?.active) editor.renderClips?.();
  };
  const toggleTl = () => setTlCollapsed(!tlCollapsed);
  syncTlToggle();
  $('etlToggle')?.addEventListener('click', toggleTl);
  $('tlLabel')?.addEventListener('click', toggleTl);

  const bind = (handle, side) => {
    if (!handle) return;
    const onDown = (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const start =
        side === 'left'
          ? readPx('--left-w', 220)
          : readPx('--right-w', 280);
      document.body.classList.add('is-resizing');
      handle.classList.add('is-active');

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        if (side === 'left') {
          root.style.setProperty('--left-w', `${clamp(start + dx, 160, 420)}px`);
        } else {
          root.style.setProperty('--right-w', `${clamp(start - dx, 200, 460)}px`);
        }
      };
      const onUp = () => {
        document.body.classList.remove('is-resizing');
        handle.classList.remove('is-active');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        save();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointerdown', onDown);
    handle.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 24 : 12;
      const cur =
        side === 'left'
          ? readPx('--left-w', 220)
          : readPx('--right-w', 280);
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        root.style.setProperty(
          side === 'left' ? '--left-w' : '--right-w',
          `${clamp(side === 'left' ? cur - step : cur + step, side === 'left' ? 160 : 200, side === 'left' ? 420 : 460)}px`
        );
        save();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        root.style.setProperty(
          side === 'left' ? '--left-w' : '--right-w',
          `${clamp(side === 'left' ? cur + step : cur - step, side === 'left' ? 160 : 200, side === 'left' ? 420 : 460)}px`
        );
        save();
      }
    });
  };

  const bindTimeline = (handle) => {
    if (!handle) return;
    const applyHeight = (next) => {
      const h = Math.round(clamp(next, TL_MIN, TL_MAX));
      tlExpanded = h;
      if (tlCollapsed) setTlCollapsed(false);
      else root.style.setProperty('--tl-h-editor', `${h}px`);
      if (editor?.active) editor.renderClips?.();
    };
    const onDown = (e) => {
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      if (tlCollapsed) setTlCollapsed(false);
      const startY = e.clientY;
      const shell = document.querySelector('.timeline-shell');
      const start =
        shell?.getBoundingClientRect().height ||
        readPx('--tl-h-editor', tlExpanded) ||
        tlExpanded;
      document.body.classList.add('is-resizing-y');
      handle.classList.add('is-active');

      const onMove = (ev) => {
        // Drag up → taller timeline (same feel as pulling a Premiere panel).
        applyHeight(start - (ev.clientY - startY));
      };
      const onUp = () => {
        document.body.classList.remove('is-resizing-y');
        handle.classList.remove('is-active');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        save();
        if (editor?.active) editor.renderClips?.();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointerdown', onDown);
    handle.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 32 : 16;
      const cur = tlCollapsed ? tlExpanded : readPx('--tl-h-editor', tlExpanded);
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        applyHeight(cur + step);
        save();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        applyHeight(cur - step);
        save();
      }
    });
  };

  bind($('resizeLeft'), 'left');
  bind($('resizeRight'), 'right');
  bindTimeline($('resizeTimeline'));
}

function wirePanelTabs() {
  document.querySelectorAll('.project-panel .ptab').forEach((tab) => {
    tab.onclick = () => showLeftTab(tab.dataset.left);
  });
  document.querySelectorAll('.tools-panel .ptab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.tools-panel .ptab').forEach((t) => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      const id = tab.dataset.right;
      $('toolsPanel').dataset.tab = id;
      const map = {
        feedback: $('rightFeedback'),
        inspector: $('rightInspector'),
        motion: $('rightMotion'),
        review: $('rightReview'),
        deliver: $('rightDeliver'),
      };
      swapPanelBodies(map[id], Object.values(map));
    };
  });
}

function renderMotionMeta(motion) {
  const el = $('motionMeta');
  if (!el) return;
  if (!motion) {
    el.textContent = 'enter — · stagger —';
    return;
  }
  const atmosphere = motion.atmosphere && motion.atmosphere !== 'none' ? ` · ${motion.atmosphere}` : '';
  el.textContent = `${motion.energy} · enter ${motion.enterMs}ms · stagger ${motion.staggerMs}ms · push ${motion.pushScale}${atmosphere}`;
}

function renderPlateBin(assets) {
  const plates = (assets || []).filter((a) => a.kind === 'plate' || a.kind === 'brand');
  const count = $('plateCount');
  if (count) count.textContent = plates.length ? `${plates.length}` : '';
  const bin = $('plateBin');
  if (!bin) return;
  bin.innerHTML = plates.length
    ? plates
        .map(
          (a) => `<li>
      <div class="who"><strong>${escapeHtml(a.name)}</strong>
        <span>${a.sizeMB} MB · ${a.kind}</span></div>
      <div class="row">
        <button type="button" class="btn icon-only" data-plate-url="${escapeHtml(a.url)}" data-act="preview" title="Preview" aria-label="Preview">${ICONS.preview}</button>
      </div>
    </li>`
        )
        .join('')
    : `<li class="hint">No plate renders yet — Preview plates.</li>`;
  updateMotionApprove();
}

function updateMotionApprove() {
  const btn = $('btnApproveMotion');
  if (!btn) return;
  btn.disabled = !(state.motionApplied && state.platesPreviewed);
}

async function loadVideo(slug, { play = false } = {}) {
  // Callers set state.slug before loadVideo — compare against the loaded video, not the picker.
  const switched = Boolean(state.video?.slug && state.video.slug !== slug);
  setBusy(true, 'Opening sequence', sequenceName(slug));
  try {
    if (switched) {
      // Drop plate-edit / compare leftovers from the previous sequence before the new payload lands.
      state.plateDirty = false;
      state.plateFrameReady = null;
      state.previewingPlate = null;
      state.lastChapter = null;
      state.ytText = '';
      state.compare = false;
      editor?.resetForProject?.();
    }

    const v = await api(`/api/video/${encodeURIComponent(slug)}`);
    // Picker may have moved on while we were fetching.
    if (state.slug && state.slug !== slug) return;
    state.video = v;
    state.chapters = v.chapters || [];
    state.duration = v.durationSec || 0;
    state.lastChapter = null;

    $('title').textContent = v.title || v.slug;
    $('subtitle').textContent = v.audience ? String(v.audience).slice(0, 80) : 'Delivery preview';
    $('metaBits').innerHTML = [
      v.durationSec != null ? clockShort(v.durationSec) : null,
      v.sizeMB != null ? `${v.sizeMB} MB` : null,
      v.brand,
    ]
      .filter(Boolean)
      .map((b) => `<span class="chip">${escapeHtml(b)}</span>`)
      .join('');

    renderActionCard(v);
    workflow?.render(v);
    renderQc(v.qc);
    renderHandoff(v);
    renderExports(v);
    renderVersions(v);
    renderCritic(v);
    renderStory(v.story);
    renderCriticFindings(v.critic);
    setEnergy(v.motion?.energy || 'clear');
    renderEffects(v.motion);
    renderMotionMeta(v.motion);
    renderDirection(v.direction);
    renderTransitions(v.transitions);
    renderPlateBin(v.assets);
    renderHtmlPlatePicker(v.htmlPlates || []);
    renderScenes(v.scenes || []);
    await editor?.refresh?.();

    const player = $('player');
    // Heal a stuck legacy mode (e.g. 'html') that hid every pane without re-entering the Editor.
    const healedMode = normalizeMonitorMode(state.monitorMode);
    if (healedMode !== state.monitorMode) {
      state.monitorMode = healedMode;
      if ($('playerSingle')) $('playerSingle').hidden = healedMode !== 'program';
      if ($('playerPlate')) $('playerPlate').hidden = healedMode !== 'plate';
      if ($('playerCompare')) $('playerCompare').hidden = healedMode !== 'compare';
      if (healedMode !== 'plate') {
        document.body.classList.remove('is-editor');
        editor?.onLeave?.();
      }
    }
    if (!state.proposalOpen && state.monitorMode !== 'plate') {
      state.previewingPlate = null;
      setMonitorLabel('Program');
    }
    if (v.deliveryUrl && capturedTour({ hasLive: Boolean(v.freshness?.liveAt), recordFailed: Boolean(v.recordFailure) })) {
      if (state.monitorMode === 'program' || state.monitorMode === 'compare') {
        state.previewingPlate = null;
        player.src = v.deliveryUrl + `?t=${Date.now()}`;
      }
      player.poster = v.posterUrl || '';
      player.classList.remove('hidden');
      $('noVideo').classList.remove('show');
      [...player.querySelectorAll('track')].forEach((t) => t.remove());
      if (v.captions?.vttUrl) {
        const track = document.createElement('track');
        track.kind = 'captions';
        track.label = 'English';
        track.srclang = 'en';
        track.src = v.captions.vttUrl + `?t=${Date.now()}`;
        player.appendChild(track);
      }
      if (play) player.play?.().catch(() => {});
    } else {
      player.removeAttribute('src');
      player.load?.();
      player.classList.add('hidden');
      $('noVideo').classList.add('show');
    }

    renderPoster(v);

    await loadCaptions(slug);
    if (state.slug && state.slug !== slug) return;
    renderTimeline(state.chapters, player.duration || state.duration);

    if (v.youtubeChaptersUrl) {
      state.ytText = await fetch(v.youtubeChaptersUrl)
        .then((r) => r.text())
        .catch(() => '');
    } else state.ytText = '';

    if (state.compare) syncCompare();
    updateTransport();
  } catch (err) {
    toast('Could not open sequence', err.message || String(err), 'err');
    throw err;
  } finally {
    setBusy(false);
  }
}

function setEnergy(energy) {
  document.querySelectorAll('#energyGrid .energy').forEach((btn) => {
    const on = btn.dataset.energy === energy;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}

function setAtmosphere(id) {
  document.querySelectorAll('#atmosphereGrid [data-atmosphere]').forEach((btn) => {
    const on = btn.dataset.atmosphere === id;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  const sliders = document.querySelector('.atmosphere-sliders');
  if (sliders) sliders.classList.toggle('hidden', id === 'none');
}

/** Mirror the resolved effects layer (atmosphere, title reveal, depth, sheen) into the controls. */
function renderEffects(motion) {
  if (!motion) return;
  setAtmosphere(motion.atmosphere || 'none');
  const op = $('atmosphereOpacity');
  if (op && document.activeElement !== op && motion.atmosphereOpacity != null) {
    op.value = String(motion.atmosphereOpacity);
    $('atmosphereOpacityOut').textContent = Number(motion.atmosphereOpacity).toFixed(2);
  }
  const sp = $('atmosphereSpeed');
  if (sp && document.activeElement !== sp && motion.atmosphereSpeed != null) {
    sp.value = String(motion.atmosphereSpeed);
    $('atmosphereSpeedOut').textContent = `${Number(motion.atmosphereSpeed).toFixed(1)}×`;
  }
  if ($('titleReveal') && motion.titleReveal) $('titleReveal').value = motion.titleReveal;
  if ($('cardDepth') && motion.depth) $('cardDepth').value = motion.depth;
  if ($('sheenToggle')) $('sheenToggle').checked = motion.sheen !== false;
}

/** Everything the Motion & transitions panel sends to POST /motion. */
function collectMotionBody() {
  const energy = document.querySelector('#energyGrid .energy.active')?.dataset.energy || 'clear';
  const body = { energy };
  const atmosphere = document.querySelector('#atmosphereGrid .energy.active')?.dataset.atmosphere;
  if (atmosphere) body.atmosphere = atmosphere;
  if ($('atmosphereOpacity')) body.atmosphereOpacity = Number($('atmosphereOpacity').value);
  if ($('atmosphereSpeed')) body.atmosphereSpeed = Number($('atmosphereSpeed').value);
  if ($('titleReveal')) body.titleReveal = $('titleReveal').value;
  if ($('cardDepth')) body.depth = $('cardDepth').value;
  if ($('sheenToggle')) body.sheen = $('sheenToggle').checked;
  return body;
}

/** CSS look tokens for a motion patch — paints the Editor stage before the rebuild lands. */
function paintMotionLiveOptimistic(motion) {
  const table = state.video?.motionOptions?.lookVars || {};
  if (!motion || !editor?.paintLookVars) return;
  const vars = {};
  const sheen = motion.sheen === false ? 'off' : 'on';
  for (const [key, val] of [
    ['energy', motion.energy],
    ['depth', motion.depth],
    ['sheen', sheen],
    ['titleReveal', motion.titleReveal],
  ]) {
    Object.assign(vars, table[key]?.[val] || {});
  }
  editor.paintLookVars(vars, motion.titleReveal || null);
}

let motionLiveTimer = 0;
let motionLiveGen = 0;
/**
 * Direction effects land on the Editor the moment they change: CSS picks paint at once, then a
 * debounced save rebuilds plate HTML (atmosphere, opacity, speed) and force-reloads the stage.
 */
function scheduleMotionLive() {
  state.motionApplied = false;
  state.platesPreviewed = false;
  updateMotionApprove();
  const body = collectMotionBody();
  paintMotionLiveOptimistic(body);
  clearTimeout(motionLiveTimer);
  const gen = ++motionLiveGen;
  motionLiveTimer = setTimeout(() => applyMotionLive(gen), 320);
}

async function applyMotionLive(gen = motionLiveGen) {
  if (!state.slug) return;
  try {
    const r = await api(`/api/video/${state.slug}/motion`, { method: 'POST', body: collectMotionBody() });
    if (gen !== motionLiveGen) return;
    state.motionApplied = true;
    if (state.video) {
      state.video.motion = r.motion;
      if (r.direction) state.video.direction = r.direction;
    }
    renderMotionMeta(r.motion);
    renderEffects(r.motion);
    if (r.direction) {
      renderDirection(r.direction);
      workflow?.render(state.video);
    }
    // Rebuild + force-reload the Editor plate so backgrounds and shaders match the pick.
    await rebuildPlateHtmlPreview({
      selectFirst: false,
      plateId: editor?.active ? null : state.activePlateId,
    });
    if (gen !== motionLiveGen) return;
    state.platesPreviewed = true;
    updateMotionApprove();
  } catch (err) {
    if (gen === motionLiveGen) toast('Look not saved', err.message, 'err');
  }
}

function renderTransitions(transitions) {
  if (!transitions) return;
  document.querySelectorAll('#transitionGrid [data-transition]').forEach((btn) => {
    const on = btn.dataset.transition === transitions.style;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  const range = $('transitionDuration');
  if (range && document.activeElement !== range) range.value = String(transitions.duration);
  $('transitionDurationOut').textContent = `${Number(transitions.duration).toFixed(1)}s`;
}

function renderOverlays(overlays) {
  const look = overlays || state.video?.overlays;
  if (!look) return;
  const set = (id, value) => {
    const el = $(id);
    if (el && value != null && document.activeElement !== el) el.value = String(value);
  };
  set('overlayPreset', look.preset || 'plateMatch');
  set('overlayChapterAtm', look.chapter?.atmosphere || 'waves');
  set('overlayCaptionAtm', look.caption?.atmosphere || 'waves');
  set('overlayCaptionSeat', look.caption?.seat || 'bottom-center');
  set('overlayCaptionAlign', look.caption?.align || 'left');
}

async function applyOverlaysLook() {
  const body = {
    preset: $('overlayPreset')?.value || 'plateMatch',
    chapter: { atmosphere: $('overlayChapterAtm')?.value || 'waves' },
    caption: {
      atmosphere: $('overlayCaptionAtm')?.value || 'waves',
      seat: $('overlayCaptionSeat')?.value || 'bottom-center',
      align: $('overlayCaptionAlign')?.value || 'left',
    },
  };
  buttonBusy($('btnOverlaysApply'), true);
  try {
    const r = await api(`/api/video/${state.slug}/overlays`, { method: 'POST', body });
    if (state.video) {
      state.video.overlays = r.overlays;
      state.video.direction = r.direction || state.video.direction;
      state.video.htmlPlates = r.plates || state.video.htmlPlates;
    }
    renderOverlays(r.overlays);
    renderHtmlPlatePicker(r.plates || state.htmlPlates);
    const active = state.activePlateId;
    if (active?.startsWith('overlay:')) await loadPlateFrame(active, { force: true });
    else if (!active && (r.plates || []).some((p) => p.liveCard)) {
      const first = (r.plates || []).find((p) => p.liveCard);
      if (first) showPlateHtml(first);
    }
    toast('Live cards updated', r.overlays?.preset || 'look saved');
    setStatus('warn', 'Live card look updated — preview is live · Produce to bake into the master');
  } catch (err) {
    toast('Live cards failed', err.message, 'err');
  } finally {
    buttonBusy($('btnOverlaysApply'), false);
  }
}

function previewLiveCard({ kind, flowIndex }) {
  const id = `overlay:${kind}:${flowIndex}`;
  const card = (state.htmlPlates || []).find((p) => p.id === id);
  if (!card) {
    toast('Card not ready', 'Rebuild plates / open Direction → Apply live cards first', 'warn');
    return;
  }
  showPlateHtml(card);
  document.querySelector('.tools-panel .ptab[data-right="motion"]')?.click();
}

function renderDirection(direction) {
  if (!direction) return;
  renderOverlays(state.video?.overlays || direction.overlays);
  const foundation = state.video?.brandFoundation;
  if (foundation) {
    $('directionBrandName').textContent = foundation.name;
    $('directionBrandMeta').textContent = `${foundation.font} · base colors · logo chosen below`;
    $('directionBrandAccent').style.setProperty('--brand-accent', foundation.accent);
  }
  const roles = direction.roles || [
    { id: 'ink', label: 'Ink' },
    { id: 'surface', label: 'Surface' },
    { id: 'gold', label: 'Accent' },
    { id: 'amber', label: 'Secondary' },
    { id: 'teal', label: 'Support' },
  ];
  const grid = $('paletteGrid');
  if (grid) {
    grid.innerHTML = (direction.scales || []).map((scale) => {
      const on = scale.id === direction.scale;
      return `<button type="button" class="scale-option${on ? ' active' : ''}" data-palette="${escapeHtml(scale.id)}" role="radio" aria-checked="${on ? 'true' : 'false'}">
        <span class="scale-copy"><strong>${escapeHtml(scale.label)}</strong>${scale.recommended ? '<em>Best match</em>' : ''}<span>${escapeHtml(scale.hint || '')}</span></span>
        <span class="scale-swatches">${roles.map((role) => `<i style="--swatch:${escapeHtml(scale.colors[role.id])}" title="${escapeHtml(role.label)}"></i>`).join('')}</span>
      </button>`;
    }).join('');
  }
  const editor = $('scaleEditor');
  if (editor) {
    editor.innerHTML = roles.map((role) => `<label><span>${escapeHtml(role.label)}</span><input type="color" data-role="${role.id}" value="${escapeHtml(direction.colors[role.id])}" aria-label="${escapeHtml(role.label)}" /></label>`).join('');
  }
  const logos = $('logoGrid');
  if (logos) {
    logos.innerHTML = (direction.lockups || []).map((lockup) => {
      const on = lockup.file === direction.logo;
      const src = `/api/video/${encodeURIComponent(state.slug)}/brand-file/${encodeURIComponent(lockup.file)}`;
      const preview = lockup.kind === 'html'
        ? '<span class="logo-fallback">Plate</span>'
        : `<img src="${escapeHtml(src)}" alt="" />`;
      return `<button type="button" class="logo-option${on ? ' active' : ''}" data-logo="${escapeHtml(lockup.file)}" role="radio" aria-checked="${on ? 'true' : 'false'}">${preview}<strong>${escapeHtml(lockup.label)}</strong></button>`;
    }).join('') || '<p class="meta">No captured logo in this brand pack.</p>';
  }
  document.querySelectorAll('#focusGrid [data-focus]').forEach((btn) => {
    const on = btn.dataset.focus === direction.focus;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  renderPace(direction);
  const status = $('directionStatus');
  if (status) {
    status.textContent = direction.approvedAt ? 'Approved' : 'Needs approval';
    status.dataset.tone = direction.approvedAt ? 'ok' : 'warn';
  }
  const approve = $('btnApproveDirection');
  if (approve) {
    approve.disabled = Boolean(direction.approvedAt);
    approve.textContent = direction.approvedAt ? 'Direction approved' : 'Approve direction';
  }
  renderCamera(direction);
}

function renderCamera(direction) {
  const camera = direction.camera || {
    zoom: 'off',
    frame: 'full',
    background: 'brand',
    padding: 'balanced',
    corners: 'soft',
    shadow: 'soft',
  };
  const cursor = direction.cursor || { style: 'classic', size: 'm', glide: false, hideIdle: false, loop: false };
  const mark = (selector, value) => {
    document.querySelectorAll(`${selector} [data-value]`).forEach((btn) => {
      const on = btn.dataset.value === value;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  };
  for (const key of ['zoom', 'frame', 'background', 'padding', 'corners', 'shadow']) {
    mark(`[data-camera="${key}"]`, camera[key]);
  }
  for (const key of ['style', 'size']) mark(`[data-cursor="${key}"]`, cursor[key]);
  $('backgroundRow').hidden = camera.frame !== 'inset';
  document.querySelectorAll('.frameDetailRow').forEach((row) => (row.hidden = camera.frame !== 'inset'));
  $('cursorSizeRow').hidden = cursor.style === 'classic';
  document.querySelectorAll('.cursorDetailRow').forEach((row) => (row.hidden = cursor.style === 'classic'));
  $('keysToggle').checked = Boolean(direction.keys);
  $('glideToggle').checked = Boolean(cursor.glide);
  $('idleToggle').checked = Boolean(cursor.hideIdle);
  $('loopToggle').checked = Boolean(cursor.loop);
  const c = direction.colors || {};
  const chips = {
    brand: `radial-gradient(circle at 80% 15%, ${c.gold}66, transparent 55%), linear-gradient(135deg, ${c.surface}, ${c.ink})`,
    ink: c.ink,
    accent: `linear-gradient(135deg, ${c.gold}, ${c.amber})`,
  };
  document.querySelectorAll('.bg-chip[data-bg]').forEach((chip) => {
    chip.style.background = chips[chip.dataset.bg] || '';
  });
  const looks = direction.looks || {};
  $('lookPresets').innerHTML = Object.entries(looks)
    .map(
      ([id, look]) => `<button type="button" data-look="${escapeHtml(id)}" class="${direction.look === id ? 'active' : ''}"
        role="radio" aria-checked="${direction.look === id ? 'true' : 'false'}">
        <i aria-hidden="true"></i><span><strong>${escapeHtml(look.label)}</strong><em>${escapeHtml(look.hint)}</em></span>
      </button>`
    )
    .join('');
  const preview = $('lookPreview');
  preview.dataset.frame = camera.frame;
  preview.dataset.cursor = cursor.style;
  preview.dataset.keys = direction.keys ? 'on' : 'off';
  preview.dataset.padding = camera.padding;
  preview.dataset.corners = camera.corners;
  preview.dataset.shadow = camera.shadow;
  preview.style.setProperty('--look-bg', chips[camera.background] || chips.brand);
  preview.style.setProperty('--look-accent', c.gold || '#42f272');
}

function renderExports(v) {
  const presets = v.exportPresets || {};
  const box = $('exportPresets');
  if (!box) return;
  const chosen = new Set(state.exportPick || ['square', 'vertical', 'gif']);
  box.innerHTML = Object.entries(presets)
    .map(
      ([id, p]) => `<label class="export-preset${chosen.has(id) ? ' active' : ''}">
        <input type="checkbox" value="${escapeHtml(id)}"${chosen.has(id) ? ' checked' : ''} />
        <span class="export-shape" data-shape="${escapeHtml(id)}" aria-hidden="true"></span>
        <span><strong>${escapeHtml(p.label)}</strong><em>${escapeHtml(p.hint)}</em></span>
      </label>`
    )
    .join('');
  const list = v.exports || [];
  $('exportCount').textContent = list.length ? `${list.length} ready` : '';
  $('exportList').innerHTML = list
    .map(
      (item) => `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" download>${escapeHtml(item.label)}</a>
        <span class="meta">${item.sizeMB} MB${item.stale ? ' · older than master' : ''}</span></li>`
    )
    .join('');
  $('btnExportFormats').disabled = !v.deliveryUrl;
}

/** Live pace: preset radios plus a tempo readout; a custom multiplier from the CLI shows as its own chip. */
function renderPace(direction) {
  const seg = $('paceSeg');
  if (!seg || !direction?.pace) return;
  const pace = direction.pace;
  const presets = Object.entries(direction.paces || {});
  seg.innerHTML =
    presets
      .map(
        ([id, p]) => `<label title="${escapeHtml(p.hint)} · ${p.tempo}×"><input type="radio" name="pace" value="${id}" ${
          id === pace.id ? 'checked' : ''
        } /><span>${escapeHtml(p.label)}</span></label>`
      )
      .join('') +
    (pace.custom
      ? `<label title="Set from the CLI (direction --pace ${pace.tempo})"><input type="radio" name="pace" value="${pace.tempo}" checked /><span>${pace.tempo}×</span></label>`
      : '');
  if ($('paceMeta')) $('paceMeta').textContent = `${pace.tempo}×`;
  if ($('paceHint')) $('paceHint').textContent = `${pace.hint}${pace.id === 'steady' ? '' : ' · re-record to apply'}`;
  const note = $('paceNote');
  const live = state.video?.livePace;
  if (note) {
    const pct = live ? Math.round((live.narrationHoldShare || 0) * 100) : 0;
    const bound = live && live.narrationHoldSec >= 3;
    note.hidden = !bound;
    if (bound) {
      note.textContent = `Last take: narration held the tour ${live.narrationHoldSec}s (${pct}%)${
        live.id !== pace.id ? ` at pace ${live.id}` : ''
      }${pct >= 20 ? ' — a faster pace cannot shorten this; trim those lines or raise voice speed.' : '.'}`;
      note.dataset.tone = pct >= 20 ? 'warn' : '';
    }
  }
}

async function saveDirection(patch, { quiet = false } = {}) {
  try {
    const r = await api(`/api/video/${state.slug}/direction`, { method: 'PUT', body: patch });
    if (state.video) {
      state.video.direction = r.direction;
      state.video.motion = r.motion;
      state.video.transitions = r.transitions;
    }
    renderDirection(r.direction);
    renderMotionMeta(r.motion);
    renderTransitions(r.transitions);
    workflow?.render(state.video);
    if (!quiet) toast('Direction updated', 'Preview scenes, then approve before recording', 'ok');
    return r;
  } catch (err) {
    toast('Direction failed', err.message, 'err');
    throw err;
  }
}

/**
 * Keep the Editor stage in step with Direction: refresh the edit deck (inset frame, brand
 * colours, joins) and, when the plate HTML itself changed, force-reload the plate on stage.
 */
async function syncEditorAfterDirection({ plates = false } = {}) {
  if (plates) {
    await rebuildPlateHtmlPreview({ selectFirst: !state.activePlateId && !editor?.active });
  }
  if (editor?.active) await editor.refresh();
}

/** Camera keys that reshape the Editor's live inset frame (not just the next recording). */
const FRAME_CAMERA_KEYS = new Set(['frame', 'background', 'padding', 'corners', 'shadow']);

let transitionSaveTimer = null;
function saveTransitions(patch) {
  clearTimeout(transitionSaveTimer);
  transitionSaveTimer = setTimeout(async () => {
    try {
      const r = await api(`/api/video/${state.slug}/transitions`, { method: 'PUT', body: patch });
      renderTransitions(r.transitions);
      if (state.video) state.video.transitions = r.transitions;
      // The Editor draws joins from the edit deck — refresh so the stage matches without a render.
      await loadVideo(state.slug);
      if (editor?.active) await editor.refresh();
      toast('Transitions updated', `${r.transitions.style} · ${r.transitions.duration}s · live on the stage`, 'ok');
    } catch (err) {
      toast('Transitions failed', err.message, 'err');
    }
  }, 250);
}

function setMonitorLabel(text = 'Program', hint = '') {
  const labelEl = $('monitorLabel') || document.querySelector('.monitor-label');
  if (labelEl) {
    labelEl.textContent = text;
    labelEl.hidden = text === 'Program' || text === 'Plate HTML';
  }
  const hintEl = $('monitorModeHint');
  if (hintEl) {
    const fallback =
      state.monitorMode === 'plate'
        ? 'Inline edit · timeline paused on this plate'
        : state.monitorMode === 'compare'
          ? 'A/B against a saved version'
          : 'The rendered master';
    hintEl.textContent = hint || fallback;
  }
}

function playPlatePreview(url, label = 'Plate') {
  if (!url) return;
  setCompare(false);
  state.previewingPlate = url;
  // Always show the Program pane for MP4 plate previews (Editor is HTML, not this).
  if (normalizeMonitorMode(state.monitorMode) !== 'program') {
    setMonitorMode('program', { keepPreview: true });
  }
  const player = $('player');
  player.pause?.();
  player.src = url + (url.includes('?') ? '&' : '?') + `t=${Date.now()}`;
  player.classList.remove('hidden');
  $('noVideo').classList.remove('show');
  startPlayback(player);
  setMonitorLabel(`Preview · ${label}`, 'Plate encode — Program tab or Play restores the master');
  toast('Plate preview', `${label} · Play / Program returns to the master`);
  updateTransport();
}

function elapsedSec(job) {
  const start = job?.startedAt || job?.createdAt;
  if (!start) return 0;
  const end = job.finishedAt ? Date.parse(job.finishedAt) : Date.now();
  return Math.max(0, Math.floor((end - Date.parse(start)) / 1000));
}

function hideActivityDock() {
  document.body.classList.remove('has-activity');
  clearInterval(state.elapsedTimer);
  if (!state.proposalOpen) setSessionIdle();
}

function showActivityDock(job, { surface } = {}) {
  if (state.activityDismissed && job.status !== 'running' && job.status !== 'queued') return;
  if (job.status === 'running' || job.status === 'queued') state.activityDismissed = false;

  const running = job.status === 'running' || job.status === 'queued';
  const failed = job.status === 'failed' || job.status === 'needs-agent';
  const done = job.status === 'done';
  const isImprove = job.kind === 'improve';
  const resolvedSurface =
    surface || state.activeSurface || (isImprove ? 'session' : 'render');

  // Never let agent progress overwrite the Render bay while a pipeline is active
  if (resolvedSurface === 'render' && !isImprove) {
    updateRenderLive(job);
    showLeftTab('render');
    setRenderMode(running || state.jobBusy);
  }
  if (resolvedSurface === 'session' || isImprove) {
    document.querySelector('.tools-panel .ptab[data-right="feedback"]')?.click();
  }

  const rail = $('sessionRail');
  if (!rail) return;
  if (resolvedSurface !== 'session' && !isImprove) return;

  document.body.classList.add('has-activity');

  rail.classList.toggle('is-running', running);
  rail.classList.toggle('is-done', done && !state.proposalOpen);
  rail.classList.toggle('is-failed', failed);

  const view = paintWork('session', job);
  if ($('sessionPipe')) $('sessionPipe').hidden = view.stages.length > 0;
  if ($('sessionElapsed')) {
    $('sessionElapsed').hidden = false;
    $('sessionElapsed').textContent = fmt(elapsedSec(job));
  }
  if ($('btnSessionLog')) $('btnSessionLog').hidden = false;
  paintAgentStream($('sessionStream'), job, { variant: 'rail' });
  if ($('sessionLog')) {
    const lines = (job.log || []).map((l) => l.line).join('\n');
    $('sessionLog').textContent = lines.slice(-5000);
    if (state.activityExpanded) {
      $('sessionLog').hidden = false;
      $('sessionLog').scrollTop = $('sessionLog').scrollHeight;
      if ($('sessionNow')) $('sessionNow').hidden = true;
    }
  }

  clearInterval(state.elapsedTimer);
  if (running) {
    state.elapsedTimer = setInterval(() => {
      const j = state.job || job;
      if ($('sessionElapsed')) $('sessionElapsed').textContent = fmt(elapsedSec(j));
      if ($('renderElapsed') && state.pipelineStartedAt) {
        const sec = Math.max(0, Math.floor((Date.now() - state.pipelineStartedAt) / 1000));
        $('renderElapsed').textContent = fmt(sec);
        $('renderElapsed').hidden = false;
      }
    }, 1000);
  }
}

async function runJobPromise(step, force = false, { signal, presets, slug } = {}) {
  state.activeSurface = 'render';
  if (signal?.aborted) throw new Error('cancelled');
  const target = slug || state.slug;
  if (!target) throw new Error('No sequence selected');
  const r = await api(`/api/video/${encodeURIComponent(target)}/run`, { method: 'POST', body: { step, force, presets } });
  return watchJob(r.job.id, { surface: 'render', signal });
}

function requestMake(mode) {
  const v = state.video;
  if (!v) return;
  const action = state.action || decideAction(v);
  const resolved = mode || action.primary?.mode || 'quick';
  const label =
    resolved === 'full'
      ? 'Re-record & render full'
      : resolved === 'plates'
        ? 'Re-render brand plates'
        : 'Render sequence';
  enqueueJob({ kind: 'make', mode: resolved, label });
}

async function runMakePipeline(mode, { signal, slug: boundSlug } = {}) {
  const target = boundSlug || state.slug;
  const v = state.video?.slug === target ? state.video : target ? await api(`/api/video/${encodeURIComponent(target)}`).catch(() => null) : null;
  if (!v && !target) return;
  const resolved = mode || 'quick';
  const record = resolved === 'full';
  const platesOnly = resolved === 'plates';
  const sig = signal || state.workAbort?.signal;

  const steps = platesOnly
    ? [
        { id: 'plates', label: 'Render brand plates' },
        { id: 'preview', label: 'Refresh Program' },
      ]
    : [
        ...(record ? [{ id: 'record', label: 'Record walkthrough' }] : []),
        { id: 'plates', label: 'Render brand plates' },
        { id: 'produce', label: 'Produce master video' },
        { id: 'audio', label: 'Add voice & music' },
        { id: 'deliver', label: 'Export handoff pack' },
        { id: 'preview', label: 'Show in player' },
      ];
  state.pipeline = steps.map((s) => ({ ...s, status: 'todo' }));
  state.pipelineStartedAt = Date.now();
  setRenderMode(true, record ? 'record' : 'render');
  showLeftTab('render');

  const pill = $('renderStatusPill');
  if (pill) {
    pill.className = 'render-pill run';
    pill.textContent = 'Rendering';
  }
  if ($('renderHeadline')) {
    $('renderHeadline').textContent = platesOnly
      ? 'Re-rendering brand plates'
      : record
        ? 'Rendering with re-record'
        : 'Rendering sequence';
  }
  if ($('renderReason')) {
    $('renderReason').textContent = platesOnly
      ? 'Motion-safe hold probe + frame QC run on every plate. Failed QC aborts the job.'
      : 'Live log and pipeline update here. Program refreshes when the last step finishes.';
  }
  if ($('renderElapsed')) {
    $('renderElapsed').hidden = false;
    $('renderElapsed').textContent = '00:00:00';
  }
  renderSteps(state.pipeline);
  setStatus('run', 'Rendering…');
  buttonBusy($('btnMake'), true);
  buttonBusy($('btnActionPrimary'), true);
  buttonBusy($('btnActionSecondary'), true);
  updateStopButtons();

  try {
    for (const s of steps) {
      if (s.id === 'preview') continue;
      if (sig?.aborted || state.stopRequested) throw new Error('cancelled');
      setStep(s.id, 'run');
      setFaviconMode(s.id === 'record' ? 'record' : s.id === 'deliver' ? 'export' : 'render');
      // Plates are content-hash cached; forcing here would redraw every plate twice per make.
      await runJobPromise(s.id, false, { signal: sig, slug: target });
      setStep(s.id, 'done');
    }
    setStep('preview', 'run');
    if (target === state.slug) await loadVideo(state.slug, { play: true });
    setStep('preview', 'done');
    try {
      await api(`/api/video/${encodeURIComponent(target)}/versions/snapshot`, {
        method: 'POST',
        body: {
          title: record ? 'Re-recorded sequence' : 'Rendered sequence',
          trigger: record ? 'make-full' : 'make',
          kind: 'release',
          note: 'studio make video',
        },
      });
    } catch {
      /* ignore */
    }
    await loadVideo(state.slug, { play: true });
    setStatus('ok', 'Ready — Program updated');
    setFaviconMode('ok');
    toast('Render complete', 'Program monitor updated');
    hideActivityDock();
    if ($('renderLiveTitle')) $('renderLiveTitle').textContent = 'Complete';
    if ($('renderLiveMeta')) $('renderLiveMeta').textContent = 'Pipeline finished';
    if ($('renderSpinner')) $('renderSpinner').hidden = true;
  } catch (err) {
    const running = state.pipeline?.find((s) => s.status === 'run');
    if (running) setStep(running.id, 'fail');
    setStatus('warn', 'Render failed');
    setFaviconMode('err');
    toast('Render failed', err.message, 'err');
    throw err;
  } finally {
    buttonBusy($('btnMake'), false);
    buttonBusy($('btnActionPrimary'), false);
    buttonBusy($('btnActionSecondary'), false);
    state.pipelineStartedAt = null;
  }
}

/** @deprecated use requestMake — kept for callers */
async function makeVideo(mode) {
  requestMake(mode);
}

async function exportPack() {
  enqueueJob({ kind: 'step', step: 'deliver', force: false, label: 'Export handoff pack' });
  document.querySelector('.tools-panel .ptab[data-right="deliver"]')?.click();
}

function startImprove(goal = 'full') {
  const note = ($('improveNote')?.value || '').trim();
  if (!note) {
    toast('Add a director note', 'Describe what to change before Apply', 'warn');
    $('improveNote')?.focus();
    return;
  }
  const btn = $('btnImprove');
  // A plate is pinned only by the explicit “Ask AI” action. Merely viewing a plate must not
  // silently turn a broad director note into a one-plate edit.
  const pinnedPlate = btn?.dataset.plateId || null;
  const pinnedGoal = btn?.dataset.improve;
  const resolvedGoal =
    goal === 'full' && pinnedGoal && (pinnedGoal === 'scene' || pinnedGoal === 'motion')
      ? pinnedGoal
      : goal;
  const plateAware = ['full', 'plates', 'scene', 'motion'].includes(resolvedGoal);
  const plateId = plateAware ? pinnedPlate || inferPlateIdFromFeedback(note) : null;
  if (plateId) state.editingPlateId = plateId;
  const focus =
    (plateId && (state.scenes || []).find((s) => s.plateId === plateId)?.title) ||
    plateId ||
    resolvedGoal;
  enqueueJob({
    kind: 'improve',
    goal: resolvedGoal === 'scene' ? 'scene' : resolvedGoal,
    note,
    plateId: plateId || null,
    motion: resolvedGoal === 'motion',
    label: `AI · ${focus}`,
  });
  resetImproveTarget();
}

/** Drop a plate pinned by Ask AI, so the next note is not silently scoped to it. */
function resetImproveTarget() {
  const btn = $('btnImprove');
  if (!btn) return;
  btn.dataset.improve = 'full';
  delete btn.dataset.plateId;
  btn.textContent = 'Apply with smart scope';
}

async function runImproveJob(item, { signal } = {}) {
  hideProposal();
  resetThinkSteps();
  setThinkStep('think');
  state.activeSurface = 'session';
  document.querySelector('.tools-panel .ptab[data-right="feedback"]')?.click();
  buttonBusy($('btnImprove'), true);
  updateStopButtons();

  const sig = signal || state.workAbort?.signal;
  if (sig?.aborted) throw new Error('cancelled');

  const target = item.slug || state.slug;
  if (!target) throw new Error('No sequence selected');
  const goal = item.goal || 'full';
  const note = item.note || '';
  const plateId = item.plateId || null;
  if (plateId) state.editingPlateId = plateId;

  const focusLabel = plateId
    ? (state.scenes || []).find((s) => s.plateId === plateId)?.title || plateId
    : goal;

  let r;
  if (plateId && (goal === 'scene' || goal === 'motion' || item.motion)) {
    r = await api(`/api/video/${encodeURIComponent(target)}/scenes/${encodeURIComponent(plateId)}/improve`, {
      method: 'POST',
      body: { note, goal: item.motion || goal === 'motion' ? 'motion' : 'scene' },
    });
  } else {
    r = await api(`/api/video/${encodeURIComponent(target)}/improve`, {
      method: 'POST',
      body: { goal, note, snapshot: true, plateId: plateId || undefined },
    });
  }

  const job = r.job;
  if (job.status === 'needs-agent') {
    showActivityDock(job, { surface: 'session' });
    const claude = job.provider === 'claude' || /claude/i.test(job.message || '');
    toast(
      claude ? 'Sign in to Claude Code' : 'Sign in to Cursor CLI',
      claude ? 'claude → /login, then retry' : 'agent login, then retry',
      'warn'
    );
    resetThinkSteps();
    return;
  }

  toast('Studio is thinking…', focusLabel);
  setStatus('run', plateId ? `Editing ${focusLabel}…` : 'Agent working on feedback…');
  setThinkStep('edit');

  try {
    await watchJob(job.id, {
      surface: 'session',
      signal: sig,
      onUpdate: (j) => {
        showActivityDock(j, { surface: 'session' });
        if (j.phase === 'thinking') setThinkStep('think');
        else if (j.phase === 'tool' || j.phase === 'writing') setThinkStep('edit');
      },
    });
  } catch (err) {
    if (isCancelError(err)) {
      resetThinkSteps();
      throw err;
    }
    if (/needs-agent/i.test(err.message)) toast('Auth needed', 'agent login', 'warn');
    else toast('Feedback failed', err.message, 'err');
    resetThinkSteps();
    throw err;
  }

  try {
    const changes = await api(`/api/video/${encodeURIComponent(target)}/draft/changes`).catch(() => ({
      files: [],
      domains: [],
      labels: [],
    }));
    const domains = new Set(changes.domains || []);
    const targetId = plateId || null;
    const needsPlatePreview = ['plates', 'brand', 'motion'].some((domain) => domains.has(domain));
    let plate = null;
    const stillHere = target === state.slug;
    if (stillHere) {
      if (needsPlatePreview || targetId) plate = await previewPlateAfterEdit(targetId);
      else await loadVideo(state.slug);
    }

    const labels = changes.labels?.length ? changes.labels : [focusLabel === 'full' ? 'Coordinated video pass' : focusLabel];
    if (!stillHere) {
      setThinkStep('approve');
      toast('Done on another sequence', `${target} · switch back to review`, 'ok');
      return;
    }
    const scriptReview = ['script', 'voice', 'timing', 'journey'].some((domain) => domains.has(domain));
    const directionReview = !scriptReview && ['brand', 'motion'].some((domain) => domains.has(domain)) && !plate;
    setThinkStep('approve');
    showProposal({
      title:
        labels.length > 1
          ? 'Review coordinated changes'
          : plate
            ? `Review “${plate.label || plate.id}”`
            : `Review ${labels[0]}`,
      reason: scriptReview
        ? `${labels.join(' · ')} changed. Review the script and narration; any updated plate is already live in Program.`
        : plate
          ? `${labels.join(' · ')} changed. The live plate is replaying in Program.`
          : `${labels.join(' · ')} changed. Review the focused settings before approving.`,
      review: scriptReview ? 'script' : directionReview ? 'direction' : 'preview',
      reviewLabel: scriptReview
        ? plate
          ? 'Review script + preview'
          : 'Review script & voice'
        : directionReview
          ? 'Review brand direction'
          : 'Review preview',
      reviewDetail: scriptReview
        ? plate
          ? 'Open the words; the live plate remains in Program'
          : 'Open the changed story and narration'
        : undefined,
      steps: [
        ...labels.map((label) => ({ label, status: 'done' })),
        ...(plate ? [{ label: 'Live preview rebuilt', status: 'done' }] : []),
        { label: 'Awaiting your decision', status: 'run' },
      ],
    });
    $('btnApprovePlate').hidden = !(targetId && plate);
    state.motionApplied = domains.has('motion') || domains.has('brand');
    state.platesPreviewed = Boolean(plate);
    updateMotionApprove();
    setStatus('warn', 'Preview ready — approve to render');
    toast('Changes ready to review', labels.join(' · '));
  } catch (err) {
    setThinkStep('html');
    const msg = err.message || String(err);
    toast('HTML rebuild failed', msg, 'err');
    setStatus('warn', 'Sources changed — rebuild failed');
    // Keep the rail honest: agent finished, but plate HTML did not rebuild.
    if ($('sessionTitle')) $('sessionTitle').textContent = 'Plate HTML failed';
    if ($('sessionMeta')) $('sessionMeta').textContent = msg;
    if ($('sessionNow')) {
      $('sessionNow').hidden = false;
      $('sessionNow').textContent = msg;
    }
    if ($('sessionPhase')) {
      $('sessionPhase').hidden = false;
      $('sessionPhase').textContent = 'FAILED';
      $('sessionPhase').className = 'badge err';
    }
    const rail = $('sessionRail');
    if (rail) {
      rail.classList.remove('is-running', 'is-done');
      rail.classList.add('is-failed');
    }
    throw err;
  }
}

function seekTo(sec) {
  const d = activePlayer().duration || state.duration || 0;
  const t = Math.min(Math.max(0, sec), d || sec);
  if (state.compare) {
    $('playerA').currentTime = t;
    $('playerB').currentTime = t;
  } else {
    $('player').currentTime = t;
  }
  updateTransport();
}

function seekFromEvent(e) {
  const track = $('timelineTrack');
  const rect = track.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const d = activePlayer().duration || state.duration || 0;
  seekTo(ratio * d);
  return ratio;
}

const commandItems = () => [...document.querySelectorAll('#commandList [data-command]')].filter((b) => !b.hidden);
function commandActive(btn) {
  document.querySelectorAll('#commandList .is-active').forEach((b) => b.classList.remove('is-active'));
  if (!btn) return;
  btn.classList.add('is-active');
  btn.scrollIntoView({ block: 'nearest' });
}

function openCommandMenu() {
  const dialog = $('commandDialog');
  if (!dialog.open) dialog.showModal();
  $('commandInput').value = '';
  document.querySelectorAll('#commandList [data-command]').forEach((btn) => (btn.hidden = false));
  $('commandEmpty').hidden = true;
  commandActive(commandItems()[0]);
  requestAnimationFrame(() => $('commandInput').focus());
}

function runCommand(command) {
  $('commandDialog').close();
  if (command === 'render') $('btnMake').click();
  else if (command === 'handoff') $('btnExport').click();
  else if (command === 'version') $('btnSnapshot').click();
  else if (command === 'new') $('btnNewVideo').click();
  else if (command === 'branch') $('btnBranch')?.click();
  else if (command === 'help') $('helpDialog').showModal();
  else if (command === 'direction') document.querySelector('.tools-panel .ptab[data-right="motion"]')?.click();
  else if (command === 'deliver') document.querySelector('.tools-panel .ptab[data-right="deliver"]')?.click();
  else if (command === 'script') document.querySelector('.pstage[data-stage="script"]')?.click();
}

function wire() {
  const player = $('player');
  for (const p of [player, $('playerA'), $('playerB')]) {
    p.addEventListener('timeupdate', updateTransport);
    p.addEventListener('play', updateTransport);
    p.addEventListener('pause', updateTransport);
    p.addEventListener('ended', updateTransport);
  }
  player.addEventListener('loadedmetadata', () => {
    state.duration = player.duration || state.duration;
    renderTimeline(state.chapters, state.duration);
    updateTransport();
  });

  const tl = $('timeline');
  const onMove = (e) => {
    if (!state.scrubbing) return;
    const ratio = seekFromEvent(e);
    const tip = $('scrubTip');
    const track = $('timelineTrack').getBoundingClientRect();
    const shell = $('timeline').getBoundingClientRect();
    tip.hidden = false;
    tip.textContent = fmtShort(ratio * (activePlayer().duration || state.duration || 0));
    tip.style.left = `${track.left - shell.left + ratio * track.width}px`;
  };
  const onUp = () => {
    state.scrubbing = false;
    tl.classList.remove('is-scrubbing');
    $('scrubTip').hidden = true;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  tl.addEventListener('pointerdown', (e) => {
    // Plate editor locks scrubbing — only plate tips remain interactive
    if (state.monitorMode === 'plate') {
      if (e.target.closest?.('.tl-region.is-clickable')) return; // region handler owns it
      toast('Timeline locked', 'Exit Plate HTML (Program) to scrub · or click another plate tip', 'warn');
      e.preventDefault();
      return;
    }
    state.scrubbing = true;
    tl.classList.add('is-scrubbing');
    seekFromEvent(e);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  $('chapterStrip').onclick = (e) => {
    if (state.monitorMode === 'plate') {
      toast('Timeline locked', 'Exit to Program to jump chapters', 'warn');
      return;
    }
    const btn = e.target.closest('button[data-start]');
    if (!btn) return;
    seekTo(Number(btn.dataset.start));
    activePlayer().play?.().catch(() => {});
  };

  $('btnPlay').onclick = () => {
    const mode = normalizeMonitorMode(state.monitorMode);
    if (mode !== state.monitorMode) setMonitorMode(mode);
    if (document.body.classList.contains('is-editor') || mode === 'plate') {
      if ($('edPlay')) {
        $('edPlay').click();
        return;
      }
      if (mode === 'plate') {
        $('btnPlateReplay')?.click();
        return;
      }
    }
    const p = activePlayer();
    if (p && !p.paused && !p.ended) {
      p.pause();
      if (state.compare) $('playerB')?.pause();
      updateTransport();
      return;
    }
    // Program (or compare A): if a plate preview is loaded, restore the master first.
    if (mode === 'program' && state.video?.deliveryUrl) {
      const src = p?.currentSrc || p?.getAttribute?.('src') || '';
      if (
        needsProgramRestore({
          monitorMode: 'program',
          previewingPlate: state.previewingPlate,
          playerSrc: src,
          deliveryUrl: state.video.deliveryUrl,
        })
      ) {
        ensureProgramMaster({ play: true, preserveTime: false });
        return;
      }
    }
    startPlayback(p);
    if (state.compare) startPlayback($('playerB'));
  };
  $('btnSkipBack').onclick = () => {
    if (normalizeMonitorMode(state.monitorMode) === 'plate') {
      toast('Timeline locked', 'Exit to Program to scrub', 'warn');
      return;
    }
    if (
      normalizeMonitorMode(state.monitorMode) === 'program' &&
      state.previewingPlate &&
      state.video?.deliveryUrl
    ) {
      ensureProgramMaster({ preserveTime: false });
    }
    seekTo((activePlayer().currentTime || 0) - 5);
  };
  $('btnSkipFwd').onclick = () => {
    if (normalizeMonitorMode(state.monitorMode) === 'plate') {
      toast('Timeline locked', 'Exit to Program to scrub', 'warn');
      return;
    }
    if (
      normalizeMonitorMode(state.monitorMode) === 'program' &&
      state.previewingPlate &&
      state.video?.deliveryUrl
    ) {
      ensureProgramMaster({ preserveTime: false });
    }
    seekTo((activePlayer().currentTime || 0) + 5);
  };
  $('togCaptions').onchange = updateTransport;
  $('togCompare').onchange = () => setCompare($('togCompare').checked);
  $('modeProgram').onclick = () => {
    if (state.plateDirty) {
      toast('Unsaved plate edits', 'Save or Discard first', 'warn');
      return;
    }
    $('togCompare').checked = false;
    state.previewingPlate = null;
    setMonitorMode('program');
    highlightTimelinePlate(null);
    // Always re-assert the delivery master after leaving Editor / plate preview.
    ensureProgramMaster({ force: true });
  };
  $('modePlate').onclick = async () => {
    $('togCompare').checked = false;
    if (!state.htmlPlates?.length && !editor?.deck?.scenes?.length) {
      try {
        await rebuildPlateHtmlPreview({ selectFirst: false });
      } catch (err) {
        toast('Nothing to edit yet', err.message, 'warn');
        return;
      }
    }
    setMonitorMode('plate');
  };
  $('platePickerList').onclick = (e) => {
    const btn = e.target.closest('button[data-plate-id]');
    if (!btn || btn.dataset.kind === 'live') return;
    const plate = state.htmlPlates.find((p) => p.id === btn.dataset.plateId);
    if (plate) showPlateHtml(plate);
  };
  $('btnPlateSaveCopy')?.addEventListener('click', () => savePlateCopyEdits());
  $('btnPlateDiscardEdits')?.addEventListener('click', () => discardPlateCopyEdits());
  $('btnPlateReplay')?.addEventListener('click', () => {
    if (!$('plateFrame')?.contentDocument?.body) {
      const plate = (state.htmlPlates || []).find((p) => p.id === state.activePlateId);
      if (!plate) return;
      // Cold start: load then play through to peak
      const frame = $('plateFrame');
      frame.onload = () => {
        fitFhdPreview();
        let peakMs = 2200;
        try {
          const doc = frame.contentDocument;
          if (doc?.body) peakMs = Math.round(plateEditPeakSec(doc) * 1000);
        } catch {
          /* ignore */
        }
        // Compose static edit ASAP — no need to wait out the peak timeline
        setTimeout(() => enablePlateInlineEdit(frame), 500);
      };
      frame.src = plate.htmlUrl.split('?')[0] + `?t=${Date.now()}&play=1`;
      return;
    }
    // In-place replay keeps unsaved inline edits
    replayPlateInline();
  });
  $('btnPlateExit')?.addEventListener('click', () => $('modeProgram').click());
  $('btnDiscardDraft').onclick = async () => {
    buttonBusy($('btnDiscardDraft'), true);
    try {
      const r = await api(`/api/video/${state.slug}/draft/discard`, { method: 'POST', body: {} });
      renderHtmlPlatePicker(r.plates || []);
      await loadVideo(state.slug);
      hideProposal();
      resetThinkSteps();
      state.editingPlateId = null;
      $('btnApprovePlate').hidden = true;
      setMonitorMode('program');
      toast('Discarded', 'Restored previous sources');
      setStatus('ok', 'Draft discarded');
    } catch (err) {
      toast('Discard failed', err.message, 'err');
    } finally {
      buttonBusy($('btnDiscardDraft'), false);
    }
  };
  $('btnApprovePlate').onclick = () => approvePlateOnly();
  $('btnApproveDraft').onclick = async () => {
    buttonBusy($('btnApproveDraft'), true);
    try {
      await api(`/api/video/${state.slug}/draft/approve`, { method: 'POST', body: {} });
      hideProposal();
      setThinkStep('approve');
      document.querySelectorAll('#thinkSteps li, #sessionPipe li').forEach((li) => li.classList.add('done'));
      toast('Approved', 'Rendering full sequence…');
      setMonitorMode('program');
      state.editingPlateId = null;
      $('btnApprovePlate').hidden = true;
      await makeVideo(state.video?.freshness?.needsRecord ? 'full' : 'quick');
      resetThinkSteps();
    } catch (err) {
      toast('Approve failed', err.message, 'err');
    } finally {
      buttonBusy($('btnApproveDraft'), false);
    }
  };
  $('btnEditScene').onclick = () => editCurrentPlate();
  $('btnAskAiScene')?.addEventListener('click', () => askAiForCurrentScene());
  $('btnMotionScene').onclick = () => openMotionForCurrentScene();
  $('sceneChips').onclick = (e) => {
    const btn = e.target.closest('button[data-scene-id]');
    if (!btn) return;
    const scene = state.scenes.find((s) => s.id === btn.dataset.sceneId);
    if (!scene) return;
    state.currentScene = scene;
    // Chips open the editor for that clip (plate or live)
    if (scene.editable || state.monitorMode === 'plate') {
      editCurrentPlate(scene);
      return;
    }
    if (state.plateDirty) {
      toast('Unsaved plate edits', 'Save or Discard first', 'warn');
      return;
    }
    setMonitorMode('program');
    seekTo(scene.start + 0.05);
    activePlayer().pause?.();
    updateSceneFromTime(scene.start + 0.05);
  };
  // Click a plate tip on the timeline → open plate editor (primary path)
  $('timelineRegions')?.addEventListener('click', (e) => {
    const region = e.target.closest('.tl-region.is-clickable');
    if (!region) return;
    const scene = (state.scenes || []).find(
      (s) => s.plateId === region.dataset.plateId || s.id === region.dataset.sceneId
    );
    if (!scene) return;
    // Live regions open the clip editor only once the Editor is up; in Program they just seek.
    if (!scene.editable && state.monitorMode !== 'plate') return;
    e.preventDefault();
    e.stopPropagation();
    editCurrentPlate(scene);
  });
  $('rateSelect').onchange = () => {
    const rate = Number($('rateSelect').value) || 1;
    $('player').playbackRate = rate;
    $('playerA').playbackRate = rate;
    $('playerB').playbackRate = rate;
  };
  $('btnMute').onclick = () => {
    const p = activePlayer();
    p.muted = !p.muted;
    $('btnMute').classList.toggle('is-muted', p.muted);
    $('btnMute').setAttribute('aria-label', p.muted ? 'Unmute' : 'Mute');
    $('btnMute').title = p.muted ? 'Unmute' : 'Mute';
  };
  $('btnFs').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $('stage').requestFullscreen();
    } catch {
      toast('Fullscreen unavailable', '', 'warn');
    }
  };
  $('compareSelect').onchange = syncCompare;

  $('btnMake').onclick = () => requestMake();
  $('btnActionPrimary').onclick = () => requestMake($('btnActionPrimary').dataset.mode);
  $('recordTargetForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.slug) return;
    try {
      await api(`/api/video/${state.slug}/record-target`, {
        method: 'PUT',
        body: { startUrl: $('recordStartUrl').value, loginRequired: $('recordLoginRequired').checked },
      });
      await loadVideo(state.slug);
      toast('Target saved', state.video?.freshness?.needsRecord ? 'Re-record & Render is ready' : 'Start URL saved');
    } catch (err) {
      toast('Could not save the start URL', err.message, 'err');
    }
  });
  $('btnCleanup')?.addEventListener('click', async () => {
    if (!state.slug) return;
    try {
      const selectedVersions = [...document.querySelectorAll('#cleanupVersions input:checked')].map((el) => el.value);
      const plan = await api(`/api/video/${state.slug}/cleanup`, { method: 'POST', body: { confirm: false, selectedVersions } });
      if (!plan.files?.length) {
        toast('Nothing to clean', 'The master and live recording stay');
        return;
      }
      const lines = plan.files.map((file) => `${file.name} · ${file.bytes} bytes`).join('\n');
      const ok = await ask({
        title: 'Delete intermediate files',
        detail: `${lines}\n\n${plan.totalBytes} bytes. The current master and live.mp4 stay.`,
        ok: 'Delete',
        tone: 'warn',
      });
      if (!ok) return;
      const done = await api(`/api/video/${state.slug}/cleanup`, { method: 'POST', body: { confirm: true, selectedVersions } });
      toast('Intermediates deleted', `${done.files.length} file(s), ${done.totalBytes} bytes`);
    } catch (err) {
      toast('Cleanup failed', err.message, 'err');
    }
  });
  $('btnActionSecondary').onclick = () => requestMake($('btnActionSecondary').dataset.mode);
  $('recordFailureFix')?.addEventListener('click', () => {
    const note = recordFailureNote(state.video?.recordFailure);
    const noteEl = $('improveNote');
    if (noteEl) noteEl.value = note;
    document.querySelector('.tools-panel .ptab[data-right="feedback"]')?.click();
    startImprove('full');
  });
  $('btnExport').onclick = () => exportPack();
  $('btnSetPoster')?.addEventListener('click', () => setPosterFromCurrentFrame());
  $('btnExportMedia')?.addEventListener('click', () => exportPack());
  $('btnBuildHandoffZip')?.addEventListener('click', () => downloadHandoffZip({ buildIfMissing: true }));
  $('btnDownloadHandoff')?.addEventListener('click', (e) => {
    if (!$('btnDownloadHandoff').href || $('btnDownloadHandoff').href.endsWith('#')) {
      e.preventDefault();
      downloadHandoffZip({ buildIfMissing: true });
    }
  });
  $('linkHandoffZip')?.addEventListener('click', (e) => {
    if (!$('linkHandoffZip').href || $('linkHandoffZip').href.endsWith('#')) {
      e.preventDefault();
      downloadHandoffZip({ buildIfMissing: true });
    }
  });

  document.querySelectorAll('[data-enqueue]').forEach((btn) => {
    btn.onclick = () => {
      const kind = btn.dataset.enqueue;
      if (kind === 'make-quick') {
        enqueueJob({ kind: 'make', mode: 'quick', label: 'Render sequence' });
        return;
      }
      if (kind === 'make-full') {
        enqueueJob({ kind: 'make', mode: 'full', label: 'Re-record & render full' });
        return;
      }
      const labels = {
        plates: 'Render brand plates',
        audio: 'Add voice & music',
        deliver: 'Export handoff pack',
        produce: 'Produce master video',
        record: 'Record walkthrough',
      };
      enqueueJob({
        kind: 'step',
        step: kind,
        force: kind === 'plates',
        label: labels[kind] || kind,
      });
    };
  });
  $('btnClearQueue')?.addEventListener('click', () => {
    state.queue = [];
    renderQueue();
    updateStopButtons();
    toast('Queue cleared', 'Running job (if any) keeps going — use Stop to kill it');
  });
  const stopHandler = () => stopAllWork({ reason: 'Stopped' });
  $('btnStopWork')?.addEventListener('click', stopHandler);
  $('btnStopRender')?.addEventListener('click', stopHandler);
  $('btnStopSession')?.addEventListener('click', stopHandler);
  updateStopButtons();
  $('jobQueue')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-qid]');
    if (!btn) return;
    state.queue = state.queue.filter((q) => q.qid !== btn.dataset.removeQid);
    renderQueue();
  });
  $('btnRenderLogToggle')?.addEventListener('click', () => {
    state.renderLogExpanded = !state.renderLogExpanded;
    if ($('renderLiveLog')) $('renderLiveLog').hidden = !state.renderLogExpanded;
    $('btnRenderLogToggle').textContent = state.renderLogExpanded ? 'Collapse log' : 'Expand log';
  });
  $('btnImprove').onclick = () => startImprove('full');
  $('improveNote')?.addEventListener('input', (e) => {
    if (!e.target.value.trim() && $('btnImprove')?.dataset.plateId) resetImproveTarget();
  });
  document.querySelectorAll('[data-improve]').forEach((btn) => {
    if (btn.id === 'btnImprove') return;
    btn.onclick = () => startImprove(btn.dataset.improve);
  });
  $('btnCritic').onclick = () => runCriticFromStudio({ force: false });
  $('btnCriticRun')?.addEventListener('click', () => runCriticFromStudio({ force: true }));
  $('btnCriticApply')?.addEventListener('click', async () => {
    buttonBusy($('btnCriticApply'), true);
    try {
      await api(`/api/video/${state.slug}/critic`, { method: 'POST', body: { force: true, apply: true } });
      await loadVideo(state.slug);
      toast('Safe fixes applied', 'High-confidence narration rewrites written to narration.mjs');
    } catch (err) {
      toast('Apply failed', err.message, 'err');
    } finally {
      buttonBusy($('btnCriticApply'), false);
    }
  });
  $('criticFindings')?.addEventListener('click', (e) => {
    const fix = e.target.closest('[data-critic-fix]');
    if (!fix) return;
    const f = $('criticFindings').__findings?.[Number(fix.dataset.criticFix)];
    if (f) fixFindingWithAi(f);
  });
  $('storyPurpose')?.addEventListener('change', async (e) => {
    const purpose = e.target.value;
    if (!purpose) return;
    try {
      const r = await api(`/api/video/${state.slug}/story`, { method: 'POST', body: { purpose } });
      if (state.video) state.video.story = r.story;
      renderStory(r.story);
      toast('Story spine set', r.story.framework);
    } catch (err) {
      toast('Could not set purpose', err.message, 'err');
    }
  });
  $('btnPlateAccent')?.addEventListener('click', () => togglePlateAccent());
  $('btnAccentClose')?.addEventListener('click', () => togglePlateAccent(false));
  $('btnAccentReset')?.addEventListener('click', () => savePlateAccent({ reset: true }));
  for (const [id, key] of [
    ['accentAtmosphere', 'atmosphere'],
    ['accentReveal', 'titleReveal'],
    ['accentDepth', 'depth'],
    ['accentEnergy', 'energy'],
  ]) {
    $(id)?.addEventListener('change', (e) => savePlateAccent({ [key]: e.target.value || null }));
  }
  $('accentSheen')?.addEventListener('change', (e) => savePlateAccent({ sheen: e.target.value ? e.target.value === 'on' : null }));
  document.addEventListener('pointerdown', (e) => {
    const pop = $('plateAccentPop');
    if (pop && !pop.hidden && !e.target.closest('#plateAccent')) togglePlateAccent(false);
  });
  $('btnOverlaysApply')?.addEventListener('click', () => applyOverlaysLook());
  $('btnMotion').onclick = async () => {
    buttonBusy($('btnMotion'), true);
    try {
      if (!state.video?.hasDraft) {
        await api(`/api/video/${state.slug}/draft/snapshot`, { method: 'POST', body: {} });
      }
      clearTimeout(motionLiveTimer);
      motionLiveGen += 1;
      const r = await api(`/api/video/${state.slug}/motion`, { method: 'POST', body: collectMotionBody() });
      state.motionApplied = true;
      if (state.video) state.video.motion = r.motion;
      renderMotionMeta(r.motion);
      renderEffects(r.motion);
      if (r.direction) {
        state.video.direction = r.direction;
        renderDirection(r.direction);
        workflow?.render(state.video);
      }
      await rebuildPlateHtmlPreview({ selectFirst: !state.activePlateId && !editor?.active });
      state.platesPreviewed = true;
      updateMotionApprove();
      showProposal({
        title: 'Motion template applied',
        reason: `${energy} on all plates — review live HTML, then Approve & Render.`,
        steps: [
          { label: `Motion → ${energy}`, status: 'done' },
          { label: 'HTML rebuilt', status: 'done' },
          { label: 'Awaiting approve', status: 'run' },
        ],
      });
      toast('Live preview updated', energy);
      setStatus('warn', 'Motion preview — approve to render');
    } catch (err) {
      toast('Motion failed', err.message, 'err');
    } finally {
      buttonBusy($('btnMotion'), false);
    }
  };
  $('btnPreviewPlates').onclick = async () => {
    buttonBusy($('btnPreviewPlates'), true);
    try {
      if (!state.motionApplied) {
        const r = await api(`/api/video/${state.slug}/motion`, { method: 'POST', body: collectMotionBody() });
        if (r.direction) {
          state.video.direction = r.direction;
          renderDirection(r.direction);
          workflow?.render(state.video);
        }
        state.motionApplied = true;
      }
      // Fast path: live HTML. Queue MP4 encode so it doesn't steal the poller.
      await rebuildPlateHtmlPreview({ selectFirst: true });
      enqueueJob({ kind: 'step', step: 'plates', force: true, label: 'Render brand plates' });
      state.platesPreviewed = true;
      updateMotionApprove();
      document.querySelector('.tools-panel .ptab[data-right="motion"]')?.click();
      showProposal({
        title: 'Plate preview ready',
        reason: 'Live HTML is in the center. Approve & Render to encode the full sequence.',
        steps: [
          { label: 'HTML preview', status: 'done' },
          { label: 'Awaiting approve', status: 'run' },
        ],
      });
      toast('Live HTML ready', 'Use Plate HTML mode');
    } catch (err) {
      toast('Plate preview failed', err.message, 'err');
    } finally {
      buttonBusy($('btnPreviewPlates'), false);
    }
  };
  $('btnApproveMotion').onclick = () => $('btnApproveDraft').click();
  $('plateBin').onclick = (e) => {
    const btn = e.target.closest('button[data-plate-url]');
    if (!btn) return;
    playPlatePreview(btn.dataset.plateUrl, btn.closest('li')?.querySelector('strong')?.textContent || 'plate');
  };
  document.querySelectorAll('#energyGrid .energy').forEach((btn) => {
    btn.onclick = () => {
      setEnergy(btn.dataset.energy);
      scheduleMotionLive();
    };
  });
  document.querySelectorAll('#transitionGrid [data-transition]').forEach((btn) => {
    btn.onclick = () => {
      renderTransitions({ ...(state.video?.transitions || { duration: 0.6 }), style: btn.dataset.transition });
      saveTransitions({ style: btn.dataset.transition });
    };
  });
  document.querySelectorAll('#atmosphereGrid [data-atmosphere]').forEach((btn) => {
    btn.onclick = () => {
      setAtmosphere(btn.dataset.atmosphere);
      scheduleMotionLive();
    };
  });
  $('atmosphereOpacity')?.addEventListener('input', (e) => {
    $('atmosphereOpacityOut').textContent = Number(e.target.value).toFixed(2);
    scheduleMotionLive();
  });
  $('atmosphereSpeed')?.addEventListener('input', (e) => {
    $('atmosphereSpeedOut').textContent = `${Number(e.target.value).toFixed(1)}×`;
    scheduleMotionLive();
  });
  ['titleReveal', 'cardDepth', 'sheenToggle'].forEach((id) => $(id)?.addEventListener('change', () => scheduleMotionLive()));
  $('paletteGrid').onclick = async (e) => {
    const btn = e.target.closest('[data-palette]');
    if (!btn) return;
    const r = await saveDirection({ scale: btn.dataset.palette }, { quiet: true });
    await syncEditorAfterDirection({ plates: true });
    toast('Color scale set', `${r.direction.scale} · five plate roles updated`, 'ok');
  };
  $('scaleEditor').onchange = async (e) => {
    const input = e.target.closest('input[data-role]');
    if (!input) return;
    const colors = {};
    $('scaleEditor').querySelectorAll('input[data-role]').forEach((el) => {
      colors[el.dataset.role] = el.value;
    });
    const r = await saveDirection({ scale: 'custom', colors }, { quiet: true });
    await syncEditorAfterDirection({ plates: true });
    toast('Colors set', `${r.direction.colors.gold} accent · this video only`, 'ok');
  };
  $('cameraSection').onclick = async (e) => {
    const look = e.target.closest('[data-look]');
    if (look && !look.classList.contains('active')) {
      const r = await saveDirection({ look: look.dataset.look }, { quiet: true });
      // Look presets reshape the inset frame on the Editor stage immediately.
      await syncEditorAfterDirection();
      toast('Look applied', `${r.direction.looks[r.direction.look].label} · live on the stage`, 'ok');
      return;
    }
    const btn = e.target.closest('[data-value]');
    const group = btn?.closest('[data-camera],[data-cursor]');
    if (!btn || !group || btn.classList.contains('active')) return;
    const patch = group.dataset.camera
      ? { camera: { [group.dataset.camera]: btn.dataset.value } }
      : { cursor: { [group.dataset.cursor]: btn.dataset.value } };
    const r = await saveDirection(patch, { quiet: true });
    if (group.dataset.camera && FRAME_CAMERA_KEYS.has(group.dataset.camera)) {
      await syncEditorAfterDirection();
      toast(
        'Frame set',
        `${r.direction.camera.frame}${r.direction.camera.frame === 'inset' ? ` · ${r.direction.camera.background}` : ''} · live on the stage`,
        'ok'
      );
    } else if (group.dataset.camera === 'zoom') {
      // Auto zoom re-plans from this recording's click marks — refresh so the Editor stage matches.
      await syncEditorAfterDirection();
      toast('Auto zoom set', `${r.direction.camera.zoom} · live on the stage`, 'ok');
    } else {
      toast('Cursor set', `${r.direction.cursor.style} · ${r.direction.cursor.size.toUpperCase()} · next recording`, 'ok');
    }
  };
  $('keysToggle').onchange = async (e) => {
    const r = await saveDirection({ keys: e.target.checked }, { quiet: true });
    toast('Keystrokes', `${r.direction.keys ? 'shown' : 'hidden'} · next recording`, 'ok');
  };
  for (const [id, key, label] of [
    ['glideToggle', 'glide', 'Smooth glide'],
    ['idleToggle', 'hideIdle', 'Hide when idle'],
    ['loopToggle', 'loop', 'Loop cursor'],
  ]) {
    $(id).onchange = async (e) => {
      const r = await saveDirection({ cursor: { [key]: e.target.checked } }, { quiet: true });
      toast(label, `${r.direction.cursor[key] ? 'on' : 'off'} · next recording`, 'ok');
    };
  }
  $('exportPresets').onchange = () => {
    state.exportPick = [...$('exportPresets').querySelectorAll('input:checked')].map((el) => el.value);
    $('exportPresets').querySelectorAll('.export-preset').forEach((el) => {
      el.classList.toggle('active', el.querySelector('input').checked);
    });
  };
  $('reelToggle').onchange = (e) => {
    $('safeAreaOverlay').hidden = !e.target.checked;
    toast('Reel safe area', e.target.checked ? 'Vertical interface overlap shown on Program' : 'Preview hidden', 'ok');
  };
  $('btnExportFormats').onclick = () => {
    const presets = state.exportPick || ['square', 'vertical', 'gif'];
    if (!presets.length) return toast('Pick a format', 'Choose at least one format to export', 'warn');
    enqueueJob({ kind: 'step', step: 'export', presets, label: `Export ${presets.length} format${presets.length === 1 ? '' : 's'}` });
  };
  $('logoGrid').onclick = async (e) => {
    const btn = e.target.closest('[data-logo]');
    if (!btn) return;
    const r = await saveDirection({ logo: btn.dataset.logo }, { quiet: true });
    await syncEditorAfterDirection({ plates: true });
    toast('Logo set', r.direction.logo, 'ok');
  };
  document.querySelectorAll('#focusGrid [data-focus]').forEach((btn) => {
    btn.onclick = () => {
      renderDirection({ ...(state.video?.direction || {}), focus: btn.dataset.focus, approvedAt: null });
      saveDirection({ focus: btn.dataset.focus });
    };
  });
  $('paceSeg')?.addEventListener('change', async (e) => {
    const value = e.target?.value;
    if (!value) return;
    const r = await saveDirection({ pace: value }, { quiet: true });
    if (r) toast('Live pace set', `${r.direction.pace.label} · ${r.direction.pace.tempo}× — re-record to apply`, 'ok');
  });
  $('btnApproveDirection').onclick = async () => {
    buttonBusy($('btnApproveDirection'), true);
    try {
      const r = await saveDirection({ approve: true }, { quiet: true });
      toast('Direction approved', `${r.direction.palette} palette · ${r.direction.focus} focus`, 'ok');
      await loadVideo(state.slug);
    } finally {
      buttonBusy($('btnApproveDirection'), false);
    }
  };
  $('transitionDuration').oninput = (e) => {
    $('transitionDurationOut').textContent = `${Number(e.target.value).toFixed(1)}s`;
  };
  $('transitionDuration').onchange = (e) => saveTransitions({ duration: Number(e.target.value) });
  const snapshot = async () => {
    try {
      const suggested = `Saved snapshot`;
      const title = await ask({
        kind: 'prompt',
        title: 'Save a version',
        detail: 'A named checkpoint of the whole cut — play it, compare it or restore it later.',
        label: 'Title',
        value: suggested,
        ok: 'Save version',
      });
      if (title === null) return; // cancelled
      const r = await api(`/api/video/${state.slug}/versions/snapshot`, {
        method: 'POST',
        body: {
          title: (title || suggested).trim() || suggested,
          trigger: 'manual',
          kind: 'release',
          note: 'manual save',
        },
      });
      await loadVideo(state.slug);
      document.querySelector('.project-panel .ptab[data-left="versions"]')?.click();
      const ver = r.version;
      toast(ver?.name ? `${ver.name} saved` : 'Version saved', ver?.title || '');
    } catch (err) {
      toast('Save failed', err.message, 'err');
    }
  };
  $('btnSnapshot').onclick = snapshot;
  $('btnSnapshotSide').onclick = snapshot;
  if ($('togShowCheckpoints')) {
    $('togShowCheckpoints').onchange = () => {
      if (state.video) renderVersions(state.video);
    };
  }
  wirePanelTabs();
  wirePanelResize();
  $('btnCopyYt').onclick = async () => {
    if (!state.ytText) return;
    await navigator.clipboard.writeText(state.ytText.trim() + '\n');
    toast('Copied', 'YouTube chapters');
  };
  $('btnHelp').onclick = () => $('helpDialog').showModal();
  $('btnCommand').onclick = openCommandMenu;
  $('commandInput').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    let visible = 0;
    document.querySelectorAll('#commandList [data-command]').forEach((btn) => {
      btn.hidden = Boolean(q) && !btn.textContent.toLowerCase().includes(q);
      if (!btn.hidden) visible++;
    });
    $('commandEmpty').hidden = visible > 0;
    commandActive(commandItems()[0]);
  };
  $('commandInput').onkeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      $('commandDialog').close();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = commandItems();
      if (!items.length) return;
      const i = items.findIndex((b) => b.classList.contains('is-active'));
      const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      commandActive(next);
      return;
    }
    if (e.key !== 'Enter') return;
    const pick = commandItems().find((b) => b.classList.contains('is-active')) || commandItems()[0];
    if (pick) {
      e.preventDefault();
      runCommand(pick.dataset.command);
    }
  };
  $('commandList').onclick = (e) => {
    const btn = e.target.closest('[data-command]');
    if (btn) runCommand(btn.dataset.command);
  };
  $('commandList').onpointermove = (e) => {
    const btn = e.target.closest('[data-command]');
    if (btn && !btn.classList.contains('is-active')) commandActive(btn);
  };
  if ($('btnSessionLog')) {
    $('btnSessionLog').onclick = () => {
      state.activityExpanded = !state.activityExpanded;
      if ($('sessionLog')) $('sessionLog').hidden = !state.activityExpanded;
      if ($('sessionNow')) $('sessionNow').hidden = state.activityExpanded || !$('sessionNow').textContent;
      $('btnSessionLog').textContent = state.activityExpanded ? 'Hide log' : 'Log';
    };
  }
  if ($('btnProposalWork')) {
    $('btnProposalWork').onclick = () => {
      const rail = $('sessionRail');
      const expanded = !rail?.classList.contains('show-work');
      rail?.classList.toggle('show-work', expanded);
      $('btnProposalWork').textContent = expanded ? 'Hide agent work' : 'View agent work';
      $('btnProposalWork').setAttribute('aria-expanded', String(expanded));
      if (expanded) $('sessionProgress')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      else if (rail) rail.scrollTop = 0;
    };
  }
  if ($('btnReviewProposal')) {
    $('btnReviewProposal').onclick = () => {
      const review = $('btnReviewProposal').dataset.review || 'preview';
      if (review === 'script') {
        workflow?.openScript?.();
        toast('Review changes', 'Script and narration are open — approve only after they read and sound right');
        return;
      }
      if (review === 'direction') {
        document.querySelector('.tools-panel .ptab[data-right="motion"]')?.click();
        toast('Review direction', 'Check the video-local brand, motion and camera settings');
        return;
      }
      const plate = state.htmlPlates?.find((item) => item.id === state.activePlateId) || state.htmlPlates?.[0];
      if (plate) {
        showPlateHtml(plate);
        setMonitorMode('plate');
      } else {
        setMonitorMode('program');
      }
      const stage = $('stage');
      stage?.classList.remove('review-focus');
      requestAnimationFrame(() => stage?.classList.add('review-focus'));
      setTimeout(() => stage?.classList.remove('review-focus'), 900);
      stage?.focus?.({ preventScroll: true });
      toast('Preview in focus', plate ? `Reviewing ${plate.label || plate.id}` : 'Review the proposed result in Program');
    };
  }
  setSessionIdle();
  showLeftTab('render');
  renderQueue();

  $('versions').onclick = async (e) => {
    const btn = e.target.closest('button[data-ver]');
    if (!btn) return;
    const id = btn.dataset.ver;
    const act = btn.dataset.act;
    if (act === 'play') {
      const verUrl = `/version-media/${state.slug}/${id}/${state.slug}.mp4`;
      const ver = (state.video?.versions || []).find((x) => x.id === id);
      playPlatePreview(verUrl, ver ? `Snapshot · ${versionDisplayName(ver)}` : `Snapshot · ${id}`);
    } else if (act === 'compare') {
      $('compareSelect').value = id;
      setCompare(true);
      const ver = (state.video?.versions || []).find((x) => x.id === id);
      toast('Compare', ver ? `Current vs ${versionDisplayName(ver)}` : 'Current vs version');
    } else if (act === 'restore') {
      const ver = (state.video?.versions || []).find((x) => x.id === id);
      await api(`/api/video/${state.slug}/versions/${id}/restore`, { method: 'POST', body: {} });
      await loadVideo(state.slug);
      toast(ver ? `${ver.name} restored` : 'Settings restored', 'Press Render to rebuild');
    }
  };

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if ($('commandDialog').open) $('commandDialog').close();
      else openCommandMenu();
      return;
    }
    const tag = e.target?.tagName || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.target?.isContentEditable) return;
    if (document.querySelector('dialog[open]')) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 's' && state.monitorMode === 'plate') {
      e.preventDefault();
      savePlateCopyEdits();
      return;
    }
    if (e.code === 'Space') {
      if (document.body.classList.contains('is-editor')) return;
      e.preventDefault();
      $('btnPlay').click();
    } else if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowLeft') {
      if (normalizeMonitorMode(state.monitorMode) === 'plate') return;
      e.preventDefault();
      if (state.previewingPlate && state.video?.deliveryUrl) ensureProgramMaster({ preserveTime: false });
      seekTo((activePlayer().currentTime || 0) - (e.key === 'ArrowLeft' ? 2 : 5));
    } else if (e.key === 'l' || e.key === 'L' || e.key === 'ArrowRight') {
      if (normalizeMonitorMode(state.monitorMode) === 'plate') return;
      e.preventDefault();
      if (state.previewingPlate && state.video?.deliveryUrl) ensureProgramMaster({ preserveTime: false });
      seekTo((activePlayer().currentTime || 0) + (e.key === 'ArrowRight' ? 2 : 5));
    } else if (e.key === 'c' || e.key === 'C') {
      $('togCaptions').checked = !$('togCaptions').checked;
      updateTransport();
    } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      $('helpDialog').showModal();
    }
  });
}

/** Re-read the summary without touching the player (approvals, narration edits). */
async function refreshSummary() {
  if (!state.slug) return;
  const v = await api(`/api/video/${state.slug}`);
  state.video = v;
  renderActionCard(v);
  workflow?.render(v);
  renderVersions(v);
}

function optionLabel(v) {
  if (v.error) return `${v.slug} (needs setup)`;
  if (v.lineage?.role === 'branch') return `  ↳ ${v.title || v.slug}`;
  return v.title || v.slug;
}

/** Fill the sequence picker, grouping branches under project folders. */
function fillSlugSelect(sel, { videos = [], folders = [], loose = [] } = {}) {
  const chunks = [];
  for (const folder of folders) {
    if (!folder.videos?.length) continue;
    chunks.push(
      `<optgroup label="${escapeHtml(folder.title || folder.id)}">${folder.videos
        .map((v) => `<option value="${escapeHtml(v.slug)}">${escapeHtml(optionLabel(v))}</option>`)
        .join('')}</optgroup>`
    );
  }
  const rest = loose.length ? loose : folders.length ? [] : videos;
  if (rest.length) {
    const label = folders.length ? 'Other videos' : 'Videos';
    chunks.push(
      `<optgroup label="${label}">${rest
        .map((v) => `<option value="${escapeHtml(v.slug)}">${escapeHtml(optionLabel(v))}</option>`)
        .join('')}</optgroup>`
    );
  }
  sel.innerHTML = chunks.join('') || `<option value="">No videos</option>`;
}

/** Refresh the sequence picker (folders + branches) and keep the current selection when possible. */
async function refreshVideoIndex({ prefer } = {}) {
  const sel = $('slugSelect');
  const keep = prefer || sel?.value || state.slug || '';
  const data = await api('/api/videos');
  fillSlugSelect(sel, data);
  if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
  return data;
}

async function openVideo(slug) {
  const sel = $('slugSelect');
  // Always reload the index so new branches / folders appear after create.
  await refreshVideoIndex({ prefer: slug });
  if (![...sel.options].some((o) => o.value === slug)) {
    throw new Error(`Sequence "${slug}" is not in the project list`);
  }
  sel.value = slug;
  setSlug(slug);
  await loadVideo(slug);
}

function initStages() {
  editor = initEditor({
    $,
    api,
    state,
    toast,
    escapeHtml,
    fmtShort,
    setMonitorMode,
    setMonitorLabel,
    saveDirection,
    renderOverlays,
    requestMake,
    requestAudio() {
      enqueueJob({ kind: 'step', step: 'audio', label: 'Mix voice and music' });
    },
    async requestMusicFit({ prompt } = {}) {
      const slug = state.slug;
      if (!slug) return;
      try {
        if (prompt != null) {
          const r = await api(`/api/video/${encodeURIComponent(slug)}/music/prompt`, {
            method: 'POST',
            body: { prompt },
          });
          if (state.slug === slug && r && editor) {
            // Apply the saved prompt into the live deck without a second round-trip.
            editor.refresh && (await editor.refresh());
          }
        }
      } catch (err) {
        toast('Could not save music prompt', err.message, 'err');
        return;
      }
      if (state.slug !== slug) return;
      const hint = String(prompt || '').trim();
      enqueueJob({
        kind: 'step',
        step: 'music',
        force: true,
        label: hint ? `Compose music · ${hint.slice(0, 40)}${hint.length > 40 ? '…' : ''}` : 'Compose music to fit the cut',
      });
      enqueueJob({ kind: 'step', step: 'mix', label: 'Mix with the new bed' });
    },
    plate: {
      load: (id, opts) => loadPlateFrame(id, opts),
      ready: () => state.plateFrameReady || null,
      motion: plateMotionMode,
      seek: plateSeek,
      restart: plateRestart,
      text: plateTextMode,
      composite: plateSetLiveComposite,
      dirty: () => Boolean(state.plateDirty),
      save: savePlateCopyEdits,
      discard: discardPlateCopyEdits,
      accent: toggleFieldAccent,
      accentState: currentAccentState,
      focus: focusPlateField,
      fields: listPlateFields,
      setField: setPlateFieldSource,
      selection: plateSelectionDetail,
      fit: fitFhdPreview,
    },
  });
  workflow = initWorkflow({
    api,
    toast,
    escapeHtml,
    watchJob,
    setFaviconMode,
    getState: () => state,
    reload: ({ quiet } = {}) => (quiet ? refreshSummary() : loadVideo(state.slug)),
    onPreviewLiveCard: previewLiveCard,
    onStageAction: async (key, opts = {}) => {
      if (key === 'record') {
        const r = state.video?.review?.script;
        if (
          r?.effective !== 'approved' &&
          !(await ask({ title: 'Record before the script is approved?', detail: 'Recording follows the script line by line. Approving first keeps the capture and the narration in step.', ok: 'Record anyway', tone: 'warn' }))
        )
          return;
        if (
          !state.video?.direction?.approvedAt &&
          !(await ask({ title: 'Record before direction is approved?', detail: 'Palette, camera and cursor settings shape the capture. Approve direction first to avoid a re-record.', ok: 'Record anyway', tone: 'warn' }))
        )
          return;
        requestMake('full');
      } else if (key === 'direction') {
        document.querySelector('.tools-panel .ptab[data-right="motion"]')?.click();
      } else if (key === 'deliver') {
        const c = state.video?.review?.cut;
        if (
          c?.effective !== 'approved' &&
          !(await ask({ title: 'Export before the cut is approved?', detail: 'The handoff pack is built from the current render. Approving the cut first marks it as the version you stand behind.', ok: 'Export anyway', tone: 'warn' }))
        )
          return;
        exportPack();
      } else if (key === 'feedback') {
        document.querySelector('.tools-panel .ptab[data-right="feedback"]')?.click();
        if (opts.note && $('improveNote')) $('improveNote').value = opts.note;
      }
    },
  });
  initProjects({
    api,
    toast,
    escapeHtml,
    watchJob,
    openVideo,
    followAgentJob: workflow.followAgentJob,
    openScript: workflow.openScript,
  });
}

function agentTip(auth, id) {
  const runner = auth.runners?.[id];
  const label = runner?.label || (id === 'claude' ? 'Claude Code' : 'Cursor agent');
  const active = (auth.provider || auth.preference) === id;
  if (!runner?.available) {
    return `${label}\nNot installed\n${runner?.message || (id === 'claude'
      ? 'Install from claude.ai/code, then run claude → /login.'
      : 'Install Cursor CLI, then run agent login.')}`;
  }
  if (!runner.authenticated) {
    return `${label}${active ? ' · selected' : ''}\nNeeds sign-in\n${runner.message || (id === 'claude'
      ? 'Run claude → /login, or set ANTHROPIC_API_KEY in kit/.env.'
      : 'Run agent login, or set CURSOR_API_KEY in kit/.env.')}`;
  }
  if (runner.soft) {
    return `${label}${active ? ' · selected' : ''}\nSigned in (unverified)\n${runner.message || 'Retry Improve after agent login refreshes.'}`;
  }
  if (active) {
    return `${label}\nActive · ready for Improve${runner.via ? `\nvia ${runner.via}` : ''}`;
  }
  return `${label}\nReady — click to use for Improve${auth.switchable ? '' : '\n(other runner unavailable)'}`;
}

function renderAgentChrome(auth = {}) {
  const host = $('agentChrome');
  if (!host) return;

  const active = auth.provider || (auth.preference !== 'auto' ? auth.preference : null);

  for (const btn of host.querySelectorAll('[data-agent]')) {
    const id = btn.dataset.agent;
    const runner = auth.runners?.[id];
    const isActive = Boolean(active && active === id);
    const available = Boolean(runner?.available);
    const ready = available && runner.authenticated && !runner.soft;

    let state = 'missing';
    if (ready) state = 'ready';
    else if (available) state = 'needs-auth';

    btn.dataset.state = state;
    btn.classList.toggle('is-live', isActive && state !== 'missing');
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    // Keep missing buttons focusable/hoverable for setup tips; block activation via aria-disabled.
    btn.disabled = false;
    btn.setAttribute('aria-disabled', available ? 'false' : 'true');
    btn.dataset.tip = agentTip(auth, id);
    btn.removeAttribute('title');
    btn.setAttribute(
      'aria-label',
      `${runner?.label || id}${isActive ? ', active' : ''}${
        state === 'ready' ? ', ready' : state === 'needs-auth' ? ', needs sign-in' : ', not installed'
      }`
    );
  }
}

function showAgentTip(host, btn) {
  const tip = $('agentTip');
  if (!tip || !btn?.dataset.tip) return;
  tip.textContent = btn.dataset.tip;
  tip.hidden = false;
}

function hideAgentTip() {
  const tip = $('agentTip');
  if (tip) tip.hidden = true;
}

function wireAgentSwitch() {
  const host = $('agentChrome');
  if (!host || host.dataset.wired) return;
  host.dataset.wired = '1';

  host.addEventListener('pointerover', (e) => {
    const btn = e.target.closest?.('[data-agent]');
    if (btn && host.contains(btn)) showAgentTip(host, btn);
  });
  host.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget || !host.contains(e.relatedTarget)) hideAgentTip();
  });
  host.addEventListener('focusin', (e) => {
    const btn = e.target.closest?.('[data-agent]');
    if (btn) showAgentTip(host, btn);
  });
  host.addEventListener('focusout', (e) => {
    if (!e.relatedTarget || !host.contains(e.relatedTarget)) hideAgentTip();
  });

  host.addEventListener('click', async (e) => {
    const btn = e.target.closest?.('[data-agent]');
    if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
    if (btn.getAttribute('aria-pressed') === 'true') return;
    if (btn.dataset.state === 'missing') return;
    const provider = btn.dataset.agent;
    const buttons = [...host.querySelectorAll('[data-agent]')];
    try {
      for (const b of buttons) b.setAttribute('aria-disabled', 'true');
      const r = await api('/api/agent/preference', { method: 'POST', body: { provider } });
      renderAgentChrome(r.agentAuth || {});
      const label = r.agentAuth?.active?.label || provider;
      toast('Agent runner', label, 'ok');
    } catch (err) {
      toast('Could not switch agent', err.message, 'err');
      try {
        const health = await api('/api/health');
        renderAgentChrome(health.agentAuth || {});
      } catch {
        renderAgentChrome({});
      }
    } finally {
      hideAgentTip();
    }
  });
}

async function boot() {
  try {
    initFavicon();
    initSelects();
    mountZen();
    initHelp();
    setFaviconMode('loading');
    document.addEventListener('click', (e) => {
      if (e.target.closest?.('[data-open-editor]')) $('modePlate')?.click();
    });
    setBootStatus('Starting…');
    const health = await api('/api/health');
    renderAgentChrome(health.agentAuth || {});
    wireAgentSwitch();

    initStages();
    initBranch({ $, api, state, toast, escapeHtml, openVideo, watchJob });
    setBootStatus('Loading projects…');
    const videoIndex = await api('/api/videos');
    const { videos } = videoIndex;
    const sel = $('slugSelect');
    if (!videos.length) {
      sel.innerHTML = `<option value="">No videos</option>`;
      setStatus('warn', 'No projects — create one with New video');
      wire();
      setFaviconMode('idle');
      dismissBoot();
      return;
    }
    fillSlugSelect(sel, videoIndex);
    const want = (qsSlug() && videos.some((v) => v.slug === qsSlug()) && qsSlug()) || videos.find((v) => !v.error)?.slug || videos[0].slug;
    sel.value = want;
    setSlug(want);
    sel.onchange = async () => {
      const next = sel.value;
      if (!next || next === state.slug) return;
      if (state.jobBusy || state.queue.length) {
        await stopAllWork({ reason: 'Stopped · sequence changed', silent: false });
      }
      setSlug(next);
      try {
        await loadVideo(next);
      } catch {
        /* toast already shown in loadVideo */
      }
    };
    window.addEventListener('pagehide', () => {
      if (!state.jobBusy && !state.queue.length) return;
      const id = state.jobId;
      try {
        state.workAbort?.abort();
      } catch {
        /* ignore */
      }
      if (id) {
        navigator.sendBeacon?.(
          `/api/jobs/${id}/cancel`,
          new Blob([JSON.stringify({})], { type: 'application/json' })
        );
      }
      fetch('/api/jobs/cancel-all', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(
        () => {}
      );
    });
    wire();
    await loadVideo(want);
    if (getMarkMode() === 'loading') setFaviconMode('idle');
    dismissBoot();
  } catch (err) {
    setFaviconMode('err');
    document.body.innerHTML = `<pre style="color:#f07178;padding:40px">Studio failed: ${escapeHtml(err.message)}</pre>`;
  }
}

window.addEventListener('error', (ev) => {
  const msg = ev?.error?.message || ev?.message || 'Unknown error';
  console.error('[studio]', msg, ev?.error || ev);
  try {
    toast?.('Studio hitch', msg, 'err');
  } catch {
    /* boot may not have wired toast yet */
  }
});
window.addEventListener('unhandledrejection', (ev) => {
  const reason = ev?.reason;
  const msg = reason?.message || String(reason || 'Unhandled rejection');
  console.error('[studio]', msg, reason);
  try {
    toast?.('Studio hitch', msg, 'err');
  } catch {
    /* ignore */
  }
});

boot();

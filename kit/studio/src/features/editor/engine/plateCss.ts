import { desk } from '@/desk/store';

/** Plate edit-mode CSS and the reveal helpers from the top of `kit/studio/app.js`. */

export const PLATE_EDIT_CSS = `
/*
  Composed static edit mode.
  Seeking mid-timeline freezes rise/mask/wipe/trace mid-reveal → sliced glyphs & half-drawn logos.
  Here we disable every reveal mechanism and force the finished visual state.
*/
body.studio-edit .black { display: none !important; }
body.studio-edit .grain { opacity: 0.22 !important; animation: none !important; }
body.studio-edit .sweep { display: none !important; } /* decorative pass — not needed to edit */
/* Paint-only atmosphere. On the close plate the bloom and the full-stage grid sit above the steps. */
.blob, .grid, .bloom, .burst, .halo { pointer-events: none !important; }

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
/* Lockups: honour Show logo + settle size/lift while editing (do not force marks on). */
body.studio-edit .lockup-exit {
  opacity: var(--close-logo, var(--open-logo, 1)) !important;
}
body.studio-edit body[data-plate="open"] .lockup-exit,
body.studio-edit .open-plate .lockup-exit {
  opacity: var(--open-logo, 1) !important;
}
body.studio-edit body[data-plate="close"] .lockup-exit {
  opacity: var(--close-logo, 1) !important;
}
body.studio-edit .lockup-exit .logo {
  transform: translateY(var(--close-lift-y, 0%)) scale(var(--close-lift-scale, 1)) !important;
  opacity: 1 !important;
  filter: drop-shadow(0 14px 40px color-mix(in srgb, var(--amber) 22%, transparent)) !important;
}
body.studio-edit .corner-logo {
  opacity: var(--mark-logo, 1) !important;
  width: var(--mark-logo-width, 180px) !important;
  filter: none !important;
  transform: none !important;
  animation: none !important;
}
body.studio-edit .corner-logo .logo svg,
body.studio-edit .corner-logo .logo-img {
  max-height: var(--mark-logo-size, 30px) !important;
}
body.studio-edit .o-center {
  opacity: var(--orbit-logo, 1) !important;
  scale: var(--orbit-center-scale, 1) !important;
  transform: none !important;
  animation: none !important;
  filter: none !important;
}
body.studio-edit .o-center .logo svg,
body.studio-edit .o-center .logo-img {
  max-height: var(--orbit-logo-size, 56px) !important;
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
export const PLATE_PEEK_CSS = `
/* Paint-only atmosphere. On the close plate the bloom and the full-stage grid sit above the steps,
   so a click on a step never reached the words. */
.blob, .grid, .bloom, .burst, .halo { pointer-events: none !important; }
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
/* Content slots: a whole tile (feature card, logo, stat, quote) or an image inside it. Hovering
   lights it on the stage and its record in the Inspector; a click opens the record. */
body[data-motion="1"] [data-slot] {
  outline: 1.5px dashed transparent;
  outline-offset: 6px;
  border-radius: 14px;
  transition: outline-color .14s ease, box-shadow .14s ease;
}
body[data-motion="1"] [data-slot]:hover,
body[data-motion="1"] [data-slot].is-peek {
  outline-color: rgba(255, 254, 37, 0.7);
  box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.0), 0 0 40px -10px rgba(255, 254, 37, 0.35);
}
body[data-motion="1"] [data-slot-kind="asset"] { cursor: pointer; position: relative; z-index: 5; }
/* Pins drag across their surface (the surface only lends its box; the shot under it stays clickable). */
body[data-motion="1"] [data-slot-drag="xy"] { cursor: grab; pointer-events: auto; touch-action: none; }
body[data-motion="1"] [data-slot-drag="xy"].is-dragging { cursor: grabbing; animation-play-state: paused; outline-color: rgba(255, 254, 37, 0.9); }
body[data-motion="1"] [data-slot-drag="xy"].is-dragging * { animation-play-state: paused; }
body[data-motion="1"] [data-slot-kind="asset"].is-empty { display: none; }
body[data-motion="1"] [data-slot-kind="asset"]:hover::before {
  content: 'Swap image';
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  z-index: 30;
  padding: 3px 8px;
  border-radius: 5px;
  font: 600 10px/1.2 ui-sans-serif, system-ui, sans-serif;
  color: #0a0a0a;
  background: #fffe25;
  white-space: nowrap;
  pointer-events: none;
}
`;

/** Parse a CSS time custom property (e.g. `--black-out: 5.7s`) from the plate document. */
export function plateCssSec(doc: Document, name: string): number | null {
  const el = doc.documentElement;
  const view = doc.defaultView || window;
  const raw =
    view.getComputedStyle(el).getPropertyValue(name).trim() ||
    view.getComputedStyle(doc.body).getPropertyValue(name).trim() ||
    view.getComputedStyle(doc.querySelector('.stage') || el).getPropertyValue(name).trim();
  if (!raw) return null;
  const m = String(raw).trim().match(/^(-?[\d.]+)(m?s)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return (m[2] || '').toLowerCase() === 'ms' ? n / 1000 : n;
}

const finite = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

/** Names templates use for exit/fade-out keyframes — kept visible instead of run to completion. */
const EXIT_RE = /fadeOut|exit|carOut|copyLineOut|blackOut|dissolve|exitUp|exitScale/i;

/**
 * Peak composition time: fully entered, just before the first fade-out / exit / black-out.
 * Prefers explicit --hold-from/--hold-until when set; otherwise earliest exit − slack.
 */
export function plateEditPeakSec(doc: Document): number {
  const dur = Number(doc.body.dataset['duration']) || plateCssSec(doc, '--dur') || 6;
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
  ].filter((n): n is number => finite(n) && n > 0.2);

  // Scan running animations for exit/fadeOut delays (templates sometimes hardcode them)
  try {
    for (const a of doc.getAnimations?.() || []) {
      const name = (a as CSSAnimation).animationName || '';
      if (!EXIT_RE.test(name)) continue;
      const timing = a.effect?.getTiming?.() || {};
      const delay = typeof timing.delay === 'number' ? timing.delay / 1000 : 0;
      if (delay > 0.2) exitCandidates.push(delay);
    }
  } catch {
    /* ignore */
  }

  const earliestExit = exitCandidates.length ? Math.min(...exitCandidates) : blackOut;
  let peak: number;
  if (finite(holdFrom) && finite(holdUntil) && holdUntil > holdFrom + 0.12 && !(holdFrom === 0 && holdUntil === 0)) {
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
export function freezePlateAtPeak(doc: Document, peakSec: number): number {
  const ms = peakSec * 1000;
  const anims = typeof doc.getAnimations === 'function' ? doc.getAnimations() : [];
  for (const a of anims) {
    try {
      const timing = a.effect?.getComputedTiming?.();
      const end = timing ? Number(timing.endTime) : null;
      // Entrance anims: park at their finished state if the peak is past them
      if (finite(end) && end > 0 && ms >= end) {
        a.currentTime = Math.max(0, end - 1);
      } else {
        a.currentTime = Math.min(ms, finite(end) && end > 0 ? end - 1 : ms);
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

export const REVEAL_STYLE_PROPS = [
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

type Styled = Element & { style: CSSStyleDeclaration; dataset: DOMStringMap };

export function forceStyle(el: Element | null | undefined, styles: Record<string, string>): void {
  const node = el as Styled | null | undefined;
  if (!node?.style) return;
  node.dataset['studioReveal'] = '1';
  for (const [prop, value] of Object.entries(styles)) {
    node.style.setProperty(prop, value, 'important');
  }
}

export function forceAll(doc: Document, selector: string, styles: Record<string, string>): void {
  doc.querySelectorAll(selector).forEach((el) => forceStyle(el, styles));
}

/**
 * Freeze every running Web Animation to exactly what's on screen right now — "edit in place
 * what he sees". Must run BEFORE `body.studio-edit` is applied: that class's blanket
 * `animation: none !important` rule (see PLATE_EDIT_CSS) stops every CSS animation the instant
 * it's added, so by the time anything reads `getAnimations()` afterward the live state is already
 * gone and every template-specific class not covered by the static selector overrides below
 * (`.pr-card`, `.q-card`, `.tm-card`, `.k-tile`, `.o-tile`, `.p-step`, `.fq-q`, `.ck-row`,
 * `.logo-tile`, the `.panel`/`.score` checklist pieces, and more) snaps to its plain declared
 * style — usually the pre-reveal `opacity: 0`.
 *
 * Rather than guess a "finished" keyframe (fragile: picking the wrong keyframe, or running after
 * a duplicate/concurrent entry already cancelled things, reliably mis-renders), this reads each
 * animation's own `getComputedStyle` at this exact instant — i.e. whatever is actually painted,
 * whether that's fully revealed or still mid-entrance — and pins that. It's simpler, matches the
 * literal "freeze what's visible" intent, and has no per-class allowlist to keep growing.
 */
export function pinLiveAnimationFrames(doc: Document | null | undefined): void {
  if (!doc?.body) return;
  const view = doc.defaultView;
  if (!view) return;
  for (const a of doc.getAnimations?.() || []) {
    try {
      const effect = a.effect as KeyframeEffect | null;
      const target = effect?.target as Element | null;
      const keyframes = effect?.getKeyframes?.() || [];
      if (!target || !keyframes.length) continue;
      const props = new Set<string>();
      for (const kf of keyframes) {
        for (const prop of Object.keys(kf)) {
          if (prop === 'offset' || prop === 'easing' || prop === 'composite') continue;
          props.add(prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));
        }
      }
      if (!props.size) continue;
      const live = view.getComputedStyle(target);
      const styles: Record<string, string> = {};
      for (const prop of props) {
        const value = live.getPropertyValue(prop);
        if (value) styles[prop] = value;
      }
      if (Object.keys(styles).length) forceStyle(target, styles);
    } catch {
      /* ignore */
    }
  }
  // Cancel only after every target's live look is pinned via inline styles.
  for (const a of doc.getAnimations?.() || []) {
    try {
      a.cancel();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Composed static edit frame: finishes reveals that aren't driven by a Web Animation (clip-path
 * masks, SVG stroke tricks, JS-timed overlays) so the editor always shows a readable frame.
 * Call `pinLiveAnimationFrames` first — before `body.studio-edit` is applied — to freeze anything
 * that *is* a Web Animation to what was actually on screen.
 */
export function composePlateForEdit(doc: Document | null | undefined): void {
  if (!doc?.body) return;

  // 1) Open every clip / overflow gate
  forceAll(doc, '.mask, .mask.word, .title-line, .line-exit, .copy-exit, .title-exit, .steps-exit, .compose, .flood, .head, .title, [data-edit]', {
    overflow: 'visible',
    'clip-path': 'none',
    '-webkit-clip-path': 'none',
    'mask-image': 'none',
    '-webkit-mask-image': 'none',
    opacity: '1',
    filter: 'none',
    visibility: 'visible',
    'will-change': 'auto',
  });
  // Lockup seats: open clip gates but keep Show-logo opacity from CSS vars (do not force 1).
  forceAll(doc, '.lockup-exit, .corner-logo, .o-center', {
    overflow: 'visible',
    'clip-path': 'none',
    '-webkit-clip-path': 'none',
    'mask-image': 'none',
    '-webkit-mask-image': 'none',
    filter: 'none',
    'will-change': 'auto',
  });

  // 2) Finish rises / wipes / letters / image logos
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

  // 3) Finish SVG draw / trace builds
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

  // 4) Scale / grow entrances that default to 0
  forceAll(doc, '.dot', { transform: 'scale(1)', opacity: '1' });
  forceAll(doc, '.track, .track-fill', { transform: 'scaleX(1)', opacity: '1' });
  forceAll(doc, '.step-label, .step-note, .platform, .eyebrow, .sub, .body, .card, .stat, .t-card, .badge', {
    opacity: '1',
    filter: 'none',
    transform: 'none',
    visibility: 'visible',
  });

  // 5) Live chapter / caption overlays — parent .content/.card default opacity:0
  const isOverlay = String(doc.body.dataset['cardId'] || desk.get().activePlateId || '').startsWith('overlay:');
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
    held.textContent = '.wt-ch .eyebrow::before,.wt-ch .eyebrow::after{opacity:.65!important;transform:scaleX(1)!important}';
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

  // 6) Open-plate lockup: keep post-lift seat when vars exist; otherwise identity
  const root = doc.documentElement;
  const cs = (doc.defaultView || window).getComputedStyle(root);
  const liftY = cs.getPropertyValue('--open-lift-y').trim();
  const liftS = cs.getPropertyValue('--open-lift-scale').trim();
  const openShow = cs.getPropertyValue('--open-logo').trim();
  const closeShow = cs.getPropertyValue('--close-logo').trim();
  const markShow = cs.getPropertyValue('--mark-logo').trim();
  const orbitShow = cs.getPropertyValue('--orbit-logo').trim();
  const shown = (v: string) => (v === '0' || v === '0px' ? '0' : '1');
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
  // Honour Show logo toggles after the generic opacity:1 freeze above.
  doc.querySelectorAll('.lockup-exit').forEach((el) => {
    const onClose = Boolean(el.querySelector('.logo') && !el.querySelector('.lockup'));
    forceStyle(el, { opacity: shown(onClose ? closeShow || '1' : openShow || '1') });
  });
  doc.querySelectorAll('.corner-logo').forEach((el) => forceStyle(el, { opacity: shown(markShow || '1') }));
  doc.querySelectorAll('.o-center').forEach((el) => forceStyle(el, { opacity: shown(orbitShow || '1') }));
}

/** Clear inline reveal overrides (replay / leave edit). */
export function clearPlateRevealOverrides(doc: Document | null | undefined): void {
  if (!doc) return;
  doc.getElementById('studio-overlay-held')?.remove();
  doc.querySelectorAll<HTMLElement>('[data-studio-reveal]').forEach((el) => {
    for (const prop of REVEAL_STYLE_PROPS) {
      el.style.removeProperty(prop);
    }
    delete el.dataset['studioReveal'];
  });
}

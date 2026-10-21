/**
 * Chapter/caption on-screen motion timing — the single source for Studio preview, the overlay
 * HTML build (lib/liveCards.mjs) and the produce bake (lib/liveCardBake.mjs).
 * Browser-safe on purpose (no Node imports): Studio is served from this folder, so lib imports
 * from here rather than the other way round. Keep in sync with templates/overlays.css
 * (--x-out / --hold / --x-* exits).
 */

export function defaultCardHoldMs(kind) {
  return kind === 'chapter' ? 2800 : 2400;
}

export function clampCardHoldMs(ms, kind = 'caption') {
  const n = Number(ms);
  return Math.max(400, Number.isFinite(n) && n > 0 ? n : defaultCardHoldMs(kind));
}

/** Template fill keys for chapter.html exit delays. */
export function chapterMotionTiming(ms) {
  const hold = clampCardHoldMs(ms, 'chapter');
  const out = Math.max(1.4, (hold - 720) / 1000);
  return {
    X_BODY: Math.max(0.9, out - 0.32).toFixed(3),
    X_LINE: Math.max(1.0, out - 0.22).toFixed(3),
    X_TITLE: Math.max(1.1, out - 0.12).toFixed(3),
    X_EYE: Math.max(1.15, out - 0.04).toFixed(3),
    X_GHOST: Math.max(1.2, out + 0.02).toFixed(3),
    X_ATM: Math.max(1.3, out + 0.14).toFixed(3),
  };
}

/** Template fill keys for caption.html exit + timer bar. */
export function captionMotionTiming(ms) {
  const hold = clampCardHoldMs(ms, 'caption');
  // Exit starts after the entrance has landed — a 0.4s hold must not schedule a negative delay.
  const out = Math.max(0.12, (hold - 520) / 1000);
  const holdStart = 0.75;
  const holdLen = Math.max(0.4, out - holdStart);
  return {
    X_OUT: out.toFixed(3),
    HOLD: holdLen.toFixed(3),
    HOLD_START: holdStart.toFixed(3),
  };
}

/**
 * CSS custom properties + data-duration for a live card root.
 * @returns {{ holdMs: number, durationSec: string, selector: string, vars: Record<string, string> }}
 */
export function cardMotionCss(kind, ms) {
  const slot = kind === 'chapter' ? 'chapter' : 'caption';
  const holdMs = clampCardHoldMs(ms, slot);
  const durationSec = (holdMs / 1000).toFixed(2);
  if (slot === 'chapter') {
    const t = chapterMotionTiming(holdMs);
    return {
      holdMs,
      durationSec,
      selector: '.wt-ch',
      vars: {
        '--x-body': `${t.X_BODY}s`,
        '--x-line': `${t.X_LINE}s`,
        '--x-title': `${t.X_TITLE}s`,
        '--x-eye': `${t.X_EYE}s`,
        '--x-ghost': `${t.X_GHOST}s`,
        '--x-atm': `${t.X_ATM}s`,
      },
    };
  }
  const t = captionMotionTiming(holdMs);
  return {
    holdMs,
    durationSec,
    selector: '.wt-cap',
    vars: {
      '--x-out': `${t.X_OUT}s`,
      '--hold': `${t.HOLD}s`,
      '--hold-start': `${t.HOLD_START}s`,
    },
  };
}

/**
 * Apply hold length onto a live-card document (preview iframe or bake page).
 * Callers must recreate CSS animations after this so delays pick up the new vars.
 */
export function applyCardMotionToDocument(doc, kind, ms) {
  if (!doc?.body) return null;
  const motion = cardMotionCss(kind, ms);
  doc.body.dataset.duration = motion.durationSec;
  const root = doc.querySelector(motion.selector);
  if (root) {
    for (const [prop, value] of Object.entries(motion.vars)) {
      root.style.setProperty(prop, value);
    }
  }
  return motion;
}

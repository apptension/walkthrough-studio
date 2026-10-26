/**
 * Composition fit: the last word on how a plate sits in its frame.
 *
 * After type fit, the runtime measures the composition as it will read at the settled frame
 * (every animation parked at the hold), then scales and nudges `.compose` with the individual
 * `scale` / `translate` properties — they stack on top of the templates' own transform
 * animations, so no entrance or exit is disturbed.
 *
 *   - Content that would cross the safe area shrinks back inside it (long copy, six cards in a
 *     vertical master, a tall board).
 *   - Content that leaves the frame half empty grows, up to `--fill-grow`, toward the safe area.
 *
 * Templates tune it per layout with CSS custom properties on `.compose`:
 *   --fill-mode: auto | shrink | none   (none: the layout bleeds on purpose, e.g. a marquee)
 *   --fill-grow: 1.16                   (ceiling for growth)
 * Decorative children opt out of the measurement with `data-fill-skip` or `aria-hidden="true"`.
 * Frame furniture (the corner brand mark, `data-fill-pin`) is left out too and held where it was.
 */

/** Safe-area insets per frame: phones crop the vertical master harder top and bottom. */
export function safeInsets(w, h) {
  return w >= h ? { x: 72, y: 60 } : { x: 60, y: 110 };
}

/**
 * Pure plan: given the content box and the frame, the scale and shift that keep the content in
 * the safe area and fill it. `origin` is the transform origin of `.compose` in frame pixels.
 */
export function planFrameFit({ content, frame, origin, mode = 'auto', grow = 1.16, fillW = 0.97, fillH = 0.9 }) {
  const none = { s: 1, dx: 0, dy: 0 };
  if (!content || mode === 'none') return none;
  const cw = content.r - content.l;
  const ch = content.b - content.t;
  if (cw < 8 || ch < 8) return none;
  const safe = safeInsets(frame.w, frame.h);
  const availW = frame.w - 2 * safe.x;
  const availH = frame.h - 2 * safe.y;
  const o = origin || { x: frame.w / 2, y: frame.h / 2 };
  const fit = Math.min(availW / cw, availH / ch);
  let s = 1;
  if (fit < 1) s = Math.max(0.6, fit);
  else if (mode === 'auto') {
    // Growth never moves the composition: each edge may only travel as far as its safe edge.
    const room = (lo, hi, oc, min, max) =>
      Math.min(lo < oc ? (oc - min) / (oc - lo) : Infinity, hi > oc ? (max - oc) / (hi - oc) : Infinity);
    const edge = Math.min(
      room(content.l, content.r, o.x, safe.x, frame.w - safe.x),
      room(content.t, content.b, o.y, safe.y, frame.h - safe.y),
    );
    s = Math.max(1, Math.min(grow, edge, (availW * fillW) / cw, (availH * fillH) / ch));
  }
  s = Math.floor(s * 1000) / 1000;
  const at = (v, oc) => oc + s * (v - oc);
  const box = { l: at(content.l, o.x), r: at(content.r, o.x), t: at(content.t, o.y), b: at(content.b, o.y) };
  const shift = (lo, hi, min, max) => {
    if (hi - lo > max - min) return (min + max) / 2 - (lo + hi) / 2;
    if (lo < min) return min - lo;
    if (hi > max) return max - hi;
    return 0;
  };
  const dx = shift(box.l, box.r, safe.x, frame.w - safe.x);
  const dy = shift(box.t, box.b, safe.y, frame.h - safe.y);
  if (s === 1 && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return none;
  return { s, dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10 };
}

export function frameFitRuntimeSource() {
  return `(function () {
  ${safeInsets.toString()}
  ${planFrameFit.toString()}
  const PIN = '.corner-logo, [data-fill-pin]';
  const SKIP = PIN + ', [data-fill-skip], [aria-hidden="true"], .bloom, .floor, .glare, .veil, .mq, .plate-field, .title-mask, .title-glow';
  function settledMs() {
    const root = getComputedStyle(document.documentElement);
    const num = (n) => { const v = parseFloat(root.getPropertyValue(n)); return Number.isFinite(v) ? v : null; };
    const dur = parseFloat(document.body.dataset.duration) || 6;
    const black = num('--black-out') ?? dur - 0.7;
    return Math.max(0, ((num('--hold-from') || black - 1.2) - 0.05) * 1000);
  }
  function opacityOf(el, stop) {
    let o = 1;
    for (let e = el; e && e !== stop.parentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
      o *= parseFloat(cs.opacity);
    }
    return o;
  }
  /** What an element can actually paint: its box cut by every clipping ancestor inside compose. */
  function clipOf(el, compose, cache) {
    const parent = el.parentElement;
    if (!parent || parent === compose || !compose.contains(parent)) return null;
    if (cache.has(parent)) return cache.get(parent);
    let clip = clipOf(parent, compose, cache);
    const cs = getComputedStyle(parent);
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.clipPath !== 'none') {
      const q = parent.getBoundingClientRect();
      clip = clip
        ? { left: Math.max(clip.left, q.left), top: Math.max(clip.top, q.top), right: Math.min(clip.right, q.right), bottom: Math.min(clip.bottom, q.bottom) }
        : { left: q.left, top: q.top, right: q.right, bottom: q.bottom };
    }
    cache.set(parent, clip);
    return clip;
  }
  function contentBox(compose) {
    let l = 1e9, t = 1e9, r = -1e9, b = -1e9;
    const cache = new Map();
    let clip = null;
    const add = (q) => {
      let ql = q.left, qt = q.top, qr = q.right, qb = q.bottom;
      if (clip) { ql = Math.max(ql, clip.left); qt = Math.max(qt, clip.top); qr = Math.min(qr, clip.right); qb = Math.min(qb, clip.bottom); }
      if (qr - ql < 1 || qb - qt < 1) return;
      l = Math.min(l, ql); t = Math.min(t, qt); r = Math.max(r, qr); b = Math.max(b, qb);
    };
    for (const el of compose.querySelectorAll('*')) {
      if (el.closest(SKIP)) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed') continue;
      const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
      const boxy = el.matches('img, svg, canvas, video, [data-slot]') || (cs.backgroundImage !== 'none' && !el.matches('.mask')) || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') || parseFloat(cs.borderTopWidth) > 0;
      if (!own && !boxy) continue;
      if (opacityOf(el, compose) < 0.05) continue;
      clip = clipOf(el, compose, cache);
      if (boxy) add(el.getBoundingClientRect());
      if (own) {
        for (const n of el.childNodes) {
          if (n.nodeType !== 3 || !n.textContent.trim()) continue;
          const rg = document.createRange();
          rg.selectNodeContents(n);
          for (const q of rg.getClientRects()) add(q);
        }
      }
    }
    return r > l ? { l, t, r, b } : null;
  }
  /** Undo the composition scale on frame furniture so it stays put at its authored size. */
  function holdPin(el, was, s) {
    el.style.scale = String(1 / s);
    const c = (q) => ({ x: q.left + q.width / 2, y: q.top + q.height / 2 });
    const want = c(was);
    let now = c(el.getBoundingClientRect());
    const dx = want.x - now.x;
    const dy = want.y - now.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    el.style.translate = dx + 'px ' + dy + 'px';
    now = c(el.getBoundingClientRect());
    const kx = dx ? (now.x - (want.x - dx)) / dx : 1;
    const ky = dy ? (now.y - (want.y - dy)) / dy : 1;
    el.style.translate = (dx / (kx || 1)).toFixed(1) + 'px ' + (dy / (ky || 1)).toFixed(1) + 'px';
  }
  window.__fitFrame = function fitFrame() {
    const compose = document.querySelector('.stage .compose');
    if (!compose) return null;
    // No frame to fit into: any plan would hit the 0.6 floor. Keep whatever fit the page has.
    if (innerWidth < 2 || innerHeight < 2) return null;
    compose.style.scale = '';
    compose.style.translate = '';
    const pins = [...compose.querySelectorAll(PIN)];
    for (const el of pins) { el.style.scale = ''; el.style.translate = ''; }
    const cs = getComputedStyle(compose);
    const mode = (cs.getPropertyValue('--fill-mode').trim() || 'auto');
    const grow = parseFloat(cs.getPropertyValue('--fill-grow')) || 1.16;
    if (mode === 'none') { document.body.dataset.frameFit = '1'; return null; }
    const anims = document.getAnimations();
    const saved = anims.map((a) => [a, a.currentTime, a.playState]);
    const ms = settledMs();
    for (const a of anims) { try { a.pause(); a.currentTime = ms; } catch (e) {} }
    let plan = null;
    try {
      const frame = { w: innerWidth, h: innerHeight };
      const cr = compose.getBoundingClientRect();
      const origin = { x: cr.left + cr.width / 2, y: cr.top + cr.height / 2 };
      const pinRects = pins.map((el) => el.getBoundingClientRect());
      plan = planFrameFit({ content: contentBox(compose), frame, origin, mode, grow });
      if (plan.s !== 1 || plan.dx || plan.dy) {
        compose.style.scale = String(plan.s);
        // Lengths inside a zoomed compose are zoomed too: measure the real shift and correct once.
        compose.style.translate = plan.dx + 'px ' + plan.dy + 'px';
        if (plan.dx || plan.dy) {
          const after = compose.getBoundingClientRect();
          const got = { x: after.left + after.width / 2, y: after.top + after.height / 2 };
          const kx = plan.dx ? (got.x - origin.x) / plan.dx : 1;
          const ky = plan.dy ? (got.y - origin.y) / plan.dy : 1;
          if ((kx > 0.2 && Math.abs(kx - 1) > 0.02) || (ky > 0.2 && Math.abs(ky - 1) > 0.02)) {
            compose.style.translate = (plan.dx / (kx || 1)).toFixed(1) + 'px ' + (plan.dy / (ky || 1)).toFixed(1) + 'px';
          }
        }
        pins.forEach((el, i) => holdPin(el, pinRects[i], plan.s));
      }
    } finally {
      for (const [a, t, state] of saved) {
        try { a.currentTime = t; if (state === 'running') a.play(); } catch (e) {}
      }
    }
    document.body.dataset.frameFit = plan ? plan.s + ' ' + plan.dx + ' ' + plan.dy : '1';
    return plan;
  };
})();`;
}

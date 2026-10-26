/**
 * Scalable plate typography.
 *
 * Every text element marked `data-fit` gets the largest font size, between its floor and its
 * ceiling, that keeps it inside its line budget and its box. Copy that is short sets big; copy
 * that runs long steps down instead of spilling out of a card or off the frame.
 *
 *   data-fit="2"           at most 2 lines (0 = no line budget, width / box only)
 *   data-fit-min="40"      floor in px (default: 62% of the stylesheet size)
 *   data-fit-max="84"      ceiling in px (default: the stylesheet size — shrink only)
 *   data-fit-box=".card"   closest ancestor that must not overflow either
 *   data-fit-group="stat"  siblings in a group settle on the smallest member's size, so a row of
 *                          figures or two column heads never mix sizes
 *
 * Sizes snap to half pixels so near-identical titles land on the same size. Count-up values
 * are measured at their final text (`data-count-final`) so the settled number fits.
 * The runtime is registered as `window.__fitType` and runs before the encoder's first frame
 * (`renderOne` awaits it, then a template's own `__fitPlate`).
 */

/** Pure parser shared by the runtime and tests. */
export function parseFitSpec(dataset = {}, basePx = 0) {
  const lines = Math.max(0, parseInt(dataset.fit, 10) || 0);
  const max = parseFloat(dataset.fitMax) || basePx;
  const min = Math.min(max, parseFloat(dataset.fitMin) || Math.round(basePx * 0.62));
  return { lines, min, max, box: dataset.fitBox || '' };
}

export function typeFitRuntimeSource() {
  return `(function () {
  ${parseFitSpec.toString()}
  function measureText(el) {
    const final = el.dataset.countFinal;
    if (final == null || el.textContent === final) return () => {};
    const live = el.textContent;
    el.textContent = final;
    return () => { el.textContent = live; };
  }
  function lineCount(el, px) {
    const cs = getComputedStyle(el);
    let lh = parseFloat(cs.lineHeight);
    if (!Number.isFinite(lh)) lh = px * 1.2;
    const h = el.offsetHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    return Math.round(h / lh);
  }
  function fitOne(el) {
    el.style.fontSize = '';
    const base = parseFloat(el.dataset.fitBase || getComputedStyle(el).fontSize);
    el.dataset.fitBase = String(base);
    const spec = parseFitSpec(el.dataset, base);
    const box = spec.box ? el.closest(spec.box) : null;
    const restore = measureText(el);
    const fits = (px) => {
      el.style.fontSize = px + 'px';
      if (spec.lines && lineCount(el, px) > spec.lines) return false;
      if (el.clientWidth && el.scrollWidth > el.clientWidth + 1) return false;
      if (box && (box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1)) return false;
      return true;
    };
    let best = spec.min;
    if (fits(spec.max)) best = spec.max;
    else {
      let lo = spec.min, hi = spec.max;
      for (let i = 0; i < 10 && hi - lo > 0.5; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) { best = mid; lo = mid; } else hi = mid;
      }
    }
    best = Math.floor(best * 2) / 2;
    el.style.fontSize = best + 'px';
    el.dataset.fitPx = best.toFixed(1);
    restore();
  }
  window.__fitType = async function fitType() {
    // Images size the composition (the interface shot in a device): measuring before they land
    // grows the frame to fill the gap they leave. The encoder fits after load; so does this.
    if (document.readyState !== 'complete') await new Promise((r) => addEventListener('load', r, { once: true }));
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    // A page with no viewport (the editor's back frame while it loads off-stage) has nothing to
    // measure: every line wraps per word and the frame is zero wide, so a fit here bakes floor
    // sizes and the 0.6 composition shrink. Leave the page unfit and fit it the moment it is given
    // a frame — whichever path brings it on stage.
    if (innerWidth < 2 || innerHeight < 2) {
      if (!window.__fitTypeWaiting) {
        window.__fitTypeWaiting = true;
        addEventListener('resize', function sized() {
          if (innerWidth < 2 || innerHeight < 2) return;
          removeEventListener('resize', sized);
          window.__fitTypeWaiting = false;
          window.__fitType();
        });
      }
      return;
    }
    // Outer elements first: a title that shrinks frees room for the copy below it.
    const groups = new Map();
    for (const el of document.querySelectorAll('[data-fit]')) {
      try { fitOne(el); } catch (e) { console.warn('[type-fit]', e); continue; }
      const g = el.dataset.fitGroup;
      if (g) groups.set(g, [...(groups.get(g) || []), el]);
    }
    for (const els of groups.values()) {
      const px = Math.min(...els.map((el) => parseFloat(el.dataset.fitPx)));
      for (const el of els) { el.style.fontSize = px + 'px'; el.dataset.fitPx = px.toFixed(1); }
    }
    document.body.dataset.typeFit = '1';
    // Then the composition settles into the frame (lib/frameFit.mjs).
    if (typeof window.__fitFrame === 'function') window.__fitFrame();
  };
  window.__fitType();
})();`;
}

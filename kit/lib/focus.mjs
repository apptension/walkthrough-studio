/**
 * Focus ring + smart framing for every action a flow performs.
 *
 * Before a locator is clicked, filled, checked, selected or hovered, the element is framed
 * into view (only when it is outside a comfortable margin), then a ring lands on it:
 * concentric with the element's own corner radius, a 5 px gap, tracking it while it moves.
 * The action runs once the ring has landed. A press (click, check, tap) dissolves the ring on the
 * press itself; other actions let it leave shortly after. It also vanishes at once if its element
 * disappears, jumps, or the route changes, so it never lingers on the next screen. Re-acting on the
 * same element keeps the ring instead of re-animating it.
 *
 * Framing policy (capture-critical):
 * - Prefer `nearest` over `center` — centering every control on multi-panel UIs causes scroll thrash.
 * - Skip scroll when ≥85% of the target is already inside the safe margin.
 * - Large targets (canvas / viewers / >55% viewport) only nudge edges — never recenter the page on them.
 * - Default scroll behavior is `auto` (instant). Smooth scrolling burns compositor time and starves
 *   screencast FPS on WebGL-heavy apps; opt in via record.scroll.behavior = "smooth".
 *
 * Installed by record.mjs by patching Locator.prototype for the duration of a take.
 */
import { hexA } from './text.mjs';

const ACTIONS = ['click', 'dblclick', 'fill', 'check', 'uncheck', 'setChecked', 'selectOption', 'tap', 'hover', 'pressSequentially'];
// Actions that press the element: the ring dissolves on the press itself, not after the action resolves
const PRESS = new Set(['click', 'dblclick', 'check', 'uncheck', 'setChecked', 'tap']);
const LAND_MS = 280;
/** Cap how long framing waits for a locator — a missing target must not burn the page default (30s). */
const FRAME_TIMEOUT_MS = 8000;

/**
 * Build a CSS selector that survives focus. Placeholders and floating labels often clear on focus, so
 * a getByPlaceholder / getByLabel locator that matched before click matches nothing for fill/type —
 * Playwright then waits until the action timeout and capture looks stuck.
 */
export function stableSelectorFrom(el) {
  if (!el || typeof el !== 'object') return null;
  const tag = String(el.tagName || '').toLowerCase();
  if (!tag || tag.includes(' ')) return null;
  const q = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const name = el.name != null && String(el.name);
  if (name) return `${tag}[name=${q(name)}]`;
  const id = el.id != null && String(el.id);
  if (id && !/[\s"']/.test(id)) return `${tag}#${id}`;
  return null;
}

/**
 * Rebind a locator to name/id when possible so later actions still resolve after focus.
 * Call this once before click→fill/type sequences that started from getByPlaceholder / getByLabel:
 * focus often clears those, and a second action on the original locator hangs until timeout.
 */
export async function stabilizeLocator(locator) {
  const info = await locator
    .evaluate((node) => ({
      tagName: node.tagName,
      name: node.getAttribute('name') || '',
      id: node.id || '',
    }), null, { timeout: FRAME_TIMEOUT_MS })
    .catch(() => null);
  const sel = info && stableSelectorFrom(info);
  if (!sel) return locator;
  const next = locator.page().locator(sel).first();
  if ((await next.count().catch(() => 0)) < 1) return locator;
  return next;
}

function focusCss(gold) {
  return `
  .wt-focus { position:fixed; z-index:2147483645; pointer-events:none; box-sizing:border-box;
    border:2px solid ${gold}; background:${hexA(gold, 0.05)};
    box-shadow:0 0 0 4px ${hexA(gold, 0.13)}, 0 0 24px ${hexA(gold, 0.42)}, inset 0 0 14px ${hexA(gold, 0.1)};
    transform-origin:center; animation:wtFocusIn .45s cubic-bezier(.16,1,.3,1) both; }
  .wt-focus::after { content:''; position:absolute; inset:-2px; border-radius:inherit; border:2px solid ${gold};
    opacity:0; animation:wtFocusPing .95s .12s cubic-bezier(.16,1,.3,1) both; }
  .wt-focus.out { animation:wtFocusOut .32s cubic-bezier(.55,0,.75,.2) forwards; }
  .wt-focus.press { animation:wtFocusPress .16s cubic-bezier(.33,0,.67,1) forwards; }
  .wt-focus.press::after, .wt-focus.gone::after { animation:none; opacity:0; }
  .wt-focus.gone { animation:wtFocusGone .12s linear forwards; }
  @keyframes wtFocusPress { from { opacity:1; transform:scale(1); } to { opacity:0; transform:scale(.97); } }
  @keyframes wtFocusGone { from { opacity:1; } to { opacity:0; } }
  @keyframes wtFocusIn { from { opacity:0; transform:scale(var(--s-in)); } to { opacity:1; transform:scale(1); } }
  @keyframes wtFocusPing { from { opacity:.65; transform:scale(1); } to { opacity:0; transform:scale(var(--s-ping)); } }
  @keyframes wtFocusOut { from { opacity:1; transform:scale(1); } to { opacity:0; transform:scale(var(--s-out)); } }`;
}

/* ——— in-page functions (serialized by Playwright) ——— */

/**
 * Frame `el` into the viewport with minimal camera motion.
 * Returns true when a scroll actually ran.
 */
function pageScrollIntoView(el, opts = {}) {
  const margin = Number.isFinite(opts.margin) ? opts.margin : 72;
  const behavior = opts.behavior === 'smooth' ? 'smooth' : 'auto';
  const forceBlock = opts.block; // 'nearest' | 'center' | 'start' | 'end' | undefined
  const r = el.getBoundingClientRect();
  if (r.width < 1 && r.height < 1) return false;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const safeTop = margin;
  const safeBottom = vh - margin;
  const safeLeft = 8;
  const safeRight = vw - 8;

  const visTop = Math.min(r.bottom, safeBottom) - Math.max(r.top, safeTop);
  const visLeft = Math.min(r.right, safeRight) - Math.max(r.left, safeLeft);
  const visArea = Math.max(0, visTop) * Math.max(0, visLeft);
  const area = Math.max(1, r.width * r.height);
  const ratio = visArea / area;

  const isLarge = r.height > vh * 0.55 || r.width > vw * 0.7 || el.tagName === 'CANVAS';
  const fullyOff = r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw;
  const comfortablyIn =
    ratio >= 0.85 &&
    r.top >= safeTop - 12 &&
    r.bottom <= safeBottom + 12 &&
    r.left >= safeLeft - 12 &&
    r.right <= safeRight + 12;

  // A magnifier needs room around its target: a centre closer than `lens` px to an edge is re-centred.
  const lens = Number.isFinite(opts.lens) ? opts.lens : 0;
  const cy = (r.top + r.bottom) / 2;
  const cx = (r.left + r.right) / 2;
  const lensCramped = lens > 0 && !isLarge && (cy < lens || cy > vh - lens || cx < lens || cx > vw - lens);

  if (comfortablyIn && !lensCramped) return false;
  // Large viewers: only act when fully off-screen; never recenter the page on a canvas
  if (isLarge && !fullyOff && ratio >= 0.4) return false;

  const block =
    forceBlock ||
    (lensCramped ? 'center' : isLarge ? 'nearest' : fullyOff ? 'center' : 'nearest');
  el.scrollIntoView({ block, inline: lensCramped ? 'center' : 'nearest', behavior });
  return true;
}

function pageSettle(el, budgetMs = 900) {
  return new Promise((resolve) => {
    let last = '';
    let still = 0;
    const t0 = performance.now();
    const tick = () => {
      const r = el.getBoundingClientRect();
      const key = `${Math.round(r.top)},${Math.round(r.left)}`;
      still = key === last ? still + 1 : 0;
      last = key;
      // auto-scroll settles in 1–2 frames; smooth needs more
      if (still >= 4 || performance.now() - t0 > budgetMs) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function pageFocusIn(el, { css, pad, press }) {
  if (!document.getElementById('wt-focus-style')) {
    const style = document.createElement('style');
    style.id = 'wt-focus-style';
    style.textContent = css;
    document.documentElement.appendChild(style);
  }
  // Leave now: 'press' when the element is pressed, 'gone' when the screen changed under the ring
  const dissolve = (f, how) => {
    if (f.done) return;
    f.done = true;
    clearTimeout(f.timer);
    f.ring.classList.remove('out');
    f.ring.classList.add(how);
    setTimeout(() => f.ring.remove(), how === 'press' ? 180 : 140);
    if (window.__wtFocus === f) window.__wtFocus = null;
    if (how !== 'press') return;
    // If the press swaps the screen, cut the ring on that frame rather than fade it over the new one
    const href = location.href;
    const watch = () => {
      if (!f.ring.isConnected) return;
      const r = el.getBoundingClientRect();
      if (location.href !== href || !el.isConnected || (r.width < 2 && r.height < 2)) return f.ring.remove();
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  };
  const arm = (f) => {
    if (!press) return;
    // The click itself: the next screen can follow within a frame, so the ring must already be leaving
    const onPress = () => dissolve(f, 'press');
    el.addEventListener('pointerdown', onPress, { capture: true, once: true });
    el.addEventListener('click', onPress, { capture: true, once: true });
  };
  const current = window.__wtFocus;
  if (current && current.el === el && current.ring.isConnected && !current.done) {
    clearTimeout(current.timer);
    current.ring.classList.remove('out');
    arm(current);
    return 'kept';
  }
  if (current) dissolve(current, 'gone');
  const r0 = el.getBoundingClientRect();
  if (r0.width < 2 || r0.height < 2) return false;
  const ring = document.createElement('div');
  ring.className = 'wt-focus';
  const cs = getComputedStyle(el);
  const big = Math.max(r0.width, r0.height) + 2 * pad;
  ring.style.setProperty('--s-in', String(1 + 18 / big));
  ring.style.setProperty('--s-ping', String(1 + 26 / big));
  ring.style.setProperty('--s-out', String(1 - 6 / big));
  const place = () => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) return;
    const radius = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.height / 2, r.width / 2);
    ring.style.left = `${r.left - pad}px`;
    ring.style.top = `${r.top - pad}px`;
    ring.style.width = `${r.width + 2 * pad}px`;
    ring.style.height = `${r.height + 2 * pad}px`;
    ring.style.borderRadius = `${Math.max(radius, 3) + pad}px`;
  };
  place();
  document.documentElement.appendChild(ring);
  const f = { el, ring, timer: null, done: false };
  const href = location.href;
  let prev = r0;
  const loop = () => {
    if (!ring.isConnected || f.done) return;
    const r = el.getBoundingClientRect();
    const jump = Math.abs(r.top - prev.top) > 40 || Math.abs(r.left - prev.left) > 40;
    const hidden = !el.isConnected || (r.width < 2 && r.height < 2) || getComputedStyle(el).visibility === 'hidden';
    // A route change, an element that vanished, or one that leapt (a dialog closing, a re-render)
    if (location.href !== href || hidden || jump) return dissolve(f, 'gone');
    prev = r;
    place();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__wtFocus = f;
  arm(f);
  return 'new';
}

function pageFocusOut(delay) {
  const current = window.__wtFocus;
  if (!current || current.done) return;
  clearTimeout(current.timer);
  current.timer = setTimeout(() => {
    if (current.done) return;
    current.done = true;
    current.ring.classList.add('out');
    setTimeout(() => current.ring.remove(), 340);
    if (window.__wtFocus === current) window.__wtFocus = null;
  }, delay);
}

/* ——— Node side ——— */

export function createFocus({ brand, wait, scroll = {} }) {
  const opts = { css: focusCss(brand.colors.gold), pad: 5 };
  const scrollOpts = {
    behavior: scroll.behavior === 'smooth' ? 'smooth' : 'auto',
    margin: Number.isFinite(scroll.margin) ? scroll.margin : 72,
    block: scroll.block, // optional override
  };
  const settleBudget = scrollOpts.behavior === 'smooth' ? 1800 : 900;
  const state = { enabled: true, depth: 0 };
  const restore = [];

  async function intoView(locator, override = {}) {
    const merged = { ...scrollOpts, ...override };
    const moved = await locator
      .evaluate(pageScrollIntoView, merged, { timeout: FRAME_TIMEOUT_MS })
      .catch(() => false);
    if (moved) {
      await locator.evaluate(pageSettle, settleBudget, { timeout: FRAME_TIMEOUT_MS }).catch(() => {});
    }
    return moved;
  }

  /** Scroll (if needed) and land the ring; resolves when it has landed. */
  async function show(locator, { press = false, block, behavior } = {}) {
    await locator.waitFor({ state: 'attached', timeout: FRAME_TIMEOUT_MS });
    if (!(await locator.isVisible())) return false;
    const override = {};
    if (block) override.block = block;
    if (behavior) override.behavior = behavior;
    await intoView(locator, override);
    const result = await locator
      .evaluate(pageFocusIn, { ...opts, press }, { timeout: FRAME_TIMEOUT_MS })
      .catch(() => false);
    if (result === 'new') await wait(LAND_MS);
    return Boolean(result);
  }

  const hide = (locator, delay = 380) => locator.page().evaluate(pageFocusOut, delay).catch(() => {});

  /** `before(locator, action)` runs once the target is framed, before the ring and the action. */
  function install(proto, { before, after } = {}) {
    for (const name of ACTIONS) {
      const orig = proto[name];
      if (typeof orig !== 'function') continue;
      proto[name] = async function patched(...args) {
        if (!state.enabled || state.depth > 0) return orig.apply(this, args);
        state.depth += 1;
        let ctx;
        // Stabilize before focus: placeholder/label locators often match nothing after click.
        const target = await stabilizeLocator(this);
        try {
          if (before) ctx = await before(target, name).catch(() => null);
          await show(target, { press: PRESS.has(name) }).catch(() => {});
          return await orig.apply(target, args);
        } finally {
          state.depth -= 1;
          hide(target);
          // Always notify after (even when before returned null) so capture watchdog can clear action timers.
          if (after) after(ctx || null);
        }
      };
      restore.push(() => (proto[name] = orig));
    }
    // Flows call scrollIntoViewIfNeeded: use the same smart frame — do NOT also run Playwright's
    // native scroll (that was a second jump after ours and caused thrash on multi-panel UIs).
    const origScroll = proto.scrollIntoViewIfNeeded;
    proto.scrollIntoViewIfNeeded = async function framedScroll(...args) {
      if (!state.enabled) return origScroll.apply(this, args);
      const target = await stabilizeLocator(this);
      await target.waitFor({ state: 'attached', timeout: FRAME_TIMEOUT_MS });
      await intoView(target);
      // Element may still be clipped inside an overflow scroller Playwright knows about — one
      // native pass as fallback only when our frame left it off-screen.
      const stillOff = await target
        .evaluate((el) => {
          const r = el.getBoundingClientRect();
          return r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth;
        })
        .catch(() => false);
      if (stillOff) await origScroll.apply(target, args).catch(() => {});
    };
    restore.push(() => (proto.scrollIntoViewIfNeeded = origScroll));
  }

  return {
    state,
    show,
    hide,
    intoView,
    install,
    uninstall: () => restore.splice(0).forEach((fn) => fn()),
  };
}

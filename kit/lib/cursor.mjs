/**
 * Presentation cursor for live capture. Headless Chromium paints no system cursor, so the take gets
 * one we control: an arrow or an accent dot that follows real mouse events, sized for video, with a
 * press pulse. Between actions it glides along an eased, slightly arced path, then the real mouse
 * lands on the target so hover and press are real UI. Keystroke chips show shortcuts the flow presses.
 *
 * Clicks read as clicks: just before a press the arrow morphs into a pointing hand (`arm()`), the
 * real mousedown plays a push-down on the glyph plus the ripple, and after the action the hand
 * lingers for a beat before easing back into the arrow (`release()`). `direction.cursor.hand`
 * switches the morph (default on for the arrow; the dot keeps its pulse).
 */
import { hexA } from './text.mjs';
import { minJerk } from '../studio/easing.js';

export const CURSOR_STYLES = Object.freeze(['classic', 'arrow', 'dot']);
export const CURSOR_SIZES = Object.freeze({ s: 1, m: 1.3, l: 1.65 });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Timing of the click gesture at a given pace: `armMs` is how long the hand is on screen before
 * the press (so the morph reads), `holdMs` how long it stays after the action before relaxing.
 */
export function clickChoreography(tempo = 1) {
  const t = Math.max(0.25, Number(tempo) || 1);
  return { armMs: Math.max(80, Math.round(160 / t)), holdMs: Math.max(140, Math.round(340 / t)) };
}

/** Fingertip of the hand glyph inside its 28×32 viewBox — it is pulled onto the hotspot. */
const HAND_TIP = { x: 10.3, y: 0.9 };

/** Pointing-hand glyph, same ink/outline as the arrow so the morph is a shape change, not a restyle. */
export function handCursorSvg(scale = 1) {
  const s = scale;
  const d = [
    'M8 3.2 A2.3 2.3 0 0 1 12.6 3.2 L12.6 10.4 A2.2 2.2 0 0 1 17 10.4 L17 11.6 A2.2 2.2 0 0 1 21.4 11.6',
    'L21.4 13 A2.2 2.2 0 0 1 25.8 13 L25.8 21 A8.5 8.5 0 0 1 17.3 29.5 L12 29.5 C9.5 29.5 7.5 28.4 6.1 26.5',
    'L1.6 20.2 C0.6 18.8 0.9 17 2.1 16.1 C3.3 15.2 5 15.5 6 16.7 L8 19.2 Z',
  ].join(' ');
  const mt = (HAND_TIP.y * s).toFixed(1);
  const ml = (HAND_TIP.x * s).toFixed(1);
  return (
    `<svg class="wt-h" width="${28 * s}" height="${32 * s}" viewBox="0 0 28 32" aria-hidden="true" ` +
    `style="position:absolute;left:0;top:0;margin: -${mt}px 0 0 -${ml}px;display:block;filter:drop-shadow(0 3px 5px rgba(0,0,0,.35))">` +
    `<path d="${d}" fill="#111" stroke="#fff" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<path d="M12.6 16.5 V21 M17 16.5 V21 M21.4 16.5 V21" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity=".55"/>` +
    `</svg>`
  );
}

/** Page side. Runs in every document (init script), so navigation keeps the cursor. */
function pageCursor({ style, scale, accent, halo, font, hideIdle, hand, handSvg, tip }) {
  if (window.__wtCursor) return;
  const install = () => {
    if (document.getElementById('wt-cursor')) return;
    // This function is serialised into the page: only its arguments exist here.
    const tipX = ((tip?.x || 0) * scale).toFixed(1);
    const tipY = ((tip?.y || 0) * scale).toFixed(1);
    const css = document.createElement('style');
    css.id = 'wt-cursor-style';
    css.textContent = `
      #wt-cursor { position:fixed; left:0; top:0; z-index:2147483646; pointer-events:none; opacity:0;
        transition: opacity .2s ease; will-change: transform; }
      #wt-cursor.on { opacity:1; }
      #wt-cursor.idle { opacity:0; }
      #wt-cursor .wt-c { transform-origin: 3px 2px; transition: transform .16s cubic-bezier(.34,1.56,.64,1), opacity .14s ease; }
      #wt-cursor.down .wt-c { transform: scale(.84); }
      #wt-cursor .wt-h { transform-origin: ${tipX}px ${tipY}px; opacity:0;
        transform: scale(.72) translateY(${(6 * scale).toFixed(1)}px);
        transition: transform .22s cubic-bezier(.34,1.56,.64,1), opacity .16s ease; }
      #wt-cursor.hand .wt-c { opacity:0; transform: scale(.6); }
      #wt-cursor.hand .wt-h { opacity:1; transform: none; }
      #wt-cursor.hand.down .wt-h { transform: translateY(${(3 * scale).toFixed(1)}px) scale(.9); }
      #wt-cursor.push .wt-c, #wt-cursor.push .wt-h { animation: wt-push .38s cubic-bezier(.2,.8,.2,1); }
      @keyframes wt-push { 0% { transform:none; } 28% { transform: translateY(${(4 * scale).toFixed(1)}px) scale(.86); } 100% { transform:none; } }
      #wt-cursor .wt-ripple { position:absolute; left:0; top:0; width:44px; height:44px; margin:-22px 0 0 -22px;
        border-radius:50%; border:2px solid ${accent}; opacity:0; transform:scale(.3); }
      #wt-cursor .wt-ripple.go { animation: wt-ripple .55s cubic-bezier(.16,1,.3,1) forwards; }
      @keyframes wt-ripple { 0% { opacity:.9; transform:scale(.3); } 100% { opacity:0; transform:scale(1.35); } }
      .wt-keys { position:fixed; left:50%; bottom:7.5%; z-index:2147483646; pointer-events:none; display:flex; gap:8px;
        transform:translate(-50%, 12px); opacity:0; transition: opacity .18s ease, transform .32s cubic-bezier(.16,1,.3,1);
        font: 600 26px/1 ${font}, ui-sans-serif, system-ui, sans-serif; }
      .wt-keys.on { opacity:1; transform:translate(-50%, 0); }
      .wt-keys > .wt-key { all: initial; display:block; min-width:52px; padding:13px 16px; border-radius:12px;
        text-align:center; color:#fff; background: rgba(14,16,22,.86); border:1px solid rgba(255,255,255,.16);
        box-shadow: 0 10px 30px rgba(0,0,0,.4), inset 0 -2px 0 rgba(255,255,255,.07);
        font: 600 26px/1 ${font}, ui-sans-serif, system-ui, sans-serif; box-sizing:border-box; }
    `;
    document.documentElement.appendChild(css);
    const el = document.createElement('div');
    el.id = 'wt-cursor';
    const s = scale;
    el.innerHTML =
      style === 'dot'
        ? `<div class="wt-c" style="width:${18 * s}px;height:${18 * s}px;margin:${-9 * s}px 0 0 ${-9 * s}px;border-radius:50%;background:${accent};box-shadow:0 0 0 ${6 * s}px ${halo},0 6px 18px rgba(0,0,0,.28)"></div><div class="wt-ripple"></div>`
        : `<svg class="wt-c" width="${24 * s}" height="${30 * s}" viewBox="0 0 24 30" style="display:block;filter:drop-shadow(0 3px 5px rgba(0,0,0,.35))"><path d="M2.2 1.6 L2.2 23.4 L7.6 18.3 L11.3 27.1 L15.2 25.4 L11.6 16.8 L19 16.8 Z" fill="#111" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg><div class="wt-ripple"></div>`;
    if (hand && handSvg) el.insertAdjacentHTML('beforeend', handSvg);
    document.documentElement.appendChild(el);
    /** Replay the push-down keyframes on every press (class removal + reflow restarts them). */
    const push = () => {
      el.classList.remove('push');
      void el.offsetWidth;
      el.classList.add('push');
      clearTimeout(push.t);
      push.t = setTimeout(() => el.classList.remove('push'), 420);
    };
    let idleTimer;
    const place = (x, y) => {
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.classList.add('on');
      el.classList.remove('idle');
      clearTimeout(idleTimer);
      if (hideIdle) idleTimer = setTimeout(() => el.classList.add('idle'), 1500);
      try {
        sessionStorage.setItem('__wtCursor', JSON.stringify([x, y]));
      } catch {
        /* storage blocked */
      }
    };
    try {
      const saved = JSON.parse(sessionStorage.getItem('__wtCursor') || 'null');
      if (saved) place(saved[0], saved[1]);
    } catch {
      /* ignore */
    }
    addEventListener('mousemove', (e) => place(e.clientX, e.clientY), { capture: true, passive: true });
    addEventListener('mousedown', (e) => {
      place(e.clientX, e.clientY);
      el.classList.add('down');
      push();
      const ripple = el.querySelector('.wt-ripple');
      ripple.classList.remove('go');
      void ripple.offsetWidth;
      ripple.classList.add('go');
    }, { capture: true, passive: true });
    addEventListener('mouseup', () => el.classList.remove('down'), { capture: true, passive: true });
    /**
     * Play a precomputed route on the compositor clock; one round trip per glide. The route is
     * sampled, not stepped: each frame lands between its two neighbours by elapsed time, so the
     * pointer never pauses on a waypoint when the page paints slower than the route was built.
     */
    const glide = (points) =>
      new Promise((resolve) => {
        if (!points.length) return resolve();
        const t0 = performance.now();
        const last = points[points.length - 1];
        let i = 0;
        const tick = (now) => {
          const at = now - t0;
          if (at >= last.at) {
            place(last.x, last.y);
            return resolve();
          }
          while (i < points.length - 1 && points[i + 1].at <= at) i++;
          const a = points[i];
          const b = points[Math.min(i + 1, points.length - 1)];
          const k = b.at > a.at ? Math.min(1, Math.max(0, (at - a.at) / (b.at - a.at))) : 1;
          place(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    window.__wtCursor = {
      place,
      glide,
      /** Arrow ⇄ pointing hand. No-op when the hand glyph is not installed. */
      hand: (on) => {
        if (!hand) return false;
        el.classList.toggle('hand', Boolean(on));
        if (on) {
          el.classList.remove('idle');
          clearTimeout(idleTimer);
        }
        return true;
      },
      show: () => {
        el.classList.remove('idle');
        clearTimeout(idleTimer);
      },
      hide: () => el.classList.add('idle'),
    };
  };
  if (document.documentElement) install();
  else document.addEventListener('DOMContentLoaded', install, { once: true });
}

function pageKeys({ label, ms }) {
  let box = document.querySelector('.wt-keys');
  if (!box) {
    box = document.createElement('div');
    box.className = 'wt-keys';
    document.documentElement.appendChild(box);
  }
  box.innerHTML = label.map((k) => `<span class="wt-key">${k.replace(/[<>&]/g, '')}</span>`).join('');
  requestAnimationFrame(() => box.classList.add('on'));
  clearTimeout(box.__t);
  box.__t = setTimeout(() => box.classList.remove('on'), ms);
}

const KEY_GLYPHS = {
  Meta: '⌘', Control: 'Ctrl', Alt: '⌥', Shift: '⇧', Enter: '↵ Enter', Escape: 'Esc', Backspace: '⌫',
  Tab: '⇥ Tab', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Delete: 'Del', ' ': 'Space',
  Space: 'Space', ControlOrMeta: '⌘',
};

/** "Control+Shift+K" → ['Ctrl', '⇧', 'K']. Plain characters are typing, not shortcuts. */
export function keyLabel(key) {
  const parts = String(key).split('+').filter(Boolean);
  if (parts.length === 1 && parts[0].length === 1) return null;
  return parts.map((p) => KEY_GLYPHS[p] || (p.length === 1 ? p.toUpperCase() : p.replace(/^Key/, '')));
}

/**
 * Gently arced pointer route on a minimum-jerk profile — the velocity bell a hand draws when it
 * points at something: it leaves softly, peaks mid-way and settles onto the target with no jolt.
 * Starts from the current seat (a point at 0 ms) so playback can interpolate from the first frame.
 * Duration follows distance.
 */
export function glidePath(from, to, { ms, fps = 60, speed = 1 } = {}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return { duration: 0, points: [] };
  // `speed` is the live pace: a brisk take glides faster, never below 160 ms so arcs still read.
  const duration = Math.max(160, Math.round((ms ?? clamp(240 + dist * 0.34, 260, 760)) / (speed || 1)));
  const steps = Math.max(6, Math.round((duration / 1000) * fps));
  const bend = Math.min(56, dist * 0.07) * (dx >= 0 ? 1 : -1);
  const cx = (from.x + to.x) / 2 - (dy / dist) * bend;
  const cy = (from.y + to.y) / 2 + (dx / dist) * bend;
  const points = [{ x: from.x, y: from.y, at: 0 }];
  for (let i = 1; i <= steps; i++) {
    const u = minJerk(i / steps);
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    points.push({ x: a * from.x + b * cx + c * to.x, y: a * from.y + b * cy + c * to.y, at: (duration * i) / steps });
  }
  return { duration, points };
}

/**
 * Wire the presentation cursor into a capture. Returns helpers the recorder uses before each
 * pointer action. `classic` keeps Playwright's own pointer and moves the mouse directly.
 */
export async function createCursor({ context, page, brand, wait, viewport, settings = {}, tempo = () => 1 }) {
  const style = CURSOR_STYLES.includes(settings.style) ? settings.style : 'classic';
  const scale = CURSOR_SIZES[settings.size] || CURSOR_SIZES.m;
  const accent = brand.colors.gold;
  const glideOn = settings.glide ?? style !== 'classic';
  const hideIdle = settings.hideIdle ?? style !== 'classic';
  const loopOn = settings.loop === true;
  // The pointing hand morph: on for the arrow unless direction says otherwise; the dot opts in.
  const handOn = style !== 'classic' && (typeof settings.hand === 'boolean' ? settings.hand : style === 'arrow');
  const home = { x: Math.round(viewport.width * 0.5), y: Math.round(viewport.height * 0.6) };
  const pointer = { ...home };
  if (style !== 'classic') {
    await context.addInitScript(pageCursor, {
      style,
      scale,
      accent,
      halo: hexA(accent, 0.22),
      font: `'${brand.font.family}'`,
      hideIdle,
      hand: handOn,
      handSvg: handOn ? handCursorSvg(scale) : '',
      tip: HAND_TIP,
    });
  }
  const setHand = (on) => page.evaluate((v) => window.__wtCursor?.hand(v), on).catch(() => false);
  let releaseTimer = null;
  /** Morph into the hand and give it a beat to read before the real press lands. */
  async function arm() {
    if (!handOn) return;
    clearTimeout(releaseTimer);
    releaseTimer = null;
    await setHand(true);
    await wait(clickChoreography(tempo()).armMs);
  }
  /** After the action: keep the hand a moment, then relax to the arrow. Never blocks the flow. */
  function release() {
    if (!handOn) return;
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      releaseTimer = null;
      setHand(false);
    }, clickChoreography(tempo()).holdMs);
  }
  const placeNow = () =>
    style === 'classic'
      ? Promise.resolve()
      : page.evaluate(({ x, y }) => window.__wtCursor?.place(x, y), pointer).catch(() => {});
  page.on('load', () => placeNow());

  /**
   * During capture every CDP call queues behind ~60 large screencast frames, so a glide is played
   * in the page in one call and the real mouse lands once at the end (hover fires on arrival).
   */
  async function moveTo(x, y, opts = {}) {
    x = Math.round(x);
    y = Math.round(y);
    if (glideOn && style !== 'classic') {
      const { points, duration } = glidePath(pointer, { x, y }, { speed: tempo(), ...opts });
      const route = points.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, at: Math.round(p.at) }));
      const played = await page
        .evaluate((pts) => window.__wtCursor?.glide(pts).then(() => true), route)
        .catch(() => false);
      if (!played && duration) await wait(duration);
      await page.mouse.move(x, y);
    } else {
      await page.mouse.move(x, y, { steps: glideOn ? 4 : opts.steps || 1 });
    }
    pointer.x = x;
    pointer.y = y;
  }

  return {
    style,
    glide: glideOn,
    hideIdle,
    loop: loopOn,
    hand: handOn,
    pointer,
    moveTo,
    arm,
    release,
    /** Playwright moved the mouse itself (its own click); keep our record in step. */
    sync: (x, y) => {
      pointer.x = Math.round(x);
      pointer.y = Math.round(y);
    },
    playwrightCursor: style === 'classic' ? 'pointer' : 'none',
    /** Return to the opening seat for a seamless looping take. */
    finish: async () => {
      if (!loopOn) return;
      await moveTo(home.x, home.y, { ms: 620 });
      await wait(240);
    },
    showKeys: (key, ms = 1100) => {
      const label = keyLabel(key);
      if (!label) return Promise.resolve();
      return page.evaluate(pageKeys, { label, ms }).catch(() => {});
    },
  };
}

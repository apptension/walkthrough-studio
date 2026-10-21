/**
 * Presentation cursor for live capture. Headless Chromium paints no system cursor, so the take gets
 * one we control: an arrow or an accent dot that follows real mouse events, sized for video, with a
 * press pulse. Between actions it glides along an eased, slightly arced path, then the real mouse
 * lands on the target so hover and press are real UI. Keystroke chips show shortcuts the flow presses.
 */
import { hexA } from './text.mjs';

export const CURSOR_STYLES = Object.freeze(['classic', 'arrow', 'dot']);
export const CURSOR_SIZES = Object.freeze({ s: 1, m: 1.3, l: 1.65 });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

/** Page side. Runs in every document (init script), so navigation keeps the cursor. */
function pageCursor({ style, scale, accent, halo, font, hideIdle }) {
  if (window.__wtCursor) return;
  const install = () => {
    if (document.getElementById('wt-cursor')) return;
    const css = document.createElement('style');
    css.id = 'wt-cursor-style';
    css.textContent = `
      #wt-cursor { position:fixed; left:0; top:0; z-index:2147483646; pointer-events:none; opacity:0;
        transition: opacity .2s ease; will-change: transform; }
      #wt-cursor.on { opacity:1; }
      #wt-cursor.idle { opacity:0; }
      #wt-cursor .wt-c { transform-origin: 3px 2px; transition: transform .14s cubic-bezier(.34,1.56,.64,1); }
      #wt-cursor.down .wt-c { transform: scale(.84); }
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
    document.documentElement.appendChild(el);
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
      const ripple = el.querySelector('.wt-ripple');
      ripple.classList.remove('go');
      void ripple.offsetWidth;
      ripple.classList.add('go');
    }, { capture: true, passive: true });
    addEventListener('mouseup', () => el.classList.remove('down'), { capture: true, passive: true });
    /** Play a precomputed route on the compositor clock; one round trip per glide. */
    const glide = (points) =>
      new Promise((resolve) => {
        if (!points.length) return resolve();
        const t0 = performance.now();
        let i = 0;
        const tick = (now) => {
          const at = now - t0;
          while (i < points.length - 1 && points[i].at < at) i++;
          place(points[i].x, points[i].y);
          if (i >= points.length - 1) return resolve();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    window.__wtCursor = {
      place,
      glide,
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

/** Eased, gently arced pointer route. Duration follows distance. */
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
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const u = easeInOut(i / steps);
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
    });
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
    pointer,
    moveTo,
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

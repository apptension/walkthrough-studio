/**
 * Guided capture — the reviewer shows the tour; it is filmed as the reviewer's own take and
 * every step is captured so a bot can re-record it instead (the reviewer chooses in Studio).
 *
 * A visible, signed-in browser opens for the reviewer beside a Recorder window (Start recording ·
 * Mark chapter · Pause · Undo · Finish recording — see guideRecorder.mjs). Nothing is filmed or
 * captured until Start recording. Every intentional interaction is captured with a rich target
 * descriptor — clicks, double/right clicks, typing (as final field values), keys and shortcuts,
 * selects, checkboxes, drags (pointer paths and HTML5 drag & drop), scrolls, wheel/zoom on
 * canvases, hovers that reveal something, navigations, new tabs, dialogs and uploads — plus a
 * screenshot after each settled step. Pointer travel and pauses between actions are never
 * recorded: the steps keep their order and wall-clock times, and the replay paces itself.
 *
 * Outputs (video.dir): guided-tour.json (steps + timing), guided-tour.md (readable walk),
 * guided-flow.mjs (a mechanical replay of every step — the planner optimises it into flow.mjs),
 * and the screens visited are merged into flow-analysis.json/.md for selectors. The take goes to
 * video.out/guide/take.mp4 + take.json (guideTake.mjs).
 * Sign-in and paused stretches are never stored; password values are never stored.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { analysisToMarkdown, buildRecommendations, capturePageReport, pageHintsAggregate, pickPrimaryPage } from './analyzeFlow.mjs';
import { captureProfile, contextOptions, describeCapture } from './capturePresets.mjs';
import { createCursor } from './cursor.mjs';
import { openRecorderPanel, PANEL } from './guideRecorder.mjs';
import { CHAPTER_HOLD_MS, createTakeClock, createTakeFeed, takeFiles, takeTimeline, tourChapters } from './guideTake.mjs';
import { startFrameRecorder } from './motion.mjs';
import { ensureSignedInOffCamera } from './sessionAuth.mjs';
import { sessionFile } from './signInPause.mjs';

const MAX_MS = Number(process.env.WALKTHROUGH_GUIDE_MAX_MS) || 60 * 60 * 1000;
/** Gaps longer than this count as idle — the "action time" the replay actually needs. */
const ACTIVE_GAP_CAP_SEC = 2.5;

export const guideDir = (video) => join(video.out, 'guide');
export const guideFiles = (video) => ({
  tour: join(video.dir, 'guided-tour.json'),
  md: join(video.dir, 'guided-tour.md'),
  flow: join(video.dir, 'guided-flow.mjs'),
  status: join(guideDir(video), 'status.json'),
  finish: join(guideDir(video), 'finish'),
  controls: join(guideDir(video), 'controls.jsonl'),
  events: join(guideDir(video), 'events.jsonl'),
  shots: join(guideDir(video), 'shots'),
});

/* ------------------------------------------------------------------ page side */

/** Installed in every frame before the app's scripts. Self-contained (serialised by Playwright). */
function installGuideRecorder() {
  if (window.__wtGuideInstalled) return;
  window.__wtGuideInstalled = true;
  const isTop = window.top === window;
  const queue = [];
  const flushQueue = () => {
    const emit = window.__wtGuideEmit;
    if (!emit) return;
    while (queue.length) {
      try {
        emit(queue.shift());
      } catch {
        /* the page may be unloading */
      }
    }
  };
  setInterval(flushQueue, 200);
  const send = (e) => {
    e.wall = e.wall || Date.now();
    e.url = location.href;
    e.frame = isTop ? null : location.href;
    queue.push(e);
    flushQueue();
  };
  // The take's presentation cursor is never a target, even if the page lets events through it.
  const ours = (el) => el instanceof Element && Boolean(el.closest('#wt-cursor'));

  const STRONG =
    'a[href],button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=checkbox],[role=radio],[role=switch],[role=treeitem],[role=gridcell],[role=row],[role=combobox],[role=slider],[role=textbox],[role=searchbox],[contenteditable=""],[contenteditable=true]';
  const clean = (s, n = 80) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const isTextField = (el) => {
    if (!(el instanceof Element)) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'range', 'color'].includes((el.type || 'text').toLowerCase());
  };
  const isSecret = (el) =>
    el instanceof Element &&
    ((el.getAttribute('type') || '').toLowerCase() === 'password' || /password|cc-|one-time-code/.test(el.getAttribute('autocomplete') || ''));
  const actionable = (el) => {
    if (!(el instanceof Element)) return document.body;
    if (el.tagName === 'CANVAS') return el;
    const strong = el.closest(STRONG);
    if (strong) return strong;
    let best = null;
    let cur = el;
    for (let depth = 0; cur && cur !== document.body && depth < 8; depth++, cur = cur.parentElement) {
      const pointer = cur.hasAttribute('onclick') || cur.getAttribute('tabindex') === '0' || getComputedStyle(cur).cursor === 'pointer';
      if (pointer) best = cur;
      else if (best) break;
    }
    return best || el;
  };
  const roleOf = (el) => {
    const r = el.getAttribute('role');
    if (r) return r.split(/\s+/)[0];
    const t = el.tagName.toLowerCase();
    if (t === 'a') return el.hasAttribute('href') ? 'link' : 'generic';
    if (t === 'button' || t === 'summary') return 'button';
    if (t === 'select') return el.multiple ? 'listbox' : 'combobox';
    if (t === 'textarea') return 'textbox';
    if (t === 'input') {
      const ty = (el.type || 'text').toLowerCase();
      return (
        { checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton', search: 'searchbox', button: 'button', submit: 'button', reset: 'button', image: 'button', password: 'password' }[ty] ||
        'textbox'
      );
    }
    if (/^h[1-6]$/.test(t)) return 'heading';
    if (t === 'img') return 'img';
    if (t === 'canvas') return 'canvas';
    if (t === 'li') return 'listitem';
    if (t === 'tr') return 'row';
    if (t === 'td') return 'cell';
    if (el.isContentEditable) return 'textbox';
    return 'generic';
  };
  const labelText = (el) => {
    if (el.labels?.length) return clean([...el.labels].map((l) => l.innerText).join(' '));
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return clean(l.innerText);
    }
    return '';
  };
  const LIGATURE = 'md-icon,mat-icon,.material-icons,.material-icons-outlined,.material-icons-round,.material-symbols-outlined,.material-symbols-rounded';
  /** Text as assistive tech (and Playwright's getByRole name) reads it: aria-hidden and hidden subtrees left out. */
  const spokenText = (el) => {
    let out = '';
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) out += `${c.textContent} `;
        else if (c.nodeType === 1 && c.getAttribute('aria-hidden') !== 'true') {
          const cs = getComputedStyle(c);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          if (c.tagName === 'IMG') out += `${c.getAttribute('alt') || ''} `;
          else walk(c);
        }
      }
    };
    walk(el);
    return clean(out);
  };
  const iconHint = (el) => {
    const pick =
      el.getAttribute('data-icon') ||
      el.querySelector?.('[md-svg-icon]')?.getAttribute('md-svg-icon') ||
      el.querySelector?.('[svgicon]')?.getAttribute('svgicon') ||
      el.querySelector?.('[data-icon]')?.getAttribute('data-icon') ||
      el.querySelector?.('use')?.getAttribute('href') ||
      el.querySelector?.('use')?.getAttribute('xlink:href') ||
      el.querySelector?.(LIGATURE)?.textContent ||
      (el.matches?.(LIGATURE) ? el.textContent : '') ||
      '';
    return pick ? `icon: ${clean(pick.replace(/^#/, ''), 40)}` : '';
  };
  const tooltip = (el) =>
    clean(
      el.getAttribute('title') ||
        el.getAttribute('data-tooltip') ||
        el.getAttribute('data-original-title') ||
        el.getAttribute('mattooltip') ||
        el.getAttribute('data-tip') ||
        (el.getAttribute('aria-describedby') ? document.getElementById(el.getAttribute('aria-describedby'))?.innerText : '') ||
        '',
      60
    );
  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = clean(by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' '));
      if (t) return t;
    }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
      if (['submit', 'button', 'reset'].includes(el.type)) return clean(el.value);
      return labelText(el) || clean(el.getAttribute('placeholder')) || clean(el.title);
    }
    if (el.tagName === 'IMG') return clean(el.alt);
    return spokenText(el) || clean(el.title || el.querySelector?.('svg title')?.textContent || el.querySelector?.('img[alt]')?.alt || '');
  };
  const cssPath = (el) => {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement && parts.length < 7) {
      const tid = cur.getAttribute('data-testid') || cur.getAttribute('data-test') || cur.getAttribute('data-qa') || cur.getAttribute('data-cy');
      if (tid) {
        const attr = ['data-testid', 'data-test', 'data-qa', 'data-cy'].find((a) => cur.getAttribute(a) === tid);
        parts.unshift(`[${attr}="${CSS.escape(tid)}"]`);
      } else if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id)) {
        parts.unshift(`#${CSS.escape(cur.id)}`);
      } else {
        let part = cur.tagName.toLowerCase();
        const parent = cur.parentElement;
        if (parent) {
          const same = [...parent.children].filter((c) => c.tagName === cur.tagName);
          if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
        }
        parts.unshift(part);
      }
      const sel = parts.join(' > ');
      try {
        if (document.querySelectorAll(sel).length === 1) return sel;
      } catch {
        /* keep climbing */
      }
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };
  const whereOf = (el, r) => {
    const vw = innerWidth;
    const vh = innerHeight;
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const pos =
      cy < vh * 0.12
        ? cx > vw * 0.75
          ? 'top-right'
          : cx < vw * 0.2
            ? 'top-left'
            : 'top bar'
        : cx < vw * 0.2
          ? 'left sidebar'
          : cx > vw * 0.8
            ? 'right side'
            : cy > vh * 0.85
              ? 'bottom'
              : 'main area';
    const land = el.closest('nav,header,aside,footer,main,form,dialog,[role=navigation],[role=banner],[role=complementary],[role=dialog],[role=menu],[role=toolbar],[role=tablist]');
    const dlg = el.closest('[role=dialog],[role=alertdialog],dialog,[aria-modal=true]');
    const dialog = dlg ? clean(dlg.getAttribute('aria-label') || dlg.querySelector('h1,h2,h3,[role=heading]')?.innerText, 60) || 'dialog' : null;
    let heading = '';
    let sec = el.parentElement;
    for (let i = 0; sec && i < 6 && !heading; i++, sec = sec.parentElement) {
      const h = sec.querySelector('h1,h2,h3,[role=heading]');
      if (h && h !== el && !h.contains(el)) heading = clean(h.innerText, 60);
    }
    return { pos, landmark: land ? land.getAttribute('role') || land.tagName.toLowerCase() : null, dialog, heading: heading || null };
  };
  const describe = (raw, ev) => {
    const el = raw instanceof Element ? raw : document.body;
    const r = el.getBoundingClientRect();
    const role = roleOf(el);
    const name = nameOf(el) || iconHint(el) || tooltip(el);
    const d = {
      tag: el.tagName.toLowerCase(),
      role,
      name,
      text: clean(el.innerText, 80) || null,
      label: /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ? labelText(el) || null : null,
      placeholder: el.getAttribute('placeholder'),
      testid: el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa') || el.getAttribute('data-cy'),
      id: el.id || null,
      nameAttr: el.getAttribute('name'),
      type: el.getAttribute('type'),
      href: el.getAttribute('href'),
      tooltip: tooltip(el) || null,
      css: cssPath(el),
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      ...whereOf(el, r),
      canvas: el.tagName === 'CANVAS' ? [...document.querySelectorAll('canvas')].indexOf(el) : null,
    };
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) d.checked = el.checked;
    if (ev && typeof ev.clientX === 'number') {
      d.point = { x: Math.round(ev.clientX), y: Math.round(ev.clientY) };
      d.rel = {
        fx: Number(((ev.clientX - r.x) / Math.max(1, r.width)).toFixed(3)),
        fy: Number(((ev.clientY - r.y) / Math.max(1, r.height)).toFixed(3)),
      };
    }
    if (name) {
      const same = [...document.querySelectorAll(`${STRONG},canvas`)].filter((x) => x === el || (roleOf(x) === role && nameOf(x) === name));
      d.matches = same.length;
      d.nth = Math.max(0, same.indexOf(el));
    }
    return d;
  };
  const mods = (e) => [e.ctrlKey && 'Control', e.metaKey && 'Meta', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);

  /* --- coalesced inputs: typing, scrolling and wheel become one step each --- */
  let pendingFill = null;
  let fillTimer = 0;
  const flushFill = () => {
    clearTimeout(fillTimer);
    if (!pendingFill) return;
    const p = pendingFill;
    pendingFill = null;
    send({ type: 'fill', target: p.desc, value: p.secret ? '' : p.value, secret: p.secret, length: p.length, wall: p.t });
  };
  const scrolls = new Map();
  const known = new WeakMap();
  let scrollTimer = 0;
  let lastScrollAt = 0;
  const flushScroll = () => {
    clearTimeout(scrollTimer);
    for (const [el, s] of scrolls) {
      const page = el === document.scrollingElement || el === document.documentElement || el === document.body;
      const maxY = Math.max(0, el.scrollHeight - el.clientHeight);
      const maxX = Math.max(0, el.scrollWidth - el.clientWidth);
      known.set(el, { y: s.toY, x: s.toX });
      if (Math.abs(s.toY - (s.fromY ?? s.toY)) < 4 && Math.abs(s.toX - (s.fromX ?? s.toX)) < 4 && s.fromY != null) continue;
      send({
        type: 'scroll',
        target: page ? { page: true } : describe(el),
        fromY: s.fromY,
        toY: Math.round(s.toY),
        fromX: s.fromX,
        toX: Math.round(s.toX),
        fracY: maxY ? Number((s.toY / maxY).toFixed(3)) : 0,
        fracX: maxX ? Number((s.toX / maxX).toFixed(3)) : 0,
        wall: s.t,
      });
    }
    scrolls.clear();
  };
  let wheel = null;
  let wheelTimer = 0;
  const flushWheel = () => {
    clearTimeout(wheelTimer);
    if (!wheel) return;
    const w = wheel;
    wheel = null;
    if (lastScrollAt >= w.t - 30) return; // the page scrolled — the scroll step covers it
    if (Math.abs(w.dx) + Math.abs(w.dy) < 10) return;
    send({ type: 'wheel', target: w.desc, dx: Math.round(w.dx), dy: Math.round(w.dy), zoom: w.zoom, wall: w.t });
  };
  const flushAll = () => {
    flushFill();
    flushWheel();
    flushScroll();
  };
  window.__wtGuideFlush = flushAll;
  addEventListener('pagehide', flushAll, true);
  addEventListener('beforeunload', flushAll, true);
  const step = (e) => {
    flushAll();
    send(e);
  };

  /* --- pointer: click vs drag --- */
  let down = null;
  let lastDragAt = 0;
  let lastMouse = null;
  addEventListener(
    'pointerdown',
    (e) => {
      if (!e.isTrusted || ours(e.target)) return;
      flushAll();
      const el = actionable(e.target);
      down = { t: Date.now(), x: e.clientX, y: e.clientY, desc: describe(el, e), path: [[0, 0, 0]], max: 0, last: 0, button: e.button };
    },
    true
  );
  addEventListener(
    'pointermove',
    (e) => {
      if (!e.isTrusted) return;
      lastMouse = { clientX: e.clientX, clientY: e.clientY };
      if (!down) return;
      const dt = Date.now() - down.t;
      down.max = Math.max(down.max, Math.hypot(e.clientX - down.x, e.clientY - down.y));
      if (dt - down.last >= 40) {
        down.path.push([dt, Math.round(e.clientX - down.x), Math.round(e.clientY - down.y)]);
        down.last = dt;
      }
    },
    true
  );
  addEventListener(
    'pointerup',
    (e) => {
      if (!down) return;
      const d = down;
      down = null;
      if (d.max <= 8) return;
      d.path.push([Date.now() - d.t, Math.round(e.clientX - d.x), Math.round(e.clientY - d.y)]);
      const endEl = document.elementFromPoint(e.clientX, e.clientY);
      lastDragAt = Date.now();
      send({
        type: 'drag',
        target: d.desc,
        from: { x: Math.round(d.x), y: Math.round(d.y) },
        to: { x: Math.round(e.clientX), y: Math.round(e.clientY) },
        path: d.path,
        ms: Date.now() - d.t,
        drop: endEl && !ours(endEl) ? describe(actionable(endEl), e) : null,
        button: d.button,
        wall: d.t,
      });
    },
    true
  );
  addEventListener('pointercancel', () => (down = null), true);
  addEventListener(
    'click',
    (e) => {
      if (!e.isTrusted || ours(e.target)) return;
      if (Date.now() - lastDragAt < 300) return;
      const el = actionable(e.target);
      // Native checkboxes/radios report through `change` (one step, with the final state).
      const ctl = el.tagName === 'LABEL' ? el.control : el;
      if (ctl && ctl.tagName === 'INPUT' && (ctl.type === 'checkbox' || ctl.type === 'radio')) return;
      if (el.tagName === 'SELECT') return;
      if (isTextField(el)) {
        step({ type: 'focus', target: describe(el, e) });
        return;
      }
      step({ type: 'click', target: describe(el, e), detail: e.detail, button: e.button, mods: mods(e) });
    },
    true
  );
  addEventListener(
    'contextmenu',
    (e) => {
      if (!e.isTrusted || ours(e.target)) return;
      step({ type: 'rightclick', target: describe(actionable(e.target), e) });
    },
    true
  );

  /* --- typing, choices, keys --- */
  addEventListener(
    'input',
    (e) => {
      if (!e.isTrusted || ours(e.target)) return;
      const el = e.target;
      if (!isTextField(el)) return;
      const value = el.isContentEditable ? el.innerText : el.value;
      if (!pendingFill || pendingFill.el !== el) {
        flushAll();
        pendingFill = { el, desc: describe(el), t: Date.now() };
      }
      pendingFill.secret = isSecret(el);
      pendingFill.value = String(value ?? '');
      pendingFill.length = pendingFill.value.length;
      clearTimeout(fillTimer);
      fillTimer = setTimeout(flushFill, 1500);
    },
    true
  );
  addEventListener(
    'change',
    (e) => {
      if (!e.isTrusted || ours(e.target)) return;
      const el = e.target;
      if (!(el instanceof Element)) return;
      if (el.tagName === 'SELECT') {
        const opts = [...el.selectedOptions];
        step({ type: 'select', target: describe(el), value: el.value, label: clean(opts.map((o) => o.label || o.text).join(', ')) });
      } else if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
        step({ type: 'check', target: describe(el), checked: el.checked });
      } else if (el.tagName === 'INPUT' && el.type === 'file') {
        step({ type: 'upload', target: describe(el), files: [...(el.files || [])].map((f) => f.name) });
      } else if (el.tagName === 'INPUT' && (el.type === 'range' || el.type === 'color')) {
        step({ type: 'fill', target: describe(el), value: el.value, secret: false, length: String(el.value).length });
      } else if (isTextField(el)) flushFill();
    },
    true
  );
  const SPECIAL = new Set(['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Backspace', 'Delete', ' ']);
  addEventListener(
    'keydown',
    (e) => {
      if (!e.isTrusted || ours(e.target)) return;
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn'].includes(e.key)) return;
      const inText = isTextField(e.target);
      const combo = e.ctrlKey || e.metaKey || e.altKey;
      if (!combo && e.target instanceof Element && e.target.tagName === 'SELECT') return; // `change` carries the choice
      if (inText) {
        if (combo && /^[acvxyz]$/i.test(e.key)) return; // editing — the fill carries the result
        if (!combo && !['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        if (!combo && e.key === 'Enter' && e.target.tagName === 'TEXTAREA') return;
      } else if (!combo && !SPECIAL.has(e.key) && e.key.length !== 1) {
        return;
      }
      const key = [
        e.ctrlKey || e.metaKey ? 'ControlOrMeta' : '',
        e.altKey ? 'Alt' : '',
        e.shiftKey && e.key.length > 1 ? 'Shift' : '',
        e.key === ' ' ? 'Space' : e.key.length === 1 && combo ? e.key.toLowerCase() : e.key,
      ]
        .filter(Boolean)
        .join('+');
      step({ type: 'press', key, inText, target: describe(actionable(document.activeElement || document.body)) });
    },
    true
  );

  /* --- scroll, wheel, hover, html5 drag --- */
  addEventListener(
    'scroll',
    (e) => {
      if (!e.isTrusted) return;
      const el = e.target === document ? document.scrollingElement || document.documentElement : e.target;
      if (!(el instanceof Element) || ours(el)) return;
      lastScrollAt = Date.now();
      let s = scrolls.get(el);
      if (!s) {
        const k = known.get(el);
        s = { fromY: k ? k.y : null, fromX: k ? k.x : null, t: Date.now() };
        scrolls.set(el, s);
      }
      s.toY = el.scrollTop;
      s.toX = el.scrollLeft;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(flushScroll, 450);
    },
    true
  );
  addEventListener(
    'wheel',
    (e) => {
      if (!e.isTrusted || ours(e.target)) return;
      const el = actionable(e.target);
      if (!wheel || wheel.el !== el) {
        flushWheel();
        wheel = { el, desc: describe(el, e), dx: 0, dy: 0, t: Date.now(), zoom: e.ctrlKey };
      }
      wheel.dx += e.deltaX;
      wheel.dy += e.deltaY;
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(flushWheel, 450);
    },
    { capture: true, passive: true }
  );
  let mutations = 0;
  const watch = () => {
    try {
      new MutationObserver((list) => {
        for (const m of list) {
          if (m.type === 'attributes' || [...m.addedNodes].some((n) => n.nodeType === 1)) mutations++;
        }
      }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'open', 'aria-hidden'] });
    } catch {
      /* no document yet */
    }
  };
  if (document.documentElement) watch();
  else addEventListener('DOMContentLoaded', watch, { once: true });
  let hoverEl = null;
  let hoverTimer = 0;
  // CSS :hover menus reveal controls without touching the DOM. Hover state is already applied
  // when mouseover fires, so read it from the stylesheet: a :hover rule that changes visibility
  // and now matches an element holding controls outside the hovered chain.
  let hoverRules = null;
  let sheetCount = -1;
  const hoverSelectors = () => {
    if (hoverRules && document.styleSheets.length === sheetCount) return hoverRules;
    sheetCount = document.styleSheets.length;
    hoverRules = [];
    const walk = (rules) => {
      for (const r of rules) {
        if (!r.selectorText && r.cssRules) {
          walk(r.cssRules);
          continue;
        }
        if (r.selectorText?.includes(':hover') && /display|visibility|opacity|max-height|transform|clip/.test(r.style?.cssText || '')) hoverRules.push(r.selectorText);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules);
      } catch {
        /* cross-origin sheet */
      }
    }
    return hoverRules;
  };
  const cssRevealed = (el) => {
    for (const sel of hoverSelectors()) {
      let hits = [];
      try {
        hits = document.querySelectorAll(sel);
      } catch {
        continue;
      }
      for (const h of hits) {
        if (h === el || h.contains(el) || el.contains(h)) continue;
        if (!(h.matches(STRONG) || h.querySelector(STRONG))) continue;
        const r = h.getBoundingClientRect();
        if (r.width > 1 && r.height > 1) return true;
      }
    }
    return false;
  };
  addEventListener(
    'mouseover',
    (e) => {
      if (!e.isTrusted || ours(e.target) || down) return;
      const el = actionable(e.target);
      if (el === hoverEl) return;
      hoverEl = el;
      clearTimeout(hoverTimer);
      const before = mutations;
      const at = Date.now();
      hoverTimer = setTimeout(() => {
        if (hoverEl !== el || down) return;
        const revealed = mutations - before + (cssRevealed(el) ? 1 : 0);
        const drawn = el.tagName === 'CANVAS' || Boolean(el.closest('svg'));
        if (revealed > 0 || drawn) send({ type: 'hover', target: describe(el, lastMouse), revealed: revealed > 0, wall: at });
      }, 900);
    },
    true
  );
  addEventListener(
    'pointerdown',
    () => {
      clearTimeout(hoverTimer);
      hoverEl = null;
    },
    true
  );
  let dragSrc = null;
  addEventListener(
    'dragstart',
    (e) => {
      if (!e.isTrusted || ours(e.target)) return;
      dragSrc = { desc: describe(actionable(e.target), e), t: Date.now(), x: e.clientX, y: e.clientY };
      down = null;
    },
    true
  );
  addEventListener(
    'drop',
    (e) => {
      if (!dragSrc) return;
      lastDragAt = Date.now();
      step({
        type: 'drag',
        html5: true,
        target: dragSrc.desc,
        from: { x: Math.round(dragSrc.x), y: Math.round(dragSrc.y) },
        to: { x: Math.round(e.clientX), y: Math.round(e.clientY) },
        drop: describe(actionable(e.target), e),
        ms: Date.now() - dragSrc.t,
        wall: dragSrc.t,
      });
      dragSrc = null;
    },
    true
  );
  addEventListener('dragend', () => (dragSrc = null), true);
}

/* ------------------------------------------------------------------ normalise */

const ACTION_TYPES = new Set(['click', 'dblclick', 'rightclick', 'press', 'fill', 'select', 'check', 'focus']);

function sameTarget(a, b) {
  if (!a || !b) return false;
  if (a.page && b.page) return true;
  if (a.css && a.css === b.css) return true;
  return Boolean(a.name) && a.role === b.role && a.name === b.name && a.tag === b.tag;
}

/**
 * Raw dock/page events → ordered steps. Merges what one intention produced (keystrokes into a
 * field value, a double click, a scroll gesture, repeated keys, a click and the navigation it
 * caused), honours Undo / Pause, and keeps wall-clock timing so idle time is visible but never
 * replayed. Pure: no I/O.
 */
export function normalizeGuideEvents(raw = [], { shots = [] } = {}) {
  const steps = [];
  const removed = [];
  let started = !raw.some((e) => e.type === 'start');
  let paused = false;
  for (const e of raw) {
    if (e.type === 'start') {
      if (!started) steps.push({ type: 'start', url: e.url, at: e.at, seq: e.seq });
      started = true;
      continue;
    }
    if (!started) continue;
    if (e.type === 'pause') {
      paused = true;
      continue;
    }
    if (e.type === 'resume') {
      paused = false;
      continue;
    }
    if (paused) continue;
    if (e.type === 'undo') {
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].type === 'start') break;
        removed.push(steps.splice(i, 1)[0]);
        break;
      }
      continue;
    }
    const prev = steps.at(-1);
    const near = (ms) => prev && e.at - prev.at <= ms;
    const s = { ...e };
    delete s.wall;
    if (e.type === 'fill') {
      if (prev && (prev.type === 'fill' || prev.type === 'focus') && sameTarget(prev.target, e.target)) {
        Object.assign(prev, { type: 'fill', value: e.value, secret: e.secret, length: e.length, target: e.target, seq: e.seq });
        continue;
      }
    } else if (e.type === 'click') {
      if (prev?.type === 'click' && e.detail >= 2 && near(700) && sameTarget(prev.target, e.target)) {
        prev.type = 'dblclick';
        prev.seq = e.seq;
        continue;
      }
      if (prev?.type === 'hover' && sameTarget(prev.target, e.target)) steps.pop();
    } else if (e.type === 'scroll') {
      if (prev?.type === 'scroll' && sameTarget(prev.target, e.target)) {
        Object.assign(prev, { toY: e.toY, toX: e.toX, fracY: e.fracY, fracX: e.fracX, seq: e.seq });
        continue;
      }
    } else if (e.type === 'wheel') {
      if (prev?.type === 'wheel' && sameTarget(prev.target, e.target) && near(1500)) {
        prev.dx += e.dx;
        prev.dy += e.dy;
        prev.seq = e.seq;
        continue;
      }
    } else if (e.type === 'press') {
      if (prev?.type === 'press' && prev.key === e.key && near(1200)) {
        prev.count = (prev.count || 1) + 1;
        prev.seq = e.seq;
        continue;
      }
    } else if (e.type === 'nav') {
      const last = [...steps].reverse().find((x) => x.type !== 'mark');
      if (last?.type === 'start' && e.at - last.at <= 4000) {
        last.url = e.url;
        last.title = e.title || last.title;
        continue;
      }
      if (last && (ACTION_TYPES.has(last.type) || last.type === 'drag') && e.at - last.at <= 2500 && !last.navigates) {
        last.navigates = e.url;
        if (e.title) last.lands = e.title;
        continue;
      }
      if (last && (last.type === 'goto' || last.navigates) && e.at - last.at <= 2500) {
        if (last.type === 'goto') last.url = e.url;
        else last.navigates = e.url;
        continue;
      }
      steps.push({ type: 'goto', url: e.url, title: e.title || null, at: e.at, seq: e.seq });
      continue;
    } else if (e.type === 'title') {
      const hit = [...steps].reverse().find((x) => x.url === e.url || x.navigates === e.url);
      if (hit) hit[hit.type === 'goto' || hit.type === 'start' ? 'title' : 'lands'] = e.title;
      continue;
    } else if (e.type === 'dialog') {
      if (prev) prev.dialog = { kind: e.kind, message: e.message };
      continue;
    }
    steps.push(s);
  }
  for (const s of steps) if (s.type === 'focus') Object.assign(s, { type: 'click', focusOnly: true });

  let active = 0;
  steps.forEach((s, i) => {
    s.id = `s${i + 1}`;
    s.t = Number(((s.at || 0) / 1000).toFixed(2));
    s.gap = i ? Number((((s.at || 0) - (steps[i - 1].at || 0)) / 1000).toFixed(2)) : 0;
    active += Math.min(Math.max(0, s.gap), ACTIVE_GAP_CAP_SEC);
    s.activeT = Number(active.toFixed(2));
  });
  const ordered = [...shots].sort((a, b) => a.seq - b.seq);
  for (const shot of ordered) {
    const owner = [...steps].reverse().find((s) => (s.seq ?? -1) <= shot.seq);
    if (owner) owner.shot = shot.file;
  }
  const wallSec = steps.length ? steps.at(-1).t : 0;
  return {
    steps,
    removed,
    stats: {
      steps: steps.filter((s) => s.type !== 'start' && s.type !== 'mark').length,
      marks: steps.filter((s) => s.type === 'mark').length,
      wallSec,
      activeSec: Number(active.toFixed(1)),
      idleSec: Number(Math.max(0, wallSec - active).toFixed(1)),
      byType: steps.reduce((m, s) => ((m[s.type] = (m[s.type] || 0) + 1), m), {}),
    },
  };
}

/* ------------------------------------------------------------------ describe */

const quote = (s) => `“${String(s).slice(0, 60)}”`;
const pathOf = (url) => {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}${u.hash}` || '/';
  } catch {
    return String(url || '');
  }
};

export function describeTarget(d) {
  if (!d) return 'the page';
  if (d.page) return 'the page';
  const kind = d.canvas != null ? `canvas #${d.canvas}` : d.role && d.role !== 'generic' ? d.role : d.tag;
  const label = d.name || d.text || d.placeholder || d.label || '';
  const where = d.dialog ? `in dialog ${quote(d.dialog)}` : d.pos;
  return `${kind}${label ? ` ${quote(label)}` : ''}${where ? ` · ${where}` : ''}`;
}

export function describeStep(s) {
  const t = describeTarget(s.target);
  const lands = s.navigates ? ` → ${pathOf(s.navigates)}` : '';
  switch (s.type) {
    case 'start':
      return `start at ${pathOf(s.url)}`;
    case 'mark':
      return `◆ moment${s.title ? ` ${quote(s.title)}` : ''}`;
    case 'click':
      return `${s.focusOnly ? 'click into' : 'click'} ${t}${lands}`;
    case 'dblclick':
      return `double-click ${t}${lands}`;
    case 'rightclick':
      return `right-click ${t}`;
    case 'fill':
      return s.secret ? `type a secret into ${t} (not stored)` : `type ${JSON.stringify(String(s.value).slice(0, 60))} into ${t}`;
    case 'select':
      return `choose ${quote(s.label || s.value)} in ${t}`;
    case 'check':
      return `${s.checked ? 'tick' : 'untick'} ${t}`;
    case 'press':
      return `press ${s.key}${s.count > 1 ? ` ×${s.count}` : ''}${lands}`;
    case 'scroll': {
      const dy = (s.toY ?? 0) - (s.fromY ?? 0);
      return `scroll ${t} ${dy >= 0 ? 'down' : 'up'}${s.fromY != null ? ` ${Math.abs(dy)}px` : ''} (to ${Math.round((s.fracY || 0) * 100)}%)`;
    }
    case 'wheel':
      return `${s.zoom ? 'pinch-zoom' : 'wheel'} on ${t} (${s.dy < 0 ? 'up' : 'down'} ${Math.abs(s.dy)})`;
    case 'drag': {
      const dx = (s.to?.x ?? 0) - (s.from?.x ?? 0);
      const dy = (s.to?.y ?? 0) - (s.from?.y ?? 0);
      const dir = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'down' : 'up';
      return `drag ${t} ${dir} ${Math.round(Math.hypot(dx, dy))}px${s.drop && s.html5 ? ` onto ${describeTarget(s.drop)}` : ''}`;
    }
    case 'hover':
      return `hover ${t}${s.revealed ? ' (reveals more UI)' : ''}`;
    case 'goto':
      return `go to ${pathOf(s.url)}`;
    case 'tab':
      return `a new tab opens at ${pathOf(s.url)}`;
    case 'upload':
      return `upload ${(s.files || []).join(', ') || 'a file'} via ${t}`;
    default:
      return `${s.type} ${t}`;
  }
}

const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export function tourToMarkdown(tour) {
  const lines = [
    `# Guided tour — ${tour.slug}`,
    '',
    `Shown by the reviewer ${tour.finishedAt ? new Date(tour.finishedAt).toISOString().slice(0, 16).replace('T', ' ') : ''} · ${tour.stats.steps} steps, ${tour.stats.marks} marked moments · ${clock(tour.stats.wallSec)} wall clock, ${clock(tour.stats.activeSec)} of action (idle removed).`,
    `Started at ${tour.capturedFrom || tour.startUrl}${tour.signedIn ? ' (signed in)' : ''}. ${
      viewportMatched(tour)
        ? `Shown at the recording viewport ${tour.recordViewport.width}×${tour.recordViewport.height} (CSS px${tour.window?.scale && tour.window.scale < 1 ? `, displayed at ${Math.round(tour.window.scale * 100)}%` : ''}) — boxes, click points and drag paths replay 1:1.`
        : `Window while showing ${tour.window?.w || '?'}×${tour.window?.h || '?'}; recording viewport ${tour.recordViewport?.width}×${tour.recordViewport?.height} — sizes differ, so boxes, points and duplicate indexes are approximate.`
    }${tour.capture?.mobile ? ` Device: ${tour.capture.label} (mobile layout${tour.capture.touch ? ', touch' : ''}).` : ''}`,
    '',
    'Each step: wall-clock time, gap since the previous step (idle is not replayed), what happened, and the screenshot after it. Full target descriptors (role, name, testid, css, box, click point) are in guided-tour.json.',
    '',
    '## Steps',
    '',
  ];
  for (const s of tour.steps) {
    if (s.type === 'mark') {
      lines.push('', `### ◆ ${s.title || 'Unnamed moment'}${s.note ? ` — ${s.note}` : ''}`, '');
      continue;
    }
    const extra = [s.lands ? `lands on ${quote(s.lands)}` : '', s.dialog ? `${s.dialog.kind} dialog accepted: ${quote(s.dialog.message)}` : '', s.shot ? `shot ${s.shot}` : '']
      .filter(Boolean)
      .join(' · ');
    lines.push(`${s.id}. **${clock(s.t)}**${s.gap > ACTIVE_GAP_CAP_SEC ? ` _(+${s.gap.toFixed(1)} s idle)_` : ''} ${describeStep(s)}${extra ? ` — ${extra}` : ''}`);
  }
  if (tour.removed?.length) {
    lines.push('', '## Undone by the reviewer', '', ...tour.removed.map((s) => `- ${describeStep(s)}`));
  }
  return `${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------------ compile */

const J = (v) => JSON.stringify(v);
const REPLAY_ROLES = new Set([
  'button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'checkbox', 'radio', 'switch', 'treeitem',
  'combobox', 'textbox', 'searchbox', 'spinbutton', 'slider', 'heading', 'row', 'gridcell', 'listitem', 'cell', 'img', 'listbox',
]);

/** Steps that put a value in: they need the real element, never a guessed position. */
const VALUE_STEPS = new Set(['fill', 'select', 'check', 'scroll', 'upload']);

/** The tour was shown at the recording viewport, so captured CSS px match the take. */
export function viewportMatched(tour) {
  const w = tour?.window;
  const v = tour?.recordViewport;
  return Boolean(w && v && w.w === v.width && w.h === v.height);
}

/** A Playwright locator expression for a captured descriptor — most specific signal first. */
export function locatorFor(d) {
  const expr = baseLocatorFor(d);
  if (!expr || d.canvas != null) return expr;
  return `${expr}${d.matches > 1 && d.nth > 0 ? `.nth(${d.nth})` : '.first()'}`;
}

/**
 * Does this target have a handle that survives to replay?
 *
 * A test id, an id, a label, a form name, a canvas index or a named ARIA role all find the
 * element again. Anything else is reached by a CSS path down the DOM as it looked during the
 * tour — a guess that breaks on transient nodes (tooltips, popovers) and on generated markup.
 */
export function isAnchored(d) {
  if (!d) return false;
  if (d.testid || d.id || d.label || d.placeholder || d.canvas != null) return true;
  if (d.nameAttr && /^(input|select|textarea)$/.test(d.tag)) return true;
  const named = d.name && !/^icon: /.test(d.name);
  return Boolean(named && REPLAY_ROLES.has(d.role));
}

/**
 * Captured geometry per step id for targets that nothing lasting can find.
 *
 * Replay reads this straight from the tour, so a flow keeps working even when the selector in it
 * was shortened, re-guessed or written before the markup changed. Empty when the tour was shown
 * at another size, where captured pixels mean nothing.
 */
export function tourFallbacks(tour) {
  const byStep = new Map();
  const all = [];
  for (const s of tour && viewportMatched(tour) ? tour.steps || [] : []) {
    const d = s.target;
    if (!d || VALUE_STEPS.has(s.type) || isAnchored(d)) continue;
    if (!d.point || !(d.box?.w >= 1) || !(d.box?.h >= 1)) continue;
    const geometry = {
      box: { x: d.box.x, y: d.box.y, width: d.box.w, height: d.box.h },
      point: { ...d.point },
    };
    byStep.set(s.id, geometry);
    all.push(geometry);
  }
  return {
    size: byStep.size,
    get: (step) => byStep.get(step) || null,
    has: (step) => byStep.has(step),
    /**
     * Geometry for one near() call. Step names get rewritten on the way into flow.mjs, so the
     * captured point in the call is the key that survives: it is the pixel the reviewer touched.
     */
    find({ step, x, y } = {}) {
      if (step && byStep.has(step)) return byStep.get(step);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      let best = null;
      let bestDistance = 4.5;
      for (const geometry of all) {
        const d = Math.hypot(geometry.point.x - x, geometry.point.y - y);
        if (d <= bestDistance) {
          best = geometry;
          bestDistance = d;
        }
      }
      return best;
    },
  };
}

/**
 * The step's target in replay: the duplicate nearest the captured point when the tour was shown
 * at the recording viewport, else the captured duplicate index.
 *
 * A target with no lasting handle also carries the rectangle the reviewer touched, so the step
 * acts on the right pixel instead of aborting the take when the CSS path no longer resolves.
 * Steps that put a value in get no such fallback — typing into a guessed position is worse than
 * stopping. Throws when nothing shows and there is nothing to fall back to.
 */
export function targetFor(d, { matched = false, step = '', value = false } = {}) {
  const expr = baseLocatorFor(d);
  if (!expr) return null;
  const at = matched && d.point ? `x: ${d.point.x}, y: ${d.point.y}, ` : '';
  const nth = d.canvas == null && d.matches > 1 ? `nth: ${d.nth || 0}, ` : '';
  const loose = !value && matched && d.point && d.box?.w >= 1 && d.box?.h >= 1 && !isAnchored(d);
  const fallback = loose
    ? `timeout: 3000, fallback: { box: ${J({ x: d.box.x, y: d.box.y, width: d.box.w, height: d.box.h })}, point: ${J(d.point)} }, `
    : '';
  return `await near(${expr}, { ${at}${nth}${fallback}step: ${J(step)} })`;
}

function baseLocatorFor(d) {
  if (!d || d.page) return null;
  const named = d.name && !/^icon: /.test(d.name);
  let expr;
  if (d.testid) expr = `page.getByTestId(${J(d.testid)})`;
  else if (d.canvas != null) expr = `page.locator('canvas').nth(${d.canvas})`;
  else if (named && REPLAY_ROLES.has(d.role)) {
    expr = d.name.length <= 40 ? `page.getByRole(${J(d.role)}, { name: ${J(d.name)}, exact: true })` : `page.getByRole(${J(d.role)}, { name: ${J(d.name.slice(0, 40))} })`;
  } else if (d.label) expr = `page.getByLabel(${J(d.label)}, { exact: true })`;
  else if (d.placeholder) expr = `page.getByPlaceholder(${J(d.placeholder)}, { exact: true })`;
  else if (d.nameAttr && /^(input|select|textarea)$/.test(d.tag)) expr = `page.locator(${J(`${d.tag}[name="${d.nameAttr}"]`)})`;
  else if (d.id) expr = `page.locator(${J(`#${d.id}`)})`;
  else if (named && d.text && d.text === d.name && d.name.length <= 60) expr = `page.getByText(${J(d.text)}, { exact: true })`;
  else expr = `page.locator(${J(d.css || d.tag)})`;
  return expr;
}

const thinPath = (path = [], max = 24) => {
  if (path.length <= max) return path;
  const out = [];
  for (let i = 0; i < max - 1; i++) out.push(path[Math.round((i * (path.length - 1)) / (max - 1))]);
  out.push(path.at(-1));
  return out;
};

/** Replay every captured step, in order, at a steady pace. The planner turns it into flow.mjs. */
export function compileGuidedFlow(tour, { startUrl = null } = {}) {
  const out = [];
  const say = (line = '') => out.push(line ? `  ${line}` : '');
  const matched = viewportMatched(tour);
  const chapters = tourChapters(tour);
  const markChapters = new Map(chapters.filter((c) => c.step && tour.steps.some((s) => s.id === c.step && s.type === 'mark')).map((c) => [c.step, c]));
  const opening = chapters.find((c) => !markChapters.has(c.step));
  out.push(
    '/**',
    ` * Guided replay of "${tour.slug}" — ${tour.stats.steps} step${tour.stats.steps === 1 ? '' : 's'} the reviewer showed${tour.finishedAt ? ` on ${tour.finishedAt.slice(0, 10)}` : ''}.`,
    ' * Generated from guided-tour.json: every step in order, idle time removed, steady holds.',
    ' * The planner optimises it into flow.mjs (drop detours, harden selectors, add say() captions);',
    ' * near() calls that carry a fallback box are copied across as they are — those targets have no',
    ' * lasting handle, so their pixels are the only thing that finds them again.',
    ...(matched
      ? []
      : [
          ` * Shown at ${tour.window?.w || '?'}×${tour.window?.h || '?'}, recorded at ${tour.recordViewport?.width}×${tour.recordViewport?.height}: positions are scaled guesses — show the tour again to replay it 1:1.`,
        ]),
    ' */',
    'export default async function flow(ctx) {',
    '  const { page, chapter, wait, settle, actions, typeInto, near, spot } = ctx;',
    "  await page.waitForLoadState('domcontentloaded').catch(() => {});"
  );
  const start = tour.steps.find((s) => s.type === 'start');
  if (start?.url && pathOf(start.url) !== pathOf(startUrl || '')) {
    say(`// The reviewer began on ${pathOf(start.url)}`);
    say(`await page.goto(${J(start.url)}, { waitUntil: 'domcontentloaded' });`);
    say('await settle(null, 1200);');
  }
  if (opening) say(`await chapter(${J(opening.title)}, '', ${CHAPTER_HOLD_MS});`);
  for (const s of tour.steps) {
    if (s.type === 'start') continue;
    if (s.type === 'mark') {
      const c = markChapters.get(s.id) || { title: s.title || 'Moment', note: s.note || '' };
      say('');
      say(`// —— ${c.title} ——`);
      say(`await chapter(${J(c.title)}, ${J(c.note || '')}, ${CHAPTER_HOLD_MS});`);
      continue;
    }
    say('');
    say(`// ${s.id} · ${describeStep(s).replace(/\*\//g, '* /')}${s.gap > ACTIVE_GAP_CAP_SEC ? ` (reviewer paused ${s.gap.toFixed(1)} s)` : ''}`);
    if (s.dialog) say(`page.once('dialog', (d) => d.accept().catch(() => {}));`);
    const t = targetFor(s.target, { matched, step: s.id, value: VALUE_STEPS.has(s.type) });
    const settleAfter = s.navigates ? 'await settle(null, 1200);' : null;
    const at = s.target?.rel && (s.target.canvas != null || (s.target.box?.w > 320 && s.target.box?.h > 160));
    const cap = J({ w: s.target?.box?.w || 0, h: s.target?.box?.h || 0 });
    const rel = J({ fx: s.target?.rel?.fx ?? 0.5, fy: s.target?.rel?.fy ?? 0.5 });
    const spotIn = `const box = await t.boundingBox(); const p = spot(box, ${cap}, ${rel});`;
    switch (s.type) {
      case 'click':
      case 'dblclick':
      case 'rightclick': {
        const method = s.type === 'dblclick' ? 'dblclick' : 'click';
        if (!t) break;
        const button = s.type === 'rightclick' ? ", button: 'right'" : '';
        if (at) say(`{ const t = ${t}; ${spotIn} await t.${method}({ position: { x: p.x, y: p.y }${button} }); }`);
        else say(`await (${t}).${method}(${button ? `{ ${button.slice(2)} }` : ''});`);
        say(settleAfter || `await wait(${s.focusOnly ? 400 : 900});`);
        break;
      }
      case 'fill':
        if (s.secret) {
          say('// A password went in here. Sign-in runs off camera before capture; never type secrets on camera.');
          break;
        }
        if (s.target?.tag === 'input' && (s.target.type === 'range' || s.target.type === 'color')) say(`await (${t}).fill(${J(String(s.value))});`);
        else say(`await typeInto(${t}, ${J(String(s.value))});`);
        say('await wait(600);');
        break;
      case 'select':
        say(`await (${t}).selectOption(${s.label ? `{ label: ${J(s.label.split(', ')[0])} }` : J(s.value)});`);
        say('await wait(800);');
        break;
      case 'check':
        say(`await (${t}).setChecked(${s.checked ? 'true' : 'false'});`);
        say('await wait(700);');
        break;
      case 'press': {
        const n = s.count || 1;
        say(n > 1 ? `for (let i = 0; i < ${n}; i++) await page.keyboard.press(${J(s.key)});` : `await page.keyboard.press(${J(s.key)});`);
        say(settleAfter || 'await wait(700);');
        break;
      }
      case 'hover':
        if (at) say(`{ const t = ${t}; ${spotIn} await t.hover({ position: { x: p.x, y: p.y } }); }`);
        else say(`await (${t}).hover();`);
        say(`await wait(${s.revealed ? 1300 : 1000});`);
        break;
      case 'scroll':
        if (s.target?.page) {
          say(`await page.evaluate((f) => { const el = document.scrollingElement || document.documentElement; el.scrollTo({ top: Math.round((el.scrollHeight - el.clientHeight) * f), behavior: 'smooth' }); }, ${s.fracY ?? 0});`);
        } else {
          say(`await (${t}).evaluate((el, f) => el.scrollTo({ top: Math.round((el.scrollHeight - el.clientHeight) * f.y), left: Math.round((el.scrollWidth - el.clientWidth) * f.x), behavior: 'smooth' }), { y: ${s.fracY ?? 0}, x: ${s.fracX ?? 0} });`);
        }
        say('await wait(1000);');
        break;
      case 'wheel': {
        say(`{ const t = ${t || "page.locator('body')"}; ${spotIn} await page.mouse.move(box.x + p.x, box.y + p.y);`);
        if (s.zoom) say("  await page.keyboard.down('Control');");
        say(`  await page.mouse.wheel(${s.dx || 0}, ${s.dy || 0});`);
        if (s.zoom) say("  await page.keyboard.up('Control');");
        say('}');
        say('await wait(900);');
        break;
      }
      case 'drag': {
        if (s.html5 && s.drop) {
          say(`await (${t}).dragTo(${targetFor(s.drop, { matched, step: `${s.id} drop` })});`);
          say('await wait(900);');
          break;
        }
        const pts = thinPath(s.path).slice(1).map(([, dx, dy]) => [dx, dy]);
        say('{');
        say(`  const t = ${t || "page.locator('body')"};`);
        say(`  ${spotIn}`);
        say('  const x = box.x + p.x;');
        say('  const y = box.y + p.y;');
        say('  await actions.hide();');
        say('  await page.mouse.move(x, y);');
        say('  await page.mouse.down();');
        say(`  for (const [dx, dy] of ${J(pts)}) await page.mouse.move(x + dx * p.k, y + dy * p.k, { steps: 3 });`);
        say('  await page.mouse.up();');
        say('  await actions.show();');
        say('}');
        say(settleAfter || 'await wait(1000);');
        break;
      }
      case 'goto':
        say(`await page.goto(${J(s.url)}, { waitUntil: 'domcontentloaded' });`);
        say('await settle(null, 1200);');
        break;
      case 'tab':
        say(`// A new tab opened at ${pathOf(s.url)} — the recorder follows the original page; open it with page.goto if the story needs it.`);
        break;
      case 'upload':
        say(`// TODO upload: the reviewer attached ${J((s.files || []).join(', '))} — add a fixture and use setInputFiles on ${loc}.`);
        break;
      default:
        say(`// ${s.type} is not replayed`);
    }
  }
  say('');
  say('await wait(1600);');
  out.push('}');
  return `${out.join('\n')}\n`;
}

/* ------------------------------------------------------------------ session */

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function readGuideStatus(video) {
  return readJson(guideFiles(video).status);
}

export function readGuidedTour(video) {
  return readJson(guideFiles(video).tour);
}

/** Ask a running guide session to save and close (Studio's Finish button). */
export function requestGuideFinish(video) {
  mkdirSync(guideDir(video), { recursive: true });
  writeFileSync(guideFiles(video).finish, new Date().toISOString());
}

export const GUIDE_CONTROLS = ['start', 'stop-countdown', 'pause', 'resume', 'mark', 'undo', 'finish', 'cancel'];

/** Press a Recorder button from Studio: the running session picks it up within a moment. */
export function requestGuideControl(video, action, extra = {}) {
  if (!GUIDE_CONTROLS.includes(action)) throw new Error(`Unknown guide control "${action}"`);
  mkdirSync(guideDir(video), { recursive: true });
  const title = typeof extra.title === 'string' ? extra.title.slice(0, 60) : undefined;
  appendFileSync(guideFiles(video).controls, JSON.stringify({ action, ...(title ? { title } : {}), at: new Date().toISOString() }) + '\n');
}

/** Merge the screens the reviewer visited into flow-analysis.json/.md (selectors for the planner). */
function mergeFlowAnalysis(video, reports, { runId, viewport }) {
  if (!reports.size) return;
  const file = join(video.dir, 'flow-analysis.json');
  const prior = readJson(file);
  const byPath = new Map((prior?.pages || []).map((p) => [p.path, p]));
  for (const p of reports.values()) byPath.set(p.path, p);
  const pages = [...byPath.values()].map((p, hop) => ({ ...p, hop }));
  const primary = pickPrimaryPage(pages) || pages[0];
  const report = {
    slug: video.slug,
    analyzedAt: new Date().toISOString(),
    url: primary.url,
    title: primary.title,
    viewport,
    deviceScaleFactor: Math.min(captureProfile(video.config).dpr, 2),
    device: describeCapture(captureProfile(video.config)),
    runId,
    explore: true,
    explorer: prior?.explorer === 'agent' ? 'agent+guided' : 'guided',
    signedIn: pages.some((p) => p.signedIn),
    pages: pages.map((p) => ({ hop: p.hop, url: p.url, path: p.path, title: p.title, via: p.via, signedIn: p.signedIn, dom: p.dom, frameworks: p.frameworks, canvases: p.canvases, hints: p.hints })),
    dom: primary.dom,
    frameworks: primary.frameworks || [],
    canvases: primary.canvases || [],
    hints: pageHintsAggregate(pages),
  };
  report.recommendations = buildRecommendations(report);
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(video.dir, 'flow-analysis.md'), analysisToMarkdown(report));
}

/** Display scale that fits the recording viewport (plus browser chrome) on this screen. */
export function viewportFit(viewport, { sw, sh, cw = 0, ch = 0 } = {}) {
  if (!sw || !sh) return 1;
  const s = Math.min(1, (sw - cw - 40) / viewport.width, (sh - ch - 40) / viewport.height);
  return Math.max(0.3, Math.floor(s * 1000) / 1000);
}

/** Where the app window and the Recorder window sit: the panel beside the app when it fits. */
export function sessionLayout(viewport, { sw, sh, cw = 0, ch = 0 } = {}, panel = PANEL) {
  const gap = 12;
  const scale = viewportFit(viewport, { sw: sw ? sw - panel.width - gap : sw, sh, cw, ch });
  const app = { left: 20, top: 20, width: Math.ceil(viewport.width * scale) + cw, height: Math.ceil(viewport.height * scale) + ch };
  const height = Math.min(panel.height, Math.max(420, (sh || panel.height + 40) - 40));
  const left = Math.min(app.left + app.width + gap, Math.max(0, (sw || 0) - panel.width - 10));
  return { scale, app, panel: { left: Math.max(0, left), top: 20, width: panel.width, height } };
}

const windowSize = () => {
  const m = String(process.env.WALKTHROUGH_GUIDE_WINDOW || '').match(/^(\d{3,4})x(\d{3,4})$/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1600, height: 960 };
};

const COUNTDOWN_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FALLBACK_BRAND = { colors: { gold: '#ffffff' }, font: { family: 'Inter' } };

/**
 * Open the reviewer's browser and the Recorder window. Nothing is recorded until Start recording;
 * after a countdown the app window is filmed (the reviewer's own take) while every step is
 * captured for the bot's replay. Pause cuts the stretch from both. Ends on Finish (Recorder or
 * Studio), when the app window closes, or at the time limit, and resolves with the saved tour.
 * `headless` exists for tests, which drive the page through `onOpen` (before the session is
 * ready) and `onReady` (with the Recorder page, to press its buttons).
 */
export async function runGuidedTour(
  video,
  { url = null, headless = false, countdownMs = COUNTDOWN_MS, onOpen = null, onReady = null, say = (m) => console.log(`» guide · ${m}`) } = {}
) {
  const files = guideFiles(video);
  const take = takeFiles(video);
  const startUrl = url || video.config.record?.startUrl || video.config.env?.appUrl;
  if (!startUrl) throw new Error('No start URL — set record.startUrl or pass --url');
  // The last session (and its take) stays aside until this one records something.
  const prevDir = `${guideDir(video)}.prev`;
  if (existsSync(take.take)) {
    rmSync(prevDir, { recursive: true, force: true });
    renameSync(guideDir(video), prevDir);
  } else rmSync(guideDir(video), { recursive: true, force: true });
  mkdirSync(files.shots, { recursive: true });
  const profile = captureProfile(video.config);
  const recordViewport = { width: profile.width, height: profile.height };
  const win = windowSize();
  const runId = Date.now().toString(36);

  const browser = await chromium.launch({
    headless,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist', `--window-size=${win.width},${win.height}`, '--window-position=20,20'],
  });
  const storage = existsSync(sessionFile(video)) ? sessionFile(video) : undefined;
  // The page always lays out at the recording viewport, so every captured box, point, duplicate
  // index and drag path replays 1:1 in the bot's take, and the reviewer's take is filmed at the
  // same size; a headed window shows it scaled to fit the screen. A phone or tablet profile also
  // brings its user agent, touch and mobile layout.
  const device = contextOptions(profile);
  const context = await browser.newContext(
    headless
      ? { ...device, storageState: storage }
      : { viewport: null, hasTouch: device.hasTouch, ...(device.userAgent ? { userAgent: device.userAgent } : {}), storageState: storage }
  );
  const fit = { scale: 1 };
  const emulate = async (p) => {
    if (headless) return;
    try {
      const cdp = await context.newCDPSession(p);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: recordViewport.width, height: recordViewport.height, deviceScaleFactor: 0, mobile: profile.mobile, scale: fit.scale });
      // A touch device reports a coarse pointer and touch support, so touch layouts appear. The
      // reviewer's mouse stays a mouse, as the take's clicks are: both meet the same handlers.
      if (profile.touch) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
      /* a page that closes before it is set up records nothing */
    }
  };
  let panel = null;
  const fitWindows = async (p) => {
    if (headless) return;
    try {
      const m = await p.evaluate(() => ({ sw: screen.availWidth, sh: screen.availHeight, cw: outerWidth - innerWidth, ch: outerHeight - innerHeight }));
      const layout = sessionLayout(recordViewport, m);
      fit.scale = layout.scale;
      // Studio asks before this point whenever possible; this is the backstop for CLI/API
      // launches that skip that pre-flight check.
      if (layout.scale < 0.999) {
        say(
          `heads up: ${recordViewport.width}×${recordViewport.height} is larger than this screen — the recording window will show at ${Math.round(layout.scale * 100)}%. A smaller recording size (Studio → Direction → Recording size) is easier to drive.`
        );
      }
      const cdp = await context.newCDPSession(p);
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: layout.app });
      await panel?.place(layout.panel);
    } catch {
      /* keep the launch size; emulation still pins the layout */
    }
    await emulate(p);
  };

  const t0 = Date.now();
  const raw = [];
  const shots = [];
  const reports = new Map();
  const st = { mode: 'connecting', seq: 0, started: false, signedIn: false, needsSignIn: false, capturedFrom: null, window: null, lastPage: null, finishReason: null, countdownEnds: 0, hold: null };
  let finished = null;
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));

  /* --- the reviewer's take: the app window filmed on the take clock (pauses cut) --- */
  const clock = createTakeClock();
  let recorder = null;
  let feed = null;
  let cast = null;
  let castChain = Promise.resolve();
  let poster = null;
  let lastFrame = null;
  let savedTake = null;
  const onFrame = (frame) => {
    feed?.onFrame(frame);
    if (!frame?.data || !clock.started || clock.paused) return;
    lastFrame = frame.data;
    if (!poster && frame.timestamp - clock.t0 > 900) poster = frame.data;
  };
  /** Film whichever tab the reviewer is acting in. */
  const castOn = (p) => {
    castChain = castChain.then(async () => {
      if (!recorder || !p || p.isClosed() || cast === p || finished) return;
      const prev = cast;
      cast = p;
      if (prev && !prev.isClosed()) await prev.screencast.stop().catch(() => {});
      await p.screencast.start({ size: recordViewport, quality: 100, onFrame }).catch((err) => say(`filming this tab failed: ${err.message.split('\n')[0]}`));
    });
    return castChain;
  };
  const activePage = () => (st.lastPage && !st.lastPage.isClosed() ? st.lastPage : context.pages().filter((p) => !p.isClosed()).at(-1));

  const summary = () => normalizeGuideEvents(raw, { shots });
  const recSec = () => (clock.started ? clock.toTake(Date.now()) / 1000 : 0);
  const writeStatus = () => {
    const n = summary();
    const last = [...n.steps].reverse().find((s) => s.type !== 'start' && s.type !== 'mark');
    const cuts = clock.cuts();
    const status = {
      state: st.mode,
      steps: n.stats.steps,
      marks: n.stats.marks,
      last: last ? describeStep(last) : '',
      url: st.lastPage?.url?.() || startUrl,
      needsSignIn: st.needsSignIn,
      recording: clock.started,
      recSec: Number(recSec().toFixed(1)),
      countdownMs: st.mode === 'countdown' ? Math.max(0, st.countdownEnds - Date.now()) : 0,
      cuts: cuts.length + (clock.paused ? 1 : 0),
      cutSec: Number(((clock.pausedMs || 0) / 1000).toFixed(1)),
      take: savedTake,
      startedAt: new Date(t0).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      writeFileSync(files.status, JSON.stringify(status, null, 2));
    } catch {
      /* status is advisory */
    }
    return status;
  };
  let host = '';
  try {
    host = new URL(startUrl).host;
  } catch {
    /* a relative start URL has no host to show */
  }
  const broadcast = async (flash = '') => {
    const s = writeStatus();
    const hold = st.hold && st.hold.until > Date.now() ? st.hold : null;
    await panel?.update({ ...s, mode: st.mode, host, flash, holdMs: hold ? hold.until - Date.now() : 0, holdTotalMs: CHAPTER_HOLD_MS, holdWhat: hold?.what || '' });
  };
  const record = (e) => {
    const ev = { ...e, seq: ++st.seq, at: (e.wall || Date.now()) - t0 };
    raw.push(ev);
    try {
      appendFileSync(files.events, JSON.stringify(ev) + '\n');
    } catch {
      /* the in-memory copy is authoritative */
    }
    return ev;
  };

  let shotTimer = null;
  const scheduleShot = () => {
    clearTimeout(shotTimer);
    shotTimer = setTimeout(async () => {
      const p = st.lastPage;
      if (!p || p.isClosed() || st.mode === 'finishing') return;
      const seq = st.seq;
      const file = `shots/${String(shots.length + 1).padStart(3, '0')}.jpg`;
      try {
        await p.screenshot({ path: join(guideDir(video), file), type: 'jpeg', quality: 55, timeout: 4000 });
        shots.push({ seq, file });
      } catch {
        /* a missed shot must not stop the tour */
      }
    }, 700);
  };
  let inventory = Promise.resolve();
  const scheduleInventory = (p) => {
    const path = pathOf(p.url());
    if (reports.has(path)) return;
    reports.set(path, null);
    setTimeout(() => {
      inventory = inventory.then(async () => {
        if (p.isClosed() || st.mode === 'finishing') return;
        try {
          const rep = await capturePageReport(p, video, { runId, probeForms: false, probeCanvasesFull: false });
          reports.set(path, { ...rep, via: 'guided', signedIn: st.signedIn });
        } catch {
          reports.delete(path);
        }
      });
    }, 1800);
  };

  /** Stop filming and keep the take when it has something to show. */
  const saveTake = async (tour, endedAt) => {
    if (!recorder) return null;
    await castChain.catch(() => {});
    if (cast && !cast.isClosed()) await cast.screencast.stop().catch(() => {});
    let cap = null;
    try {
      cap = await recorder.finish(clock.epoch(endedAt));
    } catch (err) {
      recorder.kill();
      say(`the recording could not be saved: ${err.message.split('\n')[0]}`);
    }
    if (!cap || cap.seconds < 1) {
      rmSync(take.recording, { force: true });
      return null;
    }
    renameSync(take.recording, take.take);
    if (poster || lastFrame) writeFileSync(take.poster, poster || lastFrame);
    const timeline = takeTimeline(tour, { clock, tourT0: t0, seconds: cap.seconds });
    const meta = {
      slug: video.slug,
      seconds: Number(cap.seconds.toFixed(3)),
      frames: cap.frames,
      capture: cap.capture,
      cuts: clock.cuts(),
      viewport: recordViewport,
      profile,
      startUrl,
      capturedFrom: st.capturedFrom,
      recordedAt: new Date(clock.t0).toISOString(),
      tourFinishedAt: tour.finishedAt,
      timeline,
    };
    writeFileSync(take.meta, JSON.stringify(meta, null, 2) + '\n');
    return { seconds: meta.seconds, cuts: meta.cuts.length, cutSec: Number(meta.cuts.reduce((a, c) => a + c.dur, 0).toFixed(1)), chapters: timeline.filter((m) => m.kind === 'chapter').length, file: 'guide/take.mp4' };
  };

  const finish = (reason) => {
    if (finished) return finished;
    st.finishReason = reason;
    finished = (async () => {
      clearTimeout(shotTimer);
      const prevMode = st.mode;
      const endedAt = Date.now();
      st.mode = 'finishing';
      say(`saving (${reason})`);
      await broadcast().catch(() => {});
      await Promise.all(context.pages().map((p) => p.evaluate(() => window.__wtGuideFlush?.()).catch(() => {})));
      await sleep(400);
      await Promise.race([inventory, sleep(4000)]);
      if (st.started || (prevMode === 'ready' && !st.needsSignIn)) await context.storageState({ path: sessionFile(video) }).catch(() => {});
      const n = summary();
      const tour = {
        version: 1,
        slug: video.slug,
        startUrl,
        capturedFrom: st.capturedFrom,
        signedIn: st.signedIn,
        startedAt: new Date(t0).toISOString(),
        finishedAt: new Date().toISOString(),
        finishReason: reason,
        window: st.window,
        recordViewport,
        capture: { id: profile.id, label: profile.label, dpr: profile.dpr, mobile: profile.mobile, touch: profile.touch },
        stats: n.stats,
        steps: n.steps,
        removed: n.removed,
        shotsDir: `${video.slug}/guide/shots`,
      };
      savedTake = await saveTake(tour, endedAt);
      if (savedTake) tour.take = savedTake;
      if (n.stats.steps || savedTake) {
        writeFileSync(files.tour, JSON.stringify(tour, null, 2) + '\n');
        writeFileSync(files.md, tourToMarkdown(tour));
      }
      if (!n.stats.steps && savedTake) rmSync(files.flow, { force: true });
      if (n.stats.steps) {
        writeFileSync(files.flow, compileGuidedFlow(tour, { startUrl }));
        const ready = new Map([...reports].filter(([, v]) => v));
        try {
          mergeFlowAnalysis(video, ready, { runId, viewport: recordViewport });
        } catch (err) {
          say(`screen map skipped: ${err.message}`);
        }
      }
      st.mode = 'done';
      await broadcast().catch(() => {});
      if (!headless && (n.stats.steps || savedTake)) await sleep(1600);
      await panel?.close();
      await browser.close().catch(() => {});
      resolveDone(tour);
      return tour;
    })();
    return finished;
  };

  const beginCapture = async (p) => {
    const title = await p.title().catch(() => '');
    st.started = true;
    st.mode = 'capturing';
    st.lastPage = p;
    st.capturedFrom = p.url();
    const wall = clock.t0 || Date.now();
    record({ type: 'start', url: st.capturedFrom, wall });
    if (title) record({ type: 'title', url: st.capturedFrom, title, wall });
    scheduleShot();
    scheduleInventory(p);
  };

  /** Start recording: the countdown, then filming and step capture from the same instant. */
  const startRecording = async () => {
    if (st.mode !== 'ready' || finished) return;
    if (st.needsSignIn) {
      await context.storageState({ path: sessionFile(video) }).catch(() => {});
      st.signedIn = true;
    }
    st.mode = 'countdown';
    st.countdownEnds = Date.now() + countdownMs;
    say(countdownMs ? `recording in ${Math.round(countdownMs / 1000)} s` : 'recording');
    await broadcast();
    while (st.mode === 'countdown' && Date.now() < st.countdownEnds && !finished) await sleep(Math.min(250, st.countdownEnds - Date.now()));
    if (st.mode !== 'countdown' || finished) return;
    const p = activePage();
    recorder = startFrameRecorder(take.recording, recordViewport);
    feed = createTakeFeed(recorder, clock);
    const now = Date.now();
    clock.begin(now);
    recorder.begin(now);
    await castOn(p);
    await beginCapture(p);
    st.hold = { until: now + CHAPTER_HOLD_MS, what: 'Opening card on screen' };
    say(`recording from ${pathOf(p.url())} — Pause, Mark chapter and Finish are in the Recorder window`);
    await broadcast();
  };

  /** Typing is kept as the field's final value; land it before a pause or chapter starts. */
  const flushPages = async () => {
    await Promise.all(context.pages().map((p) => p.evaluate(() => window.__wtGuideFlush?.()).catch(() => {})));
    await sleep(120);
  };

  /** One entry point for the Recorder window, Studio (control file) and tests. */
  const control = async (action, extra = {}) => {
    if (finished) return;
    if (st.mode === 'capturing' && (action === 'pause' || action === 'mark')) await flushPages();
    const wall = Date.now();
    switch (action) {
      case 'start':
        return void (await startRecording());
      case 'stop-countdown':
        if (st.mode !== 'countdown') return;
        st.mode = 'ready';
        say('countdown stopped');
        return void (await broadcast());
      case 'cancel':
        if (st.started) return;
        return void finish('cancelled');
      case 'finish':
        return void finish(st.started ? 'finished' : 'cancelled');
      case 'pause':
        if (st.mode !== 'capturing') return;
        feed?.pause(wall);
        record({ type: 'pause', wall });
        st.mode = 'paused';
        st.hold = null;
        say('paused — this stretch is cut');
        return void (await broadcast());
      case 'resume':
        if (st.mode !== 'paused') return;
        feed?.resume(wall);
        record({ type: 'resume', wall });
        st.mode = 'capturing';
        say('recording again');
        return void (await broadcast(`Recording again — the pause is cut`));
      case 'undo': {
        if (st.mode !== 'capturing' && st.mode !== 'paused') return;
        const last = [...summary().steps].reverse().find((s) => s.type !== 'start');
        if (!last) return;
        record({ type: 'undo', wall });
        say(`undid ${describeStep(last)}`);
        return void (await broadcast(`Removed from the steps: ${describeStep(last)}. Your recording still shows it — the bot re-record skips it.`));
      }
      case 'mark': {
        if (st.mode !== 'capturing') return;
        const title = String(extra.title || '').slice(0, 60);
        record({ type: 'mark', title, wall, url: st.lastPage?.url?.() });
        st.hold = { until: wall + CHAPTER_HOLD_MS, what: title ? `“${title}” card on screen` : 'Chapter card on screen' };
        say(`chapter ${title ? `“${title}”` : 'marked'}`);
        return void (await broadcast(title ? `Chapter: ${title}` : 'Chapter marked'));
      }
      default:
    }
  };
  panel = await openRecorderPanel(browser, { headless, onAction: (a, x) => void control(a, x), say });

  await context.exposeBinding('__wtGuideEmit', async ({ page }, e) => {
    if (!e || finished || e.type === 'control') return;
    if (st.mode !== 'capturing') return; // before recording, sign-in and paused stretches are never stored
    st.lastPage = page;
    void castOn(page);
    record(e);
    say(describeStep({ ...e, id: '' }));
    scheduleShot();
    void broadcast();
  });
  await context.addInitScript(installGuideRecorder);

  const lastNav = new WeakMap();
  const adopt = (p) => {
    p.on('framenavigated', (frame) => {
      if (frame !== p.mainFrame() || finished) return;
      const u = frame.url();
      if (!/^https?:/.test(u) || lastNav.get(p) === u) return;
      lastNav.set(p, u);
      if (st.mode !== 'capturing') return;
      st.lastPage = p;
      record({ type: 'nav', url: u });
      scheduleShot();
      scheduleInventory(p);
      p.waitForLoadState('domcontentloaded', { timeout: 15000 })
        .then(() => p.title())
        .then((title) => title && record({ type: 'title', url: u, title }))
        .catch(() => {});
    });
    p.on('dialog', (d) => {
      if (st.mode === 'capturing') record({ type: 'dialog', kind: d.type(), message: d.message().slice(0, 200) });
      d.accept().catch(() => {});
    });
    p.on('close', () => {
      if (finished) return;
      const open = context.pages().filter((x) => !x.isClosed());
      if (!open.length) return void finish('window closed');
      if (st.lastPage === p) st.lastPage = open.at(-1);
      if (cast === p) void castOn(st.lastPage);
    });
  };
  context.on('page', (p) => {
    adopt(p);
    void emulate(p);
    if (st.mode === 'capturing' && context.pages().length > 1) {
      record({ type: 'tab', url: p.url() });
      st.lastPage = p;
      void castOn(p);
    }
  });
  browser.on('disconnected', () => void finish('browser closed'));

  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  // A screencast paints no OS pointer: the take shows the presentation cursor where the mouse is.
  await createCursor({
    context,
    page,
    brand: video.brand?.colors && video.brand?.font ? video.brand : FALLBACK_BRAND,
    wait: sleep,
    viewport: recordViewport,
    settings: profile.touch ? { style: 'dot', hand: false, glide: false } : { style: 'arrow', hand: false, glide: false, size: video.brand?.direction?.cursor?.size },
  });
  await fitWindows(page);
  say(`opening ${startUrl}`);
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((err) => say(`start page slow: ${err.message.split('\n')[0]}`));
  if (onOpen) await onOpen({ page, state: st });
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
  st.window = await page.evaluate(() => ({ w: innerWidth, h: innerHeight })).catch(() => null);
  if (st.window && fit.scale < 1) st.window.scale = Number(fit.scale.toFixed(3));
  const auth = await ensureSignedInOffCamera(page, context, video, { say }).catch(() => ({ needsPerson: false, signedIn: false }));
  st.signedIn = Boolean(auth.signedIn);
  st.needsSignIn = Boolean(auth.needsPerson);
  if (!finished) st.mode = 'ready';
  say(st.needsSignIn ? 'sign in in the browser window, then press Start recording in the Recorder window' : 'ready — go to the first screen, then press Start recording in the Recorder window');
  await broadcast();

  const controlsAt = { offset: 0 };
  const poll = setInterval(() => {
    if (existsSync(files.finish)) return void finish('finished in Studio');
    if (Date.now() - t0 > MAX_MS) return void finish('time limit');
    if (st.hold && st.hold.until <= Date.now()) {
      st.hold = null;
      void broadcast();
    }
    for (const c of readControls(files.controls, controlsAt)) void control(c.action, c);
  }, 300);
  const onSignal = () => void finish('stopped');
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  if (onReady) {
    Promise.resolve(onReady({ page, context, controls: panel.page(), control, finish, state: st })).catch((err) => say(`test driver: ${err.message}`));
  }
  const tour = await done;
  clearInterval(poll);
  process.off('SIGTERM', onSignal);
  process.off('SIGINT', onSignal);
  if (!tour.take && !tour.stats.steps && existsSync(prevDir)) {
    rmSync(guideDir(video), { recursive: true, force: true });
    renameSync(prevDir, guideDir(video));
  } else rmSync(prevDir, { recursive: true, force: true });
  return tour;
}

/** New lines of guide/controls.jsonl since the last read. */
function readControls(file, at) {
  if (!existsSync(file)) return [];
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  if (text.length <= at.offset) return [];
  const fresh = text.slice(at.offset);
  const end = fresh.lastIndexOf('\n');
  if (end < 0) return [];
  at.offset += end + 1;
  return fresh
    .slice(0, end)
    .split('\n')
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((c) => c?.action);
}

/**
 * Contextual help: any element with `data-help="…"` gets a small info button. One shared tooltip
 * shows the text on hover or keyboard focus; a click pins it until Escape, a click outside, a
 * resize or a scroll. The text lives in the markup next to the control it explains.
 *
 * Studio guide (`#helpDialog`): section jump nav, stage shortcuts into the stage bar, and
 * platform-aware modifier glyphs on `[data-mod]` keycaps.
 */
const $ = (id) => document.getElementById(id);

let pop = null;
let current = null;
let pinned = false;
let showTimer = 0;
let hideTimer = 0;

function ensurePop() {
  if (pop) return pop;
  pop = document.createElement('div');
  pop.id = 'helpPop';
  pop.className = 'help-pop';
  pop.setAttribute('role', 'tooltip');
  pop.hidden = true;
  document.body.appendChild(pop);
  pop.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  pop.addEventListener('pointerleave', () => !pinned && scheduleHide());
  return pop;
}

function place(btn) {
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const gap = 8;
  const below = r.bottom + gap + h <= window.innerHeight - 8;
  const top = below ? r.bottom + gap : r.top - gap - h;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  pop.style.top = `${Math.round(top)}px`;
  pop.style.left = `${Math.round(left)}px`;
  pop.dataset.side = below ? 'below' : 'above';
  pop.style.setProperty('--arrow-x', `${Math.round(r.left + r.width / 2 - left)}px`);
}

function show(btn, { pin = false } = {}) {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  ensurePop();
  if (current && current !== btn) current.setAttribute('aria-expanded', 'false');
  current = btn;
  pinned = pin;
  pop.textContent = btn.__helpText;
  pop.hidden = false;
  pop.classList.remove('is-in');
  place(btn);
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-describedby', 'helpPop');
  requestAnimationFrame(() => pop.classList.add('is-in'));
}

function hide() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  pop.classList.remove('is-in');
  pinned = false;
  if (current) {
    current.setAttribute('aria-expanded', 'false');
    current.removeAttribute('aria-describedby');
  }
  current = null;
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, 140);
}

function labelOf(el) {
  const text = (el.textContent || '').trim();
  return text ? `About ${text}` : 'More about this';
}

function attach(el) {
  if (el.__help) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'help-tip';
  btn.setAttribute('aria-label', labelOf(el));
  btn.setAttribute('aria-expanded', 'false');
  btn.textContent = 'i';
  btn.__helpText = el.dataset.help;
  el.__help = btn;
  el.classList.add('has-help');
  el.appendChild(btn);

  btn.addEventListener('pointerenter', () => {
    if (pinned) return;
    clearTimeout(hideTimer);
    showTimer = setTimeout(() => show(btn), current ? 0 : 220);
  });
  btn.addEventListener('pointerleave', () => {
    clearTimeout(showTimer);
    if (!pinned) scheduleHide();
  });
  btn.addEventListener('focus', () => {
    if (btn.matches(':focus-visible')) show(btn);
  });
  btn.addEventListener('blur', () => !pinned && scheduleHide());
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (current === btn && pinned) hide();
    else show(btn, { pin: true });
  });
}

/** Modifier glyph for shortcut keycaps — ⌘ on Apple, Ctrl elsewhere. */
export function modKeyGlyph(platform = typeof navigator !== 'undefined' ? navigator.platform || '' : '') {
  return /Mac|iPhone|iPad|Macintosh/i.test(platform) ? '⌘' : 'Ctrl';
}

/** Paint every `[data-mod]` keycap inside `root` with the host platform's modifier. */
export function paintGuideMods(root = document, platform) {
  const mod = modKeyGlyph(platform ?? (typeof navigator !== 'undefined' ? navigator.platform || '' : ''));
  root.querySelectorAll('[data-mod]').forEach((el) => {
    el.textContent = mod;
  });
  return mod;
}

const GUIDE_SECTIONS = ['guideHow', 'guideDesk', 'guideWords', 'guideKeys'];
let guideJumpLock = 0;

function setGuideNavActive(id) {
  const nav = $('guideNav');
  if (!nav) return;
  nav.querySelectorAll('[data-guide-jump]').forEach((btn) => {
    const on = btn.dataset.guideJump === id;
    btn.classList.toggle('is-active', on);
    if (on) btn.setAttribute('aria-current', 'true');
    else btn.removeAttribute('aria-current');
  });
}

function jumpGuideSection(id) {
  const body = $('guideBody');
  const el = $(id);
  if (!body || !el) return;
  setGuideNavActive(id);
  // Instant jump keeps the nav and scroll position in lockstep (smooth scroll
  // was undershooting and letting scroll-spy flip the active section).
  if (guideJumpLock) clearTimeout(guideJumpLock);
  guideJumpLock = setTimeout(() => {
    guideJumpLock = 0;
  }, 320);
  // offsetTop is relative to the dialog (form uses display:contents), not #guideBody.
  const top = () => Math.max(0, el.offsetTop - body.offsetTop - 6);
  const apply = () => {
    body.scrollTop = top();
  };
  apply();
  // The dialog's open transition can reset child scrollTop — re-apply after it.
  requestAnimationFrame(apply);
  setTimeout(apply, 240);
}

function openGuideStage(stage) {
  const dialog = $('helpDialog');
  if (dialog?.open) dialog.close();
  // Defer so the dialog teardown finishes before another sheet opens.
  requestAnimationFrame(() => {
    document.querySelector(`#stageBar .pstage[data-stage="${stage}"]`)?.click();
  });
}

function syncGuideNavFromScroll() {
  if (guideJumpLock) return;
  const body = $('guideBody');
  if (!body) return;
  // Bias toward the upper third so a jumped section stays selected while its
  // heading sits at the top; pin the last section when scrolled to the end.
  if (body.scrollTop + body.clientHeight >= body.scrollHeight - 12) {
    setGuideNavActive(GUIDE_SECTIONS[GUIDE_SECTIONS.length - 1]);
    return;
  }
  const origin = body.offsetTop;
  const top = body.scrollTop + Math.min(72, body.clientHeight * 0.28);
  let active = GUIDE_SECTIONS[0];
  for (const id of GUIDE_SECTIONS) {
    const el = $(id);
    if (!el) continue;
    if (el.offsetTop - origin <= top) active = id;
  }
  setGuideNavActive(active);
}

function initStudioGuide() {
  if (initStudioGuide.wired) return;
  const dialog = $('helpDialog');
  if (!dialog) return;
  initStudioGuide.wired = true;

  paintGuideMods(dialog);

  const nav = $('guideNav');
  // Keep the jump button from taking focus — browsers scroll ancestors to
  // reveal the focused control and would undo body.scrollTop.
  nav?.addEventListener('mousedown', (e) => {
    if (e.target.closest('[data-guide-jump]')) e.preventDefault();
  });
  nav?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-guide-jump]');
    if (!btn) return;
    e.preventDefault();
    jumpGuideSection(btn.dataset.guideJump);
  });

  dialog.querySelectorAll('[data-guide-stage]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openGuideStage(btn.dataset.guideStage);
    });
  });

  const body = $('guideBody');
  body?.addEventListener('scroll', () => {
    if (body.__guideNavRaf) return;
    body.__guideNavRaf = requestAnimationFrame(() => {
      body.__guideNavRaf = 0;
      syncGuideNavFromScroll();
    });
  }, { passive: true });

  dialog.addEventListener('close', () => {
    hide();
    clearTimeout(guideJumpLock);
    guideJumpLock = 0;
    if (body) body.scrollTop = 0;
    setGuideNavActive(GUIDE_SECTIONS[0]);
  });
}

export function initHelp(root = document) {
  root.querySelectorAll('[data-help]').forEach(attach);
  if (initHelp.wired) {
    initStudioGuide();
    return;
  }
  initHelp.wired = true;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pop && !pop.hidden) {
      const btn = current;
      hide();
      btn?.focus();
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
  document.addEventListener('pointerdown', (e) => {
    if (!pinned) return;
    if (e.target === current || pop?.contains(e.target)) return;
    hide();
  });
  window.addEventListener('resize', hide);
  document.addEventListener('scroll', (e) => {
    if (pop && !pop.contains(e.target)) hide();
  }, true);
  initStudioGuide();
}

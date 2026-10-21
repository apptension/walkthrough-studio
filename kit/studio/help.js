/**
 * Contextual help: any element with `data-help="…"` gets a small info button. One shared tooltip
 * shows the text on hover or keyboard focus; a click pins it until Escape, a click outside, a
 * resize or a scroll. The text lives in the markup next to the control it explains.
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

export function initHelp(root = document) {
  root.querySelectorAll('[data-help]').forEach(attach);
  if (initHelp.wired) return;
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
  $('helpDialog')?.addEventListener('close', hide);
}

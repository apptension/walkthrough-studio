/**
 * Empty states ("zen" moments): one quiet illustration, a big line, a small one.
 *
 * Every panel that can be empty draws from the same kit so the quiet moments
 * feel like one product. Art lives in icons/zen/*.svg; section icons in icons/ui.
 */

import { ZEN_ART, SEC_ICONS, mountIcons } from './icons.js';

export { ZEN_ART, SEC_ICONS };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Build one empty state.
 * @param {keyof typeof ZEN_ART} art
 * @param {string} title big line
 * @param {string} [sub] small line (may carry inline HTML when `html` is true)
 * @param {{ mini?: boolean, html?: boolean, action?: string, cls?: string, id?: string, hidden?: boolean }} [opts]
 */
export function zen(art, title, sub = '', opts = {}) {
  const body = opts.html ? sub : esc(sub);
  const attrs = `${opts.id ? ` id="${esc(opts.id)}"` : ''}${opts.hidden ? ' hidden' : ''}`;
  return `<div class="zen${opts.mini ? ' mini' : ''}${opts.cls ? ` ${opts.cls}` : ''}"${attrs} data-zen="${esc(art)}">${ZEN_ART[art] || ''}<div class="zen-copy"><strong class="zen-title">${esc(title)}</strong>${sub ? `<p class="zen-sub">${body}</p>` : ''}</div>${opts.action || ''}</div>`;
}

/** Prepend a section icon to every `[data-ico]` label (idempotent). */
export function mountSectionIcons(root = document) {
  root.querySelectorAll('[data-ico]').forEach((el) => {
    if (el.querySelector(':scope > .sec-ico')) return;
    const svg = SEC_ICONS[el.dataset.ico];
    if (svg) el.insertAdjacentHTML('afterbegin', svg);
  });
}

/** Fill `.zen-slot[data-art]` hosts (the idle art inside activity cards). */
export function mountZenSlots(root = document) {
  root.querySelectorAll('.zen-slot[data-art]').forEach((el) => {
    if (!el.firstElementChild) el.innerHTML = ZEN_ART[el.dataset.art] || '';
  });
}

/** Upgrade static `<div data-zen="art" data-title="…" data-sub="…">` placeholders in the page. */
export function mountZen(root = document) {
  mountIcons(root);
  mountSectionIcons(root);
  mountZenSlots(root);
  root.querySelectorAll('[data-zen][data-title]').forEach((el) => {
    el.outerHTML = zen(el.dataset.zen, el.dataset.title, el.dataset.sub || '', {
      mini: el.hasAttribute('data-mini'),
      cls: el.className || '',
      action: el.innerHTML.trim(),
      id: el.id || '',
      hidden: el.hidden,
    });
  });
}

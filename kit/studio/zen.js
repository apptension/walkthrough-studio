/**
 * Empty states ("zen" moments): one quiet illustration, a big line, a small one.
 *
 * Every panel that can be empty draws from the same kit so the quiet moments
 * feel like one product. The art is stroke-only SVG in currentColor, so it
 * inherits the muted ink and stays greyed out; small idle animations live in
 * styles.css under `.zen`.
 */

const SVG = (body) =>
  `<svg class="zen-art" viewBox="0 0 96 64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ZEN_ART = {
  /** Nothing is running: a tumbleweed drifting over a dotted horizon. */
  tumbleweed: SVG(
    `<path class="z-ground" d="M4 55h88" stroke-dasharray="2 6"/>
     <g class="z-weed">
       <circle cx="48" cy="38" r="14"/>
       <path d="M38 29c7 3 13 11 10 19M58 29c-7 3-13 11-10 19M35 42c8-7 18-7 26 0M41 25c3 9 3 17-1 26M55 25c-3 9-3 17 1 26M34 36h28" opacity=".65"/>
     </g>
     <g class="z-dust">
       <circle cx="24" cy="51" r="1.1" fill="currentColor" stroke="none"/>
       <circle cx="18" cy="47" r=".8" fill="currentColor" stroke="none"/>
       <circle cx="29" cy="46" r=".7" fill="currentColor" stroke="none"/>
     </g>`
  ),
  /** The agent is idle: a little bot asleep with floating z's. */
  sleep: SVG(
    `<rect x="30" y="26" width="36" height="26" rx="8"/>
     <path d="M39 39h7M50 39h7"/>
     <path d="M48 26v-6"/><circle cx="48" cy="17" r="2.2"/>
     <path d="M40 52v4M56 52v4"/>
     <g class="z-zz" fill="currentColor" stroke="none" font-family="Plus Jakarta Sans, system-ui, sans-serif" font-weight="800">
       <text x="68" y="30" font-size="8">z</text>
       <text x="74" y="22" font-size="10">z</text>
       <text x="82" y="13" font-size="12">z</text>
     </g>`
  ),
  /** No versions: a clapperboard with a lazy flap. */
  clapper: SVG(
    `<rect x="22" y="29" width="52" height="25" rx="4"/>
     <path d="M30 41h14M30 47h22" opacity=".55"/>
     <g class="z-flap">
       <path d="M22 29h52l-4-11H18z"/>
       <path d="M31 18l5 11M44 18l5 11M57 18l5 11" opacity=".7"/>
     </g>`
  ),
  /** No poster: a framed landscape, sun gently rising. */
  frame: SVG(
    `<rect x="18" y="14" width="60" height="40" rx="5"/>
     <path d="M18 48l16-14 12 10 8-6 24 14" />
     <circle class="z-sun" cx="62" cy="27" r="5"/>`
  ),
  /** Nothing to review yet: a loupe that sways. */
  loupe: SVG(
    `<g class="z-loupe">
       <circle cx="44" cy="30" r="15"/>
       <path d="M55 41l16 16"/>
       <path d="M36 27a9 9 0 0 1 8-6" opacity=".55"/>
     </g>`
  ),
  /** No checks yet: a short checklist, boxes ticking themselves. */
  checklist: SVG(
    `<rect x="24" y="12" width="48" height="42" rx="6"/>
     <g class="z-tick"><rect x="31" y="20" width="8" height="8" rx="2"/><path d="M33 24l2 2 4-4"/></g>
     <g class="z-tick"><rect x="31" y="32" width="8" height="8" rx="2"/><path d="M33 36l2 2 4-4"/></g>
     <g class="z-tick"><rect x="31" y="44" width="8" height="8" rx="2"/><path d="M33 48l2 2 4-4"/></g>
     <path d="M44 24h20M44 36h16M44 48h12" opacity=".55"/>`
  ),
  /** No handoff pack: an open box, lid ajar. */
  box: SVG(
    `<path d="M24 30h48v24H24z"/>
     <g class="z-lid"><path d="M24 30l-6-10h60l-6 10"/></g>
     <path d="M48 30v24M40 42h16" opacity=".55"/>`
  ),
  /** Nothing selected: a pointer tapping a clip. */
  pointer: SVG(
    `<rect x="16" y="22" width="48" height="20" rx="5"/>
     <path d="M26 22v20M36 22v20M46 22v20" opacity=".45"/>
     <g class="z-pointer"><path d="M56 30l16 7-7 2-2 7z" fill="currentColor" fill-opacity=".18"/></g>`
  ),
  /** No chapters yet: a strip of film. */
  film: SVG(
    `<rect x="16" y="20" width="64" height="24" rx="4"/>
     <path d="M16 26h64M16 38h64" opacity=".5"/>
     <path d="M24 20v6M34 20v6M44 20v6M54 20v6M64 20v6M74 20v6M24 38v6M34 38v6M44 38v6M54 38v6M64 38v6M74 38v6" opacity=".5"/>
     <g class="z-reel"><circle cx="48" cy="32" r="3"/></g>`
  ),
  /** Queue is clear: three quiet dashes. */
  dashes: SVG(
    `<g class="z-dash"><path d="M28 24h40" opacity=".3"/><path d="M28 32h28" opacity=".5"/><path d="M28 40h34" opacity=".3"/></g>`
  ),
};

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

const ICO = (body) =>
  `<svg class="sec-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Section icons for panel labels — same weight and size as the Editor inspector headers. */
export const SEC_ICONS = {
  pipeline: ICO('<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="18" cy="18" r="2"/>'),
  activity: ICO('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  queue: ICO('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
  poster: ICO('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>'),
  film: ICO('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 10h4M3 14h4M17 10h4M17 14h4"/>'),
  note: ICO('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  target: ICO('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  plates: ICO('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h6"/>'),
  story: ICO('<path d="M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14"/><path d="M4 19a2 2 0 0 0 2 2h14"/><path d="M8 7h8M8 11h5"/>'),
  loupe: ICO('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  check: ICO('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
  chapters: ICO('<path d="M6 4h12a1 1 0 0 1 1 1v16l-7-4-7 4V5a1 1 0 0 1 1-1z"/>'),
  box: ICO('<path d="M21 8l-9-4-9 4 9 4z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/>'),
  formats: ICO('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>'),
  palette: ICO('<path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1.1.9-2 2-2h2.4A4.6 4.6 0 0 0 21 10c0-3.9-4-7-9-7z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="11" cy="7.5" r="1"/><circle cx="16" cy="8" r="1"/>'),
  logo: ICO('<circle cx="12" cy="12" r="9"/><path d="M8 15l4-7 4 7"/><path d="M9.5 12.5h5"/>'),
  focus: ICO('<circle cx="12" cy="12" r="3"/><path d="M3 9V5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M9 21H5a2 2 0 0 1-2-2v-4"/>'),
  pace: ICO('<path d="M12 12l4-4"/><path d="M4 14a8 8 0 1 1 16 0"/><path d="M4 14h2M18 14h2"/>'),
  camera: ICO('<path d="M15 10l5-3v10l-5-3"/><rect x="3" y="6" width="12" height="12" rx="2"/>'),
  motion: ICO('<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/><path d="M3 6v12" opacity=".5"/>'),
};

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

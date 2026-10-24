/** Shared "water" for the neon fill. Rendered by `NeonFx` and by string templates via `neonFxHtml()`. */

export interface NeonBlob {
  w: number;
  h: number;
  top: number;
  dur: number;
  delay: number;
  busy: number;
  color: string;
}

export const NEON_BLOBS: NeonBlob[] = [
  { w: 34, h: 130, top: -35, dur: 5.5, delay: 0, busy: 0, color: 'rgb(255 255 214 / 0.95)' },
  { w: 27, h: 110, top: 17, dur: 7, delay: -2.5, busy: -0.4, color: 'rgb(226 255 170 / 0.85)' },
  { w: 38, h: 148, top: -13, dur: 8.5, delay: -5, busy: -0.8, color: 'rgb(214 255 228 / 0.75)' },
];

export const NEON_SPARKS = Array.from({ length: 14 }, (_, i) => ({
  left: (37 * i) % 100,
  top: 18 + ((53 * i) % 64),
  dur: 1.6 + (i % 5) * 0.35,
  delay: (0.29 * i) % 2,
}));

/** Buttons whose fill is the brand gradient. Segment chips and progress bars are not in this set. */
export const NEON_FILL_SELECTOR = [
  '.btn.primary',
  '.render-cta.primary',
  '.ed-pill-btn.primary',
  '.ins-btn.primary',
  '.ed-render',
  '.neon-btn',
].join(', ');

function blobStyle(b: NeonBlob): string {
  return [
    `width:${b.w}%`,
    `height:${b.h}%`,
    `top:${b.top}%`,
    `left:-${b.w}%`,
    `background:radial-gradient(closest-side, ${b.color}, transparent)`,
    `--dur:${b.dur}s`,
    `--delay:${b.delay}s`,
    `--busy-delay:${b.busy}s`,
  ].join(';');
}

/** Markup for buttons built as HTML strings (inspector, text bar, critic markup). */
export function neonFxHtml(): string {
  const blobs = NEON_BLOBS.map((b) => `<span class="neon-btn__blob" style="${blobStyle(b)}"></span>`).join('');
  const sparks = NEON_SPARKS.map(
    (s) => `<span class="neon-btn__spark" style="left:${s.left}%;top:${s.top}%;animation-duration:${s.dur}s;animation-delay:${s.delay}s"></span>`,
  ).join('');
  return `<span class="neon-btn__fx" aria-hidden="true"><span class="neon-btn__water">${blobs}${sparks}</span><span class="neon-btn__glow"></span></span>`;
}

/**
 * The caption of a string-built neon button.
 * The effect layer is a span and it is the first one, so `querySelector('span')` hits it
 * and `textContent` wipes the water, glow, and sparks.
 */
export function neonButtonLabel(host: ParentNode | null | undefined): HTMLElement | null {
  const el = host?.querySelector(':scope > span:not(.neon-btn__fx)');
  return el instanceof HTMLElement ? el : null;
}

/** Pointer glow + press ripple for every neon fill, including ones React did not re-render. */
export function bindNeonGlow(root: ParentNode & { addEventListener: Document['addEventListener'] } = document): () => void {
  const host = root instanceof Document ? root : root.ownerDocument ?? document;
  const fillOf = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const el = target.closest(NEON_FILL_SELECTOR);
    return el instanceof HTMLElement ? el : null;
  };
  const move = (e: PointerEvent) => {
    const btn = fillOf(e.target);
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    btn.style.setProperty('--neon-mx', `${e.clientX - r.left}px`);
    btn.style.setProperty('--neon-my', `${e.clientY - r.top}px`);
  };
  const down = (e: PointerEvent) => {
    const btn = fillOf(e.target);
    if (!btn || btn.matches(':disabled') || btn.classList.contains('busy') || btn.classList.contains('is-busy')) return;
    const fx = btn.querySelector(':scope > .neon-btn__fx');
    if (!fx) return;
    const r = btn.getBoundingClientRect();
    const dot = host.createElement('span');
    dot.className = 'neon-btn__ripple';
    dot.style.left = `${e.clientX - r.left - 10}px`;
    dot.style.top = `${e.clientY - r.top - 10}px`;
    fx.append(dot);
    dot.addEventListener('animationend', () => dot.remove(), { once: true });
  };
  host.addEventListener('pointermove', move, true);
  host.addEventListener('pointerdown', down, true);
  return () => {
    host.removeEventListener('pointermove', move, true);
    host.removeEventListener('pointerdown', down, true);
  };
}

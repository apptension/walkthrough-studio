import { mirrorPlateCopy, presentPlateMotion, presentPlateStill, recreatePlateAnimations, seekPlateFrame } from './plate';

/**
 * The magnifier's live picture on a slide.
 *
 * A canvas cannot sample a live page, and the slide's rendered mp4 only catches up after the
 * next render — so copy, colour and look edits never reached the glass. Instead the glass holds
 * a second frame of the same document, stepped to the same moment, carrying the stage's unsaved
 * copy and live look tokens, and scaled up behind the canvas that paints the glass shading.
 */

/** `still` while the stage holds the composed edit frame (text mode), `motion` otherwise. */
type MirrorMode = 'motion' | 'still';

interface Mirror {
  src: string;
  token: number;
  ready: boolean;
  mode: MirrorMode;
  /** A switch to the still is composing; the mirror keeps its last picture meanwhile. */
  switching: boolean;
  look: string;
  copy: string;
  ms: number;
  bg: number | null;
}

/** Where the glass sits this frame, in the pane's CSS pixels and the slide's frame pixels. */
export interface GlassGeom {
  /** Centre of the glass in the host's CSS px. */
  left: number;
  top: number;
  /** Glass radius in CSS px. */
  r: number;
  /** Slide point under the centre, in frame px. */
  cx: number;
  cy: number;
  /** CSS px per frame px inside the glass (fit × magnification). */
  scale: number;
  alpha: number;
}

const fresh = (src: string, token: number): Mirror => ({ src, token, ready: false, mode: 'motion', switching: false, look: '', copy: '', ms: -1, bg: null });

let m: Mirror = fresh('', 0);
let repaint: () => void = () => undefined;
const watched = new WeakSet<Document>();

const glassEl = (): HTMLElement | null => document.getElementById('plateLoupeGlass');
const mirrorEl = (): HTMLIFrameElement | null => document.getElementById('plateLoupeFrame') as HTMLIFrameElement | null;

function docOf(frame: HTMLIFrameElement | null): Document | null {
  try {
    return frame?.contentDocument || null;
  } catch {
    return null;
  }
}

export function onPlateGlassChange(fn: () => void): void {
  repaint = fn;
}

function arm(frame: HTMLIFrameElement, token: number, attempt: number): void {
  if (token !== m.token) return;
  const doc = docOf(frame);
  if (!doc?.body) return;
  // Same wait as arming the stage: layout and SVG path lengths exist once animations do.
  if (!(doc.getAnimations?.() || []).length && attempt < 6) {
    setTimeout(() => arm(frame, token, attempt + 1), 40);
    return;
  }
  presentPlateMotion(frame, 0);
  m.ready = true;
  repaint();
}

function load(frame: HTMLIFrameElement, src: string): void {
  m = fresh(src, m.token + 1);
  const token = m.token;
  frame.onload = () => arm(frame, token, 0);
  frame.src = src;
}

/** True once the glass holds the document on stage; starts loading it when it does not. */
export function plateGlassReady(front: HTMLIFrameElement | null): boolean {
  const frame = mirrorEl();
  const src = front?.getAttribute('src') || '';
  if (!frame || !src || !front) return false;
  // Slides lay out in viewport units: the mirror has to be the stage frame's size before it loads.
  const w = `${front.offsetWidth}px`;
  const h = `${front.offsetHeight}px`;
  if (front.offsetWidth && frame.style.width !== w) frame.style.width = w;
  if (front.offsetHeight && frame.style.height !== h) frame.style.height = h;
  if (src !== m.src) {
    load(frame, src);
    return false;
  }
  return m.ready && Boolean(docOf(frame)?.body);
}

/** Look tokens live as inline vars on the root; title reveals as a data attribute. */
function lookKey(doc: Document): string {
  const reveals = [...doc.querySelectorAll<HTMLElement>('.title[data-reveal]')].map((t) => t.dataset['reveal'] || '').join(',');
  return `${doc.documentElement.getAttribute('style') || ''}|${reveals}`;
}

/** Only edited fields differ from what the mirror loaded; everything else it plays itself. */
function copyKey(doc: Document): string {
  let key = '';
  doc.querySelectorAll<HTMLElement>('[data-edit][data-dirty="1"]').forEach((el) => {
    key += `${el.dataset['edit']}\u0001${el.innerHTML}\u0002`;
  });
  return key;
}

let queued = false;
function repaintSoon(): void {
  if (queued || glassEl()?.hidden !== false) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    repaint();
  });
}

/** Typing, token edits and mode switches repaint the glass without waiting for the next stage frame. */
function watch(doc: Document): void {
  if (watched.has(doc)) return;
  watched.add(doc);
  doc.addEventListener('input', repaintSoon);
  const win = doc.defaultView;
  if (!win) return;
  const seen = new win.MutationObserver(repaintSoon);
  seen.observe(doc.documentElement, { attributes: true, attributeFilter: ['style'] });
  // Text mode swaps the stage between motion and the composed still on the body.
  if (doc.body) seen.observe(doc.body, { attributes: true, attributeFilter: ['class', 'data-motion'] });
}

/** Bring the mirror to the stage frame's look, copy and moment. */
export function syncPlateGlass(front: HTMLIFrameElement | null, ms: number, bgMs?: number | null): void {
  const frame = mirrorEl();
  const from = docOf(front);
  const to = docOf(frame);
  if (!from?.body || !to?.body || !m.ready) return;
  watch(from);
  const mode: MirrorMode = from.body.classList.contains('studio-edit') && from.body.dataset['motion'] !== '1' ? 'still' : 'motion';
  if (mode !== m.mode) {
    if (m.switching) return;
    const token = m.token;
    const settle = (): void => {
      if (token !== m.token) return;
      m = { ...m, mode, switching: false, look: '', copy: '', ms: -1, bg: null };
      repaint();
    };
    if (mode === 'still') {
      m.switching = true;
      presentPlateStill(frame, from, settle);
      return;
    }
    // Entering motion re-marks the plate unsaved from dirty fields; the mirror's are only copies.
    to.querySelectorAll<HTMLElement>('[data-edit][data-dirty]').forEach((el) => delete el.dataset['dirty']);
    presentPlateMotion(frame, ms);
    settle();
    return;
  }
  const still = mode === 'still';
  let rebuilt = false;
  const look = lookKey(from);
  if (look !== m.look) {
    const style = from.documentElement.getAttribute('style');
    if (style) to.documentElement.setAttribute('style', style);
    else to.documentElement.removeAttribute('style');
    const reveals = [...from.querySelectorAll<HTMLElement>('.title[data-reveal]')];
    to.querySelectorAll<HTMLElement>('.title[data-reveal]').forEach((t, i) => {
      const r = reveals[i]?.dataset['reveal'];
      if (r) t.dataset['reveal'] = r;
    });
    try {
      (frame?.contentWindow as (Window & { __plateRuntime?: { syncTitles?: () => void } }) | null)?.__plateRuntime?.syncTitles?.();
    } catch {
      /* same-origin plates only */
    }
    m.look = look;
    rebuilt = true;
  }
  const copy = copyKey(from);
  if (copy !== m.copy) {
    mirrorPlateCopy(from, to, { still });
    m.copy = copy;
    rebuilt = true;
  }
  // The still has no clock: it is the composed frame the stage edits on.
  if (still) return;
  if (rebuilt) recreatePlateAnimations(to);
  const bg = bgMs ?? null;
  if (rebuilt || ms !== m.ms || bg !== m.bg) {
    seekPlateFrame(frame, ms, bg);
    m.ms = ms;
    m.bg = bg;
  }
}

/** Position the glass and the slide inside it, or tuck it away (`null`). */
export function placePlateGlass(g: GlassGeom | null): void {
  const glass = glassEl();
  const frame = mirrorEl();
  if (!glass || !frame) return;
  if (!g) {
    if (!glass.hidden) glass.hidden = true;
    return;
  }
  const d = 2 * g.r;
  glass.hidden = false;
  glass.style.width = `${d}px`;
  glass.style.height = `${d}px`;
  glass.style.transform = `translate(${g.left - g.r}px, ${g.top - g.r}px)`;
  glass.style.opacity = g.alpha >= 0.999 ? '' : g.alpha.toFixed(3);
  frame.style.transform = `translate(${g.r - g.cx * g.scale}px, ${g.r - g.cy * g.scale}px) scale(${g.scale})`;
}

export function resetPlateGlassForTests(): void {
  m = fresh('', 0);
}

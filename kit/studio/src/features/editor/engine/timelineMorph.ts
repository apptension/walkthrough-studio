/**
 * One timeline, two densities. Switching between the Program overview and the Editor re-renders
 * every block, so the move is a FLIP: note where each block sits, render, then play every block
 * from its old box into its new one. Re-renders that land mid-flight wait for the morph to finish,
 * or they would swap the moving nodes for still ones.
 */

const MORPH_MS = 480;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

type Box = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

const BLOCKS: Array<[string, (el: HTMLElement) => string | undefined]> = [
  ['#etlClips .etl-clip', (el) => el.dataset['id'] && `clip:${el.dataset['id']}`],
  ['#etlClips .etl-join', (el) => el.dataset['joinI'] && `join:${el.dataset['joinI']}`],
  ['.ec-card', (el) => el.dataset['markKey'] && `card:${el.dataset['markKey']}`],
  ['#etlVoice [data-voice]', (el) => el.dataset['voice'] && `voice:${el.dataset['voice']}`],
];

let snapshot: Map<string, Box> | null = null;
let until = 0;
let endTimer: ReturnType<typeof setTimeout> | undefined;
let pending: (() => void) | null = null;

const reduced = (): boolean =>
  typeof Element.prototype.animate !== 'function' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/** Every block on the timeline by a key that survives a re-render — repeats get an ordinal. */
function collect(): Map<string, { el: HTMLElement; box: Box }> {
  const out = new Map<string, { el: HTMLElement; box: Box }>();
  for (const [sel, keyOf] of BLOCKS) {
    const seen = new Map<string, number>();
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const base = keyOf(el);
      if (!base) continue;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      out.set(n ? `${base}#${n}` : base, { el, box: { left: r.left, top: r.top, width: r.width, height: r.height } });
    }
  }
  return out;
}

/** Note where every block is before the timeline changes density. */
export function captureMorph(): void {
  if (reduced()) return;
  snapshot = new Map([...collect()].map(([k, v]) => [k, v.box]));
  document.body.classList.add('etl-morphing');
  clearTimeout(endTimer);
  endTimer = setTimeout(finish, MORPH_MS + 400);
}

/** Play every block from where `captureMorph` saw it into where it is now. */
export function playMorph(): void {
  const from = snapshot;
  snapshot = null;
  if (!from) return;
  const now = collect();
  let entering = 0;
  for (const [key, { el, box }] of now) {
    const was = from.get(key);
    if (!was) {
      el.animate(
        [
          { opacity: 0, transform: 'translateY(6px) scale(0.96)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 320, delay: 140 + Math.min(entering++, 10) * 18, easing: EASE, fill: 'backwards' },
      );
      continue;
    }
    const dx = was.left - box.left;
    const dy = was.top - box.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(was.width - box.width) < 0.5 && Math.abs(was.height - box.height) < 0.5) continue;
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)`, width: `${was.width}px`, height: `${was.height}px` },
        { transform: 'none', width: `${box.width}px`, height: `${box.height}px` },
      ],
      { duration: MORPH_MS, easing: EASE },
    );
  }
  until = performance.now() + MORPH_MS;
  clearTimeout(endTimer);
  endTimer = setTimeout(finish, MORPH_MS + 20);
}

function finish(): void {
  snapshot = null;
  until = 0;
  document.body.classList.remove('etl-morphing');
  const run = pending;
  pending = null;
  run?.();
}

/** A morph is playing — hold `run` until it lands (the latest call wins). */
export function deferWhileMorphing(run: () => void): boolean {
  if (performance.now() >= until) return false;
  pending = run;
  return true;
}

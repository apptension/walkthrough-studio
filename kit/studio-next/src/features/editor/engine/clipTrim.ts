import { clipPlayback, MIN_PLATE_KEEP, PLATE_HOLD_MAX, PLATE_RATE_RANGE, timingForDuration, timingForStretch, withPlateTime, type PlateTimingInput } from '@/logic/plateTiming';

import { postDeck } from './data';
import { paceMode } from './platePace';
import { rateAt } from './seq';
import { deckEdit, ed, type Drag } from './state';
import type { Clip, Deck, Trim } from './types';
import { clamp, r3 } from './util';

/**
 * Dragging a slide's ends on the timeline. A plate's right end lengthens it (the settled frame
 * holds) or shortens it (the exit, then the intro, trims); its left end trims the intro. A
 * recording's ends trim its head and tail, and dragging back out restores what was trimmed.
 * A plate's right end follows the Hold / Stretch choice of the speed dial; ⌥ flips it for one
 * drag, so stretching retimes the animation to the new length instead of holding.
 */

const MIN_LIVE = 0.4;

interface EdgeLimits {
  min: number;
  max: number;
}

/** How far (cut seconds) the dragged end may travel: negative is left, positive is right. */
export function edgeLimits(c: Clip, edge: 'l' | 'r', stretch = false): EdgeLimits {
  if (c.kind === 'plate') {
    const pb = clipPlayback(c);
    if (edge === 'r' && stretch) {
      const source = pb.to - pb.from;
      return { min: Math.min(0, source / PLATE_RATE_RANGE[1] - pb.dur), max: source / PLATE_RATE_RANGE[0] + PLATE_HOLD_MAX - pb.dur };
    }
    const row: PlateTimingInput = (deckEdit().plateTimes || []).find((r) => r.id === c.id) || {};
    if (edge === 'r') return { min: MIN_PLATE_KEEP - pb.dur, max: pb.head + pb.tail + PLATE_HOLD_MAX - pb.dur };
    const trimmed = (Number(row.trimStart) || 0) / pb.rate;
    return { min: -trimmed, max: Math.max(0, pb.head - 0.05) };
  }
  const trim: Partial<Trim> = (deckEdit().trims || []).find((t) => t.id === c.id) || {};
  const room = Math.max(0, c.dur - MIN_LIVE);
  if (edge === 'r') return { min: -room, max: (trim.trimEnd || 0) / rateAt(c.recTo - 0.01) };
  return { min: -(trim.trimStart || 0) / rateAt(c.recFrom), max: room };
}

export function startClipEdge(c: Clip, edge: 'l' | 'r', el: HTMLElement | null, x0: number, alt = false): Drag {
  const stretch = c.kind === 'plate' && edge === 'r' && (paceMode() === 'stretch') !== alt;
  el?.classList.add('is-trimming');
  el?.classList.toggle('is-stretching', stretch);
  return { type: 'clipEdge', edge, clip: c, el, x0, moved: false, start: parseFloat(el?.style.left || '0'), w: parseFloat(el?.style.width || '0'), offset: 0, ...(stretch ? { mode: 'stretch' } : {}) };
}

function nextPlateTiming(c: Clip, g: Drag, dt: number): PlateTimingInput {
  const pb = clipPlayback(c);
  const row: PlateTimingInput = { ...((deckEdit().plateTimes || []).find((r) => r.id === c.id) || {}) };
  if (g.edge !== 'r') return { ...row, trimStart: r3(clamp((Number(row.trimStart) || 0) + dt * pb.rate, 0, Math.max(0, pb.holdAt - 0.05))) };
  return g.mode === 'stretch' ? timingForStretch(row, pb.baseDur, pb.holdAt, pb.dur + dt) : timingForDuration(row, pb.baseDur, pb.holdAt, pb.dur + dt);
}

function tip(el: HTMLElement, text: string, x: number): void {
  let t = el.querySelector<HTMLElement>('.etl-trim-tip');
  if (!t) {
    t = document.createElement('span');
    t.className = 'etl-trim-tip';
    el.appendChild(t);
  }
  t.textContent = text;
  t.style.left = `${x}px`;
}

export function dragClipEdge(g: Drag, dx: number): void {
  const c = g.clip;
  if (!c || !g.el) return;
  const lim = edgeLimits(c, g.edge === 'l' ? 'l' : 'r', g.mode === 'stretch');
  const dt = clamp(dx / ed.pps, lim.min, lim.max);
  g.offset = dt;
  const w = g.w ?? 0;
  const left = g.start ?? 0;
  if (g.edge === 'r') {
    g.el.style.width = `${Math.max(4, w + dt * ed.pps)}px`;
    const rate = c.kind === 'plate' && g.mode === 'stretch' ? clipPlayback({ ...c, timing: nextPlateTiming(c, g, dt) }).rate : null;
    tip(g.el, `${(c.dur + dt).toFixed(1)}s${rate ? ` · ${rate.toFixed(2).replace(/\.?0+$/, '')}×` : ''}`, w + dt * ed.pps);
  } else {
    g.el.style.left = `${left + dt * ed.pps}px`;
    g.el.style.width = `${Math.max(4, w - dt * ed.pps)}px`;
    tip(g.el, `${(c.dur - dt).toFixed(1)}s`, 0);
  }
}

export async function commitClipEdge(g: Drag): Promise<Deck | null> {
  g.el?.classList.remove('is-trimming', 'is-stretching');
  g.el?.querySelector('.etl-trim-tip')?.remove();
  const c = g.clip;
  const dt = g.offset || 0;
  if (!c || Math.abs(dt) < 0.02) return null;
  if (c.kind === 'plate') {
    const next = nextPlateTiming(c, g, dt);
    const rate = clipPlayback({ ...c, timing: next }).rate;
    const hint =
      g.edge !== 'r' ? 'Intro trimmed' : g.mode === 'stretch' ? `Stretched · plays at ${rate.toFixed(2).replace(/\.?0+$/, '')}×` : dt > 0 ? 'Slide lengthened' : 'Slide shortened';
    return postDeck({ plateTimes: withPlateTime(deckEdit().plateTimes, c.id, next) }, { hint });
  }
  const trims = [...(deckEdit().trims || [])];
  const cur: Trim = { ...(trims.find((t) => t.id === c.id) || { id: c.id }) };
  if (g.edge === 'r') cur.trimEnd = r3(Math.max(0, (cur.trimEnd || 0) - dt * rateAt(c.recTo - 0.01)));
  else cur.trimStart = r3(Math.max(0, (cur.trimStart || 0) + dt * rateAt(c.recFrom)));
  if (!cur.trimStart) delete cur.trimStart;
  if (!cur.trimEnd) delete cur.trimEnd;
  const rest = trims.filter((t) => t.id !== c.id);
  if (cur.trimStart || cur.trimEnd) rest.push(cur);
  return postDeck({ trims: rest }, { hint: g.edge === 'r' ? 'Tail trimmed' : 'Head trimmed' });
}

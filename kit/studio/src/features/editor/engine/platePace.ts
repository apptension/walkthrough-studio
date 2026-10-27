import {
  clipPlayback,
  MIN_PLATE_KEEP,
  PLATE_HOLD_MAX,
  PLATE_RATE_RANGE,
  PLATE_RATE_STEPS,
  platePlayback,
  timingForDuration,
  timingForStretch,
  withPlateTime,
  type PlatePlayback,
  type PlateTimingInput,
} from '@/logic/plateTiming';

import { postDeck } from './data';
import { joinBeforeScene, sceneSegmentIndex, timelineScenes } from './seq';
import { timingBar } from '@/ui/look/previews';
import { deckEdit, ed } from './state';
import type { Clip, Deck } from './types';
import { escapeHtml, fmtRate, ICONS } from './util';

/**
 * Speed and length of a plate, from anywhere: the toolbar's Speed button, the inspector header,
 * the Timing tab and the timeline all read and write through here so they never disagree.
 *
 * Length can be reached two ways. "Hold" keeps the animation as designed and holds the settled
 * frame (or trims the exit) — what you want for a slide that needs to sit under narration.
 * "Stretch" retimes the whole animation to fill the length — every beat stays, faster or slower.
 */

export type PaceMode = 'hold' | 'stretch';
const MODE_KEY = 'wt.plate.paceMode';

export function paceMode(): PaceMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'stretch' ? 'stretch' : 'hold';
  } catch {
    return 'hold';
  }
}

export function setPaceMode(mode: PaceMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* private mode */
  }
}

export const plateRow = (c: Clip): PlateTimingInput => ({ ...((deckEdit().plateTimes || []).find((r) => r.id === c.id) || {}) });

/** The timing a requested on-screen length needs (seconds, transition pad included). */
export function timingForLength(c: Clip, want: number, mode: PaceMode = paceMode()): PlateTimingInput {
  const base = clipPlayback(c);
  const row = plateRow(c);
  const fit = (body: number) =>
    mode === 'stretch' ? timingForStretch(row, base.baseDur, base.holdAt, Math.max(MIN_PLATE_KEEP, body)) : timingForDuration(row, base.baseDur, base.holdAt, Math.max(MIN_PLATE_KEEP, body));
  // The server pads a plate so the next transition starts once its exit has cleared, and that
  // pad moves with the timing — so the length is solved with the pad the new timing will get.
  const tr = transitionOut(c);
  if (!tr) return fit(want);
  const clearSrc = c.clearAt ?? base.toSource(Math.max(0, c.dur - tr));
  const snap = (v: number) => Math.round(v * 30) / 30;
  const padFor = (t: PlateTimingInput) => {
    const pb = platePlayback(t, base.baseDur, base.holdAt);
    return snap(Math.max(0, Math.min(pb.dur, pb.toOutput(clearSrc)) + tr - snap(pb.dur)));
  };
  let pad = c.padOut || 0;
  let t = fit(want - pad);
  for (let k = 0; k < 6; k++) {
    const next = padFor(t);
    if (Math.abs(next - pad) < 0.005) break;
    pad = next;
    t = fit(want - pad);
  }
  return t;
}

/** The transition out of a plate as the server sizes its pad — unclamped, unlike the stage overlap. */
function transitionOut(c: Clip): number {
  const scenes = timelineScenes(ed.deck);
  const next = scenes[c.i + 1];
  if (!next || next.hardCut) return 0;
  const join = joinBeforeScene(ed.deck, sceneSegmentIndex(next, c.i + 1));
  const want = Number(join?.pinned?.duration ?? next.transitionIn?.dur) || 0;
  return Math.round(want * 30) / 30;
}

export function previewPlayback(c: Clip, t: PlateTimingInput): PlatePlayback {
  const base = clipPlayback(c);
  return platePlayback(t, base.baseDur, base.holdAt);
}

/** Shortest and longest on-screen length a plate can reach, transition pad included. */
export function lengthRange(c: Clip, mode: PaceMode = paceMode()): { min: number; max: number } {
  const pad = c.padOut || 0;
  const pb = clipPlayback(c);
  const source = pb.to - pb.from;
  const longest = mode === 'stretch' ? source / PLATE_RATE_RANGE[0] + PLATE_HOLD_MAX : pb.head + pb.tail + PLATE_HOLD_MAX;
  return {
    min: Math.round((MIN_PLATE_KEEP + pad) * 10) / 10,
    max: Math.round((Math.max(longest, pb.dur) + pad) * 10) / 10,
  };
}

export function savePlateTiming(c: Clip, t: PlateTimingInput | null, hint: string): Promise<Deck | null> {
  return postDeck({ plateTimes: withPlateTime(deckEdit().plateTimes, c.id, t) }, { hint });
}

export async function setPlateLength(c: Clip, want: number, mode: PaceMode = paceMode()): Promise<Deck | null> {
  const { min, max } = lengthRange(c, mode);
  const goal = Math.min(max, Math.max(min, want));
  const t = timingForLength(c, goal, mode);
  const pb = previewPlayback(c, t);
  const hint = (len: number, rate: number) => (mode === 'stretch' ? `${len.toFixed(1)}s · plays at ${fmtRate(rate)}` : `Slide length ${len.toFixed(1)}s`);
  const r = await savePlateTiming(c, t, hint(goal, pb.rate));
  // The server owns the transition pad; if it moved more than the estimate, solve once more
  // against what it returned. Same undo step — the user made one change.
  const after = r ? ed.seq.find((x) => x.id === c.id) : null;
  if (!after || Math.abs(after.dur - goal) <= 0.05) return r;
  const again = timingForLength(after, goal, mode);
  return postDeck({ plateTimes: withPlateTime(deckEdit().plateTimes, c.id, again) }, { undoable: false });
}

export function setPlateRate(c: Clip, rate: number): Promise<Deck | null> {
  return savePlateTiming(c, { ...plateRow(c), rate }, `Plays at ${fmtRate(rate)}`);
}

/** Narration that starts on this slide, and how long the slide must run to let it finish. */
export function voiceFit(c: Clip): number | null {
  const ends = (ed.deck?.audio?.voiceClips || []).filter((v) => !v.mute && v.start >= c.at - 0.05 && v.start < c.at + c.dur).map((v) => v.start + v.dur - c.at);
  return ends.length ? Math.round((Math.max(...ends) + 0.4) * 10) / 10 : null;
}

/** The chip that sums up a plate's pace — "6.5s · 1.25×" — wherever it is shown. */
export function paceLabel(c: Clip): string {
  const pb = clipPlayback(c);
  return `${c.dur.toFixed(1)}s${Math.abs(pb.rate - 1) > 0.001 ? ` · ${fmtRate(pb.rate)}` : ''}`;
}

// ─── Popover ────────────────────────────────────────────────────────────────────────────────

let pop: HTMLElement | null = null;
let popClipId: string | null = null;
let popAnchor: HTMLElement | null = null;
let draft: PlateTimingInput | null = null;
let teardown: (() => void) | null = null;

let onModeChange: (() => void) | null = null;
/** Let views that show the Hold / Stretch choice (timeline edge hints, Timing tab) repaint. */
export function onPaceModeChange(fn: () => void): void {
  onModeChange = fn;
}

const clipById = (id: string | null): Clip | null => (id ? ed.seq.find((c) => c.id === id) || null : null);

export const pacePopOpen = (): boolean => Boolean(pop);

export function closePacePop(): void {
  if (!pop) return;
  const el = pop;
  pop = null;
  popClipId = null;
  draft = null;
  teardown?.();
  teardown = null;
  popAnchor?.classList.remove('is-pace-open');
  popAnchor = null;
  el.classList.add('is-leaving');
  el.addEventListener('animationend', () => el.remove(), { once: true });
  window.setTimeout(() => el.remove(), 320);
}

/** Speed ↔ 0..1 on a log scale, so 0.5× and 2× sit equally far from 1×. */
export function rateFrac(rate: number): number {
  const [lo, hi] = PLATE_RATE_RANGE;
  return (Math.log(rate) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
}

export function rateFromFrac(f: number): number {
  const [lo, hi] = PLATE_RATE_RANGE;
  const r = Math.exp(Math.log(lo) + f * (Math.log(hi) - Math.log(lo)));
  // Land on a one-click step when close; feels like a detent on a hardware knob.
  const step = PLATE_RATE_STEPS.find((s) => Math.abs(s - r) / s < 0.035);
  return step ?? Math.round(r * 100) / 100;
}

function popHtml(c: Clip): string {
  const pb = previewPlayback(c, draft || plateRow(c));
  const pad = c.padOut || 0;
  const len = pb.dur + pad;
  const mode = paceMode();
  const fit = voiceFit(c);
  const natural = clipPlayback({ ...c, timing: null }).dur + pad;
  const changed = !pb.identity;
  const { min, max } = lengthRange(c);
  const chips = PLATE_RATE_STEPS.map(
    (r) => `<button type="button" class="pace-chip${Math.abs(r - pb.rate) < 0.001 ? ' on' : ''}" data-pace-rate="${r}" aria-pressed="${Math.abs(r - pb.rate) < 0.001}">${fmtRate(r)}</button>`,
  ).join('');
  const modeBtn = (id: PaceMode, label: string, hint: string, icon: string) =>
    `<button type="button" role="radio" aria-checked="${mode === id}" class="pace-mode-btn${mode === id ? ' on' : ''}" data-pace-mode="${id}" title="${escapeHtml(hint)}">${icon}<span>${label}</span></button>`;
  return `<header class="pace-head">
      <span class="pace-ico">${ICONS['speed'] || ''}</span>
      <div class="pace-title"><b>Speed &amp; length</b><em>${escapeHtml(c.title)} · designed ${natural.toFixed(1)}s</em></div>
      <button type="button" class="pace-x" data-pace="close" aria-label="Close">${ICONS['x'] || '×'}</button>
    </header>
    <div class="pace-readout">
      <label class="pace-len" title="Type an exact length">
        <input type="number" inputmode="decimal" min="${min}" max="${max}" step="0.1" value="${len.toFixed(1)}" data-pace-len aria-label="Slide length in seconds" />
        <span>s</span>
      </label>
      <span class="pace-times" aria-hidden="true">at</span>
      <output class="pace-rate" data-pace-rate-out>${fmtRate(pb.rate)}</output>
    </div>
    <div class="pace-strip" data-pace-strip>${timingBar(pb)}</div>
    <div class="pace-dial" style="--f:${rateFrac(pb.rate).toFixed(4)}">
      <input type="range" min="0" max="1" step="0.001" value="${rateFrac(pb.rate).toFixed(4)}" data-pace-dial aria-label="Animation speed" />
      <div class="pace-ticks" aria-hidden="true">${PLATE_RATE_STEPS.map((r) => `<i style="left:${(rateFrac(r) * 100).toFixed(2)}%"></i>`).join('')}</div>
    </div>
    <div class="pace-chips" role="group" aria-label="Speed">${chips}</div>
    <div class="pace-mode" role="radiogroup" aria-label="When the length changes">
      <span class="pace-mode-k">Length changes</span>
      ${modeBtn('hold', 'Hold', 'Keep the animation as designed: hold the settled frame, or trim the exit first', ICONS['pause'] || '')}
      ${modeBtn('stretch', 'Stretch', 'Retime the whole animation to fill the length — every beat stays', ICONS['speed'] || '')}
    </div>
    <footer class="pace-foot">
      <button type="button" class="pace-btn" data-pace-nudge="-1">−1s</button>
      <button type="button" class="pace-btn" data-pace-nudge="1">+1s</button>
      ${fit && Math.abs(fit - len) > 0.15 ? `<button type="button" class="pace-btn is-voice" data-pace-fit="${fit}" title="Long enough for the narration that starts on this slide">${ICONS['mic'] || ''}Fit voice ${fit.toFixed(1)}s</button>` : ''}
      <span class="pace-sp"></span>
      <button type="button" class="pace-btn ghost" data-pace="reset" ${changed ? '' : 'disabled'}>As designed</button>
    </footer>`;
}

function place(): void {
  if (!pop || !popAnchor) return;
  const a = popAnchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const gap = 10;
  const below = a.bottom + gap + h <= window.innerHeight - 8;
  const top = below ? a.bottom + gap : Math.max(8, a.top - gap - h);
  const left = Math.min(Math.max(8, a.left + a.width / 2 - w / 2), window.innerWidth - w - 8);
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  pop.dataset['side'] = below ? 'below' : 'above';
  pop.style.setProperty('--arrow-x', `${Math.round(a.left + a.width / 2 - left)}px`);
}

function paint(): void {
  const c = clipById(popClipId);
  if (!pop || !c) return closePacePop();
  const focused = document.activeElement?.matches?.('[data-pace-len]') ? (document.activeElement as HTMLInputElement) : null;
  if (focused) return paintLive(c);
  pop.innerHTML = popHtml(c);
  place();
}

/** Redraw readout, strip and dial from the draft without rebuilding the form under the pointer. */
function paintLive(c: Clip): void {
  if (!pop) return;
  const pb = previewPlayback(c, draft || plateRow(c));
  const len = pb.dur + (c.padOut || 0);
  const strip = pop.querySelector('[data-pace-strip]');
  if (strip) strip.innerHTML = timingBar(pb);
  const out = pop.querySelector('[data-pace-rate-out]');
  if (out) out.textContent = fmtRate(pb.rate);
  const lenIn = pop.querySelector<HTMLInputElement>('[data-pace-len]');
  if (lenIn && document.activeElement !== lenIn) lenIn.value = len.toFixed(1);
  const dial = pop.querySelector<HTMLElement>('.pace-dial');
  dial?.style.setProperty('--f', rateFrac(pb.rate).toFixed(4));
  pop.querySelectorAll<HTMLElement>('[data-pace-rate]').forEach((b) => {
    const on = Math.abs(Number(b.dataset['paceRate']) - pb.rate) < 0.001;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

async function commit(p: Promise<Deck | null>): Promise<void> {
  pop?.classList.add('is-saving');
  await p;
  draft = null;
  pop?.classList.remove('is-saving');
  pop?.classList.add('is-saved');
  window.setTimeout(() => pop?.classList.remove('is-saved'), 700);
  paint();
}

function wire(): void {
  if (!pop) return;
  const el = pop;
  el.addEventListener('click', (e) => {
    const c = clipById(popClipId);
    const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!c || !t || t.disabled) return;
    if (t.dataset['pace'] === 'close') return closePacePop();
    if (t.dataset['pace'] === 'reset') return void commit(savePlateTiming(c, null, 'Slide plays as designed'));
    if (t.dataset['paceRate']) return void commit(setPlateRate(c, Number(t.dataset['paceRate'])));
    if (t.dataset['paceMode']) {
      setPaceMode(t.dataset['paceMode'] as PaceMode);
      paint();
      pop?.querySelector<HTMLElement>(`[data-pace-mode="${t.dataset['paceMode']}"]`)?.focus({ preventScroll: true });
      onModeChange?.();
      return;
    }
    if (t.dataset['paceNudge']) return void commit(setPlateLength(c, c.dur + Number(t.dataset['paceNudge'])));
    if (t.dataset['paceFit']) return void commit(setPlateLength(c, Number(t.dataset['paceFit'])));
  });
  el.addEventListener('input', (e) => {
    const c = clipById(popClipId);
    const t = e.target as HTMLInputElement;
    if (!c) return;
    if (t.matches('[data-pace-dial]')) {
      draft = { ...plateRow(c), rate: rateFromFrac(Number(t.value)) };
      paintLive(c);
    } else if (t.matches('[data-pace-len]')) {
      const want = Number(t.value);
      if (Number.isFinite(want) && want > 0) {
        draft = timingForLength(c, want);
        paintLive(c);
      }
    }
  });
  el.addEventListener('change', (e) => {
    const c = clipById(popClipId);
    const t = e.target as HTMLInputElement;
    if (!c) return;
    if (t.matches('[data-pace-dial]')) void commit(setPlateRate(c, rateFromFrac(Number(t.value))));
    else if (t.matches('[data-pace-len]')) {
      const want = Number(t.value);
      if (Number.isFinite(want) && want > 0) void commit(setPlateLength(c, want));
    }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      const back = popAnchor;
      closePacePop();
      back?.focus?.({ preventScroll: true });
    } else if (e.key === 'Enter' && (e.target as HTMLElement).matches('[data-pace-len]')) {
      (e.target as HTMLInputElement).blur();
    }
    // The editor's single-key shortcuts must not fire while typing a length.
    e.stopPropagation();
  });
}

/** Open (or move) the speed-and-length popover for a plate, anchored to `anchor`. */
export function openPacePop(anchor: HTMLElement, c: Clip): void {
  if (c.kind !== 'plate') return;
  if (pop && popClipId === c.id && popAnchor === anchor) return closePacePop();
  if (pop) {
    pop.remove();
    teardown?.();
    popAnchor?.classList.remove('is-pace-open');
  }
  pop = document.createElement('div');
  pop.className = 'pace-pop is-entering';
  const entering = pop;
  window.setTimeout(() => entering.classList.remove('is-entering'), 520);
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', `Speed and length of ${c.title}`);
  popClipId = c.id;
  popAnchor = anchor;
  draft = null;
  anchor.classList.add('is-pace-open');
  document.body.appendChild(pop);
  pop.innerHTML = popHtml(c);
  wire();
  place();
  requestAnimationFrame(() => pop?.querySelector<HTMLInputElement>('[data-pace-len]')?.focus({ preventScroll: true }));
  const onDown = (e: PointerEvent) => {
    const t = e.target as Node;
    if (pop?.contains(t) || popAnchor?.contains(t)) return;
    closePacePop();
  };
  const onMove = () => place();
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('resize', onMove);
  teardown = () => {
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('resize', onMove);
  };
}

/** After the deck reloads (any save, undo, another panel), keep an open popover truthful. */
export function refreshPacePop(): void {
  if (!pop) return;
  if (popAnchor && !popAnchor.isConnected) {
    const replacement = document.querySelector<HTMLElement>(popAnchor.id ? `#${popAnchor.id}` : '[data-act="pace"]');
    if (replacement) {
      popAnchor = replacement;
      replacement.classList.add('is-pace-open');
    }
  }
  paint();
}

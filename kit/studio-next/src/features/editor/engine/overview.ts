import { fmtShort } from '@/desk/format';
import { activePlayer, seekTo, setMonitorMode } from '@/desk/monitor';
import { desk, useDesk } from '@/desk/store';
import { fmtScrub, keySeek } from '@/features/timeline/model';
import { cutToProgram, programToCut, type ClockFrame, type ProgramSpan } from '@/logic/programClock';

import { refresh } from './data';
import { visualSpan } from './seq';
import { ed, slug } from './state';
import { cardOwnerAt, onTimelineRender, renderTimeline } from './timeline';
import { captureMorph } from './timelineMorph';
import { paintHead } from './transport';
import type { Selection } from './types';
import { $, clamp, escapeHtml } from './util';

/**
 * Outside the Editor the timeline is the Program's overview: the same cut, fitted to the width
 * with only the clip, chapter, caption and voice rows. The playhead follows the Program player,
 * a drag scrubs it, and a click on any block opens the Editor on that block.
 */

const SNAP_PX = 6;
const DRAG_PX = 4;
/** Bar + ruler + clips row + bottom breathing room; the card and voice rows add their own heights. */
const SHELL_FIXED = 42 + 22 + 44 + 12;

// ─── Clocks ──────────────────────────────────────────────────────────────────────────────
const programDur = (): number => activePlayer()?.duration || desk.get().duration || desk.get().transport.d || 0;

const spans = (): ProgramSpan[] =>
  desk
    .get()
    .scenes.filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .map((s) => ({ id: s.id, start: s.start, end: s.end }));

const frame = (): ClockFrame => ({ programDur: programDur(), total: ed.total, fresh: !ed.deck?.stale && !ed.dirtyRender });

/** Program seconds → where that moment sits on the cut. */
export const toCut = (pt: number): number => programToCut(pt, spans(), ed.seq, frame());
/** A moment on the cut → the Program seconds that show it. */
export const toProgram = (t: number): number => cutToProgram(t, spans(), ed.seq, frame());

// ─── Paint ───────────────────────────────────────────────────────────────────────────────
export function paintOverviewHead(): void {
  if (ed.active || !ed.overview) return;
  const { t } = desk.get().transport;
  const d = programDur();
  ed.t = toCut(t);
  paintHead();
  const clock = $('edClock');
  if (clock) clock.innerHTML = `${fmtShort(t)} <span class="t-sep">/</span> ${fmtShort(d)}`;
  const scroll = $('etlScroll');
  if (scroll) {
    scroll.setAttribute('aria-valuemax', String(Math.round(d)));
    scroll.setAttribute('aria-valuenow', String(Math.min(Math.floor(t), Math.round(d))));
    scroll.setAttribute('aria-valuetext', `${fmtShort(t)} of ${fmtShort(d)}`);
  }
}

/** Runs after every overview render: accessible slider, quiet tooltips, a shell that fits the rows. */
function dressOverview(): void {
  const scroll = $('etlScroll');
  if (scroll) {
    scroll.setAttribute('role', 'slider');
    scroll.setAttribute('tabindex', '0');
    scroll.setAttribute('aria-label', 'Timeline — drag to scrub, click a block to edit it');
    scroll.scrollLeft = 0;
  }
  const clips = $('etlClips');
  if (clips) clips.dataset['empty'] = ed.seq.length ? '' : slug() ? 'Loading the cut…' : 'The cut lands here once a video is open';
  // The scrub tip names what a click opens; native tooltips would stack on top of it.
  for (const el of document.querySelectorAll<HTMLElement>('#etlCanvas [title]')) {
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', el.title);
    el.removeAttribute('title');
  }
  const rows = ['etlChapters', 'etlVoice'].reduce((sum, id) => {
    const h = parseFloat($(id)?.style.height || '');
    return sum + (Number.isFinite(h) ? h : 24);
  }, 0);
  document.documentElement.style.setProperty('--tl-h-overview', `${Math.round(clamp(SHELL_FIXED + rows, 150, 320))}px`);
  paintOverviewHead();
}

/** The Editor owns the timeline again — it is a set of tracks, not one slider. */
export function undressOverview(): void {
  const scroll = $('etlScroll');
  if (!scroll) return;
  for (const a of ['role', 'tabindex', 'aria-label', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext']) scroll.removeAttribute(a);
  hideTip();
}

// ─── Hover / scrub tip ───────────────────────────────────────────────────────────────────
interface Point {
  t: number;
  snap: string | null;
}

const cutAtX = (clientX: number): number => {
  const rect = $('etlCanvas')?.getBoundingClientRect();
  if (!rect || !(ed.pps > 0)) return 0;
  return clamp((clientX - rect.left) / ed.pps, 0, ed.total);
};

/** Pull onto the nearest clip or card start within a few pixels, unless ⌥ is held. */
function pointAt(clientX: number, free: boolean): Point {
  const t = cutAtX(clientX);
  if (free) return { t, snap: null };
  let best: { t: number; label: string; d: number } | null = null;
  const consider = (at: number, label: string) => {
    const d = Math.abs(at - t) * ed.pps;
    if (d <= SNAP_PX && (!best || d < best.d)) best = { t: at, label, d };
  };
  ed.seq.forEach((c, i) => consider(visualSpan(i)[0], c.title));
  for (const el of document.querySelectorAll<HTMLElement>('#etlChapters .ec-card')) {
    consider((parseFloat(el.style.left) || 0) / ed.pps, el.querySelector('.ec-card-t')?.textContent || (el.dataset['cardKind'] === 'caption' ? 'Caption' : 'Chapter'));
  }
  const hit = best as { t: number; label: string } | null;
  return hit ? { t: hit.t, snap: hit.label } : { t, snap: null };
}

function showTip(p: Point, mode: 'hover' | 'scrub', block: Focus | null): void {
  const tip = $('etlTip');
  const ghost = $('etlGhost');
  if (!tip || !ghost) return;
  const x = p.t * ed.pps;
  const pt = toProgram(p.t);
  const time = mode === 'scrub' ? fmtScrub(pt) : fmtShort(pt);
  const what = mode === 'hover' && block ? `<span class="etl-tip-edit">Edit <b>${escapeHtml(block.label)}</b></span>` : p.snap ? `<span class="etl-tip-snap"><i></i>${escapeHtml(p.snap)}</span>` : '';
  tip.innerHTML = `<span class="etl-tip-time">${time}</span>${what}`;
  tip.hidden = false;
  tip.className = `etl-tip is-${mode}${p.snap ? ' is-snap' : ''}${block && mode === 'hover' ? ' is-block' : ''}`;
  const canvasW = $('etlCanvas')?.clientWidth || 0;
  tip.style.left = `${x}px`;
  tip.classList.toggle('is-flip', x > canvasW - 160);
  ghost.hidden = mode !== 'hover';
  ghost.style.transform = `translateX(${x}px)`;
  ghost.classList.toggle('is-snap', Boolean(p.snap));
  $('etlCanvas')?.classList.add('has-tip');
}

function hideTip(): void {
  const tip = $('etlTip');
  const ghost = $('etlGhost');
  if (tip) tip.hidden = true;
  if (ghost) ghost.hidden = true;
  $('etlCanvas')?.classList.remove('has-tip');
}

// ─── Click a block → the Editor on it ────────────────────────────────────────────────────
interface Focus {
  t: number;
  sel: Selection | null;
  label: string;
}

function focusFor(target: HTMLElement, clientX: number): Focus | null {
  const pps = ed.pps || 1;
  const card = target.closest<HTMLElement>('.ec-card');
  if (card) {
    const markT = Number(card.dataset['markT']);
    const a = (parseFloat(card.style.left) || 0) / pps;
    const kind = card.dataset['cardKind'] === 'chapter' ? 'Chapter' : 'Caption';
    const label = card.querySelector('.ec-card-t')?.textContent || kind;
    const owner = cardOwnerAt(markT);
    return {
      t: a + 0.05,
      label,
      sel: {
        type: 'card',
        ...(card.dataset['markKey'] ? { key: card.dataset['markKey'] } : {}),
        cardId: card.dataset['cardId'] || null,
        markT,
        markDur: Number(card.dataset['markDur']),
        clipId: owner?.id,
      },
    };
  }
  const voice = target.closest<HTMLElement>('#etlVoice [data-voice]');
  if (voice) {
    const key = voice.dataset['voice'] || '';
    const line = (ed.deck?.audio?.voiceClips || []).find((c) => c.key === key);
    return { t: line?.start ?? cutAtX(clientX), label: key, sel: { type: 'voice', key } };
  }
  const join = target.closest<HTMLElement>('.etl-join');
  if (join) {
    const c = ed.seq[Number(join.dataset['joinI'])];
    if (c?.join) return { t: c.at + c.overlap / 2, label: `transition into ${c.title}`, sel: { type: 'join', key: c.join.key, i: c.i } };
  }
  const clipEl = target.closest<HTMLElement>('.etl-clip');
  const c = clipEl ? ed.seq[Number(clipEl.dataset['i'])] : null;
  if (c) {
    // A slide lands on its settled frame; a recording lands where it was clicked.
    const t = c.kind === 'plate' ? c.at + Math.min(c.dur * 0.55, Math.max(0.5, c.dur - 1.6)) : clamp(cutAtX(clientX), c.at + c.overlap + 0.05, c.at + c.dur - 0.05);
    return { t, label: c.title, sel: { type: 'clip', id: c.id } };
  }
  return null;
}

/** Open the Editor — on `focus` when a block was clicked, else where Program is. */
export function openEditorAt(focus: Pick<Focus, 't' | 'sel'> | null): void {
  if (ed.active) return;
  captureMorph();
  ed.focus = focus ? { t: focus.t, sel: focus.sel } : null;
  setMonitorMode('plate');
}

// ─── Wiring ──────────────────────────────────────────────────────────────────────────────
let loadTimer: ReturnType<typeof setTimeout> | undefined;
let loadedFor: { slug: string | null; scenes: unknown; stamp: string } = { slug: null, scenes: null, stamp: '' };

/** What a record, render or source edit moves on the summary — the cut on disk changed with it. */
const freshStamp = (f = desk.get().video?.freshness): string =>
  f ? `${f.liveAt ?? ''}|${f.deliveryAt ?? ''}|${f.sourceAt ?? ''}|${f.stale ? 1 : 0}` : '';

/** Fetch the cut for the overview when the video or its render changed; otherwise just redraw. */
function scheduleLoad(): void {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => {
    if (ed.active || !ed.overview) return;
    const s = desk.get();
    const want = { slug: s.slug, scenes: s.scenes, stamp: freshStamp() };
    const fresh =
      ed.deck && ed.deck.slug === s.slug && loadedFor.slug === want.slug && loadedFor.scenes === want.scenes && loadedFor.stamp === want.stamp;
    if (!s.slug || fresh) {
      renderTimeline();
      return;
    }
    loadedFor = want;
    void refresh();
  }, 120);
}

export function wireOverview(signal: AbortSignal): void {
  const scroll = $('etlScroll');
  if (!scroll) return;
  ed.overview = true;
  onTimelineRender(dressOverview);

  scroll.addEventListener(
    'pointerdown',
    (e) => {
      if (ed.active || e.button !== 0) return;
      const target = e.target as HTMLElement;
      // The scrollbar and the row icons are not the cut.
      if (target === scroll || target.closest('.etl-heads')) return;
      e.preventDefault();
      e.stopPropagation();
      scroll.focus({ preventScroll: true });
      const block = focusFor(target, e.clientX);
      const x0 = e.clientX;
      let moved = false;
      const scrub = (ev: PointerEvent) => {
        const p = pointAt(ev.clientX, ev.altKey);
        seekTo(toProgram(p.t));
        showTip(p, 'scrub', null);
      };
      if (!block) {
        desk.set({ scrubbing: true });
        moved = true;
        scrub(e);
      }
      scroll.setPointerCapture?.(e.pointerId);
      scroll.classList.add('is-pressing');
      const onMove = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientX - x0) > DRAG_PX) {
          moved = true;
          desk.set({ scrubbing: true });
        }
        if (moved) scrub(ev);
      };
      const onUp = (ev: PointerEvent) => {
        scroll.removeEventListener('pointermove', onMove);
        scroll.removeEventListener('pointerup', onUp);
        scroll.removeEventListener('pointercancel', onUp);
        scroll.classList.remove('is-pressing');
        if (moved) {
          desk.set({ scrubbing: false });
          hideTip();
          return;
        }
        if (block && ev.type === 'pointerup') {
          hideTip();
          openEditorAt(block);
        }
      };
      scroll.addEventListener('pointermove', onMove, { signal });
      scroll.addEventListener('pointerup', onUp, { signal });
      scroll.addEventListener('pointercancel', onUp, { signal });
    },
    { capture: true, signal },
  );

  scroll.addEventListener(
    'pointermove',
    (e) => {
      if (ed.active || e.pointerType === 'touch' || e.buttons || desk.get().scrubbing) return;
      const target = e.target as HTMLElement;
      if (target === scroll || target.closest('.etl-heads')) {
        hideTip();
        return;
      }
      showTip(pointAt(e.clientX, true), 'hover', focusFor(target, e.clientX));
    },
    { signal },
  );
  scroll.addEventListener('pointerleave', () => !desk.get().scrubbing && hideTip(), { signal });

  // The Editor's gestures (double-click to edit copy, ⌘-wheel zoom) wait for the Editor.
  scroll.addEventListener('dblclick', (e) => !ed.active && e.stopPropagation(), { capture: true, signal });

  scroll.addEventListener(
    'keydown',
    (e) => {
      if (ed.active) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        openEditorAt(null);
        return;
      }
      const s = desk.get();
      const next = keySeek(e.key, s.transport.t, programDur(), s.chapters, { big: e.shiftKey });
      if (next == null) return;
      e.preventDefault();
      e.stopPropagation();
      seekTo(next);
    },
    { signal },
  );

  $('etlOpen')?.addEventListener('click', () => openEditorAt(null), { signal });

  const unsub = useDesk.subscribe((s, p) => {
    if (s.transport !== p.transport || s.duration !== p.duration) paintOverviewHead();
    const restamped = freshStamp(s.video?.freshness) !== freshStamp(p.video?.freshness);
    // The Editor re-reads too when a record or render lands behind it — never mid-gesture.
    if (restamped && ed.active && !ed.drag && s.slug === p.slug) void refresh();
    if (s.slug !== p.slug || s.scenes !== p.scenes || (s.monitorMode !== p.monitorMode && s.monitorMode !== 'plate') || restamped) scheduleLoad();
  });
  signal.addEventListener('abort', () => {
    unsub();
    clearTimeout(loadTimer);
    ed.overview = false;
    onTimelineRender(null);
  });
  scheduleLoad();
}

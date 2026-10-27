import { clipPlayback } from '@/logic/plateTiming';

import { withMusic, withVoice } from './audio';
import { commitClipEdge, dragClipEdge, startClipEdge } from './clipTrim';
import { postDeck } from './data';
import { addCut, adoptLens, adoptShot, leavePlateContentIfNeeded, select, selectFx, setSelection, showInspectorTab } from './edits';
import { afterContentSaved, flushAllContentPending, hasContentPending } from './plateContentPane';
import { renderInspector } from './inspector';
import { setScale } from './lifecycle';
import { curClip, edToRec, fxClipId, lensByKey, recToEd, shotByKey, shotKey, visualIndexAt, visualSpan } from './seq';
import { ensureLiveCards, requestPlate } from './stage';
import { audioDesk, deckEdit, ed, live, type Drag, type FxItem } from './state';
import { enterLiveCard, paintTextMode, setCoachHidden } from './text';
import { cardOwnerAt, clipRects, cutBlocks, flashHint, fxSegments, paintSelection, paintTools, renderTimeline } from './timeline';
import { etlHeadWidth, pause, seek } from './transport';
import type { CardTiming, Clip, Deck, MusicDesk } from './types';
import { $, clamp, r3 } from './util';

/** Timeline pointer gestures (scrub, reorder, trim, retime) from `kit/studio/editor.js`. */

function whenContentReady(run: () => void): void {
  if (hasContentPending()) afterContentSaved(run);
  else run();
}

export function edFromEvent(e: { clientX: number }): number {
  const rect = $('etlCanvas')!.getBoundingClientRect();
  return clamp((e.clientX - rect.left) / ed.pps, 0, ed.total);
}

export function liveClipAtEd(t: number): Clip | null {
  const i = visualIndexAt(t);
  const c = ed.seq[i];
  return c?.kind === 'live' ? c : null;
}

export function fxItem(target: HTMLElement): FxItem | null {
  const d = deckEdit();
  const ranges = ed.deck?.ranges;
  if (target.dataset['ramp'] != null) {
    const i = Number(target.dataset['ramp']);
    const r = d.speed[i];
    return r ? { kind: 'ramp', i, from: r.from, to: r.to, min: ranges?.minRampSec ?? 0 } : null;
  }
  if (target.dataset['skip'] != null) {
    const i = Number(target.dataset['skip']);
    const s = d.zoomSkips[i];
    return s ? { kind: 'skip', i, from: s.from, to: s.to, min: 0.5 } : null;
  }
  if (target.dataset['lens'] != null) {
    const l = lensByKey(target.dataset['lens']);
    return l
      ? { kind: 'lens', key: l.key, lens: l, from: l.t, to: r3(l.t + l.dur), min: ranges?.minLensSec || 1, auto: l.source === 'auto', fixed: l.source === 'off' }
      : null;
  }
  if (target.dataset['shot'] != null) {
    const shot = shotByKey(target.dataset['shot']);
    return shot ? { kind: 'zoom', key: shotKey(shot), shot, from: shot.start, to: shot.end, min: ranges?.minZoomSec ?? 0, auto: shot.source === 'auto' } : null;
  }
  return null;
}

/**
 * The clip an effect pill belongs to at `t`: the recording under the pointer, or — for a
 * magnifier or zoom placed on a plate — the copy of that plate under the pointer.
 */
export function fxOwnerAt(t: number, item: FxItem): Clip | null {
  const plate = item.lens?.clip ?? item.shot?.clip;
  if (!plate) return liveClipAtEd(t);
  const c = ed.seq[visualIndexAt(t)];
  return c?.kind === 'plate' && fxClipId(c) === plate ? c : null;
}

const targetOf = (e: Event): HTMLElement => e.target as HTMLElement;

export function wireTimeline(signal: AbortSignal): void {
  const canvas = $('etlCanvas');
  if (!canvas) return;
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      const target = targetOf(e);
      const t = edFromEvent(e);
      const cardHit = target.closest<HTMLElement>('.ec-card');
      if (cardHit) {
        e.stopPropagation();
        if (ed.playing) pause();
        const edge = target.closest<HTMLElement>('[data-edge]')?.dataset?.['edge'] || null;
        const key = cardHit.dataset['markKey'];
        const markT = Number(cardHit.dataset['markT']);
        const markDur = Number(cardHit.dataset['markDur']);
        const clip = cardOwnerAt(markT) || liveClipAtEd(t) || curClip();
        const prev = curClip();
        const cardSel = {
          type: 'card' as const,
          ...(key != null ? { key } : {}),
          cardId: cardHit.dataset['cardId'] || null,
          markT,
          markDur,
          clipId: clip?.id,
        };
        const armCardDrag = () => {
          // Soft-select without re-rendering the timeline (keeps the node alive for drag).
          setSelection(cardSel);
          document.querySelectorAll('.ec-card.is-on').forEach((n) => n.classList.toggle('is-on', n === cardHit));
          showInspectorTab();
          renderInspector();
          canvas.setPointerCapture(e.pointerId);
          ed.drag = {
            type: 'card',
            edge: edge || 'move',
            ...(key != null ? { key } : {}),
            cardId: cardHit.dataset['cardId'] || null,
            clip,
            start: markT,
            dur: markDur,
            x0: e.clientX,
            t0: t,
            el: cardHit,
            moved: false,
          };
        };
        if (hasContentPending()) {
          afterContentSaved(async () => {
            await leavePlateContentIfNeeded(prev, cardSel);
            armCardDrag();
          });
        } else {
          void leavePlateContentIfNeeded(prev, cardSel);
          armCardDrag();
        }
        return;
      }
      const markHit = target.closest<HTMLElement>('.ec-mark');
      if (markHit) {
        e.stopPropagation();
        if (ed.playing) pause();
        const clipEl = markHit.closest<HTMLElement>('.etl-clip');
        const clip = clipEl ? ed.seq[Number(clipEl.dataset['i'])] : curClip();
        if (clip) select({ type: 'clip', id: clip.id });
        void enterLiveCard(markHit.dataset['cardId'] || null, markHit.dataset['markT'] ?? null, markHit.dataset['markKey'] || null);
        return;
      }
      const join = target.closest<HTMLElement>('.etl-join');
      if (join) {
        const c = ed.seq[Number(join.dataset['joinI'])];
        if (c?.join) select({ type: 'join', key: c.join.key, i: c.i });
        return;
      }
      const voiceHit = target.closest<HTMLElement>('[data-voice]');
      const rideHit = target.closest<HTMLElement>('[data-ride]');
      const bedHit = target.closest<HTMLElement>('.music-bed');
      if (voiceHit || rideHit || bedHit) {
        canvas.setPointerCapture(e.pointerId);
        if (voiceHit) {
          const clip = (ed.deck?.audio?.voiceClips || []).find((c) => c.key === voiceHit.dataset['voice']);
          // `written` is the line's place on this cut before any nudge (the projection, see projectAudio).
          // The ends trim the clip; the body moves it.
          const edge = target.classList.contains('h') ? (target.classList.contains('l') ? 'l' : 'r') : 'move';
          if (clip)
            ed.drag = {
              type: 'voice',
              edge,
              key: clip.key,
              voice: clip,
              start: clip.start,
              written: r3(clip.start - (clip.nudge || 0)),
              dur: clip.dur,
              x0: e.clientX,
              t0: t,
              el: voiceHit,
              moved: false,
            };
        } else if (rideHit) {
          const i = Number(rideHit.dataset['ride']);
          const ride = audioDesk().music.rides[i];
          const edge = target.classList.contains('l') ? 'l' : target.classList.contains('r') ? 'r' : 'move';
          if (ride) ed.drag = { type: 'ride', i, from: ride.from, to: ride.to, edge, x0: e.clientX, t0: t, el: rideHit, moved: false };
        } else if (target.classList.contains('h')) {
          ed.drag = {
            type: 'fade',
            edge: target.classList.contains('l') ? 'in' : 'out',
            fade: target.classList.contains('l') ? audioDesk().music.fadeIn : audioDesk().music.fadeOut,
            x0: e.clientX,
            t0: t,
            moved: false,
          };
        } else {
          ed.drag = { type: 'slip', offset: audioDesk().music.offset || 0, x0: e.clientX, t0: t, el: bedHit, moved: false };
        }
        return;
      }
      const cutEl = target.closest<HTMLElement>('[data-cut]');
      const fxEl = target.closest<HTMLElement>('.fx');
      const lane = target.closest<HTMLElement>('.etl-track');
      canvas.setPointerCapture(e.pointerId);
      if (cutEl) {
        const block = cutBlocks().find((c) => c.i === Number(cutEl.dataset['cut']));
        if (!block) return;
        const mode = target.classList.contains('l') ? 'l' : target.classList.contains('r') ? 'r' : 'move';
        ed.drag = { type: 'cut', i: block.i, mode, from: block.from, to: block.to, splice: block.splice, removed: block.removed, x0: e.clientX, t0: t, el: cutEl, moved: false };
        return;
      }
      if (fxEl) {
        const item = fxItem(fxEl);
        const c = item && fxOwnerAt(t, item);
        if (!item || !c) return;
        const mode = target.classList.contains('l') ? 'l' : target.classList.contains('r') ? 'r' : 'move';
        ed.drag = { type: 'fx', item, clip: c, mode, x0: e.clientX, t0: t, from: item.from, to: item.to, el: fxEl, moved: false };
        return;
      }
      if (lane && (lane.id === 'etlSpeed' || lane.id === 'etlZoom' || lane.id === 'etlCuts')) {
        const c = liveClipAtEd(t);
        if (c) {
          ed.drag = { type: 'range', lane: lane.id, clip: c, a: edToRec(c, t), x0: e.clientX, t0: t, moved: false };
          return;
        }
      }
      // Empty voice lane click: seek + open the Add voice inspector (no scrub drag).
      if (lane?.id === 'etlVoice' && !voiceHit) {
        if (ed.playing) pause();
        seek(t);
        select(null);
        flashHint('Add voice at the playhead');
        return;
      }
      const edgeEl = target.closest<HTMLElement>('[data-clip-edge]');
      const edgeClipEl = edgeEl?.closest<HTMLElement>('.etl-clip');
      const edgeClip = edgeClipEl ? ed.seq[Number(edgeClipEl.dataset['i'])] : null;
      if (edgeEl && edgeClip) {
        if (ed.playing) pause();
        const clipId = edgeClip.id;
        whenContentReady(() => {
          setSelection({ type: 'clip', id: clipId });
          ed.drag = startClipEdge(edgeClip, edgeEl.dataset['clipEdge'] === 'l' ? 'l' : 'r', edgeClipEl ?? null, e.clientX, e.altKey);
        });
        return;
      }
      const clipEl = target.closest<HTMLElement>('.etl-clip');
      if (ed.playing) pause();
      ed.drag = { type: 'scrub', clipI: clipEl ? Number(clipEl.dataset['i']) : null, x0: e.clientX, moved: false };
      seek(t);
    },
    { signal },
  );
  canvas.addEventListener(
    'pointermove',
    (e) => {
      const g = ed.drag;
      if (!g) return;
      if (Math.abs(e.clientX - g.x0) > 3) g.moved = true;
      const t = edFromEvent(e);
      if (g.type === 'scrub') {
        if (g.clipI != null && Math.abs(e.clientX - g.x0) > 8) {
          g.type = 'clip';
          g.from = g.clipI;
          liftClip(g);
        } else if (g.moved) seek(t);
      } else if (g.type === 'clip') {
        dragClip(g, e.clientX - g.x0);
      } else if (g.type === 'clipEdge') {
        if (g.moved) dragClipEdge(g, e.clientX - g.x0);
      } else if (g.type === 'range' && g.moved && g.clip) {
        const b = edToRec(g.clip, clamp(t, g.clip.at, g.clip.at + g.clip.dur));
        const a = g.a ?? 0;
        ed.sel = { type: 'range', clipId: g.clip.id, from: r3(Math.min(a, b)), to: r3(Math.max(a, b)) };
        paintSelection();
        seek(recToEd(g.clip, b));
      } else if (g.type === 'cut' && g.moved) dragCut(g, t);
      else if (g.type === 'fx' && g.moved && !g.item?.fixed) dragFx(g, t);
      else if (g.type === 'card' && g.moved) dragCard(g, t);
      else if (g.moved && (g.type === 'voice' || g.type === 'ride' || g.type === 'slip' || g.type === 'fade')) dragAudio(g, t);
    },
    { signal },
  );
  const finish = async () => {
    const g = ed.drag;
    ed.drag = null;
    if (!g) return;
    if (g.type === 'scrub') {
      if (!g.moved && g.clipI != null) {
        const clip = ed.seq[g.clipI];
        if (clip) {
          // Keep stage and selection in sync — selecting a brick outside the playhead felt broken.
          if (ed.t < clip.at || ed.t >= clip.at + clip.dur - 1e-4) {
            seek(clip.at + Math.min(0.15, Math.max(0.05, clip.dur * 0.2)));
          }
          select({ type: 'clip', id: clip.id });
        }
      }
    } else if (g.type === 'clip') {
      await dropClip(g);
    } else if (g.type === 'clipEdge') {
      if (!g.moved) {
        g.el?.classList.remove('is-trimming');
        if (g.clip) select({ type: 'clip', id: g.clip.id });
      } else if (!(await commitClipEdge(g))) renderTimeline();
    } else if (g.type === 'range') {
      const s = ed.sel;
      const span = s?.type === 'range' ? (s.to ?? 0) - (s.from ?? 0) : 0;
      if (g.lane === 'etlCuts' && g.moved && s?.type === 'range' && span >= 0.2) {
        await addCut(s.from ?? 0, s.to ?? 0);
      } else if (!g.moved || !s || s.type !== 'range' || span < 0.2) {
        seek(g.t0 ?? 0);
        if (g.clip) select({ type: 'clip', id: g.clip.id });
      } else {
        renderInspector();
        paintTools();
      }
    } else if (g.type === 'cut') {
      if (!g.moved) select({ type: 'cut', ...(g.i != null ? { i: g.i } : {}) });
      else await commitCut(g);
    } else if (g.type === 'fx') {
      if (!g.item) return;
      if (!g.moved || g.item.fixed) selectFx(g.item);
      else await commitFx(g);
    } else if (g.type === 'card') {
      if (!g.moved) {
        const owner = g.clip || cardOwnerAt(g.start ?? 0);
        if (owner) seek(recToEd(owner, (g.start ?? 0) + 0.12));
        await ensureLiveCards(g.cardId || null);
        // Bring the tip back so Edit copy is one click away (it was often dismissed / covering captions).
        setCoachHidden(false);
        select({
          type: 'card',
          ...(g.key != null ? { key: g.key } : {}),
          cardId: g.cardId || null,
          ...(g.start != null ? { markT: g.start } : {}),
          ...(g.dur != null ? { markDur: g.dur } : {}),
          clipId: owner?.id,
        });
        paintTextMode();
      } else await commitCard(g);
    } else if (g.type === 'voice' || g.type === 'ride' || g.type === 'slip' || g.type === 'fade') {
      if (!g.moved) {
        if (g.type === 'voice') select({ type: 'voice', ...(g.key != null ? { key: g.key } : {}) });
        else if (g.type === 'ride') select({ type: 'ride', ...(g.i != null ? { i: g.i } : {}) });
        else select({ type: 'music' });
        if (g.type === 'voice') seek((g.start ?? 0) + 0.05);
      } else await commitAudio(g);
    }
  };
  canvas.addEventListener('pointerup', () => void finish(), { signal });
  canvas.addEventListener('pointercancel', () => void finish(), { signal });
  canvas.addEventListener(
    'dblclick',
    (e) => {
      const target = targetOf(e);
      const cardHit = target.closest<HTMLElement>('.ec-card');
      if (cardHit) {
        e.preventDefault();
        void enterLiveCard(cardHit.dataset['cardId'] || null, cardHit.dataset['markT'] ?? null, cardHit.dataset['markKey'] || null);
        return;
      }
      const fxEl = target.closest<HTMLElement>('.fx');
      if (fxEl) {
        const item = fxItem(fxEl);
        const owner = liveClipAtEd(edFromEvent(e)) || curClip();
        if (!item || !owner) return;
        // A plate mark's `from` is in the plate's own clock, so it maps through its playback.
        seek(owner.kind === 'plate' ? owner.at + clipPlayback(owner).toOutput(item.from + 0.02) : recToEd(owner, item.from + 0.02));
      }
    },
    { signal },
  );
  $('etlScroll')?.addEventListener(
    'wheel',
    (e) => {
      if (!ed.active || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const scroll = $('etlScroll')!;
      const at = edFromEvent(e);
      const px = e.clientX - scroll.getBoundingClientRect().left - etlHeadWidth(scroll);
      setScale(ed.zoomScale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
      scroll.scrollLeft = at * ed.pps - px;
    },
    { passive: false, signal },
  );
}

/** Pick a brick up: remember where every brick sits so the others can slide out of its way. */
export function liftClip(g: Drag): void {
  const host = $('etlClips');
  const from = g.from ?? 0;
  g.el = host?.querySelector<HTMLElement>(`.etl-clip[data-i="${from}"]`) || null;
  g.els = [...(host?.querySelectorAll<HTMLElement>('.etl-clip') || [])];
  g.span = ed.seq.map((_, i) => visualSpan(i).map((v) => v * ed.pps) as [number, number]);
  const own = g.span[from] ?? [0, 0];
  g.w = own[1] - own[0];
  g.at = from;
  g.ids = ed.seq.map((c) => c.id);
  host?.classList.add('is-reordering');
  g.el?.classList.add('is-lift');
}

/** The lifted brick rides with the pointer; its centre picks the slot, and the bricks in between slide over. */
export function dragClip(g: Drag, dx: number): void {
  if (!g.el || !g.span) return;
  const from = g.from ?? 0;
  g.el.style.transform = `translateX(${dx}px)`;
  const [a, b] = g.span[from] ?? [0, 0];
  const mid = (a + b) / 2 + dx;
  let at = 0;
  for (let i = 0; i < ed.seq.length; i++) {
    if (i === from) continue;
    const [sa, sb] = g.span[i] ?? [0, 0];
    if (mid < (sa + sb) / 2) break;
    at++;
  }
  if (at === g.at) return;
  g.at = at;
  const ids = ed.seq.map((c) => c.id);
  const [id] = ids.splice(from, 1);
  if (id != null) ids.splice(at, 0, id);
  g.ids = ids;
  const w = g.w ?? 0;
  for (const el of g.els || []) {
    const i = Number(el.dataset['i']);
    if (i === from) continue;
    let shift = 0;
    if (at > from && i > from && i <= at) shift = -w;
    else if (at < from && i >= at && i < from) shift = w;
    el.style.transform = shift ? `translateX(${shift}px)` : '';
  }
}

/** Let go: a new slot saves and the bricks glide from where they are into the saved cut; the same slot eases home. */
export async function dropClip(g: Drag): Promise<void> {
  const host = $('etlClips');
  const id = ed.seq[g.from ?? -1]?.id;
  if (g.at !== g.from && id) {
    await flushAllContentPending();
    await leavePlateContentIfNeeded(curClip(), { type: 'clip', id });
    ed.flipFrom = clipRects();
    setSelection({ type: 'clip', id });
    const r = await commitOrder(g.ids || [], 'Sequence reordered');
    host?.classList.remove('is-reordering');
    if (r) {
      paintTools();
      showInspectorTab();
    } else settleClips(g);
    return;
  }
  host?.classList.remove('is-reordering');
  settleClips(g);
}

export function settleClips(g: Drag): void {
  const host = $('etlClips');
  host?.classList.add('is-settling');
  g.el?.classList.remove('is-lift');
  g.el?.classList.add('is-home');
  for (const el of g.els || []) el.style.transform = '';
  clearTimeout(ed.settleTimer);
  ed.settleTimer = setTimeout(() => {
    host?.classList.remove('is-settling');
    g.el?.classList.remove('is-home');
  }, 340);
}

/** Save a sequence. The rendered order stores nothing, so moving a clip back clears the override. */
export function commitOrder(ids: string[], hint: string): Promise<Deck | null> {
  const natural = ed.deck?.naturalIds || [];
  const same = ids.length === natural.length && ids.every((id, i) => id === natural[i]);
  return postDeck({ order: same ? [] : ids }, { hint });
}

/** Full recording span covered by live bricks — captions/chapters can move across sections. */
export function liveRecSpan(): { from: number; to: number } {
  const lives = ed.seq.filter((x) => x.kind === 'live');
  if (!lives.length) return { from: 0, to: 0 };
  return {
    from: Math.min(...lives.map((x) => x.recFrom)),
    to: Math.max(...lives.map((x) => x.recTo)),
  };
}

export function dragCard(g: Drag, t: number): void {
  const start = g.start ?? 0;
  const gDur = g.dur ?? 0;
  const c = g.clip?.kind === 'live' ? g.clip : cardOwnerAt(start);
  if (!c || c.kind !== 'live' || !ed.clock) return;
  const span = liveRecSpan();
  const owner = liveClipAtEd(t) || c;
  const rec = clamp(ed.clock.fromClean(ed.clock.toClean(owner.recFrom) + (clamp(t, owner.at, owner.at + owner.dur) - owner.at)), span.from, span.to);
  const [minDur] = ed.deck?.ranges?.cardDur || [0.4, 30];
  let from = start;
  let dur = gDur;
  if (g.edge === 'move') {
    from = clamp(rec - gDur * 0.15, span.from, Math.max(span.from, span.to - gDur));
  } else if (g.edge === 'l') {
    const end = start + gDur;
    from = clamp(rec, span.from, end - minDur);
    dur = end - from;
  } else if (g.edge === 'r') {
    const end = clamp(rec, start + minDur, span.to);
    dur = end - start;
    from = start;
  }
  g.newT = r3(from);
  g.newDur = r3(dur);
  const segs = fxSegments(from, from + dur);
  if (segs.length && g.el) {
    g.el.style.left = `${segs[0]!.a * ed.pps}px`;
    g.el.style.width = `${Math.max(18, (segs[segs.length - 1]!.b - segs[0]!.a) * ed.pps)}px`;
  }
  const seekClip = ed.seq.find((x) => x.kind === 'live' && from >= x.recFrom - 0.05 && from < x.recTo) || owner;
  seek(recToEd(seekClip, from + 0.12));
}

export async function commitCard(g: Drag): Promise<Deck | null | undefined> {
  if (g.newT == null && g.newDur == null) return;
  const row = {
    key: g.key ?? '',
    t: g.newT != null ? g.newT : (g.start ?? 0),
    dur: g.newDur != null ? g.newDur : (g.dur ?? 0),
  };
  return saveCardTiming(row, {
    cardId: g.cardId ?? null,
    clipId: g.clip?.id ?? null,
    hint: g.edge === 'move' ? 'Card moved' : 'Card length changed',
  });
}

/** Persist start + on-screen length into `edit.cards` (produce bake reads the same). */
export async function saveCardTiming(
  row: { key?: string | null; t: number | string; dur: number | string } | null | undefined,
  { cardId = null, clipId = null, hint = 'Card timing updated' }: { cardId?: string | null; clipId?: string | null; hint?: string } = {},
): Promise<Deck | null> {
  if (!row?.key) return null;
  const [lo, hi] = ed.deck?.ranges?.cardDur || [0.4, 30];
  const next: CardTiming = {
    key: row.key,
    t: r3(Number(row.t)),
    dur: r3(clamp(Number(row.dur), lo, hi)),
  };
  if (!Number.isFinite(next.t) || !Number.isFinite(next.dur)) return null;
  const cards = [...(deckEdit().cards || [])];
  const i = cards.findIndex((c) => c.key === next.key);
  if (i >= 0) cards[i] = { ...cards[i], ...next };
  else cards.push(next);
  const r = await postDeck({ cards }, { hint });
  if (r) {
    select({ type: 'card', key: next.key, cardId, markT: next.t, markDur: next.dur, clipId: clipId ?? undefined });
    // Reload so --x-out / --hold match the new length (server rebuilt overlay HTML).
    if (cardId) {
      ed.stalePlates.add(cardId);
      ed.compositeCardId = null;
      ed.compositeHoldMs = null;
      ed.compositeSeekMs = null;
      await requestPlate(cardId, { reason: 'show', force: true });
    }
    paintTools();
  }
  return r;
}

export async function moveClip(id: string, dir: number): Promise<void> {
  const i = ed.seq.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ed.seq.length) return;
  const ids = ed.seq.map((c) => c.id);
  const [item] = ids.splice(i, 1);
  if (item != null) ids.splice(j, 0, item);
  await flushAllContentPending();
  await leavePlateContentIfNeeded(curClip(), { type: 'clip', id });
  ed.flipFrom = clipRects();
  setSelection({ type: 'clip', id });
  const r = await commitOrder(ids, dir < 0 ? 'Moved earlier' : 'Moved later');
  if (r) {
    paintTools();
    showInspectorTab();
  }
}

export function dragAudio(g: Drag, t: number): void {
  const dt = t - (g.t0 ?? 0);
  const [olo, ohi] = ed.deck?.ranges?.musicOffset || [-20, 20];
  const el = g.el;
  if (g.type === 'voice' && g.edge === 'move') {
    // Anywhere on the cut: dropping a line past another one is how they get reordered.
    const start = clamp((g.start ?? 0) + dt, 0, Math.max(0, ed.total - (g.dur ?? 0)));
    g.newStart = r3(start);
    if (el) {
      el.style.left = `${start * ed.pps}px`;
      el.style.zIndex = '4';
    }
    seek(Math.min(start + 0.05, ed.total));
  } else if (g.type === 'voice') {
    const c = g.voice;
    if (!c) return;
    const minSec = ed.deck?.ranges?.voiceMinSec || 0.3;
    if (g.edge === 'l') {
      // Trimming the head moves the start by the same amount, so the words that stay keep their place.
      const trimStart = clamp(r3(c.trimStart + dt), 0, r3(c.full - c.trimEnd - minSec));
      const delta = trimStart - c.trimStart;
      g.newTrimStart = trimStart;
      g.newNudge = r3((c.nudge || 0) + delta);
      if (el) {
        el.style.left = `${(c.start + delta) * ed.pps}px`;
        el.style.width = `${Math.max(8, (c.dur - delta) * ed.pps)}px`;
      }
      seek(Math.min(c.start + delta + 0.05, ed.total));
    } else {
      const trimEnd = clamp(r3(c.trimEnd - dt), 0, r3(c.full - c.trimStart - minSec));
      g.newTrimEnd = trimEnd;
      const dur = c.full - c.trimStart - trimEnd;
      if (el) el.style.width = `${Math.max(8, dur * ed.pps)}px`;
      seek(Math.min(c.start + dur, ed.total));
    }
  } else if (g.type === 'slip') {
    const offset = clamp(r3((g.offset ?? 0) + dt), olo, ohi);
    g.newOffset = offset;
    const bedDur = ed.deck?.audio?.music?.durationSec || ed.total;
    const from = Math.max(0, offset);
    const to = Math.min(ed.total, audioDesk().music.loop ? ed.total : offset + bedDur);
    if (el) {
      el.style.left = `${from * ed.pps}px`;
      el.style.width = `${Math.max(12, (to - from) * ed.pps)}px`;
    }
  } else if (g.type === 'fade') {
    g.newFade = r3(clamp((g.fade ?? 0) + (g.edge === 'in' ? dt : -dt), 0, 8));
  } else if (g.type === 'ride') {
    const gFrom = g.from ?? 0;
    const gTo = g.to ?? 0;
    const len = gTo - gFrom;
    let from = gFrom;
    let to = gTo;
    if (g.edge === 'move') {
      from = clamp(gFrom + dt, 0, Math.max(0, ed.total - len));
      to = from + len;
    } else if (g.edge === 'l') from = clamp(gFrom + dt, 0, gTo - 0.4);
    else to = clamp(gTo + dt, gFrom + 0.4, ed.total);
    g.newFrom = r3(from);
    g.newTo = r3(to);
    if (el) {
      el.style.left = `${from * ed.pps}px`;
      el.style.width = `${Math.max(8, (to - from) * ed.pps)}px`;
    }
    seek(g.edge === 'r' ? to : from);
  }
}

export async function commitAudio(g: Drag): Promise<void> {
  const key = g.key ?? '';
  if (g.type === 'voice' && g.newStart != null) {
    await withVoice(key, { at: g.newStart, nudge: 0 }, 'Line moved');
    select({ type: 'voice', key });
  } else if (g.type === 'voice' && g.newTrimStart != null) {
    await withVoice(key, { trimStart: g.newTrimStart, ...(g.newNudge != null ? { nudge: g.newNudge } : {}) }, 'Head trimmed');
    select({ type: 'voice', key });
  } else if (g.type === 'voice' && g.newTrimEnd != null) {
    await withVoice(key, { trimEnd: g.newTrimEnd }, 'Tail trimmed');
    select({ type: 'voice', key });
  } else if (g.type === 'slip' && g.newOffset != null) {
    await withMusic({ offset: g.newOffset }, 'Music slipped');
    select({ type: 'music' });
  } else if (g.type === 'fade' && g.newFade != null) {
    const patch: Partial<MusicDesk> = g.edge === 'in' ? { fadeIn: g.newFade } : { fadeOut: g.newFade };
    await withMusic(patch);
    select({ type: 'music' });
  } else if (g.type === 'ride' && g.newFrom != null) {
    const rides = audioDesk().music.rides.map((r, i) => (i === g.i ? { ...r, from: g.newFrom ?? r.from, to: g.newTo ?? r.to } : r));
    await withMusic({ rides }, 'Ride moved');
    select({ type: 'ride', ...(g.i != null ? { i: g.i } : {}) });
  }
}

export function dragCut(g: Drag, t: number): void {
  const dt = t - (g.t0 ?? 0);
  const min = 0.2;
  const liveDur = live().durationSec || 1e9;
  const toClean = ed.clock?.toClean || ((n: number) => n);
  const fromClean = ed.clock?.fromClean || ((n: number) => n);
  const gFrom = g.from ?? 0;
  const gTo = g.to ?? 0;
  const splice = g.splice ?? 0;
  const gRemoved = g.removed ?? 0;
  const cleanLen = Math.max(min, toClean(gTo) - toClean(gFrom));
  let from = gFrom;
  let to = gTo;
  if (g.mode === 'move') {
    const cleanFrom = clamp(toClean(gFrom) + dt, 0, Math.max(0, toClean(liveDur) - cleanLen));
    from = fromClean(cleanFrom);
    to = fromClean(cleanFrom + cleanLen);
  } else if (g.mode === 'l') {
    from = fromClean(clamp(toClean(gFrom) + dt, 0, toClean(gTo) - min));
  } else {
    to = fromClean(clamp(toClean(gTo) + dt, toClean(gFrom) + min, toClean(liveDur)));
  }
  g.newFrom = r3(Math.min(from, to));
  g.newTo = r3(Math.max(from, to));
  const removed = Math.max(min, toClean(g.newTo) - toClean(g.newFrom));
  const left = g.mode === 'r' ? splice - gRemoved : g.mode === 'move' ? splice - gRemoved + dt : splice - removed;
  if (!g.el) return;
  g.el.style.left = `${Math.max(0, left) * ed.pps}px`;
  g.el.style.width = `${Math.max(8, (g.mode === 'move' ? gRemoved : removed) * ed.pps)}px`;
  g.el.classList.add('is-drag');
}

export async function commitCut(g: Drag): Promise<void> {
  const from = g.newFrom ?? g.from ?? 0;
  const to = g.newTo ?? g.to ?? 0;
  if (!(to - from >= 0.2)) return;
  const cuts = (deckEdit().cuts || []).map((c, i) => (i === g.i ? { from: r3(from), to: r3(to) } : c));
  const r = await postDeck({ cuts }, { hint: 'Cut adjusted' });
  if (!r) return;
  const i = (deckEdit().cuts || []).findIndex((c) => Math.abs(c.from - from) < 0.05 && Math.abs(c.to - to) < 0.05);
  if (i >= 0) select({ type: 'cut', i });
}

export function dragFx(g: Drag, t: number): void {
  const c = g.clip;
  const item = g.item;
  if (!c || !item) return;
  if (c.kind === 'plate') return dragPlateFx(g, t, c, item);
  const dt = t - (g.t0 ?? 0);
  const gFrom = g.from ?? 0;
  const gTo = g.to ?? 0;
  const len = gTo - gFrom;
  let from = gFrom;
  let to = gTo;
  const lo = c.recFrom;
  const hi = c.recTo;
  // Ramps never overlap each other.
  let nlo = lo;
  let nhi = hi;
  if (item.kind === 'ramp') {
    for (const [i, r] of deckEdit().speed.entries()) {
      if (i === item.i) continue;
      if (r.to <= gFrom + 1e-3) nlo = Math.max(nlo, r.to);
      if (r.from >= gTo - 1e-3) nhi = Math.min(nhi, r.from);
    }
  }
  const startEd = recToEd(c, Math.max(gFrom, lo));
  const endEd = recToEd(c, Math.min(gTo, hi));
  if (g.mode === 'move') {
    from = clamp(edToRec(c, startEd + dt), nlo, nhi - len);
    to = from + len;
  } else if (g.mode === 'l') {
    from = clamp(edToRec(c, startEd + dt), nlo, gTo - item.min);
  } else {
    to = clamp(edToRec(c, endEd + dt), gFrom + item.min, nhi);
  }
  g.newFrom = r3(from);
  g.newTo = r3(to);
  const a = recToEd(c, Math.max(from, lo));
  const b = recToEd(c, Math.min(to, hi));
  if (g.el) {
    g.el.style.left = `${a * ed.pps}px`;
    g.el.style.width = `${Math.max(6, (b - a) * ed.pps)}px`;
    g.el.classList.add('is-drag');
  }
  seek(g.mode === 'r' ? b : a);
}

/**
 * The same drag on a plate. A plate mark is written in the plate's own clock, so the pill moves
 * through the plate's playback rather than the recording's speed map.
 */
function dragPlateFx(g: Drag, t: number, c: Clip, item: FxItem): void {
  const pb = clipPlayback(c);
  const toEd = (src: number) => c.at + pb.toOutput(src);
  const toSrc = (x: number) => pb.toSource(Math.max(0, x - c.at));
  const dt = t - (g.t0 ?? 0);
  const gFrom = g.from ?? 0;
  const gTo = g.to ?? 0;
  const len = gTo - gFrom;
  let from = gFrom;
  let to = gTo;
  if (g.mode === 'move') {
    from = clamp(toSrc(toEd(gFrom) + dt), 0, Math.max(0, pb.baseDur - len));
    to = from + len;
  } else if (g.mode === 'l') {
    from = clamp(toSrc(toEd(gFrom) + dt), 0, gTo - item.min);
  } else {
    to = clamp(toSrc(toEd(gTo) + dt), gFrom + item.min, pb.baseDur);
  }
  g.newFrom = r3(from);
  g.newTo = r3(to);
  const a = toEd(from);
  const b = toEd(to);
  if (g.el) {
    g.el.style.left = `${a * ed.pps}px`;
    g.el.style.width = `${Math.max(6, (b - a) * ed.pps)}px`;
    g.el.classList.add('is-drag');
  }
  seek(g.mode === 'r' ? b : a);
}

export async function commitFx(g: Drag): Promise<void> {
  const d = deckEdit();
  const from = g.newFrom ?? g.from ?? 0;
  const to = g.newTo ?? g.to ?? 0;
  const it = g.item;
  if (!it) return;
  if (it.kind === 'ramp') {
    await postDeck({ speed: d.speed.map((r, i) => (i === it.i ? { ...r, from, to } : r)) });
    ed.sel = { type: 'ramp', i: deckEdit().speed.findIndex((r) => Math.abs(r.from - from) < 0.01) };
  } else if (it.kind === 'skip') {
    await postDeck({ zoomSkips: d.zoomSkips.map((s, i) => (i === it.i ? { from, to } : s)) });
  } else if (it.kind === 'lens' && it.lens) {
    const lens = it.lens;
    if (it.auto) await adoptLens(lens, { t: from, dur: r3(to - from) });
    else await postDeck({ lenses: d.lenses.map((l) => (l.id === lens.id ? { ...l, t: from, dur: r3(to - from) } : l)) });
  } else if (it.kind === 'zoom' && it.shot) {
    const shot = it.shot;
    if (it.auto) await adoptShot(shot, { t: from, dur: to - from });
    else await postDeck({ zooms: d.zooms.map((z) => (z.id === shot.id ? { ...z, t: from, dur: r3(to - from) } : z)) });
  }
  renderTimeline();
  renderInspector();
}

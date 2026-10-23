import { cardMarkDuration, cardMarkKey } from '@/logic/liveCardStage';

import { lensItems, recToEd, shotKey, visualSpan, curClip } from './seq';
import { joinStyle, paintClipChip, resolveLiveCard } from './stage';
import { audioDesk, deckEdit, ed, live } from './state';
import { etlHeadWidth, paintHead } from './transport';
import type { Clip, DeckMark, DeckPlate, PlateRow } from './types';
import { $, CUT_ICON, ICONS, PLATE_ICON, T_GLYPH, escapeHtml, fmtRate, fmtRuler, fmtT, packLanes } from './util';

/** The timeline renderer (ruler, clips, card rows, fx rows, cuts, audio rows) from `kit/studio/editor.js`. */

export function renderTimeline(): void {
  const scroll = $('etlScroll');
  const canvas = $('etlCanvas');
  if (!scroll || !canvas || !ed.active) return;
  // Heads sit inside the scroll row — exclude their width from the fit math.
  const W = Math.max(200, scroll.clientWidth - etlHeadWidth(scroll) - 24);
  ed.pps = (W / Math.max(1, ed.total)) * ed.zoomScale;
  const width = Math.max(W, ed.total * ed.pps);
  canvas.style.width = `${width + 24}px`;
  const dur = $('etlDur');
  if (dur) dur.textContent = fmtT(ed.total);
  renderRuler();
  renderClipsTrack();
  renderCardTracks();
  renderFxTracks();
  renderAudioTracks();
  paintSelection();
  paintHead();
  paintTools();
  paintClipChip();
}

export function renderRuler(): void {
  const el = $('etlRuler');
  if (!el) return;
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];
  const step = steps.find((s) => s * ed.pps >= 64) || 120;
  const minor = step / (step >= 10 ? 5 : 2);
  const out: string[] = [];
  for (let t = 0; t <= ed.total + 1e-6; t += minor) {
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    out.push(`<i class="${major ? 'mj' : ''}" style="left:${t * ed.pps}px">${major ? `<span>${fmtRuler(Math.round(t * 10) / 10)}</span>` : ''}</i>`);
  }
  el.innerHTML = out.join('');
}

export function plateInfo(id: string | null | undefined): DeckPlate | null {
  return (ed.deck?.plates || []).find((p) => p.id === id) || null;
}

export function renderClipsTrack(): void {
  const el = $('etlClips');
  if (!el) return;
  const pps = ed.pps;
  const sel = ed.sel;
  const html = ed.seq.map((c, i) => {
    const [a, b] = visualSpan(i);
    const w = (b - a) * pps;
    const icon = c.kind === 'live' ? ICONS['film'] : ICONS[PLATE_ICON[c.plateId || ''] || 'plate'];
    const info = c.kind === 'plate' ? plateInfo(c.plateId) : null;
    const styled = info && (Object.keys(info.style || {}).length || (info.overrides || []).length);
    const isSel = sel?.type === 'clip' && sel.id === c.id;
    return `<div class="etl-clip ${c.kind}${isSel ? ' is-sel' : ''}${i === ed.cur ? ' is-cur' : ''}${w < 96 ? ' is-narrow' : ''}" data-i="${i}" data-id="${escapeHtml(c.id)}" style="left:${a * pps}px;width:${Math.max(2, w - 2)}px" title="${escapeHtml(`${c.title} · ${c.dur.toFixed(1)}s · drag to move`)}">
        <span class="ec-ico">${icon}</span><span class="ec-t">${escapeHtml(c.title)}</span>${styled ? `<span class="ec-dot" title="Own style">${ICONS['palette']}</span>` : ''}<span class="ec-d">${c.dur.toFixed(1)}s</span>
      </div>`;
  });
  const joins = ed.seq.slice(1).map((c) => {
    const pinned = c.join?.pinned;
    const style = joinStyle(c);
    const isSel = sel?.type === 'join' && sel.key === c.join?.key;
    return `<button type="button" class="etl-join${pinned ? ' is-pinned' : ''}${isSel ? ' is-sel' : ''}" data-join-i="${c.i}" style="left:${(c.at + c.overlap / 2) * pps}px" title="${escapeHtml(
      `${ed.deck?.transitionStyles?.[style]?.label || style} · ${c.overlap.toFixed(2)}s${pinned ? ' · set by you' : ''} — click to change`,
    )}" aria-label="Transition into ${escapeHtml(c.title)}">${T_GLYPH[style] || ICONS['transition']}</button>`;
  });
  const from = ed.flipFrom;
  ed.flipFrom = null;
  el.innerHTML = html.join('') + joins.join('');
  if (from) slideClips(from, el);
}

export const CARD_LANE_H = 26;
export const FX_LANE_H = 26;

/** Match a track's height — and the icon beside it — to how many sub-lanes it holds. */
export function fitLane(track: HTMLElement, headClass: string, lanes: number, { base = 30, laneH = FX_LANE_H }: { base?: number; laneH?: number } = {}): number {
  const h = Math.max(base, 4 + lanes * laneH);
  track.style.height = `${h}px`;
  const head = document.querySelector<HTMLElement>(`.etl-head.${headClass}`);
  if (head) head.style.height = `${h}px`;
  return h;
}

export function cardOwnerAt(recT: number): Clip | null {
  return (
    ed.seq.find((x) => x.kind === 'live' && recT >= x.recFrom - 0.05 && recT < x.recTo) ||
    ed.seq.find((x) => x.kind === 'live' && recT >= x.recFrom - 0.05 && recT <= x.recTo + 0.05) ||
    null
  );
}

interface CardItem {
  m: DeckMark;
  t: number;
  end: number;
  a: number;
  b: number;
  key: string;
  card: PlateRow | null;
  dur: number;
}

export function renderCardTracks(): void {
  const chEl = $('etlChapters');
  const capEl = $('etlCaptions');
  const chHead = $('etlHeadChapters');
  const capHead = $('etlHeadCaptions');
  if (!chEl || !capEl) return;
  const pps = ed.pps;
  const sel = ed.sel;
  const onLive = live().exists && ed.seq.some((c) => c.kind === 'live');
  const paint = (kind: 'chapter' | 'caption', host: HTMLElement, head: HTMLElement | null) => {
    const marks = onLive ? (ed.deck?.marks || []).filter((m) => m.kind === kind && Number.isFinite(m.t)) : [];
    const items = marks
      .map((m): CardItem | null => {
        const dur = cardMarkDuration(m);
        const segs = fxSegments(m.t, m.t + dur);
        if (!segs.length) return null;
        const a = segs[0]!.a;
        const b = segs[segs.length - 1]!.b;
        return {
          m,
          t: m.t,
          end: m.t + dur,
          a,
          b,
          key: m.key || cardMarkKey(m),
          card: resolveLiveCard(m),
          dur,
        };
      })
      .filter((it): it is CardItem => Boolean(it));
    const packed = packLanes(items);
    const h = Math.max(CARD_LANE_H, packed.lanes * CARD_LANE_H + 4);
    host.style.height = `${h}px`;
    if (head) head.style.height = `${h}px`;
    host.innerHTML = packed.items
      .map((it) => {
        const on = sel?.type === 'card' && sel.key === it.key;
        const label = it.m.label || kind;
        const title = `${kind === 'chapter' ? 'Chapter' : 'Caption'} · ${label} · drag to move · edges trim · double-click to edit copy`;
        const top = 3 + it.lane * CARD_LANE_H;
        return `<button type="button" class="ec-card ${kind}${on ? ' is-on' : ''}" style="left:${it.a * pps}px;width:${Math.max(18, (it.b - it.a) * pps)}px;top:${top}px;height:${CARD_LANE_H - 6}px" data-mark-t="${it.m.t}" data-mark-dur="${it.dur}" data-mark-key="${escapeHtml(it.key)}" data-card-id="${escapeHtml(it.card?.id || '')}" data-card-kind="${kind}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"><i class="h l" data-edge="l"></i><span class="ec-card-t">${escapeHtml(label)}</span><i class="h r" data-edge="r"></i></button>`;
      })
      .join('');
    host.dataset['empty'] =
      onLive && !packed.items.length
        ? kind === 'chapter'
          ? 'Chapters · cards from the recording land here'
          : 'Captions · lower-thirds from the recording land here'
        : '';
  };
  paint('chapter', chEl, chHead);
  paint('caption', capEl, capHead);
}

/** Where every brick sits on screen right now, transforms included, by clip id. */
export function clipRects(): Map<string | undefined, number> {
  const out = new Map<string | undefined, number>();
  for (const el of document.querySelectorAll<HTMLElement>('#etlClips .etl-clip')) out.set(el.dataset['id'], el.getBoundingClientRect().left);
  return out;
}

/** Slide bricks from where they were into their new places, so a reorder reads as movement rather than a repaint. */
export function slideClips(from: Map<string | undefined, number>, host: HTMLElement): void {
  const moved: HTMLElement[] = [];
  for (const el of host.querySelectorAll<HTMLElement>('.etl-clip')) {
    const was = from.get(el.dataset['id']);
    if (was == null) continue;
    const dx = was - el.getBoundingClientRect().left;
    if (Math.abs(dx) < 0.5) continue;
    el.style.transition = 'none';
    el.style.transform = `translateX(${dx}px)`;
    moved.push(el);
  }
  if (!moved.length) return;
  host.classList.add('is-settling');
  void host.offsetWidth;
  for (const el of moved) {
    el.style.transition = '';
    el.style.transform = '';
  }
  clearTimeout(ed.settleTimer);
  ed.settleTimer = setTimeout(() => host.classList.remove('is-settling'), 340);
}

export interface FxSegment {
  clip: Clip;
  a: number;
  b: number;
}

/** Every place an effect (recording range) shows on the cut — split by the live clips it crosses. */
export function fxSegments(from: number, to: number): FxSegment[] {
  const out: FxSegment[] = [];
  for (const c of ed.seq) {
    if (c.kind !== 'live') continue;
    const a = Math.max(from, c.recFrom);
    const b = Math.min(to, c.recTo);
    if (b - a > 0.01) out.push({ clip: c, a: recToEd(c, a), b: recToEd(c, b) });
  }
  return out;
}

interface FxRow {
  key: string;
  t: number;
  end: number;
  render: (top: number) => string;
}

export function renderFxTracks(): void {
  const speedEl = $('etlSpeed');
  const zoomEl = $('etlZoom');
  if (!speedEl || !zoomEl) return;
  const pps = ed.pps;
  const d = deckEdit();
  const sel = ed.sel;
  const pill = (cls: string, seg: FxSegment, attrs: string, label: string, handles: boolean, top: number) =>
    `<div class="fx ${cls}" ${attrs} style="left:${seg.a * pps}px;width:${Math.max(6, (seg.b - seg.a) * pps)}px;top:${top}px">${handles ? '<i class="h l"></i>' : ''}<span>${label}</span>${handles ? '<i class="h r"></i>' : ''}</div>`;
  const conflicts = ed.deck?.conflicts || [];
  const speedItems: FxRow[] = live().exists
    ? d.speed.flatMap((r, i) => {
        const warn = conflicts.some((c) => c.from === r.from && c.to === r.to);
        return fxSegments(r.from, r.to).map((seg) => ({
          key: `ramp:${i}`,
          t: seg.a,
          end: seg.b,
          render: (top: number) =>
            pill(
              `ramp ${r.rate < 1 ? 'slow' : 'fast'}${sel?.type === 'ramp' && sel.i === i ? ' is-sel' : ''}${warn ? ' is-warn' : ''}`,
              seg,
              `data-ramp="${i}" title="${fmtRate(r.rate)} · ${fmtT(r.from)}–${fmtT(r.to)} in the recording${warn ? ' · covers a chapter card' : ''}"`,
              `${r.rate < 1 ? ICONS['slow'] : ICONS['speed']}${fmtRate(r.rate)}`,
              true,
              top,
            ),
        }));
      })
    : [];
  const speedPacked = packLanes(speedItems);
  fitLane(speedEl, 'speed', speedPacked.lanes);
  speedEl.innerHTML = speedPacked.items.map((it) => it.render(4 + it.lane * FX_LANE_H)).join('');
  const shots = live().exists ? ed.deck?.zoomShots || [] : [];
  // Zoom skips, zoom shots, and the magnifier can all land on the same stretch of time
  // (e.g. a manual zoom drawn over an auto one, or a magnifier under a "no zoom" skip),
  // so pack them into lanes the same way overlapping chapter/caption cards are, rather
  // than letting them paint on top of each other.
  const zoomItems: FxRow[] = [];
  d.zoomSkips.forEach((s, i) => {
    fxSegments(s.from, s.to).forEach((seg) => {
      zoomItems.push({
        key: `skip:${i}`,
        t: seg.a,
        end: seg.b,
        render: (top) => pill(`skip${sel?.type === 'skip' && sel.i === i ? ' is-sel' : ''}`, seg, `data-skip="${i}" title="No auto zoom here"`, `${ICONS['noZoom']}No zoom`, true, top),
      });
    });
  });
  shots.forEach((s) => {
    fxSegments(s.start, s.end).forEach((seg) => {
      zoomItems.push({
        key: `shot:${shotKey(s)}`,
        t: seg.a,
        end: seg.b,
        render: (top) =>
          pill(
            `shot ${s.source}${sel?.type === 'zoom' && sel.key === shotKey(s) ? ' is-sel' : ''}`,
            seg,
            `data-shot="${escapeHtml(shotKey(s))}" title="${s.source === 'auto' ? 'Auto zoom (follows the clicks) — drag to take over' : 'Your zoom'} · ${s.zoom.toFixed(2)}×"`,
            `${ICONS['zoom']}${s.source === 'auto' ? 'Auto ' : ''}${s.zoom.toFixed(2)}×`,
            s.source !== 'auto',
            top,
          ),
      });
    });
  });
  (live().exists ? lensItems() : []).forEach((l) => {
    fxSegments(l.t, l.t + l.dur).forEach((seg) => {
      zoomItems.push({
        key: l.key,
        t: seg.a,
        end: seg.b,
        render: (top) =>
          pill(
            `lens ${l.source}${sel?.type === 'lens' && sel.key === l.key ? ' is-sel' : ''}`,
            seg,
            `data-lens="${escapeHtml(l.key)}" title="${l.source === 'off' ? 'Recorded magnifier — switched off' : l.source === 'auto' ? 'Recorded magnifier — drag to take over' : 'Your magnifier'} · ${l.dur.toFixed(1)}s"`,
            `${l.source === 'off' ? ICONS['lensOff'] : ICONS['lens']}${l.source === 'off' ? 'Off' : `${(l.zoom || 2).toFixed(1)}×`}`,
            l.source === 'edit',
            top,
          ),
      });
    });
  });
  const zoomPacked = packLanes(zoomItems);
  fitLane(zoomEl, 'zoom', zoomPacked.lanes);
  zoomEl.innerHTML = zoomPacked.items.map((it) => it.render(4 + it.lane * FX_LANE_H)).join('');
  const onLive = live().exists && ed.seq.some((c) => c.kind === 'live');
  speedEl.dataset['empty'] = onLive && !speedEl.innerHTML ? 'Speed · drag across a recording clip to speed it up or slow it down' : '';
  zoomEl.dataset['empty'] = onLive && !zoomEl.innerHTML ? 'Zoom & magnify · drag across a recording clip to zoom in or magnify a detail' : '';
  renderCuts();
}

export interface CutBlock {
  i: number;
  from: number;
  to: number;
  splice: number;
  removed: number;
}

/** Where a removed stretch sits on the cut: its right edge is the splice, and it reaches back by the time it took out. */
export function cutBlocks(): CutBlock[] {
  const cuts = deckEdit().cuts || [];
  const seq = ed.seq;
  const toClean = ed.clock?.toClean || ((t: number) => t);
  return cuts.map((cut, i) => {
    const after = seq.find((c) => c.kind === 'live' && c.recFrom >= cut.to - 0.04);
    const before = [...seq].reverse().find((c) => c.kind === 'live' && c.recTo <= cut.from + 0.04);
    const splice = after ? after.at : before ? before.at + before.dur : seq[0]?.at || 0;
    const removed = Math.max(0.2, toClean(cut.to) - toClean(cut.from));
    return { i, from: cut.from, to: cut.to, splice, removed };
  });
}

export function renderCuts(): void {
  const el = $('etlCuts');
  if (!el) return;
  const pps = ed.pps;
  const sel = ed.sel;
  const blocks = cutBlocks();
  const cutItems = blocks.map((c) => {
    const left = Math.max(0, c.splice - c.removed);
    const on = sel?.type === 'cut' && sel.i === c.i;
    const label = `−${(c.to - c.from).toFixed(1)}s`;
    return {
      key: `cut:${c.i}`,
      t: left,
      end: left + c.removed,
      html: `<div class="fx cut${on ? ' is-sel' : ''}" data-cut="${c.i}" title="Cut · ${fmtT(c.from)}–${fmtT(c.to)} removed from the recording · drag the ends to change it · ⌫ restores it" style="left:${left * pps}px;width:${Math.max(8, c.removed * pps)}px;top:__TOP__px"><i class="h l"></i><span>${CUT_ICON}${label}</span><i class="h r"></i></div>`,
    };
  });
  const cutPacked = packLanes(cutItems);
  fitLane(el, 'cut', cutPacked.lanes);
  el.innerHTML = cutPacked.items.map((it) => it.html.replace('__TOP__', String(4 + it.lane * FX_LANE_H))).join('');
  const onLive = live().exists && ed.seq.some((c) => c.kind === 'live');
  el.dataset['empty'] = onLive && !blocks.length ? 'Cut · drag across this row to remove a stretch of the recording' : '';
}

export function renderAudioTracks(): void {
  const voiceEl = $('etlVoice');
  const musicEl = $('etlMusic');
  if (!voiceEl || !musicEl) return;
  const pps = ed.pps;
  const audio = ed.deck?.audio;
  const clips = audio?.voiceClips || [];
  const sel = ed.sel;
  const VOICE_LANE_H = 30;
  const voiceItems = clips.map((c) => {
    const on = sel?.type === 'voice' && sel.key === c.key;
    const name = c.key.length > 22 ? `${c.key.slice(0, 20)}…` : c.key;
    const longBy = c.long ?? 0;
    const long = longBy > 0.1;
    const speaking = ed.regenerating === c.key;
    const take = c.take ?? 0;
    const takes = c.takes ?? 0;
    const tip = [c.text || c.key];
    if (speaking) tip.push('Speaking this line again…');
    if (take > 1 || takes > 1) tip.push(`Take ${take || 1} of ${Math.max(take || 1, takes || 1)}`);
    if (c.textOverride) tip.push('Rewritten from the script');
    if (c.trimStart || c.trimEnd) tip.push(`Trimmed ${(c.trimStart + c.trimEnd).toFixed(1)}s · drag the ends`);
    tip.push('Drag to move it');
    if (long) tip.push(`Runs ${longBy.toFixed(1)}s past its window on this cut`);
    if (c.moved) tip.push(`Moves here on the next render (the mix has it at ${fmtT(c.writtenStart)})`);
    // Fades shade the ends of the pill in proportion; trims show as handles.
    const w = Math.max(8, c.dur * pps);
    const fi = c.fadeIn ? Math.min(100, (c.fadeIn / Math.max(0.01, c.dur)) * 100).toFixed(1) : 0;
    const fo = c.fadeOut ? Math.min(100, (c.fadeOut / Math.max(0.01, c.dur)) * 100).toFixed(1) : 0;
    const cls = `fx voice${c.mute ? ' is-mute' : ''}${on ? ' is-sel' : ''}${c.moved ? ' is-moved' : ''}${long ? ' is-long' : ''}${c.trimStart || c.trimEnd ? ' is-trimmed' : ''}${c.textOverride || (c.speed && Math.abs(c.speed - 1) > 0.01) ? ' is-regen' : ''}${take > 1 ? ' is-take' : ''}${speaking ? ' is-speaking' : ''}`;
    // A take past the first wears its number ahead of the name, so a narrow pill still shows it;
    // a line being spoken again says so in place of its name.
    const badge = take > 1 ? `<b class="take" aria-label="Take ${take}">${take}</b>` : '';
    const label = speaking ? `${ICONS['sparkle']}Speaking…` : `${long ? ICONS['warn'] : ICONS['mic']}${badge}${escapeHtml(name)}`;
    return {
      key: c.key,
      t: c.start,
      end: c.start + c.dur,
      html: `<div class="${cls}" data-voice="${escapeHtml(c.key)}" title="${escapeHtml(tip.join(' · '))}" style="--fi:${fi}%;--fo:${fo}%;left:${c.start * pps}px;width:${w}px;top:__TOP__px"><i class="h l" title="Trim the head"></i><span>${label}</span><i class="h r" title="Trim the tail"></i></div>`,
    };
  });
  const voicePacked = packLanes(voiceItems);
  fitLane(voiceEl, 'voice', voicePacked.lanes, { base: 34, laneH: VOICE_LANE_H });
  voiceEl.innerHTML = voicePacked.items.map((it) => it.html.replace('__TOP__', String(4 + it.lane * VOICE_LANE_H))).join('');
  const music = audioDesk().music;
  const bedDur = audio?.music?.durationSec || ed.total;
  const from = Math.max(0, music.offset || 0);
  // Loop-to-fill covers the whole cut; otherwise the bar stops where the file ends.
  const to = Math.min(ed.total, music.loop ? ed.total : (music.offset || 0) + bedDur);
  const bedOn = sel?.type === 'music' || sel?.type === 'mix';
  const short = Boolean(audio?.music && ed.total - ((music.offset || 0) + bedDur) > 0.35);
  const bedSrc = audio?.music?.source;
  const bedLabel = music.mute ? 'Muted' : music.loop && short ? 'Music · looped' : bedSrc === 'upload' ? 'Music · upload' : 'Music';
  const rideItems = (music.rides || [])
    .map((r, i) => ({
      key: `ride:${i}`,
      t: r.from,
      end: Math.min(r.to, ed.total),
      i,
      r,
    }))
    .filter((it) => it.r.from < ed.total);
  const ridePacked = packLanes(rideItems);
  const musicH = fitLane(musicEl, 'music', ridePacked.lanes, { base: 34 });
  const bed =
    audio?.music && to > from
      ? `<div class="music-bed${music.mute ? ' is-mute' : ''}${music.loop && short ? ' is-loop' : ''}${bedSrc === 'upload' ? ' is-upload' : ''}${bedOn ? ' is-sel' : ''}" style="left:${from * pps}px;width:${Math.max(12, (to - from) * pps)}px${ridePacked.lanes > 1 ? `;top:4px;height:${musicH - 8}px` : ''}"><i class="h l" title="Fade in"></i><span>${ICONS['music']}${bedLabel}</span><i class="h r" title="Fade out"></i></div>`
      : '';
  const rides = ridePacked.items
    .map((it) => {
      const top = 4 + it.lane * FX_LANE_H;
      return `<div class="fx ride${sel?.type === 'ride' && sel.i === it.i ? ' is-sel' : ''}" data-ride="${it.i}" title="${it.r.gainDb > 0 ? '+' : ''}${it.r.gainDb} dB · drag the ends to retime" style="left:${it.r.from * pps}px;width:${Math.max(8, (Math.min(it.r.to, ed.total) - it.r.from) * pps)}px;top:${top}px"><i class="h l"></i><span>${it.r.gainDb > 0 ? '+' : ''}${it.r.gainDb} dB</span><i class="h r"></i></div>`;
    })
    .join('');
  musicEl.innerHTML = bed + rides;
  voiceEl.dataset['empty'] = !clips.length ? 'Voice · Mix builds narration, or Voice in the toolbar to add a line' : '';
  musicEl.dataset['empty'] = audio?.music ? '' : 'Music · compose with ElevenLabs or upload an MP3';
}

export function paintSelection(): void {
  const el = $('etlSel');
  if (!el) return;
  const s = ed.sel;
  if (s?.type !== 'range') {
    el.hidden = true;
    return;
  }
  const c = ed.seq.find((x) => x.id === s.clipId);
  if (!c) {
    el.hidden = true;
    return;
  }
  const a = recToEd(c, s.from ?? 0);
  const b = recToEd(c, s.to ?? 0);
  el.hidden = false;
  el.style.left = `${a * ed.pps}px`;
  el.style.width = `${Math.max(2, (b - a) * ed.pps)}px`;
  el.dataset['label'] = `${(b - a).toFixed(1)}s`;
}

export function paintTools(): void {
  const c = curClip();
  const onLive = c?.kind === 'live' && live().exists;
  const tip = onLive ? '' : ' — move the playhead onto a recording clip';
  const sp = $<HTMLButtonElement>('etlAddSpeed');
  const zm = $<HTMLButtonElement>('etlAddZoom');
  if (sp) {
    sp.disabled = !onLive && ed.sel?.type !== 'range';
    sp.title = `Speed up a stretch (S)${tip}`;
  }
  if (zm) {
    zm.disabled = !onLive;
    zm.title = `Zoom in at the playhead (Z)${tip}`;
  }
  const mg = $<HTMLButtonElement>('etlAddLens');
  if (mg) {
    mg.disabled = !onLive && ed.sel?.type !== 'range';
    mg.title = `Magnify a detail at the playhead (M)${tip}`;
  }
  const vo = $('etlAddVoice');
  if (vo) vo.title = 'Add a voice line at the playhead';
  const cut = $<HTMLButtonElement>('etlAddCut');
  if (cut) {
    cut.disabled = !onLive && ed.sel?.type !== 'range';
    cut.title = ed.sel?.type === 'range' ? 'Cut the selected stretch out of the recording (C)' : `Cut 2s from the playhead (C)${tip}`;
  }
  const undoBtn = $<HTMLButtonElement>('etlUndo');
  if (undoBtn) undoBtn.disabled = !ed.undo.length;
  const redoBtn = $<HTMLButtonElement>('etlRedo');
  if (redoBtn) redoBtn.disabled = !ed.redo.length;
  paintContext();
}

export function paintContext(): void {
  const el = $('etlContext');
  if (!el) return;
  const s = ed.sel;
  if (s?.type === 'range') {
    const len = (s.to ?? 0) - (s.from ?? 0);
    el.innerHTML = `<span class="ctx-label">${len.toFixed(1)}s selected</span>
        <span class="ctx-group" role="group" aria-label="Speed">${[1.5, 2, 3]
          .map((r) => `<button type="button" class="ctx-btn" data-range-rate="${r}" title="Play this stretch ${r}× faster">${ICONS['speed']}${fmtRate(r)}</button>`)
          .join('')}<button type="button" class="ctx-btn" data-range-rate="0.5" title="Slow this stretch down">${ICONS['slow']}0.5×</button></span>
        <button type="button" class="ctx-btn" data-range-zoom title="Zoom in over this stretch">${ICONS['zoom']}Zoom</button>
        <button type="button" class="ctx-btn" data-range-lens title="Magnify a detail over this stretch">${ICONS['lens']}Magnify</button>
        <button type="button" class="ctx-btn cut" data-range-cut title="Remove this stretch from the recording">${CUT_ICON}Cut</button>
        <button type="button" class="ctx-btn" data-range-skip title="Keep the whole screen here — no auto zoom">${ICONS['noZoom']}No zoom</button>
        <button type="button" class="ctx-btn icon" data-range-clear title="Clear selection (Esc)">${ICONS['x']}</button>`;
    return;
  }
  el.innerHTML = flash.text
    ? `<span class="ctx-hint flash">${ICONS['check']}${escapeHtml(flash.text)}</span>`
    : `<span class="ctx-hint">Drag across the <b>speed</b>, <b>zoom</b> or <b>cut</b> row to pick a stretch · click a block to edit it</span>`;
}

const flash = { text: '', timer: 0 as ReturnType<typeof setTimeout> | 0 };
export function flashHint(text: string): void {
  flash.text = text;
  clearTimeout(flash.timer);
  paintContext();
  flash.timer = setTimeout(() => {
    flash.text = '';
    if (ed.sel?.type !== 'range') paintContext();
  }, 1800);
}

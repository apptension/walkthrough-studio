import { desk } from '@/desk/store';
import { clipPlayback, MIN_PLATE_KEEP, PLATE_HOLD_MAX, PLATE_RATE_STEPS, PLATE_TRIM_MAX } from '@/logic/plateTiming';

import { canDuplicate } from './duplicate';
import { clipRemoveBtn, layoutSection, renderLiveCards, renderStyle, section, segBtns } from './inspector';
import { lookValue } from './look';
import { canSwap, layoutsOf, plateTypeHint, plateTypeLabel, stillThumb, SWAP_ICON } from './plateLibrary';
import { resolvePlateColors } from './plateColors';
import { plateColorsSection } from './plateColorsPane';
import {
  atmospherePreview,
  curvePreview,
  cursorPreview,
  depthPreview,
  energyPreview,
  layoutWire,
  motionLengthPreview,
  pacePreview,
  revealPreview,
  sheenPreview,
  tile,
  tileGrid,
  timingBar,
  transitionPreview,
  carryNote,
  CORE_ATMOSPHERES,
  DEPTH_HINT,
  ENERGY_HINT,
  zoomPreview,
} from '@/ui/look/previews';
import { fxClipId, shotKey, visibleLenses, visibleVoiceClips, visibleZoomShots } from './seq';
import { joinStyle, plateReady } from './stage';
import { deckEdit, ed, type InspectorTab } from './state';
import { lengthRange, paceLabel, paceMode, rateFrac, voiceFit, type PaceMode } from './platePace';
import { renderPlateFields } from './text';
import { renderPlateContent } from './plateContentPane';
import { plateInfo } from './timeline';
import type { Clip, DeckPlate, PlateTime } from './types';
import { DUP_ICON, ICONS, PLATE_ICON, T_GLYPH, escapeHtml, fmtRate, fmtT, r3 } from './util';

/**
 * The slide inspector. Every brick on the main line — the opening, a recording, a features
 * interstitial, the closing — is a slide with the same four faces: Design (copy, layout, look,
 * colours), Timing (length, trims, hold, speed, transitions in and out, place in the cut),
 * Layers (what plays over it) and, for recordings, Camera (zoom, motion, cursor and pace).
 */

const cap = (v: string) => (v ? v[0]!.toUpperCase() + v.slice(1) : v);

const KIND_LABEL: Record<string, string> = {
  open: 'Opening',
  close: 'Closing',
  features: 'Features',
  stats: 'Stats',
  statement: 'Statement',
  quote: 'Quote',
  callout: 'Callout',
  journey: 'Journey',
  chapter: 'Chapter',
};

export function slideKind(c: Clip): string {
  if (c.kind === 'live') return 'Recording';
  if (c.plateId === 'open' || c.plateId === 'close') return KIND_LABEL[c.plateId]!;
  const type = plateInfo(c.plateId)?.type || c.type || 'plate';
  return KIND_LABEL[type] || cap(type);
}

const plateKindKey = (c: Clip, info: DeckPlate | null) => (c.plateId === 'open' || c.plateId === 'close' ? c.plateId : info?.type || c.type || '');

function tabsFor(c: Clip): Array<[InspectorTab, string, string]> {
  const tabs: Array<[InspectorTab, string, string]> = [
    ['design', 'Design', ICONS['palette'] || ''],
    ['timing', 'Timing', ICONS['speed'] || ''],
    ['layers', 'Layers', ICONS['plus'] || ''],
  ];
  if (c.kind === 'live') tabs.push(['camera', 'Camera', ICONS['cursor'] || '']);
  return tabs;
}

export function activeTab(c: Clip): InspectorTab {
  const tabs = tabsFor(c).map(([id]) => id);
  return tabs.includes(ed.insTab) ? ed.insTab : 'design';
}

// ─── Head ──────────────────────────────────────────────────────────────────────────────────
/** Every slide in the cut as a proportional bar, with the playhead where it stands. */
function filmstrip(c: Clip): string {
  const total = Math.max(0.01, ed.total);
  const cells = ed.seq
    .map((x) => {
      const w = Math.max(3, (x.dur / total) * 100);
      const tip = `${x.i + 1}. ${slideKind(x)} · ${x.title} · ${x.dur.toFixed(1)}s`;
      return `<button type="button" class="sl-cell ${x.kind}${x.id === c.id ? ' on' : ''}" style="flex-grow:${w.toFixed(2)}" data-goto-clip="${escapeHtml(x.id)}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(`Go to ${x.title}`)}" aria-current="${x.id === c.id}"></button>`;
    })
    .join('');
  const at = `${((Math.min(ed.t, total) / total) * 100).toFixed(2)}%`;
  return `<div class="sl-strip" role="group" aria-label="Slides in the cut">${cells}<i class="sl-play" style="left:${at}" aria-hidden="true"></i></div>`;
}

function slideHead(c: Clip): string {
  const icon = c.kind === 'live' ? ICONS['film'] : ICONS[PLATE_ICON[c.plateId || ''] || 'plate'];
  const dup = canDuplicate();
  const timed = c.kind === 'plate' && c.timing;
  const prev = ed.seq[c.i - 1];
  const next = ed.seq[c.i + 1];
  const step = (to: Clip | undefined, dir: 'prev' | 'next', glyph: string) =>
    `<button type="button" class="sl-step" data-goto-clip="${escapeHtml(to?.id || '')}" ${to ? '' : 'disabled'} title="${escapeHtml(to ? `${dir === 'prev' ? 'Previous' : 'Next'} slide — ${to.title}` : `No ${dir === 'prev' ? 'slide before' : 'slide after'} this one`)}" aria-label="${dir === 'prev' ? 'Previous slide' : 'Next slide'}">${glyph}</button>`;
  return `<div class="sl-head ${c.kind}">
      <div class="sl-head-row">
        <span class="sl-ico">${icon}</span>
        <div class="sl-title">
          <span class="sl-kind">${escapeHtml(slideKind(c))}${c.repeatOf ? ' · replay' : ''}</span>
          <strong title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</strong>
        </div>
        <div class="sl-acts">
          <button type="button" class="ins-icon" data-act="watch-slide" title="Watch this slide" aria-label="Watch this slide">${ICONS['play']}</button>
          <button type="button" class="ins-icon sl-add" data-act="plate-add" title="Add a plate after this slide (P)" aria-label="Add a plate after this slide">${ICONS['plus']}</button>
          ${dup.ok ? `<button type="button" class="ins-icon" data-act="duplicate" title="${escapeHtml(dup.label)} (⌘D)" aria-label="${escapeHtml(dup.label)}">${DUP_ICON}</button>` : ''}
          <span class="sl-act-split" aria-hidden="true"></span>
          ${clipRemoveBtn(c)}
        </div>
      </div>
      <div class="sl-meta">
        <span class="sl-span" title="Starts at ${fmtT(c.at)}, ends at ${fmtT(c.at + c.dur)}">${fmtT(c.at)}<i>→</i>${fmtT(c.at + c.dur)}</span>
        ${
          c.kind === 'plate'
            ? `<button type="button" class="sl-pace${timed ? ' is-set' : ''}" data-act="pace" title="${timed ? 'Retimed — speed &amp; length (S)' : 'Speed &amp; length (S)'}" aria-haspopup="dialog">${ICONS['speed']}<span>${escapeHtml(paceLabel(c))}</span></button>`
            : `<b title="How long this slide plays">${c.dur.toFixed(1)}s${timed ? ' <i class="sl-flag" title="Trimmed or re-speeded — reset it on Timing">retimed</i>' : ''}</b>`
        }
        <span class="sl-nav">${step(prev, 'prev', '‹')}<em>${c.i + 1}<i>/</i>${ed.seq.length}</em>${step(next, 'next', '›')}</span>
      </div>
      ${filmstrip(c)}
    </div>`;
}

function tabBar(c: Clip, on: InspectorTab): string {
  return `<div class="sl-tabs" role="tablist" aria-label="Slide">${tabsFor(c)
    .map(
      ([id, label, icon]) =>
        `<button type="button" role="tab" class="sl-tab${id === on ? ' on' : ''}" data-ins-tab="${id}" aria-selected="${id === on}">${icon}<span>${label}</span></button>`,
    )
    .join('')}</div>`;
}

function repeatNote(c: Clip): string {
  if (!c.repeatOf) return '';
  if (c.kind === 'live') {
    return `<div class="ins-repeat"><p class="ins-note">${DUP_ICON}<span>Replays this stretch of the recording — its zooms, magnifiers and cards come along. Trim it on its own; delete removes only the replay.</span></p></div>`;
  }
  const src = ed.seq.find((x) => x.id === c.repeatOf || (x.kind === 'plate' && x.plateId === c.plateId && !x.repeatOf));
  return `<div class="ins-repeat"><p class="ins-note">${DUP_ICON}<span>Plays ${escapeHtml(src?.title || 'this plate')} again — copy and style edits change both.</span></p><button type="button" class="ins-btn wide" data-act="detach-plate" title="Give this copy its own words and look">${ICONS['plate']}Make it its own plate</button></div>`;
}

export function renderSlide(c: Clip): string {
  const tab = activeTab(c);
  const body =
    tab === 'timing' ? timingPane(c) : tab === 'layers' ? layersPane(c) : tab === 'camera' && c.kind === 'live' ? cameraPane() : designPane(c);
  return `<div class="slide-ins" data-slide-kind="${c.kind}"><div class="sl-chrome">${slideHead(c)}${tabBar(c, tab)}</div>${repeatNote(c)}<div class="sl-pane" data-pane="${tab}">${body}</div></div>`;
}

// ─── Design ────────────────────────────────────────────────────────────────────────────────
type LookOptions = Partial<{
  atmospheres: string[];
  atmosphereLabels: Record<string, string>;
  titleReveals: string[];
  titleRevealLabels: Record<string, string>;
  depths: string[];
  energies: string[];
  layouts: Record<string, Array<{ id: string; label: string; hint: string }>>;
}>;


/** Plate layout tiles — one wireframe per composition of this plate kind. */
export function renderLayoutPicker(info: DeckPlate | null, kind: string): string {
  const layouts = (desk.get().video?.motionOptions as LookOptions | undefined)?.layouts?.[kind] || [];
  if (layouts.length < 2) return '';
  const current = info?.layout || layouts[0]?.id;
  return tileGrid(
    layouts.map((l) => tile(layoutWire(kind, l.id), { attr: 'data-plate-layout', value: l.id, label: l.label, hint: l.hint, on: l.id === current })),
    'lk-layouts',
  );
}

/**
 * One look row as tiles: "Video" (follow the video, previewing what that resolves to) and
 * every option. `own` is the plate's override, if any.
 */
function lookRow(key: string, values: string[], ownRaw: unknown, labelOf: (v: string) => string, preview: (v: string) => string, hintOf: (v: string) => string = labelOf): string[] {
  const vid = lookValue({ motion: {} }, key) || values[0] || '';
  const own = typeof ownRaw === 'string' ? ownRaw : null;
  const has = Boolean(own);
  const extra = `data-look-key="${key}"`;
  return [
    tile(preview(vid), { attr: 'data-look', value: '', label: 'Video', badge: labelOf(vid), hint: `Follow the video — ${labelOf(vid)}`, on: !has, extra }),
    ...values.map((v) => tile(preview(v), { attr: 'data-look', value: v, label: labelOf(v), hint: hintOf(v), on: has && own === v, extra })),
  ];
}

export function renderLookTiles(info: DeckPlate | null): string {
  const m = (info?.motion || {}) as Record<string, unknown>;
  const o = (desk.get().video?.motionOptions || {}) as LookOptions;
  const atmLabel = (v: string) => o.atmosphereLabels?.[v] || cap(v);
  const atms = o.atmospheres || CORE_ATMOSPHERES;
  const core = atms.filter((a) => CORE_ATMOSPHERES.includes(a));
  const more = atms.filter((a) => !CORE_ATMOSPHERES.includes(a));
  const atmTiles = lookRow('atmosphere', core, m['atmosphere'], atmLabel, atmospherePreview);
  const ownAtm = typeof m['atmosphere'] === 'string' ? m['atmosphere'] : '';
  const moreTiles = more.map((v) => tile(atmospherePreview(v), { attr: 'data-look', value: v, label: atmLabel(v), on: ownAtm === v, extra: 'data-look-key="atmosphere"' }));
  const sheenOwn = m['sheen'] === true ? 'on' : m['sheen'] === false ? 'off' : null;
  const sub = (label: string, body: string, note = '') => `<div class="lk-sub"><div class="lk-sub-h"><span>${label}</span>${note}</div>${body}</div>`;
  return (
    sub('Background', tileGrid(atmTiles, 'lk-atms')) +
    (moreTiles.length
      ? `<details class="lk-more"${more.includes(ownAtm) ? ' open' : ''}><summary>More backgrounds <em>${moreTiles.length}</em></summary>${tileGrid(moreTiles, 'lk-atms')}</details>`
      : '') +
    sub('Title reveal', tileGrid(lookRow('titleReveal', o.titleReveals || [], m['titleReveal'], (v) => o.titleRevealLabels?.[v] || cap(v), revealPreview))) +
    sub('Depth', tileGrid(lookRow('depth', o.depths || ['flat', 'soft', 'deep'], m['depth'], cap, depthPreview, (v) => DEPTH_HINT[v] || cap(v)), 'lk-4')) +
    sub('Energy', tileGrid(lookRow('energy', o.energies || ['calm', 'clear', 'punchy'], m['energy'], cap, energyPreview, (v) => ENERGY_HINT[v] || cap(v)), 'lk-4')) +
    sub('Sheen', tileGrid(lookRow('sheen', ['on', 'off'], sheenOwn, cap, (v) => sheenPreview(v === 'on'), (v) => (v === 'on' ? 'A light sweep across titles and cards' : 'No sweep')), 'lk-3'))
  );
}

/**
 * What this slide is, and the way to make it something else: the plate's still, a Swap that
 * opens the library on it, and — once swapped — the plate the script chose, one click back.
 */
function plateCard(c: Clip, info: DeckPlate | null): string {
  const id = c.plateId || '';
  const from = info?.swap || null;
  if (!canSwap(c) && !from) return '';
  const end = id === 'open' || id === 'close';
  const layouts = end ? layoutsOf(id) : [];
  const now = end ? layouts.find((l) => l.id === info?.layout) || layouts[0] : null;
  const thumb = end ? `<span class="pl-thumb is-wire">${layoutWire(id, now?.id || 'classic')}</span>` : stillThumb(info?.type || '', 'pl-thumb');
  const name = end ? now?.label || 'Classic' : plateTypeLabel(info?.type);
  const hint = end ? now?.hint || '' : plateTypeHint(info?.type);
  const wasLabel = end ? layouts.find((l) => l.id === from?.layout)?.label || 'Classic' : from?.label || from?.type || '';
  const origin = from
    ? `<div class="pl-origin"><span class="pl-was">${end ? 'Was' : 'Swapped from'} <b>${escapeHtml(wasLabel)}</b></span><button type="button" class="pl-revert" data-act="plate-revert" title="Back to the plate the script chose">${ICONS['reset']}<span>Revert</span></button></div>`
    : '';
  return `<div class="pl-card${from ? ' is-swapped' : ''}">
      <button type="button" class="pl-face" data-act="plate-swap" title="${end ? 'Another composition for the same words' : 'Swap for another plate — its words carry over'}" aria-haspopup="dialog">
        ${thumb}
        <span class="pl-meta"><em>${end ? `${id === 'open' ? 'Opening' : 'Close'} style` : 'Plate'}</em><b>${escapeHtml(name)}</b><span>${escapeHtml(hint)}</span></span>
        <span class="pl-swap">${SWAP_ICON}<span>Swap</span></span>
      </button>
      ${origin}
    </div>`;
}

function designPane(c: Clip): string {
  if (c.kind === 'live') {
    return (
      (layoutSection(c) ||
        section('motion', 'Layout', `<p class="ins-note subtle">The recording fills the frame. Layouts appear once the video has chapters to place.</p>`)) +
      renderLiveCards(c)
    );
  }
  const info = plateInfo(c.plateId);
  if (ed.missing.has(c.plateId || '')) return `<p class="ins-note pad">${ICONS['warn']} No preview for this slide yet — run Preview plates or Render.</p>`;
  const kind = plateKindKey(c, info);
  const layouts = renderLayoutPicker(info, kind);
  const overrides = (info?.overrides || []).length;
  const styleCount = Object.keys(info?.style || {}).length;
  return (
    plateCard(c, info) +
    renderPlateFields(c.kind === 'plate' ? c.plateId : null) +
    renderPlateContent(c) +
    (layouts ? section('motion', 'Layout', layouts) : '') +
    section('eye', 'Look', renderLookTiles(info), overrides ? `<button type="button" class="ins-link" data-act="look-reset">Use video look</button>` : '') +
    plateColorsSection(c, info) +
    section(
      'palette',
      'Colours & motion',
      renderStyle(c.plateId || '', info),
      styleCount ? `<button type="button" class="ins-link" data-act="style-reset">Reset all</button>` : '',
    )
  );
}

// ─── Timing ────────────────────────────────────────────────────────────────────────────────
const rangeRow = (label: string, attr: string, min: number, max: number, step: number, value: number, unit = 's', set = false) =>
  `<div class="var-row${set ? ' is-set' : ''}"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" ${attr} aria-label="${escapeHtml(label)}" /><output>${value.toFixed(2)}${unit}</output><i class="var-reset"></i></div>`;

const PACE_NOTE: Record<PaceMode, string> = {
  hold: 'Longer holds the settled frame — every element in place — before the exit plays. Shorter trims the exit first, then the intro.',
  stretch: 'Longer or shorter retimes the whole animation to fit — every beat stays, just slower or faster.',
};

function plateTiming(c: Clip): string {
  const pb = clipPlayback(c);
  const pad = c.padOut || 0;
  const row: PlateTime = (deckEdit().plateTimes || []).find((r) => r.id === c.id) || { id: c.id };
  const mode = paceMode();
  const { min, max } = lengthRange(c, mode);
  const need = voiceFit(c);
  const fit = need && Math.abs(need - c.dur) > 0.15 ? need : null;
  const trimMax = r3(Math.min(PLATE_TRIM_MAX, Math.max(0, pb.baseDur - MIN_PLATE_KEEP)));
  const modeBtn = (id: PaceMode, label: string, hint: string) =>
    `<button type="button" role="radio" aria-checked="${mode === id}" class="tm-mode-btn${mode === id ? ' on' : ''}" data-pace-mode="${id}" title="${escapeHtml(hint)}">${ICONS[id === 'hold' ? 'pause' : 'speed']}<span>${label}</span></button>`;
  const f = rateFrac(pb.rate);
  return (
    section(
      'speed',
      'Length',
      `<div class="tm-hero"><output data-tm-dur>${c.dur.toFixed(1)}s</output><span data-tm-sub>${pb.identity ? 'as designed' : `designed ${(pb.baseDur + pad).toFixed(1)}s`}${Math.abs(pb.rate - 1) > 0.001 ? ` · plays at ${fmtRate(pb.rate)}` : ''}${pad ? ` · incl. ${pad.toFixed(1)}s into the next transition` : ''}</span></div>
      <div data-tm-bar>${timingBar(pb)}</div>
      <div class="tm-mode" role="radiogroup" aria-label="When the length changes" data-mode="${mode}">
        <span class="tm-mode-k">Length changes</span>
        <div class="tm-mode-seg">${modeBtn('hold', 'Hold', 'Keep the animation as designed: hold the settled frame, or trim the exit first')}${modeBtn('stretch', 'Stretch', 'Retime the whole animation to fill the length — every beat stays')}</div>
      </div>
      ${rangeRow('Length', 'data-plate-len', min, max, 0.1, r3(c.dur), 's', !pb.identity)}
      <div class="tm-quick">
        <button type="button" class="ins-btn" data-plate-nudge="-1">−1s</button>
        <button type="button" class="ins-btn" data-plate-nudge="1">+1s</button>
        <button type="button" class="ins-btn" data-plate-nudge="2">+2s</button>
        ${fit ? `<button type="button" class="ins-btn" data-plate-fit="${fit}" title="Long enough for the narration that starts on this slide">${ICONS['mic']}Fit voice ${fit.toFixed(1)}s</button>` : ''}
      </div>
      <p class="ins-note subtle" data-tm-note>${PACE_NOTE[mode]}</p>`,
      pb.identity ? '' : `<button type="button" class="ins-link" data-act="plate-time-reset">As designed</button>`,
    ) +
    section(
      'motion',
      'Speed',
      `<div class="ins-quick tm-rates"><span>Preset</span>${segBtns('data-plate-rate', [...PLATE_RATE_STEPS], pb.rate, fmtRate)}</div>
        <div class="var-row tm-rate-row${Math.abs(pb.rate - 1) > 0.001 ? ' is-set' : ''}" style="--f:${f.toFixed(4)}"><span>Fine</span><input type="range" min="0" max="1" step="0.001" value="${f.toFixed(4)}" data-plate-rate-dial aria-label="Animation speed" /><output>${fmtRate(pb.rate)}</output><i class="var-reset"></i></div>
        <p class="ins-note subtle">Speed plays the animation faster or slower; holds stay as long as you set them. The render cuts exactly what the stage shows.</p>`,
    ) +
    section(
      'keep',
      'Trim & hold',
      `${rangeRow('Trim intro', 'data-plate-time="trimStart"', 0, trimMax, 0.05, Number(row.trimStart) || 0, 's', Boolean(row.trimStart))}
        ${rangeRow('Trim exit', 'data-plate-time="trimEnd"', 0, trimMax, 0.05, Number(row.trimEnd) || 0, 's', Boolean(row.trimEnd))}
        ${rangeRow('Hold', 'data-plate-time="hold"', 0, PLATE_HOLD_MAX, 0.1, Number(row.hold) || 0, 's', Boolean(row.hold))}`,
    )
  );
}

function liveTiming(c: Clip): string {
  const d = deckEdit();
  const trim: { trimStart?: number; trimEnd?: number } = (d.trims || []).find((t) => t.id === c.id) || {};
  const recLen = c.recTo - c.recFrom;
  const rawLen = Math.max(0.4, recLen + (trim.trimStart || 0) + (trim.trimEnd || 0));
  const maxHead = Math.max(0, r3(rawLen - 0.4 - (trim.trimEnd || 0)));
  const maxTail = Math.max(0, r3(rawLen - 0.4 - (trim.trimStart || 0)));
  const ramps = d.speed.filter((r) => r.to > c.recFrom && r.from < c.recTo);
  const one = ramps.length === 1 ? ramps[0]! : null;
  const wholeRate = one && one.from <= c.recFrom + 0.05 && one.to >= c.recTo - 0.05 ? one.rate : ramps.length ? '' : 1;
  const trimRow = (k: 'trimStart' | 'trimEnd', label: string, max: number) =>
    `<div class="var-row${trim[k] ? ' is-set' : ''}"><span>${label}</span><input type="range" min="0" max="${max}" step="0.05" value="${trim[k] || 0}" data-live-trim="${k}" aria-label="${label}" /><output>${(trim[k] || 0).toFixed(2)}s</output><button type="button" class="var-reset" data-live-trim-reset="${k}" title="Back to 0" ${trim[k] ? '' : 'hidden'}>${ICONS['reset']}</button></div>`;
  const pct = (s: number) => `${((s / rawLen) * 100).toFixed(3)}%`;
  const bar = `<div class="tb" aria-hidden="true">${trim.trimStart ? `<i class="tb-cut" style="flex-basis:${pct(trim.trimStart)}"></i>` : ''}<i class="tb-play live" style="flex-basis:${pct(recLen)}"><span>Recording</span></i>${trim.trimEnd ? `<i class="tb-cut" style="flex-basis:${pct(trim.trimEnd)}"></i>` : ''}</div>`;
  return (
    section(
      'speed',
      'Length',
      `<div class="tm-hero"><output>${c.dur.toFixed(1)}s</output><span>${Math.abs(c.dur - recLen) > 0.05 ? `${recLen.toFixed(1)}s recorded · ` : ''}${rawLen.toFixed(1)}s captured</span></div>
        ${bar}
        ${trimRow('trimStart', 'Trim head', maxHead)}
        ${trimRow('trimEnd', 'Trim tail', maxTail)}
        <div class="ins-pair">
          <button type="button" class="ins-btn" data-act="trim-head-playhead" title="Drop everything before the playhead in this slide">Head to playhead</button>
          <button type="button" class="ins-btn" data-act="trim-tail-playhead" title="Drop everything after the playhead in this slide">Tail from playhead</button>
        </div>
        <p class="ins-note subtle">Drag the ends of the slide on the timeline to trim. Cut a stretch out from the middle on the Cut row.</p>`,
    ) +
    section('motion', 'Speed', `<div class="ins-quick"><span>Whole slide</span>${segBtns('data-clip-rate', [1, 1.25, 1.5, 2], wholeRate, fmtRate)}</div><p class="ins-note subtle">Ramps on the Speed row speed up or slow down a stretch — see Layers.</p>`)
  );
}

function transitionBlock(x: Clip | null, dir: 'in' | 'out', c: Clip): string {
  if (!x?.join) {
    const edge = dir === 'in' ? 'Starts the video — nothing comes before it.' : 'Ends the video — nothing follows it.';
    return `<div class="tr-block is-edge"><div class="tr-h"><b>${dir === 'in' ? 'In' : 'Out'}</b><em>${edge}</em></div></div>`;
  }
  const styles = ed.deck?.transitionStyles || {};
  const dflt = ed.deck?.transitions?.style || 'directed';
  const pinned = x.join.pinned || {};
  const current = pinned.style || '';
  const [lo, hi] = ed.deck?.ranges?.transitionDuration || [0, 2];
  const other = dir === 'in' ? ed.seq[x.i - 1] : x;
  const glyphStyle = joinStyle(x);
  const carry = x.join.carry;
  const tiles = [
    tile(transitionPreview(dflt === 'directed' ? glyphStyle : dflt), {
      attr: 'data-tr-style',
      value: '',
      label: 'Auto',
      badge: styles[glyphStyle]?.label || glyphStyle,
      hint: `Follows the video (${styles[dflt]?.label || dflt})`,
      on: !current,
      extra: `data-tr-i="${x.i}"`,
    }),
    ...Object.entries(styles)
      .filter(([id]) => id !== 'directed' && (id !== 'continue' || carry))
      .map(([id, s]) =>
        tile(transitionPreview(id), {
          attr: 'data-tr-style',
          value: id,
          label: s.label,
          hint: id === 'continue' && carry && !carry.ok ? `Needs one background on both slides — ${carry.why}` : s.hint,
          on: current === id,
          extra: `data-tr-i="${x.i}"${id === 'continue' && carry && !carry.ok ? ' data-carry-off' : ''}`,
        }),
      ),
  ];
  return `<div class="tr-block">
      <div class="tr-h"><b>${dir === 'in' ? 'In' : 'Out'}</b><em>${dir === 'in' ? 'from' : 'into'} ${escapeHtml(other && other !== c ? other.title : dir === 'out' ? (ed.seq[x.i]?.title ?? '') : '')}</em>${T_GLYPH[glyphStyle] || ''}${
        x.join.pinned ? `<button type="button" class="ins-link" data-tr-reset="${x.i}" title="Let the video pick this transition again">Use auto</button>` : ''
      }</div>
      ${tileGrid(tiles, 'lk-trs')}
      ${carryNote(carry, glyphStyle === 'continue')}
      <div class="var-row"><span>Length</span><input type="range" min="${lo}" max="${hi}" step="0.05" value="${pinned.duration ?? x.overlap}" data-tr-dur="${x.i}" aria-label="Transition length" /><output>${x.overlap.toFixed(2)}s</output><button type="button" class="var-reset" data-tr-watch="${x.i}" title="Watch the transition">${ICONS['play']}</button></div>
    </div>`;
}

function arrangeSection(c: Clip): string {
  const first = c.i <= 0;
  const last = c.i >= ed.seq.length - 1;
  return section(
    'motion',
    'Place',
    `<div class="tm-arrange">
        <button type="button" class="ins-btn" data-clip-move="first" ${first ? 'disabled' : ''} title="Move to the start">⇤ First</button>
        <button type="button" class="ins-btn" data-act="clip-earlier" ${first ? 'disabled' : ''}>${ICONS['undo']}Earlier</button>
        <button type="button" class="ins-btn" data-act="clip-later" ${last ? 'disabled' : ''}>Later${ICONS['redo']}</button>
        <button type="button" class="ins-btn" data-clip-move="last" ${last ? 'disabled' : ''} title="Move to the end">Last ⇥</button>
      </div>
      <p class="ins-note subtle">Or drag the slide along the timeline. ⌫ pulls it out of the cut — restore it from the empty inspector.</p>`,
  );
}

function timingPane(c: Clip): string {
  const next = ed.seq[c.i + 1] || null;
  return (
    (c.kind === 'plate' ? plateTiming(c) : liveTiming(c)) +
    section('transition', 'Transitions', transitionBlock(c.i > 0 ? c : null, 'in', c) + transitionBlock(next, 'out', c)) +
    arrangeSection(c)
  );
}

// ─── Layers ────────────────────────────────────────────────────────────────────────────────
function voiceRows(c: Clip): string {
  const clips = visibleVoiceClips().filter((v) => v.start < c.at + c.dur && v.start + v.dur > c.at);
  return clips
    .map(
      (v) =>
        `<button type="button" class="ins-item" data-goto-voice="${escapeHtml(v.key)}">${ICONS['mic']}<span><b>${escapeHtml(v.textOverride || v.text || v.key)}</b><em>${v.kind || 'line'} · at ${fmtT(Math.max(0, v.start - c.at))} · ${v.dur.toFixed(1)}s${v.mute ? ' · muted' : ''}</em></span><i>›</i></button>`,
    )
    .join('');
}

function layersPane(c: Clip): string {
  const voice = section(
    'mic',
    'Voice',
    `${voiceRows(c) || '<p class="ins-note subtle">No narration plays over this slide.</p>'}<button type="button" class="ins-btn wide" data-act="add-voice-here">${ICONS['plus']}Add a voice line at the playhead</button>`,
  );
  if (c.kind === 'plate') {
    // A plate's marks are written on the plate's own clock, so the times shown here are already
    // "into the slide" — no recording offset to subtract.
    const clip = fxClipId(c);
    const zooms = (ed.deck?.plateZooms || []).filter((z) => z.clip === clip);
    const lenses = visibleLenses().filter((l) => l.clip === clip);
    return (
      section(
        'zoom',
        'Zooms',
        `${
          zooms
            .map(
              (z) =>
                `<button type="button" class="ins-item" data-goto-shot="${escapeHtml(z.id)}">${ICONS['zoom']}<span><b>${z.zoom.toFixed(2)}×</b><em>at ${fmtT(z.t)} for ${z.dur.toFixed(1)}s</em></span><i>›</i></button>`,
            )
            .join('') || '<p class="ins-note subtle">Push into a corner of this slide to land a line or a number.</p>'
        }<button type="button" class="ins-btn wide" data-act="add-zoom">${ICONS['plus']}Zoom in at the playhead</button>`,
      ) +
      section(
        'lens',
        'Magnifiers',
        `${
          lenses
            .map(
              (l) =>
                `<button type="button" class="ins-item" data-goto-lens="${escapeHtml(l.key)}">${ICONS['lens']}<span><b>${escapeHtml(l.label || 'Magnifier')}</b><em>at ${fmtT(l.t)} for ${l.dur.toFixed(1)}s</em></span><i>›</i></button>`,
            )
            .join('') || '<p class="ins-note subtle">A magnifier that blows up one detail without moving the camera.</p>'
        }<button type="button" class="ins-btn wide" data-act="add-lens">${ICONS['plus']}Magnify at the playhead</button>`,
      ) +
      section(
        'speed',
        'Speed',
        `<p class="ins-note subtle">A plate is an animated page, so it plays at one speed rather than in ramps — set it, and any trim or hold, on Timing.</p><button type="button" class="ins-btn wide ghost" data-ins-tab="timing">${ICONS['speed']}Speed &amp; length</button>`,
      ) +
      voice
    );
  }
  const deck = ed.deck!;
  const d = deckEdit();
  const ramps = d.speed.map((r, i) => ({ r, i })).filter(({ r }) => r.to > c.recFrom && r.from < c.recTo);
  const shots = visibleZoomShots().filter((s) => s.end > c.recFrom && s.start < c.recTo);
  const lenses = visibleLenses().filter((l) => l.t < c.recTo && l.t + l.dur > c.recFrom);
  const cam = deck.camera || {};
  const rows = {
    speed: ramps
      .map(
        ({ r, i }) =>
          `<button type="button" class="ins-item" data-goto-ramp="${i}">${r.rate < 1 ? ICONS['slow'] : ICONS['speed']}<span><b>${fmtRate(r.rate)}</b><em>${fmtT(r.from - c.recFrom)}–${fmtT(r.to - c.recFrom)} of the slide</em></span><i>›</i></button>`,
      )
      .join(''),
    zoom: shots
      .map(
        (s) =>
          `<button type="button" class="ins-item" data-goto-shot="${escapeHtml(shotKey(s))}">${ICONS['zoom']}<span><b>${s.zoom.toFixed(2)}× ${s.source === 'auto' ? '<small>auto</small>' : ''}</b><em>at ${fmtT(Math.max(0, s.start - c.recFrom))} for ${(s.end - s.start).toFixed(1)}s</em></span><i>›</i></button>`,
      )
      .join(''),
    lens: lenses
      .map(
        (l) =>
          `<button type="button" class="ins-item" data-goto-lens="${escapeHtml(l.key)}">${l.source === 'off' ? ICONS['lensOff'] : ICONS['lens']}<span><b>${escapeHtml(l.label || 'Magnifier')} ${l.source === 'auto' ? '<small>recorded</small>' : l.source === 'off' ? '<small>off</small>' : ''}</b><em>at ${fmtT(Math.max(0, l.t - c.recFrom))} for ${l.dur.toFixed(1)}s</em></span><i>›</i></button>`,
      )
      .join(''),
  };
  return (
    section(
      'zoom',
      'Zooms',
      `${rows.zoom || `<p class="ins-note subtle">${cam['zoom'] === 'off' ? 'Auto zoom is off — turn it on in Camera, or add one here.' : 'No zooms on this slide.'}</p>`}<button type="button" class="ins-btn wide" data-act="add-zoom">${ICONS['plus']}Zoom in at the playhead</button>`,
    ) +
    section(
      'lens',
      'Magnifiers',
      `${rows.lens || '<p class="ins-note subtle">A magnifier that blows up a small detail without moving the camera.</p>'}<button type="button" class="ins-btn wide" data-act="add-lens">${ICONS['plus']}Magnify at the playhead</button>`,
    ) +
    section(
      'speed',
      'Speed ramps',
      `${rows.speed || '<p class="ins-note subtle">Plays at normal speed. Drag across the Speed row to ramp a stretch.</p>'}<button type="button" class="ins-btn wide" data-act="add-ramp">${ICONS['plus']}Speed up from the playhead</button>`,
    ) +
    (renderLiveCards(c) || '') +
    voice
  );
}

// ─── Camera (recordings) ───────────────────────────────────────────────────────────────────
const ZOOM_HINT: Record<string, string> = { off: 'Keep the whole screen', subtle: 'Gentle push-ins on clicks', bold: 'Close push-ins that fill the frame' };

function cameraPane(): string {
  const deck = ed.deck!;
  const cam = deck.camera || {};
  const cur = deck.cursor || {};
  const curves = deck.curves || {};
  const motions = deck.motions || {};
  const opts = deck.cursorOptions || {};
  const styles = (opts['style'] || ['classic', 'arrow', 'dot']).map((v) => (typeof v === 'string' ? v : v.id));
  const sizes = (opts['size'] || ['s', 'm', 'l']).map((v) => (typeof v === 'string' ? v : v.id));
  const size = String(cur['size'] || 'm');
  const rawPace = deck.pace as unknown;
  const pace = typeof rawPace === 'string' ? rawPace : (rawPace as { id?: string } | undefined)?.id || 'steady';
  const PACES: Array<[string, string, number, string]> = [
    ['calm', 'Calm', 0.85, 'Longer holds — first-time viewers, dense screens'],
    ['steady', 'Steady', 1, 'Authored timing as written'],
    ['brisk', 'Brisk', 1.25, 'Shorter holds, quicker pointer'],
    ['quick', 'Quick', 1.5, 'Fast tour — teasers, launch posts'],
  ];
  return (
    section(
      'zoom',
      'Auto zoom',
      tileGrid(
        ['off', 'subtle', 'bold'].map((z) => tile(zoomPreview(z), { attr: 'data-cam-zoom', value: z, label: cap(z), hint: ZOOM_HINT[z], on: (cam['zoom'] || 'off') === z })),
        'lk-3',
      ) + `<p class="ins-note subtle">Applies to every recording slide; the stage previews it at once.</p>`,
    ) +
    section(
      'speed',
      'Camera motion',
      `<div class="lk-sub"><div class="lk-sub-h"><span>Curve</span></div>${tileGrid(
        Object.entries(curves).map(([id, m]) => tile(curvePreview(m['css'] as string | undefined), { attr: 'data-cam-curve', value: id, label: m.label, hint: m.hint, on: (cam['curve'] || 'glide') === id })),
        'lk-4',
      )}</div>
        <div class="lk-sub"><div class="lk-sub-h"><span>Length</span></div>${tileGrid(
          Object.entries(motions).map(([id, m]) => tile(motionLengthPreview(Number(m['scale']) || 1), { attr: 'data-cam-motion', value: id, label: m.label, hint: m.hint, on: (cam['motion'] || 'natural') === id })),
          'lk-3',
        )}</div>
        <p class="ins-note subtle">Shapes every push-in, pan and the magnifier's open and close.</p>`,
    ) +
    section(
      'cursor',
      'Cursor & pace',
      `<div class="lk-sub"><div class="lk-sub-h"><span>Pointer</span>${segBtns('data-cursor-size', sizes, size, (v) => String(v).toUpperCase())}</div>${tileGrid(
        styles.map((st) => tile(cursorPreview(st, size), { attr: 'data-cursor-style', value: st, label: cap(st), on: (cur['style'] || 'classic') === st })),
        'lk-3',
      )}</div>
        <div class="lk-sub"><div class="lk-sub-h"><span>Pace</span></div>${tileGrid(
          PACES.map(([id, label, tempo, hint]) => tile(pacePreview(tempo), { attr: 'data-pace', value: id, label, hint, badge: `${tempo}×`, on: pace === id })),
          'lk-4',
        )}</div>
        <p class="ins-note">${ICONS['warn']}<span>The pointer and the tempo are captured while recording — they apply the next time you record.</span></p>
        <button type="button" class="ins-btn wide" data-act="record">${ICONS['film']}Record again</button>`,
    )
  );
}

/** Palette the background thumbnails paint in: the slide's own colours over the brand's. */
export function slidePalette(c: Clip | null): { ink: string; surface: string; gold: string; amber: string; teal: string } {
  const info = c?.kind === 'plate' ? plateInfo(c.plateId) : null;
  const raw = ed.deck?.brandColors || {};
  const brand: Record<string, string | undefined> = info ? { ...raw, ...resolvePlateColors(raw, ed.deck?.['plateColors'], info['colors']).colors } : raw;
  const style = info?.style || {};
  const pick = (k: string, fb: string) => style[`--${k}`] || brand[k] || fb;
  return {
    ink: pick('ink', '#05070b'),
    surface: pick('surface', '#111827'),
    gold: pick('gold', '#f5ab1f'),
    amber: pick('amber', '#f57326'),
    teal: pick('teal', brand['gold'] || '#2ed3bf'),
  };
}

export const slideReady = (c: Clip): boolean => c.kind === 'live' || plateReady(c.plateId);

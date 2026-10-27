import type { Overlays } from '@/api/types';
import { api } from '@/desk/api';
import { desk } from '@/desk/store';
import { cardMarkDuration, cardMarkKey } from '@/logic/liveCardStage';
import { lensLoupe, lensZoomCeiling } from '@/logic/livePreview';
import { narratorKeyNote } from '@/logic/narratorNote';
import { neonFxHtml } from '@/ui/neonFx';
import { paintRanges } from '@/ui/rangeFill';
import { helpLabel, helpState, helpTips } from '@/ui/helpStore';

import { aimSpace, deckLens, selectedShot } from './aim';
import { canDuplicate } from './duplicate';
import { sectionForClip } from './layoutPreview';
import { wireInspector } from './inspectorWire';
import { contentFieldFocused, shouldHoldInspectorForContentFocus } from './plateContentSave';
import { selectedLens } from './seq';
import { joinStyle, liveCardAtPlayhead, marksInLiveClip, plateReady, resolveLiveCard } from './stage';
import { audioDesk, deckEdit, ed, htmlPlates, slug } from './state';
import { renderLayoutPicker, renderLookTiles, renderSlide } from './slideInspector';
import { renderPlateFields } from './text';
import { carryNote } from '@/ui/look/previews';
import type { Clip, DeckPlate, NarratorVoice, PlateRow, Selection } from './types';
import { $, CUT_ICON, DUP_ICON, ICONS, LENS_PRESETS, SPEED_PRESETS, T_GLYPH, ZEN_ART, ZOOM_PRESETS, clamp, errMessage, escapeHtml, fmtRate, fmtT, r3 } from './util';

const PLACE_HELP =
  'Drag the block to reorder. Use the trash or ⌫ to pull it out of the cut — restore it anytime from the empty inspector.';

/** The Inspector (#inspectorRoot) renderers from `kit/studio/editor.js`. */

type Choice = string | { id: string; label?: string };

// ─── Live-card look (Look & reveal) ──────────────────────────────────────────────────────
type OverlaySlot = Record<string, string | number | boolean | undefined>;
type OverlayLook = Partial<Omit<Overlays, 'chapter' | 'caption' | 'catalog'>> & {
  preset?: string;
  paper?: string;
  chapter?: OverlaySlot;
  caption?: OverlaySlot;
  catalog?: {
    presets?: Choice[];
    atmospheres?: Choice[];
    seats?: Choice[];
    aligns?: Choice[];
    energies?: Choice[];
    backdrops?: Array<{ id: string; label?: string }>;
  };
};

export function overlayLook(): OverlayLook {
  return (desk.get().video?.overlays as OverlayLook | undefined) || { preset: 'plateMatch', chapter: {}, caption: {}, catalog: {} };
}

/** The Program row (listLiveCards) behind a selected card: carries chapterNo + its effective look. */
export function liveCardRow(sel: Selection | null | undefined): PlateRow | null {
  if (!sel) return null;
  const rows = htmlPlates();
  return rows.find((p) => p.liveCard && sel.cardId && p.id === sel.cardId) || rows.find((p) => p.liveCard && sel.key && p.markKey === sel.key) || null;
}

export function renderCardLook(kind: 'chapter' | 'caption', card: PlateRow | null = null): string {
  const look = overlayLook();
  const videoSlot: OverlaySlot = kind === 'caption' ? look.caption || {} : look.chapter || {};
  const chapterNo = Number(card?.chapterNo) || 0;
  const ownKeys = Array.isArray(card?.lookScope) ? card.lookScope : [];
  const scope = ed.lookScope === 'video' ? 'video' : 'chapter';
  const perChapter = Boolean(chapterNo) && scope === 'chapter';
  // Background rows show what this card will actually paint (chapter look over the video's)
  // in chapter scope, and the video-wide values in video scope. Everything else is video-wide.
  const slot: OverlaySlot = perChapter && card?.look ? (card.look as OverlaySlot) : videoSlot;
  const cat = look.catalog || {};
  const atmospheres = cat.atmospheres || ['waves', 'mesh', 'blobs', 'none'];
  const energies = cat.energies || ['calm', 'clear', 'punchy'];
  const seats = cat.seats || ['bottom-center', 'bottom-left', 'bottom-right'];
  const aligns = cat.aligns || ['left', 'center'];
  const presets = cat.presets || [
    { id: 'plateMatch', label: 'Match plates' },
    { id: 'editorial', label: 'Editorial' },
    { id: 'punchy', label: 'Punchy' },
    { id: 'minimal', label: 'Minimal' },
    { id: 'spotlight', label: 'Spotlight' },
  ];
  const opt = (values: Choice[], current: unknown, labels: Record<string, string> = {}) =>
    values
      .map((v) => {
        const id = typeof v === 'string' ? v : v.id;
        const label = typeof v === 'string' ? labels[v] || v[0]!.toUpperCase() + v.slice(1) : v.label || v.id;
        return `<option value="${escapeHtml(id)}" ${current === id ? 'selected' : ''}>${escapeHtml(label)}</option>`;
      })
      .join('');
  const row = (label: string, control: string) => `<label class="ins-row"><span>${label}</span>${control}</label>`;
  const energyLabels = { calm: 'Calm · slower unfold', clear: 'Clear · balanced', punchy: 'Punchy · snappy reveal' };
  const atmLabels = { waves: 'Waves', mesh: 'Mesh', blobs: 'Blobs', none: 'None' };
  const seatLabels = { 'bottom-center': 'Bottom center', 'bottom-left': 'Bottom left', 'bottom-right': 'Bottom right' };
  const kindLabel = kind === 'caption' ? 'captions' : 'chapters';
  // Backdrop: the solid fill behind the atmosphere. `auto` = black or white from the brand,
  // `none` = clear, a brand role or a custom #hex = that colour at `backdropOpacity` %.
  const paperName = look.paper === '#ffffff' ? 'white' : 'black';
  const backdrops = (
    cat.backdrops || [
      { id: 'auto', label: 'Auto' },
      { id: 'none', label: 'None' },
      { id: 'ink', label: 'Ink' },
      { id: 'surface', label: 'Surface' },
      { id: 'gold', label: 'Accent' },
      { id: 'amber', label: 'Secondary' },
      { id: 'teal', label: 'Support' },
      { id: 'custom', label: 'Custom…' },
    ]
  ).map((c) => (c.id === 'auto' ? { ...c, label: `Auto · ${paperName}` } : c));
  const bd = String(slot['backdrop'] || 'auto');
  const bdCustom = bd.startsWith('#');
  const bdChoice = bdCustom ? 'custom' : bd;
  const bdColored = bdChoice !== 'auto' && bdChoice !== 'none';
  const v = desk.get().video;
  const brandHex = (role: string) => v?.direction?.colors?.[role] || v?.brandFoundation?.colors?.[role] || null;
  const paper = look.paper === '#ffffff' ? '#ffffff' : '#000000';
  const bdHex = bdCustom ? bd : bdColored ? brandHex(bd) || paper : paper;
  const bdAlpha = Math.max(0, Math.min(100, Math.round(Number(slot['backdropOpacity'] ?? 100))));
  const swatchTitle =
    bdChoice === 'none'
      ? 'No backdrop — the recording shows through'
      : bdChoice === 'auto'
        ? `Auto picked ${paperName} from the brand. Pick a colour to override.`
        : 'Pick a custom colour';
  const backdropRows =
    `<div class="ins-row"><span>Backdrop</span><div class="ins-backdrop">` +
    `<select class="ins-select" data-overlay-backdrop aria-label="Backdrop colour behind the background" title="Solid fill behind the background. Auto picks black or white from the brand, None lets the recording show through, or pick a brand colour / custom colour and set its opacity.">${opt(backdrops, bdChoice)}</select>` +
    `<span class="ins-swatch${bdChoice === 'none' ? ' is-off' : ''}" style="--sw:${escapeHtml(bdHex)}" title="${escapeHtml(swatchTitle)}">` +
    `<input type="color" value="${escapeHtml(bdHex)}" data-overlay-backdrop-color aria-label="Custom backdrop colour" /></span></div></div>` +
    (bdColored
      ? `<label class="ins-row"><span>Opacity</span><div class="ins-inline-range"><input type="range" min="0" max="100" step="5" value="${bdAlpha}" data-overlay-backdrop-opacity aria-label="Backdrop opacity" /><output>${bdAlpha}%</output></div></label>`
      : '');
  const toggles =
    kind === 'chapter'
      ? row(
          'Ornaments',
          `<div class="ins-seg ins-seg-wrap">${[
            ['ghost', 'Ghost'],
            ['blobs', 'Blobs'],
            ['rail', 'Rail'],
            ['sheen', 'Sheen'],
          ]
            .map(
              ([key, label]) =>
                `<button type="button" data-overlay-bool="${key}" class="${slot[key!] !== false ? 'on' : ''}" aria-pressed="${slot[key!] !== false}">${label}</button>`,
            )
            .join('')}</div>`,
        )
      : row(
          'Sheen',
          `<div class="ins-seg">${['on', 'off']
            .map(
              (val) =>
                `<button type="button" data-overlay-bool="sheen" data-bool="${val}" class="${(slot['sheen'] !== false) === (val === 'on') ? 'on' : ''}">${val[0]!.toUpperCase() + val.slice(1)}</button>`,
            )
            .join('')}</div>`,
        ) +
        row('Seat', `<select class="ins-select" data-overlay="seat">${opt(seats, slot['seat'] || 'bottom-center', seatLabels)}</select>`) +
        row('Text', `<select class="ins-select" data-overlay="align">${opt(aligns, slot['align'] || 'left', { left: 'Left', center: 'Center' })}</select>`);
  const keyLabels: Record<string, string> = { atmosphere: 'background', backdrop: 'backdrop', backdropOpacity: 'opacity' };
  const slotWord = kindLabel.replace(/s$/, '');
  const scopeRow = chapterNo
    ? row(
        'Applies to',
        `<div class="ins-seg" data-look-scope-seg>${[
          ['chapter', `Chapter ${chapterNo}`, `Background and backdrop apply to chapter ${chapterNo} only — its chapter card and captions`],
          ['video', 'Video default', `Set the video-wide background and backdrop; chapters with a custom look keep it`],
        ]
          .map(
            ([val, label, title]) =>
              `<button type="button" data-look-scope="${val}" class="${scope === val ? 'on' : ''}" aria-pressed="${scope === val}" title="${escapeHtml(title)}">${label}</button>`,
          )
          .join('')}</div>`,
      )
    : '';
  const lookScopeBanner = (() => {
    if (!chapterNo) return '';
    const ownList = ownKeys.map((k) => keyLabels[k] || k).join(' · ');
    if (ownKeys.length) {
      return (
        `<div class="ins-look-scope is-custom" role="status" aria-live="polite">` +
        `<div class="ins-look-scope__head"><span class="ins-look-scope__badge">Ch. ${chapterNo}</span><strong>Custom ${escapeHtml(slotWord)} look</strong></div>` +
        `<p class="ins-look-scope__lede">Overrides the video: <b>${escapeHtml(ownList)}</b></p>` +
        `<div class="ins-look-scope__actions">` +
        `<button type="button" class="ins-btn" data-act="look-apply-all" title="Promote chapter ${chapterNo}’s look to the video — every chapter follows it">${ICONS['sparkle'] || ''}<span>Apply to all</span></button>` +
        `<button type="button" class="ins-btn ghost" data-act="look-follow-video" title="Drop chapter ${chapterNo}’s overrides and follow the video look again"><span>Follow video</span></button>` +
        `</div></div>`
      );
    }
    if (scope === 'video') {
      return (
        `<div class="ins-look-scope is-video" role="status" aria-live="polite">` +
        `<div class="ins-look-scope__head"><span class="ins-look-scope__badge">Video</span><strong>Default for all chapters</strong></div>` +
        `<p class="ins-look-scope__lede">Background and backdrop set the shared look. Chapters you styled on their own stay as they are.</p>` +
        `</div>`
      );
    }
    return (
      `<div class="ins-look-scope is-chapter" role="status" aria-live="polite">` +
      `<div class="ins-look-scope__head"><span class="ins-look-scope__badge">Ch. ${chapterNo}</span><strong>Follows the video look</strong></div>` +
      `<p class="ins-look-scope__lede">Tweaks below save for this chapter only.</p>` +
      `<button type="button" class="ins-link ins-look-scope__switch" data-look-scope="video">Edit video-wide look</button>` +
      `</div>`
    );
  })();
  return (
    row('Preset', `<select class="ins-select" data-overlay-preset>${opt(presets, look.preset || 'plateMatch')}</select>`) +
    scopeRow +
    lookScopeBanner +
    row('Background', `<select class="ins-select" data-overlay="atmosphere">${opt(atmospheres, slot['atmosphere'] || 'waves', atmLabels)}</select>`) +
    backdropRows +
    row('Entrance', `<select class="ins-select" data-overlay="energy">${opt(energies, slot['energy'] || 'clear', energyLabels)}</select>`) +
    toggles +
    `<p class="ins-note subtle">Preset, entrance and ornaments apply to all ${kindLabel} (same as Direction → Live cards). Timing above is this card only. Double-click the block to edit copy.</p>`
  );
}

export function renderCardSel(s: Selection): string {
  const mark = (ed.deck?.marks || []).find((m) => (m.key || cardMarkKey(m)) === s.key);
  const slot = mark?.kind === 'chapter' ? 'chapter' : 'caption';
  const kind = slot === 'chapter' ? 'Chapter' : 'Caption';
  const fields = ed.textMode && ed.liveCardId ? renderPlateFields() : '';
  const dur = Number(s.markDur ?? mark?.dur ?? cardMarkDuration(mark || { kind: 'caption' }));
  const [lo, hi] = ed.deck?.ranges?.cardDur || [0.4, 30];
  const t = Number(s.markT ?? mark?.t ?? 0);
  return (
    head(
      ICONS['plate'] ?? '',
      slot === 'chapter' ? 'plate' : 'live',
      mark?.label || kind,
      `${kind} card${mark?.copyOf ? ' · duplicate' : ''} · ${fmtT(t)} · ${dur.toFixed(1)}s`,
      mark?.copyOf ? removeBtn() : '',
    ) +
    section(
      'plate',
      'Card',
      `<button type="button" class="ins-btn wide primary" data-edit-card="${escapeHtml(s.cardId || '')}" data-mark-t="${t}" data-mark-key="${escapeHtml(s.key || mark?.key || '')}">${neonFxHtml()}${ICONS['plate']}<span>Edit ${slot} copy</span></button>
        <p class="ins-note subtle">${
          mark?.copyOf
            ? `A duplicate shows the same card again — its words and look change with the original. Move or retime it freely.`
            : `Or double-click the block · click text on the stage · tip’s <b>Edit copy</b>. Drag the tip if it covers the words.`
        }</p>`,
    ) +
    section(
      'live',
      'On screen',
      `<div class="ins-big"><output id="insCardDurOut">${dur.toFixed(1)}s</output><input type="range" min="${lo}" max="${hi}" step="0.1" value="${clamp(dur, lo, hi)}" data-card-dur aria-label="How long this card stays on screen" /></div>
        <p class="ins-note subtle">How long this ${slot} stays on the recording.</p>`,
    ) +
    section('motion', 'Look & reveal', renderCardLook(slot, liveCardRow(s))) +
    fields
  );
}

// ─── Inspector ───────────────────────────────────────────────────────────────────────────
export const section = (icon: string, title: string, body: string, extra = ''): string =>
  `<section class="ins-sec"><header>${ICONS[icon] || (typeof icon === 'string' && icon.includes('<svg') ? icon : '')}<strong>${title}</strong>${extra}</header><div class="ins-body">${body}</div></section>`;

export const segBtns = <V extends string | number>(attr: string, values: V[], current: unknown, label: (v: V) => string = (v) => String(v)): string =>
  `<div class="ins-seg">${values.map((v) => `<button type="button" ${attr}="${v}" class="${String(current) === String(v) ? 'on' : ''}">${label(v)}</button>`).join('')}</div>`;

/** Same selection repainting itself (a look pick, Use video look, a background). A new selection animates in. */
export function inspectorStaysPut(prevKey: string, nextKey: string, hasBody: boolean): boolean {
  return Boolean(nextKey) && prevKey === nextKey && hasBody;
}

function inspectorPaintKey(): string {
  if (!ed.deck) return '';
  const s = ed.sel;
  if (!s) return 'none';
  return [s.type, s.id ?? '', s.i ?? ''].join(':');
}

export function renderInspector(): void {
  const root = $('inspectorRoot');
  if (!root) return;
  const panel = root.closest<HTMLElement>('#rightInspector');
  const key = inspectorPaintKey();
  // Same selection + Content caret: keep the DOM so typing does not jump. New selection remounts
  // (clears stuck focus that otherwise deferred bake forever and left the wrong clip on screen).
  if (
    shouldHoldInspectorForContentFocus({
      focused: contentFieldFocused(),
      prevKey: root.dataset['paint'] || '',
      nextKey: key,
    })
  ) {
    return;
  }
  const quiet = inspectorStaysPut(root.dataset['paint'] || '', key, root.childElementCount > 0);
  const scroll = quiet ? panel?.scrollTop ?? 0 : 0;
  const open = quiet
    ? new Set([...root.querySelectorAll('details[open] summary')].map((s) => s.textContent?.trim() || ''))
    : null;
  const focus = quiet ? focusedField(root) : null;
  if (!ed.deck) {
    root.innerHTML = `<p class="panel-lede">Loading the cut…</p>`;
    return;
  }
  const s = ed.sel;
  let html = '';
  if (!s) html = renderEmpty();
  else if (s.type === 'clip') {
    const c = ed.seq.find((x) => x.id === s.id);
    html = !c ? renderEmpty() : c.kind === 'plate' ? renderPlate(c) : renderLive(c);
  } else if (s.type === 'ramp') html = renderRamp(s.i ?? -1);
  else if (s.type === 'zoom') html = renderZoom();
  else if (s.type === 'skip') html = renderSkip(s.i ?? -1);
  else if (s.type === 'lens') html = renderLens();
  else if (s.type === 'voice') html = renderVoice();
  else if (s.type === 'music' || s.type === 'mix') html = renderMusic();
  else if (s.type === 'ride') html = renderRide();
  else if (s.type === 'join') html = renderJoin(s.i ?? -1);
  else if (s.type === 'range') html = renderRange(s);
  else if (s.type === 'cut') html = renderCut(s.i ?? -1);
  else if (s.type === 'card') html = renderCardSel(s);
  // Class first, so the new sections are born without the entrance — adding it after would still flash one frame.
  panel?.classList.toggle('is-quiet', quiet);
  root.innerHTML = html;
  root.dataset['paint'] = key;
  if (quiet && panel) {
    panel.scrollTop = scroll;
    open?.forEach((label) => {
      root.querySelectorAll('details').forEach((d) => {
        if ((d.querySelector('summary')?.textContent?.trim() || '') === label) d.open = true;
      });
    });
    restoreFocusedField(root, focus);
  }
  // Every inspector range is the same meter the stage panels drag.
  paintRanges(root);
  wireInspector();
  wireInsHelp(root);
}

type FocusedField = {
  sel: string;
  value?: string;
  start?: number | null;
  end?: number | null;
};

/** Capture look tiles and Content inputs so a quiet remount can put the caret back. */
function focusedField(root: HTMLElement): FocusedField | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || !root.contains(el)) return null;
  const tile = el.closest<HTMLElement>('[data-look-key]');
  if (tile?.dataset['lookKey'] != null) {
    return {
      sel: `[data-look-key="${CSS.escape(tile.dataset['lookKey'])}"][data-look="${CSS.escape(tile.dataset['look'] || '')}"]`,
    };
  }
  if (!el.id) return null;
  const sel = `#${CSS.escape(el.id)}`;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return { sel, value: el.value, start: el.selectionStart, end: el.selectionEnd };
  }
  return { sel };
}

function restoreFocusedField(root: HTMLElement, focus: FocusedField | null): void {
  if (!focus?.sel) return;
  const next = root.querySelector<HTMLElement>(focus.sel);
  if (!next) return;
  if ((next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) && focus.value != null) {
    next.value = focus.value;
    next.focus({ preventScroll: true });
    try {
      if (focus.start != null && focus.end != null) next.setSelectionRange(focus.start, focus.end);
    } catch {
      /* some input types reject selection */
    }
    return;
  }
  next.focus({ preventScroll: true });
}

/** Bind string-HTML `.help-tip[data-ins-help]` buttons to the shared HelpPop. */
function wireInsHelp(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>('.help-tip[data-ins-help]').forEach((btn) => {
    const text = btn.dataset['insHelp'] || '';
    if (!text) return;
    btn.addEventListener('pointerenter', () => {
      if (helpState().pinned) return;
      helpTips.showSoon(btn, text);
    });
    btn.addEventListener('pointerleave', () => {
      helpTips.cancelShow();
      if (!helpState().pinned) helpTips.scheduleHide();
    });
    btn.addEventListener('focus', () => {
      if (btn.matches(':focus-visible')) helpTips.show(btn, text);
    });
    btn.addEventListener('blur', () => {
      if (!helpState().pinned) helpTips.scheduleHide();
    });
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = helpState().anchor === btn;
      if (open && helpState().pinned) helpTips.hide();
      else helpTips.show(btn, text, true);
    });
  });
}

export const head = (icon: string, kind: string, title: string, sub: string, actions = ''): string =>
  `<div class="ins-head ${kind}"><span class="ins-ico">${icon}</span><div><strong>${escapeHtml(title)}</strong><em>${sub}</em></div>${dupBtn()}${actions}</div>`;

function dupBtn(): string {
  const dup = canDuplicate();
  return dup.ok ? `<button type="button" class="ins-icon" data-act="duplicate" title="${escapeHtml(dup.label)} (⌘D)" aria-label="${escapeHtml(dup.label)}">${DUP_ICON}</button>` : '';
}

export function renderEmpty(): string {
  const omitted = ed.deck?.omitted || [];
  const restore =
    omitted.length > 0
      ? `<div class="ins-omitted"><strong>Removed from the cut</strong>${omitted
          .map(
            (o) =>
              `<button type="button" class="ins-item" data-act="restore-omit" data-omit-id="${escapeHtml(o.id)}">${
                o.kind === 'live' ? ICONS['film'] : ICONS['plate']
              }<span><b>${escapeHtml(o.title || o.id)}</b><em>${escapeHtml(o.kind)}${o['type'] ? ` · ${escapeHtml(o['type'])}` : ''}</em></span><i>Restore</i></button>`,
          )
          .join('')}</div>`
      : '';
  return `<div class="ins-empty">${ZEN_ART['pointer']}<strong>Click anything on the timeline 👆</strong>
      <ul>
        <li>${ICONS['plate']}<span><b>A plate</b> — click text on the stage to edit it, or change colours and motion</span></li>
        <li>${ICONS['film']}<span><b>A recording clip</b> — speed, zoom and cursor · drag aim boxes on the stage</span></li>
        <li>${ICONS['plate']}<span><b>A chapter or caption</b> — own rows under clips · look &amp; reveal on the right · double-click to edit copy</span></li>
        <li>${T_GLYPH['dissolve']}<span><b>A diamond</b> — the transition between two clips</span></li>
        <li>${ICONS['speed']}<span><b>Drag across the speed, zoom or cut row</b> to pick a stretch — a drag on Cut removes it</span></li>
        <li>${ICONS['lens']}<span><b>Magnify</b> — a loupe over a small detail, like a total or a badge</span></li>
        <li>${ICONS['mic']}<span><b>A voice line or the music</b> — move it, set its level, shape the master</span></li>
      </ul>
      ${renderAddVoice()}
      <p class="ins-keys"><kbd>Space</kbd> play · <kbd>⌫</kbd> remove section or effect · <kbd>R</kbd> replay · <kbd>S</kbd> speed · <kbd>Z</kbd> zoom · <kbd>M</kbd> magnify · <kbd>C</kbd> cut · <kbd>⌘D</kbd> duplicate · <kbd>⌘Z</kbd> undo</p>
      ${restore}</div>`;
}

/** Add a free-standing voice line at the playhead — upload, mic, or ElevenLabs. */
export function renderAddVoice(): string {
  const at = fmtT(ed.t);
  return section(
    'mic',
    'Add voice',
    `<textarea class="ins-text" data-voice-add-text rows="2" maxlength="600" spellcheck="true" aria-label="Optional line to speak" placeholder="Optional words to speak (or leave blank and upload / record)"></textarea>
      <div class="ins-pair voice-add">
        <button type="button" class="ins-btn" data-act="voice-add-eleven" title="Speak with ElevenLabs at the playhead">${ICONS['sparkle']}Speak</button>
        <button type="button" class="ins-btn" data-act="voice-add-upload" title="Add a line and attach an MP3">${ICONS['upload']}Upload MP3</button>
        <button type="button" class="ins-btn" data-act="voice-add-mic" title="Add a line and record from the mic">${ICONS['mic']}Record</button>
      </div>
      <p class="ins-note subtle">Lands at the playhead (${at}). Upload or record skips ElevenLabs; Speak needs words above.</p>`,
  );
}

export function clipRemoveBtn(_c: Clip): string {
  const alone = ed.seq.length <= 1;
  return `<button type="button" class="ins-icon danger" data-act="remove" title="${
    alone ? 'Keep at least one section' : 'Remove from the cut (⌫)'
  }" ${alone ? 'disabled' : ''}>${ICONS['trash']}</button>`;
}

const SIZE_LABEL: Record<string, string> = { small: 'Small', medium: 'Medium', large: 'Large' };
const SIDE_PLACEMENTS = new Set(['left', 'right', 'top', 'bottom']);

/** Where this recording section sits in the frame, and the words beside it. */
export function layoutSection(c: Clip): string {
  const pack = ed.deck?.layouts;
  const current = sectionForClip(c);
  if (!pack?.sections?.length || !current) return '';
  const placement = current.layout?.placement || 'fill';
  const size = current.layout?.size || 'medium';
  const textOn = Boolean(current.layout?.text?.on);
  const side = SIDE_PLACEMENTS.has(placement);
  const title = current.layout?.text?.title ?? current.copy?.title ?? '';
  const body = current.layout?.text?.body ?? current.copy?.body ?? '';
  const tiles = Object.entries(pack.placements || {})
    .map(
      ([id, meta]) =>
        `<button type="button" class="layout-place${id === placement ? ' on' : ''}" data-layout-place="${id}" title="${escapeHtml(meta.hint)}"><i class="lp lp-${id}" aria-hidden="true"></i><span>${escapeHtml(meta.label)}</span></button>`,
    )
    .join('');
  const copy = side
    ? `<label class="ins-check"><input type="checkbox" data-layout-text ${textOn ? 'checked' : ''} /> Side text</label>${
        textOn
          ? `<label class="layout-field"><span>Title</span><input type="text" data-layout-title maxlength="80" value="${escapeHtml(title)}" aria-label="Title beside the recording" /></label>
        <label class="layout-field"><span>Text</span><textarea data-layout-body maxlength="240" rows="3" aria-label="Text beside the recording">${escapeHtml(body)}</textarea></label>`
          : ''
      }`
    : '';
  return section(
    'motion',
    'Layout',
    `<div class="layout-places" role="group" aria-label="Where the recording sits">${tiles}</div>
      <div class="ins-quick"><span>Size</span>${segBtns('data-layout-size', pack.sizes?.length ? pack.sizes : ['small', 'medium', 'large'], placement === 'fill' ? '' : size, (v) => SIZE_LABEL[String(v)] || String(v))}</div>
      ${copy}
      <div class="ins-pair">
        <button type="button" class="ins-btn" data-act="layout-all" ${current.custom ? '' : 'disabled'}>Apply to all sections</button>
        <button type="button" class="ins-btn ghost" data-act="layout-reset" ${current.custom ? '' : 'disabled'}>Video default</button>
      </div>
      <p class="ins-note subtle">${escapeHtml(pack.placements?.[placement]?.hint || 'Edge to edge.')} Each stretch between chapters has its own layout, and the stage shows the frame the render will make.</p>`,
  );
}

export function placeSection(c: Clip): string {
  return section(
    'motion',
    'Place',
    `<div class="ins-pair">
        <button type="button" class="ins-btn" data-act="clip-earlier" ${c.i <= 0 ? 'disabled' : ''}>${ICONS['undo']}Earlier</button>
        <button type="button" class="ins-btn" data-act="clip-later" ${c.i >= ed.seq.length - 1 ? 'disabled' : ''}>Later${ICONS['redo']}</button>
      </div>`,
    `<button type="button" class="help-tip" data-ins-help="${escapeHtml(PLACE_HELP)}" aria-label="${escapeHtml(helpLabel('Place'))}" aria-expanded="false">?</button>`,
  );
}

export function renderPlate(c: Clip): string {
  return renderSlide(c);
}

export function renderJoinsFor(c: Clip): string {
  const inC = c.i > 0 ? c : null;
  const outC = ed.seq[c.i + 1] || null;
  const row = (x: Clip | null, label: string) => {
    if (!x?.join) return '';
    const st = joinStyle(x);
    return `<button type="button" class="ins-join" data-goto-join="${x.i}">${T_GLYPH[st] || ICONS['transition']}<span><b>${label}</b><em>${escapeHtml(ed.deck?.transitionStyles?.[st]?.label || st)} · ${x.overlap.toFixed(2)}s${x.join.pinned ? ' · yours' : ''}</em></span><i>›</i></button>`;
  };
  const rows = row(inC, 'Transition in') + row(outC, 'Transition out');
  return rows ? section('transition', 'Transitions', rows) : '';
}

/** The plate's layout picker and look tiles, as the Design tab shows them. */
export function renderLook(info: DeckPlate | null): string {
  const kind = info?.id === 'open' || info?.id === 'close' ? info.id : info?.type || '';
  return renderLayoutPicker(info, kind) + renderLookTiles(info);
}

export function liveVarValue(name: string): string {
  try {
    const doc = $<HTMLIFrameElement>('plateFrame')?.contentDocument;
    if (!doc?.documentElement) return '';
    return getComputedStyle(doc.documentElement).getPropertyValue(name).trim();
  } catch {
    return '';
  }
}

export function toHex(color: unknown): string {
  const c = String((color as string | number | null | undefined) || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${[...c.slice(1)].map((ch) => ch + ch).join('')}`.toLowerCase();
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1]!.split(/[\s,/]+/).map(Number);
    if ([r, g, b].every((n) => Number.isFinite(n)))
      return `#${[r!, g!, b!].map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('')}`;
  }
  return '#000000';
}

export function renderStyle(id: string, info: DeckPlate | null): string {
  const plateType = info?.type || id;
  const groups = (ed.deck?.styleGroups || []).filter((g) => {
    const only = g['only'] as string[] | undefined;
    const onlyTypes = g['onlyTypes'] as string[] | undefined;
    if (only?.length && !only.includes(id)) return false;
    if (onlyTypes?.length && !onlyTypes.includes(plateType)) return false;
    return true;
  });
  const style = info?.style || {};
  const ready = plateReady(id);
  if (!ready) return `<p class="ins-note">Loading the plate…</p>`;
  const palette = groups.find((g) => g.id === 'palette');
  const rest = groups.filter((g) => g !== palette);
  const swatches = palette
    ? `<div class="ins-swatches">${palette.vars
        .map((v) => {
          const set = style[v.name] != null;
          const hex = toHex(style[v.name] ?? liveVarValue(v.name));
          return `<label class="sw${set ? ' is-set' : ''}" title="${escapeHtml(v.label)}${set ? ' · changed — right-click to reset' : ''}" data-var="${v.name}"><input type="color" value="${hex}" data-var-color="${v.name}" aria-label="${escapeHtml(v.label)}" /><i style="background:${hex}"></i><span>${escapeHtml(v.label)}</span></label>`;
        })
        .join('')}</div>`
    : '';
  const rows = rest
    .map((g) => {
      const n = g.vars.filter((v) => style[v.name] != null).length;
      const body = g.vars
        .map((v) => {
          const set = style[v.name] != null;
          const current = style[v.name] ?? liveVarValue(v.name);
          const reset = set
            ? `<button type="button" class="var-reset" data-var-reset="${v.name}" title="Back to the brand value">${ICONS['reset']}</button>`
            : '<i class="var-reset"></i>';
          if (v.type === 'toggle') {
            const on = String(current).trim() !== '0' && current !== '';
            return `<div class="var-row${set ? ' is-set' : ''}" data-var="${v.name}"><span>${escapeHtml(v.label)}</span><label class="ins-switch"><input type="checkbox" data-var-toggle="${v.name}" ${on ? 'checked' : ''} aria-label="${escapeHtml(v.label)}" /><i></i></label>${reset}</div>`;
          }
          const num = parseFloat(current);
          const val = Number.isFinite(num) ? num : v.min;
          return `<div class="var-row${set ? ' is-set' : ''}" data-var="${v.name}"><span>${escapeHtml(v.label)}</span><input type="range" min="${v.min}" max="${v.max}" step="${v.step}" value="${val}" data-var-range="${v.name}" data-unit="${v.unit || ''}" aria-label="${escapeHtml(v.label)}" /><output>${val}${v.unit || ''}</output>${reset}</div>`;
        })
        .join('');
      return `<details class="var-group"${n ? ' open' : ''}><summary>${ICONS[g.icon || ''] || ''}${escapeHtml(g.label)}${n ? `<em>${n}</em>` : ''}</summary>${body}</details>`;
    })
    .join('');
  return `${swatches}${rows}<p class="ins-note subtle">Changes show on the stage instantly and render the same way.</p>`;
}

export function renderLiveCards(c: Clip): string {
  const marks = marksInLiveClip(c);
  const at = ed.liveCardId || liveCardAtPlayhead()?.id || null;
  const written = new Set((deckEdit().cards || []).filter((r) => r.label && !r.copyOf).map((r) => r.key));
  const rows = marks
    .map((m) => {
      const card = resolveLiveCard(m);
      const id = card?.id || '';
      const on = id && (at === id || (ed.textMode && ed.liveCardId === id));
      const kind = m.kind === 'chapter' ? 'Chapter' : 'Caption';
      const key = m.key || cardMarkKey(m);
      const from = written.has(key) ? 'Yours' : kind;
      return `<button type="button" class="ins-item${on ? ' is-on' : ''}" data-edit-card="${escapeHtml(id)}" data-mark-t="${m.t}" data-mark-key="${escapeHtml(key)}">${ICONS['plate']}<span><b>${escapeHtml(m.label || kind)}</b><em>${from} · at ${fmtT(Math.max(0, m.t - c.recFrom))}${
        id ? '' : ' · will rebuild'
      }</em></span><i>${ed.textMode && ed.liveCardId === id ? 'Editing' : 'Edit'}</i></button>`;
    })
    .join('');
  const add = `<button type="button" class="ins-btn wide" data-act="add-caption">${ICONS['plate']}Add a caption at the playhead</button>`;
  const fields = ed.textMode && ed.liveCardId ? renderPlateFields() : '';
  return (
    section(
      'plate',
      'Cards',
      `${rows}${add}<p class="ins-note subtle">${
        marks.length === 0
          ? 'The script\u2019s steps become captions. Add one of your own here and write it on the stage \u2014 no re-record needed.'
          : ed.deck?.live?.overlaysMode === 'clean'
            ? 'Stage shows the live Direction look. Save copy \u00b7 Produce bakes into the master.'
            : 'Stage shows the live Direction look (covers the burned take). Save copy \u00b7 Re-record once for a clean master, then Produce bakes.'
      }</p>`,
    ) + fields
  );
}


export function renderLive(c: Clip): string {
  return renderSlide(c);
}

const removeBtn = (): string => `<button type="button" class="ins-icon danger" data-act="remove" title="Remove (⌫)">${ICONS['trash']}</button>`;
const watchBtn = (): string => `<button type="button" class="ins-btn wide ghost" data-act="preview-sel">${ICONS['replay']}Watch it</button>`;

export function renderRamp(i: number): string {
  const r = deckEdit().speed[i];
  if (!r) return renderEmpty();
  const [lo, hi] = ed.deck?.ranges?.speed || [0.25, 4];
  const hit = (ed.deck?.conflicts || []).find((c) => c.from === r.from && c.to === r.to);
  const len = r.to - r.from;
  return (
    head(r.rate < 1 ? (ICONS['slow'] ?? '') : (ICONS['speed'] ?? ''), 'speed', r.rate < 1 ? 'Slow motion' : 'Speed up', `${len.toFixed(1)}s of recording plays in <b>${(len / r.rate).toFixed(1)}s</b>`, removeBtn()) +
    section(
      'speed',
      'Speed',
      `<div class="ins-big"><output id="insRateOut">${fmtRate(r.rate)}</output><input type="range" min="${lo}" max="${hi}" step="0.05" value="${r.rate}" data-ramp-rate aria-label="Speed" /></div>
        ${segBtns('data-ramp-preset', SPEED_PRESETS.filter((v) => v >= lo && v <= hi), r.rate, fmtRate)}
        ${hit ? `<p class="ins-warn">${ICONS['warn']}Covers ${(hit.marks || []).map((m) => `“${escapeHtml(m.label || m.kind)}”`).join(', ')} — chapter cards and captions play faster too.</p>` : ''}
        <p class="ins-note subtle">Drag the ends of the block on the timeline to change where it starts and stops.</p>`,
    ) +
    watchBtn()
  );
}

export function renderZoom(): string {
  const shot = selectedShot();
  if (!shot) return renderEmpty();
  const auto = shot.source === 'auto';
  const [lo, hi] = ed.deck?.ranges?.zoom || [1, 3];
  const len = shot.end - shot.start;
  const remove = removeBtn();
  if (auto) {
    return (
      head(ICONS['zoom'] ?? '', 'zoom', 'Auto zoom', `${shot.zoom.toFixed(2)}× · ${len.toFixed(1)}s · follows the clicks`, remove) +
      section(
        'zoom',
        'Zoom',
        `<p class="ins-note">Added automatically where the pointer clicked. Take it over to aim, resize or retime it — or remove it to keep the whole screen.</p>
          <button type="button" class="ins-btn wide primary" data-act="adopt">${neonFxHtml()}${ICONS['target']}Take over this zoom</button>`,
      ) +
      watchBtn()
    );
  }
  return (
    head(ICONS['zoom'] ?? '', 'zoom', 'Zoom', `${shot.zoom.toFixed(2)}× · ${len.toFixed(1)}s`, remove) +
    section(
      'zoom',
      'Zoom',
      `<div class="ins-big"><output id="insZoomOut">${shot.zoom.toFixed(2)}×</output><input type="range" min="${lo}" max="${hi}" step="0.05" value="${shot.zoom}" data-shot-zoom aria-label="Zoom level" /></div>
        ${segBtns('data-zoom-preset', ZOOM_PRESETS.filter((v) => v >= lo && v <= hi), shot.zoom, (v) => `${v}×`)}
        <button type="button" class="ins-btn wide ghost" data-act="zoom-center">${ICONS['target']}Centre the zoom</button>
        <p class="ins-note">${ICONS['target']} Drag the stage to aim, or double-click the spot to zoom on. Scroll or drag a corner to push in or out; arrow keys nudge once you click the stage.</p>`,
    ) +
    watchBtn()
  );
}

export function renderLens(): string {
  const l = selectedLens();
  if (!l) return renderEmpty();
  const remove = removeBtn();
  const watch = watchBtn();
  if (l.source === 'off') {
    return (
      head(ICONS['lensOff'] ?? '', 'lens', 'Magnifier off', `${escapeHtml(l.label)} · ${l.dur.toFixed(1)}s · recorded`) +
      section(
        'lens',
        'Magnifier',
        `<p class="ins-note">The recording asked for a loupe here; you switched it off, so the frame stays as it is.</p><button type="button" class="ins-btn wide primary" data-act="lens-on">${neonFxHtml()}${ICONS['lens']}Turn it back on</button>`,
      )
    );
  }
  if (l.source === 'auto') {
    return (
      head(ICONS['lens'] ?? '', 'lens', escapeHtml(l.label), `Recorded · ${l.zoom.toFixed(1)}× · ${l.dur.toFixed(1)}s`, remove) +
      section(
        'lens',
        'Magnifier',
        `<p class="ins-note">The flow asked for this loupe while recording${(l.path?.length ?? 0) > 1 ? ' and it follows the pointer' : ''}. Take it over to aim, resize or retime it — or remove it to keep the frame clean.</p>
          <button type="button" class="ins-btn wide primary" data-act="adopt-lens">${neonFxHtml()}${ICONS['target']}Take over this magnifier</button>`,
      ) +
      watch
    );
  }
  const own: { w?: number; h?: number; zoom?: number | undefined } = deckLens(l) || {};
  const [lo, hi] = ed.deck?.ranges?.lensZoom || [1.2, 2.4];
  const w = own.w ?? l.rect.w;
  const h = own.h ?? l.rect.h;
  // The loupe has a largest size for the frame, so a wide area can only take so much strength — the slider
  // stops where the render would start ignoring it, and the readout is what the loupe draws.
  const frame = aimSpace(l.clip);
  const ceiling = r3(clamp(lensZoomCeiling(Math.max(w, h), frame), lo, hi));
  const loupe = lensLoupe(Math.max(w, h), own.zoom, frame);
  const z = Math.min(own.zoom ?? loupe.zoom, ceiling);
  return (
    head(ICONS['lens'] ?? '', 'lens', escapeHtml(l.label || 'Magnifier'), `${loupe.zoom.toFixed(1)}× · ${l.dur.toFixed(1)}s · loupe ${loupe.diameter}px`, remove) +
    section(
      'lens',
      'Strength',
      `<div class="ins-big"><output id="insLensOut">${loupe.zoom.toFixed(2)}×${own.zoom ? '' : ' auto'}</output><input type="range" min="${lo}" max="${ceiling}" step="0.05" value="${z}" data-lens-zoom aria-label="Magnification" ${ceiling - lo < 0.05 ? 'disabled' : ''} /></div>
        <div class="ins-seg"><button type="button" data-lens-preset="" class="${own.zoom ? '' : 'on'}">Auto</button>${LENS_PRESETS.filter((v) => v >= lo && v <= hi)
          .map((v) => `<button type="button" data-lens-preset="${v}" class="${own.zoom === v ? 'on' : ''}" ${v > ceiling + 1e-6 ? 'disabled' : ''}>${v}×</button>`)
          .join('')}</div>
        <p class="ins-note" data-lens-cap>${ceiling < hi - 1e-6 ? `Up to ${ceiling.toFixed(2)}× for a ${Math.round(Math.max(w, h))}px area — shrink the area for a stronger loupe.` : ''}</p>`,
    ) +
    section(
      'target',
      'Area',
      `<div class="var-row"><span>Width</span><input type="range" min="16" max="800" step="2" value="${w}" data-lens-size="w" aria-label="Magnified width" /><output>${w}px</output><i class="var-reset"></i></div>
        <div class="var-row"><span>Height</span><input type="range" min="12" max="400" step="2" value="${h}" data-lens-size="h" aria-label="Magnified height" /><output>${h}px</output><i class="var-reset"></i></div>
        <p class="ins-note">${ICONS['target']} Drag the loupe on the stage to aim it and its edge grip to resize. Scroll over it to resize, ⌥-scroll for strength; arrow keys nudge once you click it. A bigger area gets a gentler, wider loupe.</p>`,
    ) +
    watch
  );
}

export function dbSlider(attr: string, value: number, label: string): string {
  const [lo, hi] = ed.deck?.ranges?.gain || [-18, 12];
  return `<div class="ins-big"><output>${Number(value).toFixed(1)} dB</output><input type="range" min="${lo}" max="${hi}" step="0.5" value="${value}" ${attr} aria-label="${label}" /></div>`;
}

export function renderVoice(): string {
  const clip = (ed.deck?.audio?.voiceClips || []).find((c) => c.key === ed.sel?.key);
  if (!clip) return renderEmpty();
  const [nlo, nhi] = ed.deck?.ranges?.nudge || [-6, 6];
  const nudge = clip.nudge || 0;
  const fit: string[] = [];
  if ((clip.long ?? 0) > 0.1) fit.push(`Runs ${(clip.long ?? 0).toFixed(1)}s past its window on this cut — shorten the line or give the step more time.`);
  if ((clip.late ?? 0) > 1.5) fit.push(`Starts ${(clip.late ?? 0).toFixed(1)}s late: the previous line runs over.`);
  const moved = clip.moved ? `<p class="ins-note">Moves to ${fmtT(clip.start - nudge)} on the next render — the mix has it at ${fmtT(clip.writtenStart)}.</p>` : '';
  const ranges: Partial<NonNullable<NonNullable<typeof ed.deck>['ranges']>> = ed.deck?.ranges || {};
  const [fadeLo, fadeHi] = ranges.voiceFade || [0, 2];
  const [spLo, spHi] = ranges.voiceSpeed || [0.8, 1.3];
  const minSec = ranges.voiceMinSec || 0.3;
  const textMax = ranges.voiceTextMax || 600;
  const full = clip.full || clip.dur;
  const shaped = clip.trimStart || clip.trimEnd || clip.fadeIn || clip.fadeOut;
  const take = clip.take || 1;
  const takes = Math.max(take, clip.takes || 1);
  const mode = ed.deck?.audio?.narrator?.mode || 'live';
  const shown = clip.textOverride || clip.text || '';
  const rewritten = !!clip.textOverride && clip.written && clip.textOverride !== clip.written;
  const speeds: number[] = [];
  for (let s = spLo; s <= spHi + 1e-6; s = r3(s + 0.05)) speeds.push(r3(s));
  const speed = clip.speed || clip.spokenSpeed || 1;
  const busy = ed.regenerating === clip.key;
  const cached = new Set(clip.cachedTakes || []);
  // The line differs from the script: another take, other words, or another pace.
  const altered = take > 1 || !!clip.textOverride || (clip.speed != null && Math.abs(clip.speed - 1) > 0.01);
  const sources = clip.takeSources || {};
  const sourceLabel = (src: string | null | undefined) => (src === 'mic' ? 'mic' : src === 'upload' ? 'upload' : src === 'eleven' ? 'ElevenLabs' : '');
  const chips: string[] = [];
  for (let n = 1; n <= takes; n++) {
    const isOn = n === take;
    const ready = cached.has(n);
    const src = sources[String(n)] || (isOn ? clip.source : null);
    const srcTip = sourceLabel(src);
    chips.push(
      `<button type="button" class="take-chip${isOn ? ' is-on' : ''}${ready ? ' is-cached' : ''}${src === 'mic' || src === 'upload' ? ' is-custom' : ''}" data-take="${n}" aria-pressed="${isOn}" ${busy ? 'disabled' : ''} title="Take ${n}${srcTip ? ` · ${srcTip}` : ''}${isOn ? ' · playing' : ready ? ' · ready, switches at once' : ' · spoken again on switch'}">${n}${src === 'mic' ? '<i>m</i>' : src === 'upload' ? '<i>↑</i>' : ''}</button>`,
    );
  }
  const recording = ed.micRecord?.key === clip.key;
  const curSrc = sources[String(take)] || clip.source;
  const srcNote = curSrc === 'mic' ? 'This take is a mic recording.' : curSrc === 'upload' ? 'This take is an uploaded MP3.' : '';
  const voiceNote =
    mode === 'missing-key'
      ? narratorKeyNote(mode)
      : mode === 'stub'
        ? 'Voice runs in stub mode: takes are silent placeholders of the right length. You can still upload or record a take.'
        : `Regenerate speaks a new take with ${escapeHtml(ed.deck?.audio?.narrator?.name || 'the narrator')}; Upload or Record attaches your own audio. Earlier takes stay a click away.`;
  const kindLabel = clip.kind === 'adlib' ? 'ad-lib' : clip.kind || 'line';
  return (
    head(
      ICONS['mic'] ?? '',
      'voice',
      clip.key,
      `${escapeHtml(kindLabel)} · ${clip.dur.toFixed(1)}s${take > 1 ? ` · take ${take}` : ''}${clip.mute ? ' · muted' : ''}${curSrc === 'mic' || curSrc === 'upload' ? ` · ${curSrc}` : ''}`,
      `<button type="button" class="ins-icon danger" data-act="voice-mute" title="${clip.mute ? 'Unmute' : 'Mute'}">${clip.mute ? ICONS['mic'] : ICONS['trash']}</button>`,
    ) +
    section(
      'text',
      'Line',
      `<textarea class="ins-text" data-voice-text rows="3" maxlength="${textMax}" spellcheck="true" aria-label="What this line says" placeholder="What this line says">${escapeHtml(shown)}</textarea>
        ${rewritten ? `<p class="ins-note subtle">Written: “${escapeHtml(clip.written)}” <button type="button" class="ins-link" data-act="voice-text-written">use it</button></p>` : ''}
        <div class="ins-regen">
          <button type="button" class="ins-btn primary${busy ? ' is-busy' : ''}" data-act="voice-regen" ${busy || recording ? 'disabled' : ''}>${neonFxHtml()}${ICONS['sparkle']}<span>${busy ? 'Speaking…' : 'Regenerate'}</span></button>
        </div>
        <div class="ins-pair voice-source">
          <button type="button" class="ins-btn" data-act="voice-upload" ${busy || recording ? 'disabled' : ''} title="Attach an MP3 as a new take">${ICONS['upload']}Upload MP3</button>
          <button type="button" class="ins-btn${recording ? ' is-rec' : ''}" data-act="voice-mic" ${busy ? 'disabled' : ''} title="${recording ? 'Stop and save' : 'Record a new take from the mic'}">${recording ? ICONS['stop'] : ICONS['mic']}<span>${recording ? 'Stop' : 'Record'}</span></button>
        </div>
        <div class="take-row">
          <span class="take-label">${takes > 1 ? 'Takes' : 'Take'}</span>
          <div class="take-chips" role="group" aria-label="Takes">${chips.join('')}</div>
          ${altered ? `<button type="button" class="ins-link take-revert" data-act="voice-revert" ${busy || recording ? 'disabled' : ''} title="The script's words, natural pace, take 1">${ICONS['reset']}Revert</button>` : ''}
        </div>
        <div class="var-row"><span>Pace</span><select data-voice-speed aria-label="Speaking pace">${speeds.map((s) => `<option value="${s}" ${Math.abs(s - speed) < 0.01 ? 'selected' : ''}>${s.toFixed(2)}× ${s < 0.97 ? 'slower' : s > 1.03 ? 'quicker' : 'natural'}</option>`).join('')}</select><output></output><i class="var-reset"></i></div>
        <p class="ins-note subtle">${voiceNote}${srcNote ? ` ${srcNote}` : ''}</p>
        ${fit.map((n) => `<p class="ins-warn">${ICONS['warn']}${escapeHtml(n)}</p>`).join('')}${(clip.notes || [])
          .filter((n) => !/^long by|^starts .* late/.test(n) || !fit.length)
          .map((n) => `<p class="ins-warn">${ICONS['warn']}${escapeHtml(n)}</p>`)
          .join('')}${moved}`,
    ) +
    section(
      'motion',
      'Shape',
      `<div class="var-row${clip.trimStart ? ' is-set' : ''}"><span>Trim head</span><input type="range" min="0" max="${Math.max(0, r3(full - minSec))}" step="0.05" value="${clip.trimStart || 0}" data-voice-shape="trimStart" aria-label="Trim the head" /><output>${(clip.trimStart || 0).toFixed(2)}s</output><button type="button" class="var-reset" data-voice-shape-reset="trimStart" title="Back to 0" ${clip.trimStart ? '' : 'hidden'}>${ICONS['reset']}</button></div>
        <div class="var-row${clip.trimEnd ? ' is-set' : ''}"><span>Trim tail</span><input type="range" min="0" max="${Math.max(0, r3(full - minSec))}" step="0.05" value="${clip.trimEnd || 0}" data-voice-shape="trimEnd" aria-label="Trim the tail" /><output>${(clip.trimEnd || 0).toFixed(2)}s</output><button type="button" class="var-reset" data-voice-shape-reset="trimEnd" title="Back to 0" ${clip.trimEnd ? '' : 'hidden'}>${ICONS['reset']}</button></div>
        <div class="var-row${clip.fadeIn ? ' is-set' : ''}"><span>Fade in</span><input type="range" min="${fadeLo}" max="${fadeHi}" step="0.05" value="${clip.fadeIn || 0}" data-voice-shape="fadeIn" aria-label="Fade in" /><output>${(clip.fadeIn || 0).toFixed(2)}s</output><button type="button" class="var-reset" data-voice-shape-reset="fadeIn" title="Back to 0" ${clip.fadeIn ? '' : 'hidden'}>${ICONS['reset']}</button></div>
        <div class="var-row${clip.fadeOut ? ' is-set' : ''}"><span>Fade out</span><input type="range" min="${fadeLo}" max="${fadeHi}" step="0.05" value="${clip.fadeOut || 0}" data-voice-shape="fadeOut" aria-label="Fade out" /><output>${(clip.fadeOut || 0).toFixed(2)}s</output><button type="button" class="var-reset" data-voice-shape-reset="fadeOut" title="Back to 0" ${clip.fadeOut ? '' : 'hidden'}>${ICONS['reset']}</button></div>
        <p class="ins-note subtle">The clip is ${full.toFixed(1)}s as spoken${shaped ? `; ${clip.dur.toFixed(1)}s plays` : ''}. Drag the ends of the block on the timeline to trim; the head trim keeps the remaining words where they are.</p>
        ${shaped ? `<button type="button" class="ins-btn wide ghost" data-act="voice-shape-reset">Whole take, no fades</button>` : ''}`,
    ) +
    section('speed', 'Level', dbSlider('data-voice-gain', clip.gainDb || 0, 'Voice level') + `<p class="ins-note subtle">0 dB is the fitted line. The mix uses this on top of the narration loudness.</p>`) +
    section(
      'motion',
      'Timing',
      `<div class="ins-big"><output>${nudge > 0 ? '+' : ''}${nudge.toFixed(2)}s</output><input type="range" min="${nlo}" max="${nhi}" step="0.05" value="${nudge}" data-voice-nudge aria-label="Nudge the line" /></div>
        <p class="ins-note subtle">Drag the block anywhere on the timeline — past another line is a new order. This slider trims that position by a few seconds.</p>
        ${clip.at != null ? `<p class="ins-note">Plays at ${fmtT(clip.start)}.</p>` : ''}
        ${clip.at != null || nudge ? `<button type="button" class="ins-btn wide ghost" data-act="voice-reset">Back to where the line belongs</button>` : ''}`,
    ) +
    `<button type="button" class="ins-btn wide ghost" data-act="preview-sel">${ICONS['replay']}Listen</button>`
  );
}

export function masterSlider(key: string, label: string, unit = ''): string {
  const range = ed.deck?.ranges?.master?.[key];
  if (!range) return '';
  const levels = ed.deck?.audio?.levels;
  const value = (levels?.[key] as number | undefined) ?? (ed.deck?.audio?.defaults?.[key] as number | undefined) ?? range[0];
  const shown = key === 'duckRatio' ? (levels?.duck?.ratio ?? value) : value;
  return `<div class="var-row"><span>${label}</span><input type="range" min="${range[0]}" max="${range[1]}" step="${key === 'duckRatio' ? 0.5 : 0.5}" value="${shown}" data-master="${key}" aria-label="${label}" /><output>${Number(shown).toFixed(1)}${unit}</output><i class="var-reset"></i></div>`;
}

const voiceList = (): NarratorVoice[] | null => (Array.isArray(ed.voices) ? ed.voices : ed.voices ? [] : null);

/** Narrator picker: the ElevenLabs voices on the account, with a listen button and a per-video pick. */
export function renderNarrator(): string {
  const n = ed.deck?.audio?.narrator;
  if (!n) return '';
  const raw = ed.voices;
  const list = voiceList();
  const stale = n.stale
    ? `<p class="ins-warn">${ICONS['warn']}The mix was spoken by ${escapeHtml(n.built?.name || 'another narrator')}. Mix speaks every line again with ${escapeHtml(n.name)}.</p>`
    : '';
  const source = n.source === 'video' ? 'picked for this video' : 'from the brand';
  let picker: string;
  if (n.mode !== 'live') {
    picker = `<p class="ins-note subtle" data-narrator-key>${narratorKeyNote(n.mode)}</p>`;
  } else if (!raw) {
    picker = `<p class="ins-note subtle">Loading the voices on the account…</p>`;
  } else if (!Array.isArray(raw)) {
    picker = `<p class="ins-warn">${ICONS['warn']}${escapeHtml(raw.error)} <button type="button" class="ins-link" data-act="narrators-reload">try again</button></p>`;
  } else {
    const voices = list || [];
    const want = ed.narratorPick || n.voiceId;
    const options = voices.map(
      (v) =>
        `<option value="${escapeHtml(v.voiceId)}" ${v.voiceId === want ? 'selected' : ''}>${escapeHtml(v.name)}${v.voiceId === n.voiceId ? ' · current' : ''}${v.category === 'cloned' ? ' · cloned' : ''}${v.labels?.['accent'] ? ` · ${escapeHtml(v.labels['accent'])}` : ''}</option>`,
    );
    if (!voices.some((v) => v.voiceId === n.voiceId))
      options.unshift(`<option value="${escapeHtml(n.voiceId)}" ${n.voiceId === want ? 'selected' : ''}>${escapeHtml(n.name)} · current</option>`);
    const picked = voices.find((v) => v.voiceId === want);
    const sub = picked
      ? [picked.labels?.['gender'], picked.labels?.['age'], picked.labels?.['accent'], picked.labels?.['use_case'] || picked.labels?.['description']].filter(Boolean).join(' · ')
      : '';
    picker = `<div class="narrator-pick">
          <select data-narrator aria-label="Narrator">${options.join('')}</select>
          <button type="button" class="ins-icon" data-act="narrator-listen" title="Hear a sample" ${picked?.previewUrl ? '' : 'disabled'}>${ICONS['play']}</button>
        </div>
        ${sub ? `<p class="ins-note subtle">${escapeHtml(sub)}</p>` : ''}
        <div class="ins-pair">
          <button type="button" class="ins-btn primary" data-act="narrator-use" ${(ed.narratorPick || n.voiceId) === n.voiceId ? 'disabled' : ''}>${neonFxHtml()}${ICONS['mic']}Use voice</button>
          <button type="button" class="ins-btn ghost" data-act="narrator-brand" ${n.source === 'video' ? '' : 'disabled'}>Brand voice</button>
        </div>`;
  }
  return section('mic', 'Narrator', `<p class="ins-quote">${escapeHtml(n.name)} <em class="ins-dim">· ${source} · ${escapeHtml(n.model || '')}</em></p>${stale}${picker}`);
}

export async function loadNarrators(force = false): Promise<void> {
  if (ed.voices && !force) return;
  try {
    const r = await api<{ voices?: NarratorVoice[] }>(`/api/video/${encodeURIComponent(slug() || '')}/narrators${force ? '?force=1' : ''}`);
    ed.voices = r.voices || [];
  } catch (err) {
    ed.voices = { error: errMessage(err) || 'Could not list the voices' };
  }
  if (ed.sel?.type === 'music' || ed.sel?.type === 'mix') renderInspector();
}

export function renderMusic(): string {
  const music = audioDesk().music;
  const bed = ed.deck?.audio?.music;
  const [olo, ohi] = ed.deck?.ranges?.musicOffset || [-20, 20];
  const bedSec = bed?.durationSec ?? 0;
  const shortBy = bed ? ed.total - ((music.offset || 0) + bedSec) : 0;
  const short = shortBy > 0.35;
  const src = bed?.source;
  const srcLabel = src === 'upload' ? 'upload' : src === 'stub' ? 'stub' : src === 'eleven' ? 'ElevenLabs' : '';
  const busy = ed.regenerating === 'music';
  const cutSec = ed.total > 0 ? ed.total.toFixed(0) : '—';
  const prompt = ed.deck?.audio?.musicPrompt || bed?.prompt || '';
  if (ed.deck?.audio?.narrator?.mode === 'live' && !ed.voices) void loadNarrators();
  return (
    head(
      ICONS['music'] ?? '',
      'music',
      music.mute ? 'Music off' : 'Music',
      bed ? `${bedSec.toFixed(0)}s bed${short ? ` · ${shortBy.toFixed(0)}s short` : ''}${srcLabel ? ` · ${srcLabel}` : ''}` : 'No bed yet',
      `<button type="button" class="ins-icon danger" data-act="music-mute" title="${music.mute ? 'Unmute' : 'Mute'}">${music.mute ? ICONS['music'] : ICONS['trash']}</button>`,
    ) +
    renderNarrator() +
    section(
      'text',
      'Bed',
      `${src === 'upload' ? `<p class="ins-note subtle">This bed is an uploaded track. Compose replaces it with ElevenLabs music sized to the cut (${cutSec}s).</p>` : `<p class="ins-note subtle">Upload your own track, or describe the sound and compose with ElevenLabs to the length of this cut (${cutSec}s). Brand styles still apply underneath.</p>`}
        <textarea class="ins-text" data-music-prompt rows="2" maxlength="500" spellcheck="true" aria-label="Music prompt" placeholder="Describe the music — e.g. warm electric piano, soft pulse, optimistic SaaS underscore, no vocals">${escapeHtml(prompt)}</textarea>
        <div class="ins-pair voice-source">
          <button type="button" class="ins-btn" data-act="music-upload" ${busy ? 'disabled' : ''} title="Replace the bed with an uploaded MP3">${ICONS['upload']}Upload MP3</button>
          <button type="button" class="ins-btn primary${busy ? ' is-busy' : ''}" data-act="music-compose" ${busy ? 'disabled' : ''} title="Compose a new bed sized to this cut from the prompt, then mix">${neonFxHtml()}${ICONS['sparkle']}<span>${busy ? 'Working…' : bed ? 'Compose to fit' : 'Compose music'}</span></button>
        </div>
        ${short ? `<p class="ins-warn">${ICONS['warn']}The bed is ${shortBy.toFixed(0)}s shorter than this cut — loop it, upload a longer track, or compose to fit.</p>` : ''}`,
    ) +
    section(
      'speed',
      'Level',
      dbSlider('data-music-gain', music.gainDb || 0, 'Music level') +
        `<div class="ins-quick ins-quick--pair"><span>At the playhead</span><div class="ins-pair"><button type="button" class="ins-btn" data-act="ride" data-ride-db="-6">${ICONS['music']}Softer</button><button type="button" class="ins-btn" data-act="ride" data-ride-db="4">${ICONS['music']}Louder</button></div></div>
          <p class="ins-note subtle">Softer and louder add a ride on the music row. Drag a ride to move it.</p>`,
    ) +
    section(
      'motion',
      'Length & fades',
      `<label class="ins-check"><input type="checkbox" data-music-loop ${music.loop ? 'checked' : ''} ${bed ? '' : 'disabled'} /> Loop to fill the cut</label>
        <p class="ins-note subtle">${music.loop ? 'Mix repeats the bed under the whole delivery. Turn this off to leave the tail silent, or Compose to fit for a new bed.' : short ? 'Loop fills with repeats; Compose to fit writes a new bed for this length.' : 'When the bed runs out early, Mix pads with silence — loop it, or compose a longer bed.'}</p>
        <div class="var-row"><span>Fade in</span><input type="range" min="0" max="8" step="0.1" value="${music.fadeIn}" data-fade="fadeIn" aria-label="Fade in" /><output>${music.fadeIn.toFixed(1)}s</output><i class="var-reset"></i></div>
        <div class="var-row"><span>Fade out</span><input type="range" min="0" max="8" step="0.1" value="${music.fadeOut}" data-fade="fadeOut" aria-label="Fade out" /><output>${music.fadeOut.toFixed(1)}s</output><i class="var-reset"></i></div>
        <div class="var-row"><span>Slip</span><input type="range" min="${olo}" max="${ohi}" step="0.1" value="${music.offset || 0}" data-music-offset aria-label="Slip the music" /><output>${(music.offset || 0) > 0 ? '+' : ''}${Number(music.offset || 0).toFixed(1)}s</output><i class="var-reset"></i></div>
        <p class="ins-note subtle">Drag the music bar to slip it. The ends are the fades.</p>`,
    ) +
    section(
      'palette',
      'Master',
      `${masterSlider('voiceLufs', 'Narration', ' LUFS')}${masterSlider('plateLufs', 'Music on titles', ' LUFS')}${masterSlider('bedLufs', 'Music under the demo', ' LUFS')}${masterSlider('duckRatio', 'Dip under voice', '×')}${masterSlider('targetLufs', 'Master loudness', ' LUFS')}${masterSlider('truePeakDb', 'True peak', ' dB')}
        <p class="ins-note subtle">These are the levels the mix renders to. What you hear now follows them; Mix writes them into the master.</p>
        <button type="button" class="ins-btn wide ghost" data-act="master-reset">Back to the brand mix</button>`,
    )
  );
}

export function renderRide(): string {
  const ride = audioDesk().music.rides[ed.sel?.i ?? -1];
  if (!ride) return renderEmpty();
  return (
    head(
      ICONS['music'] ?? '',
      'music',
      ride.gainDb < 0 ? 'Softer music' : 'Louder music',
      `${(ride.to - ride.from).toFixed(1)}s · ${ride.gainDb > 0 ? '+' : ''}${ride.gainDb} dB`,
      `<button type="button" class="ins-icon danger" data-act="ride-remove" title="Remove (⌫)">${ICONS['trash']}</button>`,
    ) +
    section('speed', 'Level', dbSlider('data-ride-gain', ride.gainDb, 'Ride level') + `<p class="ins-note subtle">Drag the ends... the block itself moves. It sits on top of the bed level.</p>`)
  );
}

export function renderSkip(i: number): string {
  const s = deckEdit().zoomSkips[i];
  if (!s) return renderEmpty();
  return (
    head(ICONS['noZoom'] ?? '', 'skip', 'No auto zoom', `${(s.to - s.from).toFixed(1)}s keeps the whole screen`, removeBtn()) +
    `<p class="ins-note pad">Auto zooms are skipped in this stretch. Remove it to let them back in.</p>`
  );
}

export function renderJoin(i: number): string {
  const c = ed.seq[i];
  const prev = ed.seq[i - 1];
  if (!c?.join || !prev || !ed.deck) return renderEmpty();
  const styles = ed.deck.transitionStyles || {};
  const pinned = c.join.pinned || {};
  const current = pinned.style || '';
  const dflt = ed.deck.transitions?.style || 'directed';
  const [lo, hi] = ed.deck.ranges?.transitionDuration || [0, 2];
  const carry = c.join.carry;
  const carryOff = (id: string) => id === 'continue' && carry && !carry.ok;
  const tiles = [
    ['', `Video default`, dflt] as const,
    ...Object.entries(styles)
      .filter(([id]) => id !== 'directed' && (id !== 'continue' || carry))
      .map(([id, s]) => [id, s.label, id] as const),
  ]
    .map(
      ([id, label, glyph]) =>
        `<button type="button" class="t-tile${current === id ? ' on' : ''}" data-join-style="${id}"${carryOff(id) ? ' data-carry-off' : ''} title="${escapeHtml(
          carryOff(id) ? `Needs one background on both slides — ${carry!.why}` : id ? styles[id]?.hint || '' : `Follows the video (${styles[dflt]?.label || dflt})`,
        )}">${T_GLYPH[glyph] || ICONS['transition']}<span>${escapeHtml(label)}</span></button>`,
    )
    .join('');
  return (
    head(T_GLYPH[joinStyle(c)] || ICONS['transition'] || '', 'join', 'Transition', `${escapeHtml(prev.title)} → ${escapeHtml(c.title)}${c.join.card ? ' · onto a chapter card' : ''}`) +
    section('transition', 'Style', `<div class="t-grid">${tiles}</div>${carryNote(carry, joinStyle(c) === 'continue')}`) +
    section(
      'motion',
      'Length',
      `<div class="ins-big"><output id="insJoinOut">${c.overlap.toFixed(2)}s</output><input type="range" min="${lo}" max="${hi}" step="0.05" value="${pinned.duration ?? c.overlap}" data-join-dur aria-label="Transition length" /></div>`,
      c.join.pinned ? `<button type="button" class="ins-link" data-act="join-reset">Use video default</button>` : '',
    ) +
    `<button type="button" class="ins-btn wide ghost" data-act="preview-join">${ICONS['replay']}Watch the transition</button>`
  );
}

export function renderCut(i: number): string {
  const cut = (deckEdit().cuts || [])[i];
  if (!cut) return renderEmpty();
  const sec = cut.to - cut.from;
  return (
    head(
      CUT_ICON,
      'cut',
      `${sec.toFixed(1)}s removed`,
      `${fmtT(cut.from)}–${fmtT(cut.to)} of the recording`,
      `<button type="button" class="ins-icon danger" data-act="remove" title="Restore this stretch (⌫)">${ICONS['trash']}</button>`,
    ) +
    section(
      CUT_ICON,
      'This stretch',
      `<p class="ins-note">Gone from the cut. Playback and the render skip it, and everything after closes up. Drag either end on the Cut row to take more or give some back.</p><button type="button" class="ins-btn wide" data-act="preview-cut">${ICONS['replay']}Watch the join</button>`,
    )
  );
}

export function renderRange(s: Selection): string {
  const len = (s.to ?? 0) - (s.from ?? 0);
  return (
    head(ICONS['sparkle'] ?? '', 'range', `${len.toFixed(1)}s selected`, `in “${escapeHtml(ed.seq.find((c) => c.id === s.clipId)?.title || 'recording')}”`) +
    section(
      CUT_ICON,
      'Cut',
      `<button type="button" class="ins-btn wide primary" data-range-cut>${neonFxHtml()}${CUT_ICON}Cut this stretch out</button><p class="ins-note subtle">Removes it from the recording. Playback skips it and the render closes the gap.</p>`,
    ) +
    section('speed', 'Speed', `${segBtns('data-range-rate', [0.5, 0.75, 1.5, 2, 3], '', fmtRate)}<p class="ins-note subtle">Faster skips the slow parts; slower lets a detail breathe.</p>`) +
    section(
      'zoom',
      'Zoom',
      `<button type="button" class="ins-btn wide" data-range-zoom>${ICONS['zoom']}Zoom in over this stretch</button><button type="button" class="ins-btn wide" data-range-lens>${ICONS['lens']}Magnify a detail here</button><button type="button" class="ins-btn wide ghost" data-range-skip>${ICONS['noZoom']}Keep the whole screen (no auto zoom)</button>`,
    )
  );
}

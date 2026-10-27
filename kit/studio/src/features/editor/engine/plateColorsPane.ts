import { api } from '@/desk/api';
import { toast } from '@/desk/toast';

import { paintAtmosphereStill, type ThumbPalette } from '@/ui/look/atmosphereThumbs';
import { paintStatus } from './edits';
import { renderInspector, section } from './inspector';
import { applyVar, lookValue, plateDoc, refreshPlatePreview } from './look';
import { flushAllContentPending } from './plateContentPane';
import { paintInspectorUnlessContentTyping } from './plateContentSave';
import {
  contrast,
  contrastLabel,
  matchingPreset,
  mergePlateColors,
  patchPlateColors,
  presetPlateColors,
  resolvePlateColors,
  sanitizePlateColors,
  swatchHex,
  type BrandColors,
  type PlateColorKey,
  type PlateColors,
  type ResolvedPlateColors,
} from './plateColors';
import { ed, setHtmlPlates, slug } from './state';
import { flashHint, plateInfo } from './timeline';
import type { Clip, DeckPlate, PlateRow } from './types';
import { ICONS, errMessage, escapeHtml } from './util';

/**
 * Background colours on the slide inspector's Design tab: the plate's backdrop, its two glows and
 * the copy colour, for this slide or every plate. Hovering a swatch tries it on the stage and the
 * preview card; a pick paints at once and the rebuild follows (see `plateColors.ts`).
 */

type Scope = 'plate' | 'video';
interface Slot {
  id: PlateColorKey;
  label: string;
  hint?: string;
}
interface Preset {
  id: string;
  label: string;
  hint?: string;
  colors: PlateColors;
}
interface Options {
  slots: Slot[];
  roles: Array<{ id: string; label: string }>;
  presets: Preset[];
}

const FALLBACK: Options = {
  slots: [
    { id: 'background', label: 'Background' },
    { id: 'accent', label: 'Glow' },
    { id: 'accent2', label: 'Second glow' },
    { id: 'text', label: 'Text' },
  ],
  roles: [
    { id: 'ink', label: 'Ink' },
    { id: 'surface', label: 'Surface' },
    { id: 'gold', label: 'Accent' },
    { id: 'amber', label: 'Secondary' },
    { id: 'teal', label: 'Support' },
    { id: 'text', label: 'Light' },
  ],
  presets: [{ id: 'brand', label: 'Brand', colors: {} }],
};

/** Which brand colour each slot shows when nothing is picked. */
const SLOT_ROLE: Record<PlateColorKey, keyof ResolvedPlateColors['colors']> = { background: 'ink', accent: 'gold', accent2: 'amber', text: 'text' };

let scope: Scope = 'plate';
let saveGen = 0;

const options = (): Options => (ed.deck?.['plateColorOptions'] as Options | undefined) || FALLBACK;
const brandColors = (): BrandColors => (ed.deck?.brandColors as BrandColors | undefined) || {};
const videoColors = (): PlateColors => sanitizePlateColors(ed.deck?.['plateColors'], false);
const ownColors = (info: DeckPlate | null): PlateColors => sanitizePlateColors(info?.['colors']);

/** The resolved colours as the five-colour palette the atmosphere shaders paint in. */
export function thumbPalette(r: ResolvedPlateColors): ThumbPalette {
  const c = r.colors;
  return { ink: c.ink, surface: c.surface, gold: c.gold, amber: c.amber, teal: c.teal };
}

/** Colours this plate shows with an optional patch tried at the current scope. */
function preview(info: DeckPlate | null, patch: Record<string, string | null> | null = null, preset: Preset | null = null): ResolvedPlateColors {
  let video = videoColors();
  let own = ownColors(info);
  if (preset) {
    if (scope === 'video') video = presetPlateColors(preset.colors, false);
    else own = presetPlateColors(preset.colors);
  } else if (patch) {
    if (scope === 'video') video = patchPlateColors(video, patch, false);
    else own = patchPlateColors(own, patch);
  }
  return resolvePlateColors(brandColors(), video, own);
}

const heroVars = (r: ResolvedPlateColors) => {
  const c = r.colors;
  return `--pc-bg:${c.ink};--pc-surface:${c.surface};--pc-glow:${c.gold};--pc-glow2:${c.amber};--pc-text:${c.text};--pc-muted:${c.muted};--pc-on:${c.onAccent}`;
};

function contrastBadge(r: ResolvedPlateColors): string {
  const v = contrastLabel(contrast(r.colors.text, r.colors.ink));
  return `<span class="pc-contrast${v.ok ? ' ok' : ' warn'}" data-pc-contrast title="Text against the background">${v.ok ? '' : ICONS['warn'] || ''}${escapeHtml(v.text)}</span>`;
}

function hero(info: DeckPlate | null, r: ResolvedPlateColors): string {
  const atm = lookValue(info, 'atmosphere') || 'none';
  const field = atm === 'none' ? '' : `<span class="lk-atm pc-field" aria-hidden="true"><canvas width="160" height="90" data-pc-atm="${escapeHtml(atm)}"></canvas></span>`;
  return `<div class="pc-hero" data-pc-hero style="${heroVars(r)}">
      <span class="pc-hero-bg" aria-hidden="true"></span>${field}
      <span class="pc-hero-copy" aria-hidden="true"><i>Eyebrow</i><b>Your title, <em>in colour</em></b><small>A supporting line under it</small></span>
      ${contrastBadge(r)}
    </div>`;
}

function presetTile(p: Preset, on: boolean): string {
  const r = resolvePlateColors(brandColors(), sanitizePlateColors(p.colors, false), {});
  return `<button type="button" class="pc-preset${on ? ' on' : ''}" data-pc-preset="${escapeHtml(p.id)}" aria-pressed="${on}" title="${escapeHtml(p.hint || p.label)}" style="${heroVars(r)}"><span class="pc-preset-sw" aria-hidden="true"><i></i><i></i><b>Aa</b></span><span>${escapeHtml(p.label)}</span></button>`;
}

const nowLabel = (name: string, hex: string) => `<i style="background:${hex}"></i>${escapeHtml(name)} <code>${escapeHtml(hex)}</code>`;

function chip(key: PlateColorKey, value: string, label: string, hex: string, on: boolean, extra = ''): string {
  return `<button type="button" class="pc-chip${on ? ' on' : ''}${extra}" data-pc-key="${key}" data-pc-value="${escapeHtml(value)}" style="--sw:${hex}" aria-pressed="${on}" title="${escapeHtml(`${label} · ${hex}`)}"><i aria-hidden="true"></i><span>${escapeHtml(label)}</span></button>`;
}

function slotRow(slot: Slot, info: DeckPlate | null, r: ResolvedPlateColors): string {
  const brand = brandColors();
  const picks = scope === 'video' ? videoColors() : ownColors(info);
  const raw = picks[slot.id] || '';
  // A slide pinned to the brand shows the brand's own colour as its pick.
  const picked = raw === 'brand' ? SLOT_ROLE[slot.id] : raw;
  // What the slot falls back to: the video default on a slide, the brand (or auto text) for all plates.
  const inherited = scope === 'plate' ? resolvePlateColors(brand, videoColors(), {}) : resolvePlateColors(brand, {}, {});
  const inheritHex = inherited.colors[SLOT_ROLE[slot.id]];
  const inheritLabel = slot.id === 'text' ? 'Auto' : scope === 'plate' ? 'Video' : 'Brand';
  const roles = options().roles;
  const isCustom = picked.startsWith('#');
  const shown = r.colors[SLOT_ROLE[slot.id]];
  const roleName = roles.find((x) => x.id === picked)?.label;
  const now = picked ? (isCustom ? 'Custom' : roleName || picked) : inheritLabel;
  const chips = [
    chip(slot.id, '', inheritLabel, inheritHex, !picked, ' is-inherit'),
    ...roles.map((role) => chip(slot.id, role.id, role.label, swatchHex(role.id, brand), picked === role.id)),
    `<label class="pc-chip pc-custom${isCustom ? ' on' : ''}" style="--sw:${isCustom ? picked : shown}" title="Pick any colour"><input type="color" value="${isCustom ? picked : shown}" data-pc-custom="${slot.id}" aria-label="${escapeHtml(`${slot.label} — custom colour`)}" /><i aria-hidden="true"></i><span>Custom</span></label>`,
  ];
  return `<div class="pc-slot${picked ? ' is-set' : ''}" data-pc-slot="${slot.id}">
      <div class="pc-slot-h" title="${escapeHtml(slot.hint || '')}"><span>${escapeHtml(slot.label)}</span><em data-pc-now>${nowLabel(now, shown)}</em></div>
      <div class="pc-chips" role="group" aria-label="${escapeHtml(slot.label)}">${chips.join('')}</div>
    </div>`;
}

/** The whole "Background colours" section for a plate slide. */
export function plateColorsSection(c: Clip, info: DeckPlate | null): string {
  if (c.kind !== 'plate') return '';
  const r = preview(info);
  const video = videoColors();
  const own = ownColors(info);
  const picks = scope === 'video' ? video : own;
  const presets = options().presets;
  const presetOn = matchingPreset(scope === 'video' ? video : mergePlateColors(video, own), presets);
  const ownCount = Object.keys(own).length;
  const videoCount = Object.keys(video).length;
  const note =
    scope === 'plate'
      ? ownCount
        ? `This slide sets ${ownCount} colour${ownCount === 1 ? '' : 's'} of its own; the rest follow ${videoCount ? 'the video default' : 'the brand'}.`
        : `Follows ${videoCount ? 'the video default' : 'the brand'}. A pick here changes only this slide.`
      : `Every plate starts from these${ownCount ? ' — this slide keeps its own picks on top' : ''}. Slides can still set their own.`;
  const body = `<div class="pc" data-pc-root>
      <div class="pc-scope ins-seg" role="radiogroup" aria-label="Apply to">
        <button type="button" data-pc-scope="plate" class="${scope === 'plate' ? 'on' : ''}" aria-checked="${scope === 'plate'}" role="radio">This slide${ownCount ? ` <em>${ownCount}</em>` : ''}</button>
        <button type="button" data-pc-scope="video" class="${scope === 'video' ? 'on' : ''}" aria-checked="${scope === 'video'}" role="radio">All plates${videoCount ? ` <em>${videoCount}</em>` : ''}</button>
      </div>
      ${hero(info, r)}
      <div class="pc-presets" role="group" aria-label="Colour presets">${presets.map((p) => presetTile(p, presetOn === p.id)).join('')}</div>
      ${options()
        .slots.map((s) => slotRow(s, info, r))
        .join('')}
      <p class="ins-note subtle">${escapeHtml(note)}</p>
    </div>`;
  const reset = Object.keys(picks).length
    ? `<button type="button" class="ins-link" data-pc-reset title="${scope === 'video' ? 'Every plate back to the brand colours' : 'This slide follows the video again'}">${scope === 'video' ? 'Reset to brand' : 'Use video colours'}</button>`
    : '';
  return section('palette', 'Background colours', body, reset);
}

// ─── Live paint ────────────────────────────────────────────────────────────────────────────
/** Paint resolved colours onto the stage frame; the plate's own style variables still win. */
function paintFrame(id: string, r: ResolvedPlateColors): void {
  const doc = plateDoc(id);
  if (!doc?.documentElement) return;
  const style = plateInfo(id)?.style || {};
  for (const [name, value] of Object.entries(r.vars)) if (style[name] == null) applyVar(name, value);
  if (!ed.playing) refreshPlatePreview(id);
}

function paintHero(root: HTMLElement, info: DeckPlate | null, r: ResolvedPlateColors): void {
  const el = root.querySelector<HTMLElement>('[data-pc-hero]');
  if (!el) return;
  el.setAttribute('style', heroVars(r));
  const badge = el.querySelector('[data-pc-contrast]');
  if (badge) badge.outerHTML = contrastBadge(r);
  const canvas = el.querySelector<HTMLCanvasElement>('canvas[data-pc-atm]');
  if (canvas) paintAtmosphereStill(canvas, canvas.dataset['pcAtm'] || lookValue(info, 'atmosphere') || 'none', thumbPalette(r));
}

// ─── Save ──────────────────────────────────────────────────────────────────────────────────
interface ColorsResponse {
  colors?: PlateColors;
  plateColors?: PlateColors;
  plates?: PlateRow[];
}

async function save(id: string, body: Record<string, unknown>, hint: string): Promise<void> {
  const gen = ++saveGen;
  const at = scope;
  const path = at === 'video' ? `/api/video/${encodeURIComponent(slug() || '')}/plate-colors` : `/api/video/${encodeURIComponent(slug() || '')}/plates/${encodeURIComponent(id)}/colors`;
  try {
    await flushAllContentPending();
    const r = await api<ColorsResponse>(path, { method: 'POST', body });
    if (r.plates) setHtmlPlates(r.plates, { video: false });
    ed.dirtyRender = true;
    paintStatus();
    // Every plate's HTML moved with a video-wide pick; the one on stage is already painted.
    if (at === 'video') for (const c of ed.seq || []) if (c.plateId && c.plateId !== id) ed.stalePlates.add(c.plateId);
    if (gen !== saveGen || !ed.deck) return;
    ed.deck['plateColors'] = r.plateColors || {};
    const info = plateInfo(id);
    if (info && at === 'plate') info['colors'] = r.colors || {};
    flashHint(hint);
  } catch (err) {
    toast('Colours not saved', errMessage(err), 'err');
    if (gen === saveGen) paintInspectorUnlessContentTyping(renderInspector);
  }
}

/** Optimistic local state + stage paint, then the save. */
function commit(c: Clip, next: { patch?: Record<string, string | null>; preset?: Preset; reset?: boolean }, hint: string): void {
  const id = c.plateId || '';
  const info = plateInfo(id);
  if (!ed.deck) return;
  if (scope === 'video') {
    ed.deck['plateColors'] = next.reset ? {} : next.preset ? presetPlateColors(next.preset.colors, false) : patchPlateColors(videoColors(), next.patch || {}, false);
  } else if (info) {
    info['colors'] = next.reset ? {} : next.preset ? presetPlateColors(next.preset.colors) : patchPlateColors(ownColors(info), next.patch || {});
  }
  paintFrame(id, preview(info));
  paintInspectorUnlessContentTyping(renderInspector);
  const body = next.reset ? { reset: true } : next.preset ? { preset: next.preset.id } : { colors: next.patch || {} };
  void save(id, body, hint);
}

export function wirePlateColors(root: HTMLElement, c: Clip): void {
  const box = root.querySelector<HTMLElement>('[data-pc-root]');
  if (!box || c.kind !== 'plate') return;
  const id = c.plateId || '';
  const info = plateInfo(id);
  const r0 = preview(info);
  paintHero(box, info, r0);

  let trying = false;
  let frame = 0;
  const show = (r: ResolvedPlateColors) => {
    paintHero(box, info, r);
    cancelAnimationFrame(frame);
    // The stage repaint (and its field redraw) lands once per frame however fast the pointer moves.
    frame = requestAnimationFrame(() => paintFrame(id, r));
  };
  const tryOn = (r: ResolvedPlateColors) => {
    trying = true;
    show(r);
  };
  const putBack = () => {
    if (!trying) return;
    trying = false;
    show(preview(plateInfo(id)));
  };

  box.querySelectorAll<HTMLElement>('[data-pc-scope]').forEach((el) =>
    el.addEventListener('click', () => {
      scope = el.dataset['pcScope'] === 'video' ? 'video' : 'plate';
      paintInspectorUnlessContentTyping(renderInspector);
    }),
  );

  const presetOf = (el: HTMLElement) => options().presets.find((p) => p.id === el.dataset['pcPreset']) || null;
  box.querySelectorAll<HTMLElement>('[data-pc-preset]').forEach((el) => {
    el.addEventListener('pointerenter', () => {
      const p = presetOf(el);
      if (p) tryOn(preview(info, null, p));
    });
    el.addEventListener('click', () => {
      const p = presetOf(el);
      if (!p) return;
      trying = false;
      if (p.id === 'brand') commit(c, scope === 'video' ? { reset: true } : { preset: p }, scope === 'video' ? 'Plates back to the brand colours' : 'This slide uses the brand colours');
      else commit(c, { preset: p }, `${p.label} colours${scope === 'video' ? ' on every plate' : ''}`);
    });
  });

  const labelOf = (key: string) => options().slots.find((s) => s.id === key)?.label || key;
  box.querySelectorAll<HTMLElement>('button[data-pc-key]').forEach((el) => {
    const key = el.dataset['pcKey'] || '';
    const value = el.dataset['pcValue'] || '';
    el.addEventListener('pointerenter', () => tryOn(preview(info, { [key]: value || null })));
    el.addEventListener('click', () => {
      trying = false;
      const name = el.querySelector('span')?.textContent || value;
      commit(c, { patch: { [key]: value || null } }, `${labelOf(key)} · ${name}`);
    });
  });

  box.querySelectorAll<HTMLInputElement>('input[data-pc-custom]').forEach((el) => {
    const key = el.dataset['pcCustom'] || '';
    el.addEventListener('input', () => {
      const chipEl = el.closest<HTMLElement>('.pc-custom');
      chipEl?.style.setProperty('--sw', el.value);
      tryOn(preview(info, { [key]: el.value }));
    });
    el.addEventListener('change', () => {
      trying = false;
      commit(c, { patch: { [key]: el.value } }, `${labelOf(key)} · ${el.value}`);
    });
  });

  box.querySelectorAll<HTMLElement>('.pc-chips, .pc-presets').forEach((g) => g.addEventListener('pointerleave', putBack));

  // The slot header names whichever chip is under the pointer (or focused), then settles back.
  box.querySelectorAll<HTMLElement>('.pc-slot').forEach((slotEl) => {
    const now = slotEl.querySelector<HTMLElement>('[data-pc-now]');
    if (!now) return;
    const settled = now.innerHTML;
    const peek = (chipEl: HTMLElement) => {
      const hex = chipEl.querySelector<HTMLInputElement>('input[type="color"]')?.value || chipEl.style.getPropertyValue('--sw').trim();
      now.innerHTML = nowLabel(chipEl.querySelector('span')?.textContent || '', hex);
      now.classList.add('is-peek');
    };
    const settle = () => {
      now.innerHTML = settled;
      now.classList.remove('is-peek');
    };
    slotEl.querySelectorAll<HTMLElement>('.pc-chip').forEach((chipEl) => {
      chipEl.addEventListener('pointerenter', () => peek(chipEl));
      chipEl.addEventListener('focusin', () => peek(chipEl));
      chipEl.addEventListener('pointerleave', settle);
      chipEl.addEventListener('focusout', settle);
      chipEl.querySelector('input')?.addEventListener('input', () => peek(chipEl));
    });
  });

  root.querySelector<HTMLElement>('[data-pc-reset]')?.addEventListener('click', () =>
    commit(c, { reset: true }, scope === 'video' ? 'Plates back to the brand colours' : 'This slide follows the video colours'),
  );
}

import { icon } from '@/ui/iconString';
import { curveOf, minJerk } from '@/logic/easing';

import { lensOpenState } from '@/logic/lensGlass';
import type { Clock, Lens, Piece, Span, ZoomShot } from './types';

/**
 * The pure helpers at the top of `kit/studio/editor.js`, plus the icon strings it reads
 * from `icons.js` (`ICONS`, `T_GLYPH`, `ZEN_ART`).
 */

export const PLATE_ICON: Record<string, string> = { open: 'open', close: 'close' };
export const SPEED_PRESETS = [0.5, 0.75, 1.25, 1.5, 2, 3, 4];
export const ZOOM_PRESETS = [1.2, 1.4, 1.6, 1.8, 2];
export const LENS_PRESETS = [1.4, 1.8, 2.2];
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const r3 = (v: number): number => Math.round(v * 1000) / 1000;
export const CUT_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6.5" r="2.35"/><circle cx="6" cy="17.5" r="2.35"/><path d="m8.1 8.2 12.4 9.2M8.1 15.8 20.5 6.5"/></svg>`;
export const DUP_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.2"/><path d="M15.5 8.5V6.2A2.2 2.2 0 0 0 13.3 4H6.2A2.2 2.2 0 0 0 4 6.2v7.1a2.2 2.2 0 0 0 2.2 2.2h2.3"/></svg>`;
export const fmtRate = (r: number | string): string => `${Number(r).toFixed(2).replace(/\.?0+$/, '')}×`;

/** Smootherstep — the stage's own transition preview curve (xfade dissolves use the same). */
export const ease = minJerk;

const ICON_KEYS = [
  'film', 'plate', 'open', 'close', 'speed', 'zoom', 'transition', 'palette', 'motion', 'depth',
  'lockup', 'cursor', 'text', 'reset', 'trash', 'plus', 'play', 'pause', 'replay', 'toStart',
  'loop', 'eye', 'undo', 'redo', 'render', 'keep', 'noZoom', 'check', 'warn', 'x', 'fit',
  'fullscreen', 'target', 'slow', 'sparkle', 'mic', 'upload', 'stop', 'music', 'lens', 'lensOff',
] as const;

/** Editor timeline icon set (`icons.js#ICONS`). */
export const ICONS: Record<string, string> = Object.fromEntries(ICON_KEYS.map((k) => [k, icon(k, { size: 14 })]));

/** Transition glyphs for the join grid (`icons.js#T_GLYPH`). */
export const T_GLYPH: Record<string, string> = Object.fromEntries(
  ['directed', 'dissolve', 'wipe', 'push', 'zoom', 'iris', 'blur', 'dip', 'radial', 'slice', 'diagonal'].map((k) => [
    k,
    icon(`tr-${k}`, { size: 14 }),
  ]),
);

/** Zen empty-state art (`icons.js#ZEN_ART`). */
export const ZEN_ART: Record<string, string> = Object.fromEntries(
  ['tumbleweed', 'sleep', 'clapper', 'frame', 'loupe', 'checklist', 'box', 'pointer', 'film', 'dashes'].map((k) => [
    k,
    icon(`zen-${k}`, { class: 'zen-art', width: 96, height: 64 }),
  ]),
);

export { icon };

/** `zen()` from `kit/studio/zen.js` — the empty-state markup as a string. */
export function zen(
  art: string,
  title: string,
  sub = '',
  opts: { html?: boolean; id?: string; hidden?: boolean; mini?: boolean; cls?: string; action?: string } = {},
): string {
  const body = opts.html ? sub : escapeHtml(sub);
  const attrs = `${opts.id ? ` id="${escapeHtml(opts.id)}"` : ''}${opts.hidden ? ' hidden' : ''}`;
  return `<div class="zen${opts.mini ? ' mini' : ''}${opts.cls ? ` ${opts.cls}` : ''}"${attrs} data-zen="${escapeHtml(art)}">${ZEN_ART[art] || ''}<div class="zen-copy"><strong class="zen-title">${escapeHtml(title)}</strong>${sub ? `<p class="zen-sub">${body}</p>` : ''}</div>${opts.action || ''}</div>`;
}

/** `escapeHtml()` from `app.js`. */
export function escapeHtml(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** `$()` from `app.js`. */
export function $<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Zoom factor + centre at recording time t (mirrors zoomExpr/centerExpr in camera.mjs). */
export function zoomStateAt(
  shots: ZoomShot[] | null | undefined,
  t: number,
  timing?: { in?: number; out?: number; pan?: number; curve?: string } | null,
): { zoom: number; cx: number | null; cy: number | null } {
  const IN = timing?.in ?? 0.9;
  const OUT = timing?.out ?? 1.05;
  const PAN = timing?.pan ?? 0.7;
  const curve = curveOf(timing?.curve).fn;
  let z = 1;
  let cx: number | null = null;
  let cy: number | null = null;
  for (const s of shots || []) {
    if (t < s.start || t > s.end) continue;
    z += (s.zoom - 1) * curve((t - s.start) / IN) * (1 - curve((t - (s.end - OUT)) / OUT));
    const pts = s.points || [];
    const first = pts[0];
    if (!first) continue;
    let x = first.cx;
    let y = first.cy;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i]!;
      const from = Math.max(pts[i - 1]!.t, p.t - PAN);
      const k = curve((t - from) / Math.max(0.001, p.t - from));
      x += (p.cx - x) * k;
      y += (p.cy - y) * k;
    }
    cx = x;
    cy = y;
  }
  return { zoom: z, cx, cy };
}

// Loupe geometry mirrors lib/lens.mjs and the optics come from lensGlass.js, so the stage shows
// the glass the render draws.
export const LENS_PAD = 36;

/** Top-left of the S×S loupe, centred on the target (may hang off-frame; mirrors lib/lens.mjs). */
export function loupeOrigin(cx: number, cy: number, S: number, _width?: number, _height?: number): { ox: number; oy: number } {
  return {
    ox: cx - S / 2,
    oy: cy - S / 2,
  };
}

/** How far the glass is in `T` seconds into a lens that lasts `dur` (0..1; alpha/scale/swell in lensOpenState). */
export function lensOpen(T: number, dur: number, timing?: { in: number; out: number; curve?: string }): number {
  return lensOpenState(T, dur, timing).open;
}

/** Target centre of a lens at `T` seconds in: pointer-follow paths travel on the pointer's own minimum-jerk bell. */
export function lensCentre(lens: Pick<Lens, 'rect' | 'path'>, T: number): { x: number; y: number } {
  const path = lens.path?.length ? lens.path : [{ at: 0, rect: lens.rect }];
  const c = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const first = path[0]!;
  if (T <= first.at || path.length === 1) return c(first.rect);
  for (let i = 1; i < path.length; i++) {
    const p = path[i]!;
    if (T < p.at) {
      const prev = path[i - 1]!;
      const a = c(prev.rect);
      const b = c(p.rect);
      const k = minJerk((T - prev.at) / Math.max(0.001, p.at - prev.at));
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return c(path[path.length - 1]!.rect);
}

/** `#rrggbb` scaled by `k` (lit / shaded metal), clamped. */
export function shadeHex(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const v = [0, 2, 4].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(m[1]!.slice(i, i + 2), 16) * k))));
  return `rgb(${v.join(',')})`;
}

export function clockFromPieces(pieces: Piece[] = []): Clock {
  if (!pieces.length) return { toClean: (t) => t, fromClean: (c) => c };
  const last = pieces[pieces.length - 1]!;
  const toClean = (t: number) => {
    if (t <= 0) return 0;
    for (const p of pieces) if (t <= p.to) return p.cleanFrom + (t - p.from) / p.rate;
    return last.cleanTo + (t - last.to);
  };
  const fromClean = (c: number) => {
    if (c <= 0) return 0;
    for (const p of pieces) if (c <= p.cleanTo) return p.from + (c - p.cleanFrom) * p.rate;
    return last.to + (c - last.cleanTo);
  };
  return { toClean, fromClean };
}

export const fmtT = (sec: number | null | undefined): string => {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
};

export const fmtRuler = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${String(Math.floor(s)).padStart(2, '0')}${s % 1 ? `.${Math.round((s % 1) * 10)}` : ''}`;
};

type LayerStyle = 'opacity' | 'transform' | 'clipPath' | 'filter' | 'maskImage' | 'webkitMaskImage' | 'zIndex';

/** Transition preview on the two stage layers (incoming over outgoing), progress p in 0–1. */
export function paintTransition(style: string, p: number, inL: HTMLElement | null, outL: HTMLElement | null): void {
  // Same DOM node (live→live / plate→plate): crossfading one element is a no-op — dip instead.
  if (inL && outL && inL === outL) {
    const opacity = p < 0.5 ? clamp(1 - 2 * p, 0, 1) : clamp(2 * p - 1, 0, 1);
    inL.style.opacity = String(opacity);
    return;
  }
  const e = ease(p);
  const set = (el: HTMLElement | null, prop: LayerStyle, v: string) => {
    if (el) setLayerStyle(el, prop, v);
  };
  switch (style) {
    case 'wipe':
      set(inL, 'clipPath', `inset(0 0 0 ${(1 - e) * 100}%)`);
      break;
    case 'push':
      set(inL, 'transform', `translateX(${(1 - e) * 100}%)`);
      set(outL, 'transform', `translateX(${-e * 100}%)`);
      break;
    case 'zoom':
      set(outL, 'transform', `scale(${1 + e * 0.5})`);
      set(outL, 'opacity', String(1 - e));
      set(inL, 'opacity', String(e));
      break;
    case 'iris':
      set(inL, 'clipPath', `circle(${e * 75}% at 50% 50%)`);
      break;
    case 'blur':
      set(inL, 'opacity', String(e));
      set(inL, 'filter', `blur(${(1 - e) * 16}px)`);
      set(outL, 'filter', `blur(${e * 16}px)`);
      break;
    case 'dip':
      set(outL, 'opacity', String(clamp(1 - 2 * p, 0, 1)));
      set(inL, 'opacity', String(clamp(2 * p - 1, 0, 1)));
      break;
    case 'radial': {
      const m = `conic-gradient(from 0deg, #000 ${e * 360}deg, transparent ${e * 360 + 0.5}deg)`;
      set(inL, 'maskImage', m);
      set(inL, 'webkitMaskImage', m);
      break;
    }
    case 'slice': {
      const m = `repeating-linear-gradient(to bottom, #000 0 ${e * 12.5}%, transparent ${e * 12.5}% 12.5%)`;
      set(inL, 'maskImage', m);
      set(inL, 'webkitMaskImage', m);
      break;
    }
    case 'diagonal':
      set(inL, 'clipPath', `polygon(0 0, ${e * 200}% 0, 0 ${e * 200}%)`);
      break;
    default:
      set(inL, 'opacity', String(e));
  }
}

export const LAYER_PROPS: LayerStyle[] = ['opacity', 'transform', 'clipPath', 'filter', 'maskImage', 'webkitMaskImage', 'zIndex'];

export function setLayerStyle(el: HTMLElement, prop: LayerStyle, v: string): void {
  (el.style as unknown as Record<LayerStyle, string>)[prop] = v;
}

/** Recording spans left after cuts. A sliver under 0.35s is absorbed. An empty result keeps the original span. */
export function keptSpans(from: number, to: number, cuts: Span[] | null | undefined): Array<[number, number]> {
  let spans: Array<[number, number]> = [[from, to]];
  for (const c of cuts || []) {
    const next: Array<[number, number]> = [];
    for (const [a, b] of spans) {
      const lo = Math.max(a, c.from);
      const hi = Math.min(b, c.to);
      if (hi - lo < 0.01) {
        next.push([a, b]);
        continue;
      }
      if (lo - a >= 0.35) next.push([a, lo]);
      if (b - hi >= 0.35) next.push([hi, b]);
    }
    spans = next;
  }
  return spans.length ? spans : [[from, to]];
}

export interface Laned {
  t: number;
  end: number;
  key?: string | null;
  lane?: number;
}

/**
 * Pack overlapping items into sub-lanes (by .t/.end) so overlapping blocks stack
 * instead of painting on top of each other. Segments that share a .key (one zoom
 * split across a crossfade, one ramp across two live clips) stay on the same row.
 */
export function packLanes<T extends Laned>(items: T[]): { items: Array<T & { lane: number }>; lanes: number } {
  const sorted = [...items].sort((a, b) => a.t - b.t || a.end - b.end);
  const lanes: Array<Array<{ t: number; end: number; key: string | null | undefined }>> = [];
  for (const it of sorted) {
    let lane = lanes.findIndex(
      (placed) =>
        !placed.some((p) => {
          const overlaps = it.t < p.end - 0.04 && p.t < it.end - 0.04;
          const same = it.key != null && p.key === it.key;
          return overlaps && !same;
        }),
    );
    if (lane < 0) {
      lane = lanes.length;
      lanes.push([]);
    }
    lanes[lane]!.push({ t: it.t, end: it.end, key: it.key });
    it.lane = lane;
  }
  return { items: sorted as Array<T & { lane: number }>, lanes: Math.max(1, lanes.length || 1) };
}

/** A copy field path as a human label (`items.0.title` → `Title · 1`). */
export function fieldLabel(path: string | null | undefined): string {
  const raw = String(path || '');
  const parts = raw.split('.');
  const last = parts[parts.length - 1] || raw;
  const pretty = last
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  if (parts.length >= 3 && /^\d+$/.test(parts[1]!)) return `${pretty} · ${Number(parts[1]) + 1}`;
  if (parts.length === 2 && /^\d+$/.test(parts[0]!)) return `${pretty} · ${Number(parts[0]) + 1}`;
  return pretty || raw;
}

export function hotkeyMod(): string {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
}

/** Base64-encode an ArrayBuffer without blowing the call stack on large files. */
export function bufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
export const errName = (err: unknown): string => (err && typeof err === 'object' && 'name' in err ? String(err.name) : '');

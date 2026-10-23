/**
 * String port of legacy `kit/studio/icons.js` `icon()` — same inline SVG markup, byte for byte.
 * Embed (prefer inline — external <use> drops stroke/currentColor on many icons).
 */
import { ICON_ALIAS, ICON_BODY, ICON_META, type IconMeta } from './icons.gen';
import { asText } from '@/logic/text';

export interface IconStringOptions {
  size?: number;
  width?: number;
  height?: number;
  className?: string;
  /** Legacy alias of `className`. */
  class?: string;
  label?: string;
}

export function resolveIconId(name: string | null | undefined): string | null {
  if (!name) return null;
  if (ICON_BODY[name]) return name;
  const alias = ICON_ALIAS[name];
  if (alias) return alias;
  const ui = `ui-${name}`;
  if (ICON_BODY[ui]) return ui;
  return null;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function escAttr(s: unknown): string {
  return asText(s ?? '').replace(/[&<>"]/g, (c) => ESC[c] ?? c);
}

const PRESENT_KEYS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'] as const;

/**
 * @param name short or sprite id
 */
export function icon(name: string, opts: IconStringOptions = {}): string {
  const id = resolveIconId(name);
  const body = id ? ICON_BODY[id] : undefined;
  if (!id || !body) return '';
  const meta: IconMeta = ICON_META[id] ?? { viewBox: '0 0 24 24', present: {} };
  const present: Record<string, string> = meta.present ?? {};
  const cls = [present.class, opts.className ?? opts.class].filter(Boolean).join(' ');
  const w = opts.width ?? opts.size ?? 14;
  const h = opts.height ?? opts.size ?? 14;
  const label = opts.label;
  const aria = label ? ` role="img" aria-label="${escAttr(label)}"` : ' aria-hidden="true"';
  const classAttr = cls ? ` class="${escAttr(cls)}"` : '';
  const presentAttrs = PRESENT_KEYS.filter((k) => present[k] != null)
    .map((k) => ` ${k}="${escAttr(present[k])}"`)
    .join('');
  // Always inline. External <use href="/icons.svg#…"> loses root stroke/fill on symbols
  // and currentColor inheritance is unreliable — that is what made the settings cog a black blob.
  return `<svg${classAttr} viewBox="${meta.viewBox}" width="${w}" height="${h}"${presentAttrs}${aria}>${body}</svg>`;
}

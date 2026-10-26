/**
 * Plate background colours, the Studio half of `kit/lib/plateColors.mjs`: the same merge and
 * resolve, so a pick paints the live plate this frame while the save rebuilds it behind.
 * Keep the two in step — `plateColors.test.ts` pins the shared cases.
 */

export type PlateColorKey = 'background' | 'accent' | 'accent2' | 'text';
export type PlateColors = Partial<Record<PlateColorKey, string>>;
export type BrandColors = Partial<Record<'ink' | 'surface' | 'gold' | 'amber' | 'teal' | 'text' | 'muted' | 'onAccent', string>>;

export const PLATE_COLOR_KEYS: PlateColorKey[] = ['background', 'accent', 'accent2', 'text'];
export const PLATE_COLOR_ROLES = ['ink', 'surface', 'gold', 'amber', 'teal', 'text'] as const;

export interface ResolvedPlateColors {
  set: boolean;
  colors: Required<BrandColors>;
  vars: Record<string, string>;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const CLEAR = new Set(['', 'auto', 'inherit', 'video']);

export function normalizePlateColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (CLEAR.has(s)) return null;
  if (s === 'brand' || (PLATE_COLOR_ROLES as readonly string[]).includes(s)) return s;
  if (HEX.test(s)) return s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s;
  return null;
}

export function sanitizePlateColors(raw: unknown, plate = true): PlateColors {
  const out: PlateColors = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of PLATE_COLOR_KEYS) {
    const v = normalizePlateColor((raw as Record<string, unknown>)[k]);
    if (v && (plate || v !== 'brand')) out[k] = v;
  }
  return out;
}

/** A patch laid on stored colours; null / '' clears a key. */
export function patchPlateColors(current: PlateColors | undefined, patch: Record<string, string | null>, plate = true): PlateColors {
  const next = { ...sanitizePlateColors(current, plate) };
  for (const [k, v] of Object.entries(patch)) {
    if (!PLATE_COLOR_KEYS.includes(k as PlateColorKey)) continue;
    const n = normalizePlateColor(v);
    if (n && (plate || n !== 'brand')) next[k as PlateColorKey] = n;
    else delete next[k as PlateColorKey];
  }
  return next;
}

/** A preset as stored colours; on a plate the keys it leaves out pin the brand. */
export function presetPlateColors(colors: PlateColors, plate = true): PlateColors {
  const all = plate ? { ...Object.fromEntries(PLATE_COLOR_KEYS.map((k) => [k, 'brand'])), ...colors } : colors;
  return sanitizePlateColors(all, plate);
}

export function mergePlateColors(video: unknown, plate: unknown): PlateColors {
  const merged: PlateColors = { ...sanitizePlateColors(video, false), ...sanitizePlateColors(plate) };
  for (const k of PLATE_COLOR_KEYS) if (merged[k] === 'brand') delete merged[k];
  return merged;
}

// ─── Colour maths (mirrors kit/lib/plateColors.mjs) ────────────────────────────────────────
function rgbOf(c: string | undefined): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3,8})$/i.exec(String(c || '').trim());
  if (!m || ![3, 4, 6, 8].includes(m[1]!.length)) return null;
  const h = m[1]!.length <= 4 ? [...m[1]!].map((x) => x + x).join('') : m[1]!;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toHex = (rgb: number[]) => `#${rgb.map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('')}`;

export function luminance(c: string | undefined): number {
  const rgb = rgbOf(c);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((n) => {
    const s = n / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string | undefined, b: string | undefined): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function mixHex(a: string, b: string, t: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  if (!x || !y) return x ? toHex(x) : a;
  return toHex(x.map((v, i) => v + (y[i]! - v) * t));
}

const LIGHT_TEXT = '#f8fafc';
const DARK_TEXT = '#11141a';
export const isLight = (c: string | undefined): boolean => luminance(c) > 0.4;
const readableOn = (bg: string) => (contrast(LIGHT_TEXT, bg) >= contrast(DARK_TEXT, bg) ? LIGHT_TEXT : DARK_TEXT);

export function brandBase(c: BrandColors = {}): Required<BrandColors> {
  const ink = c.ink || '#080a0f';
  return {
    ink,
    surface: c.surface || ink,
    gold: c.gold || '#f5ab1f',
    amber: c.amber || '#f57326',
    teal: c.teal || c.gold || '#2ed3bf',
    text: c.text || LIGHT_TEXT,
    muted: c.muted || '#94a3b8',
    onAccent: c.onAccent || '#111',
  };
}

/** What one plate paints with: the brand under the video default under the plate's own picks. */
export function resolvePlateColors(brandColors: BrandColors | undefined, video: unknown, plate: unknown): ResolvedPlateColors {
  const base = brandBase(brandColors || {});
  const picks = mergePlateColors(video, plate);
  const hexOf = (v: string) => (v.startsWith('#') ? v : base[v as keyof BrandColors]);
  const out = { ...base };
  const set = Object.keys(picks).length > 0;
  if (picks.background && picks.background !== 'ink') {
    out.ink = hexOf(picks.background) || base.ink;
    out.surface = isLight(out.ink) ? mixHex(out.ink, '#000000', 0.06) : mixHex(out.ink, '#ffffff', 0.09);
  }
  if (picks.accent) out.gold = hexOf(picks.accent) || base.gold;
  if (picks.accent2) {
    out.amber = hexOf(picks.accent2) || base.amber;
    out.teal = out.amber;
  }
  if (picks.text) {
    out.text = hexOf(picks.text) || base.text;
    out.muted = mixHex(out.text, out.ink, 0.38);
  } else if (set) {
    if (contrast(base.text, out.ink) < 4.5) {
      out.text = readableOn(out.ink);
      out.muted = mixHex(out.text, out.ink, 0.38);
    } else if (contrast(base.muted, out.ink) < 3) out.muted = mixHex(out.text, out.ink, 0.38);
  }
  if (set && contrast(out.onAccent, out.gold) < 4.5) out.onAccent = readableOn(out.gold);
  return {
    set,
    colors: out,
    vars: {
      '--ink': out.ink,
      '--surface': out.surface,
      '--gold': out.gold,
      '--amber': out.amber,
      '--teal': out.teal,
      '--text': out.text,
      '--muted': out.muted,
      '--on-accent': out.onAccent,
      '--shade': isLight(out.ink) ? '#0a0a0a' : out.ink,
    },
  };
}

/** The hex a stored value shows as in a swatch (roles name the brand colour). */
export function swatchHex(value: string, brand: BrandColors | undefined): string {
  if (value.startsWith('#')) return value;
  const base = brandBase(brand || {});
  return base[value as keyof BrandColors] || base.ink;
}

/** Contrast as a short verdict for the picker ("7.1:1 · AAA"). */
export function contrastLabel(ratio: number): { text: string; ok: boolean } {
  const grade = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'Large text only' : 'Hard to read';
  return { text: `${ratio.toFixed(1)}:1 · ${grade}`, ok: ratio >= 4.5 };
}

/** The preset whose colours match the effective picks exactly (`brand` counts as unset), or null. */
export function matchingPreset(picks: PlateColors, presets: Array<{ id: string; colors: PlateColors }>): string | null {
  const keys = (o: PlateColors) =>
    PLATE_COLOR_KEYS.filter((k) => o[k] && o[k] !== 'brand')
      .map((k) => `${k}=${o[k]}`)
      .join('|');
  const want = keys(picks);
  return presets.find((p) => keys(sanitizePlateColors(p.colors, false)) === want)?.id ?? null;
}

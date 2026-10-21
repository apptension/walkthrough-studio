export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** `*word*` → `<tag class>word</tag>` after escaping, so copy stays plain text in config. */
export const emphasize = (s, open = '<span class="accent">', close = '</span>') =>
  esc(s).replace(/\*([^*]+)\*/g, `${open}$1${close}`);

/** Parse CSS hex (#RGB, #RGBA, #RRGGBB, #RRGGBBAA) → [r,g,b,a?]. */
export function parseCssHex(hex) {
  const h = String(hex || '').replace('#', '').trim();
  if (![3, 4, 6, 8].includes(h.length) || /[^0-9a-f]/i.test(h)) return null;
  const full =
    h.length <= 4
      ? [...h].map((c) => c + c).join('')
      : h;
  const n = parseInt(full.slice(0, 6), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  if (full.length === 8) return [r, g, b, parseInt(full.slice(6, 8), 16) / 255];
  return [r, g, b];
}

export function hexA(hex, alpha) {
  const rgb = parseCssHex(hex);
  if (!rgb) return `rgba(0,0,0,${alpha})`;
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

function relativeLuma(hex) {
  const rgb = parseCssHex(hex);
  if (!rgb) return 0;
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

export function brandCssVars(brand) {
  const c = brand.colors;
  const ink = c.ink || '#080a0f';
  // Soft elevation shadows must stay dark even when --ink is a white plate backdrop.
  const shade = relativeLuma(ink) > 160 ? '#0a0a0a' : ink;
  return [
    `--ink: ${ink};`,
    `--surface: ${c.surface || ink};`,
    `--gold: ${c.gold};`,
    `--amber: ${c.amber};`,
    `--teal: ${c.teal || c.gold};`,
    `--text: ${c.text || '#f8fafc'};`,
    `--muted: ${c.muted || '#94a3b8'};`,
    `--on-accent: ${c.onAccent || '#111'};`,
    `--shade: ${shade};`,
    `--font: '${brand.font.family}';`,
  ].join('\n      ');
}

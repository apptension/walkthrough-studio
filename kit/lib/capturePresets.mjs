/**
 * What the product is recorded at: a CSS viewport plus device traits. One resolver for every
 * browser the kit opens (guided tour, explore, analysis, record), so they all see the same layout.
 */
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const preset = (id, label, group, width, height, dpr, extra = {}) =>
  Object.freeze({ id, label, group, width, height, dpr, mobile: false, touch: false, userAgent: null, ...extra });

export const CAPTURE_PRESETS = Object.freeze({
  'desktop-fhd': preset('desktop-fhd', 'Desktop · 1920×1080', 'desktop', 1920, 1080, 2),
  'laptop-1536': preset('laptop-1536', 'Laptop · 1536×864', 'laptop', 1536, 864, 2),
  'laptop-1440': preset('laptop-1440', 'Laptop · 1440×810', 'laptop', 1440, 810, 2),
  'laptop-1280': preset('laptop-1280', 'Small laptop · 1280×720', 'laptop', 1280, 720, 2),
  'ipad-portrait': preset('ipad-portrait', 'iPad · 820×1180', 'tablet', 820, 1180, 2, { mobile: true, touch: true, userAgent: IPAD_UA }),
  'ipad-landscape': preset('ipad-landscape', 'iPad landscape · 1180×820', 'tablet', 1180, 820, 2, { mobile: true, touch: true, userAgent: IPAD_UA }),
  'iphone-15': preset('iphone-15', 'iPhone · 390×844', 'phone', 390, 844, 3, { mobile: true, touch: true, userAgent: IPHONE_UA }),
  'pixel-8': preset('pixel-8', 'Android · 412×916', 'phone', 412, 916, 3, { mobile: true, touch: true, userAgent: ANDROID_UA }),
});
export const DEFAULT_CAPTURE = 'desktop-fhd';

const even = (v) => Math.round(v / 2) * 2;

/** An error message for a size the kit cannot record, or null. */
export function validateCapture({ width, height, dpr = 2 } = {}) {
  for (const [k, v] of [['width', width], ['height', height]]) {
    if (!Number.isInteger(v) || v < 320 || v > 3840) return `Recording ${k} must be a whole number between 320 and 3840 px.`;
    if (v % 2) return `Recording ${k} must be even (video encoders need even sizes).`;
  }
  if (![1, 2, 3].includes(dpr)) return 'Pixel density must be 1, 2 or 3.';
  return null;
}

/** The capture a config asks for. `record.deviceScaleFactor` (older configs) keeps priority on DPR. */
export function captureProfile(config = {}) {
  const rec = config.record || {};
  const dev = rec.device || {};
  const fallback = CAPTURE_PRESETS[DEFAULT_CAPTURE];
  const base = CAPTURE_PRESETS[dev.preset] || null;
  const vp = rec.viewport || base || fallback;
  const width = vp.width || fallback.width;
  const height = vp.height || fallback.height;
  const sized = base && base.width === width && base.height === height ? base : null;
  const known = sized || (!base && !dev.mobile ? Object.values(CAPTURE_PRESETS).find((p) => !p.mobile && p.width === width && p.height === height) : null);
  const dprRaw = rec.deviceScaleFactor ?? dev.dpr ?? (base || known)?.dpr ?? 2;
  const id = dev.preset === 'screen' ? 'screen' : known ? known.id : 'custom';
  return {
    id,
    label: known ? known.label : id === 'screen' ? `My screen · ${width}×${height}` : `Custom · ${width}×${height}`,
    width,
    height,
    dpr: [1, 2, 3].includes(dprRaw) ? dprRaw : 2,
    mobile: Boolean(dev.mobile ?? base?.mobile ?? false),
    touch: Boolean(dev.touch ?? base?.touch ?? false),
    userAgent: dev.userAgent || base?.userAgent || null,
  };
}

/** Playwright newContext options for a profile. */
export function contextOptions(p) {
  return {
    viewport: { width: p.width, height: p.height },
    deviceScaleFactor: p.dpr,
    isMobile: p.mobile,
    hasTouch: p.touch,
    ...(p.userAgent ? { userAgent: p.userAgent } : {}),
  };
}

/**
 * Browser context for exploring, analysing or browsing the product: the same layout, device and
 * touch as the take, at a cheaper pixel density (screenshots there feed agents, not the video).
 */
export function analysisContextOptions(config, { maxDpr = 2 } = {}) {
  const p = captureProfile(config);
  return { ...contextOptions(p), deviceScaleFactor: Math.min(p.dpr, maxDpr) };
}

/** "iPhone · 390×844 CSS px @3x, mobile, touch" — names the device in agent prompts and logs. */
export function describeCapture(p) {
  const traits = [p.mobile && 'mobile', p.touch && 'touch'].filter(Boolean);
  const name = String(p.label || '').split(' · ')[0] || 'Custom';
  return `${name} · ${p.width}×${p.height} CSS px @${p.dpr}x${traits.length ? ', ' + traits.join(', ') : ''}`;
}

/** What Studio / the CLI write back into video.config.json → record. */
export function configPatch(p) {
  const known = CAPTURE_PRESETS[p.id];
  const viewport = { width: p.width, height: p.height };
  if (known && known.width === p.width && known.height === p.height) {
    if (p.id === DEFAULT_CAPTURE && p.dpr === known.dpr) return { viewport };
    return { viewport, device: { preset: p.id, ...(p.dpr !== known.dpr ? { dpr: p.dpr } : {}) } };
  }
  return {
    viewport,
    device: {
      preset: p.id === 'screen' ? 'screen' : 'custom',
      dpr: p.dpr,
      ...(p.mobile ? { mobile: true } : {}),
      ...(p.touch ? { touch: true } : {}),
      ...(p.userAgent ? { userAgent: p.userAgent } : {}),
    },
  };
}

const PHONE_HINT = /\b(mobile|phones?|smartphones?|ios|android|pwa|on the go|in the field|field (staff|team|technicians?))\b/i;

/**
 * Ranked choices for the Recording size picker. `screen` is what Studio reads from the reviewer's
 * browser (CSS px). A guided tour is shown on that screen, so sizes it displays at ≥90% rank
 * first; the bot alone (agent mode) is not limited by the screen.
 */
export function suggestCaptures({ screen = null, brief = {}, mode = 'agent', output = 'landscape' } = {}) {
  // Who uses it and what it is — not scenario data, where "Orion Mobile App" is just a project name.
  const text = [brief.audience, brief.product, brief.app?.platform].filter(Boolean).join(' ');
  const wantsPhone = PHONE_HINT.test(text);
  const room = screen ? { w: (screen.availWidth || screen.width) - 40, h: (screen.availHeight || screen.height) - 120 } : null;
  const fit = (p) => (room ? Math.min(1, room.w / p.width, room.h / p.height) : 1);
  const own =
    room && validateCapture({ width: even(room.w), height: even(room.h) }) === null
      ? { ...CAPTURE_PRESETS[DEFAULT_CAPTURE], id: 'screen', label: `My screen · ${even(room.w)}×${even(room.h)}`, width: even(room.w), height: even(room.h) }
      : null;
  const rows = [...Object.values(CAPTURE_PRESETS), ...(own ? [own] : [])].map((p) => {
    const f = fit(p);
    let score = 0;
    const why = [];
    const vertical = output === 'portrait';
    if (wantsPhone) score += p.group === 'phone' ? 40 : p.group === 'tablet' ? 15 : 0;
    else score += p.group === 'desktop' ? 30 : p.group === 'laptop' ? 24 : 0;
    if (vertical) score += p.group === 'phone' ? 50 : p.height > p.width ? 40 : 0;
    else if (Math.abs(p.width / p.height - 16 / 9) < 0.02) score += 8;
    if (mode === 'guided') {
      score += f >= 0.9 ? 30 : f >= 0.75 ? 12 : -20;
      if (screen) why.push(`shown at ${Math.round(f * 100)}% on your ${screen.width}×${screen.height} screen`);
    }
    if (p.id === DEFAULT_CAPTURE && !vertical) why.push('matches the 1080p video 1:1');
    if (vertical && p.group === 'phone') why.push('fills a vertical video');
    if (wantsPhone && p.group === 'phone') why.push('your brief describes phone users');
    if (p.id === 'screen') score -= 10;
    score += p.width / 1000;
    return { preset: { ...p }, score: Number(score.toFixed(2)), reason: why.join(' · ') || p.label };
  });
  return rows.sort((a, b) => b.score - a.score);
}

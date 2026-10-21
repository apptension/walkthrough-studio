/**
 * Discover / refresh a brand pack from a live marketing site and optional app URL.
 * Prefer official SVG/PNG lockups over invented wordmarks. Always review before plates.
 *
 *   node cli.mjs discover-brand --name Acme --url https://acme.example --app-url https://app.acme.example
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chromium } from 'playwright';
import { BRANDS } from './project.mjs';

function slugify(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function rgbToHex(rgb) {
  const hex = String(rgb).trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) return `#${hex[1].toLowerCase()}`;
  const m = String(rgb).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return (
    '#' +
    [m[1], m[2], m[3]]
      .map((n) => Number(n).toString(16).padStart(2, '0'))
      .join('')
  );
}

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Dark plate palette tinted by the brand accent (plates are always dark; the accent carries the brand). */
function paletteFromAccent(accent, brandInk = null) {
  const [h, s] = hexToHsl(accent);
  const tint = Math.min(s, 0.45);
  const n = parseInt(accent.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  const ink = brandInk || hslToHex(h, tint, 0.06);
  const [inkH, inkS, inkL] = hexToHsl(ink);
  return {
    ink,
    surface: hslToHex(inkH, Math.min(inkS, 0.45), Math.min(0.2, inkL + 0.06)),
    gold: accent,
    amber: hslToHex((h + 18) % 360, Math.max(s, 0.5), 0.58),
    teal: '#2dd4bf',
    text: '#f8fafc',
    muted: hslToHex(h, Math.min(s, 0.14), 0.68),
    onAccent: lum > 150 ? hslToHex(h, tint, 0.08) : '#ffffff',
  };
}

async function dismissCookies(page) {
  const allow = page.getByRole('button', { name: /allow all|accept all|agree/i });
  if (await allow.isVisible({ timeout: 2500 }).catch(() => false)) {
    await allow.click({ force: true }).catch(() => {});
  }
}

async function harvestPage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1800);
  await dismissCookies(page);
  return page.evaluate(() => {
    const logos = [];
    for (const link of document.querySelectorAll(
      'link[rel*="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]'
    )) {
      if (link.href) logos.push({ kind: 'icon', href: link.href, rel: link.rel, sizes: link.getAttribute('sizes') });
    }
    for (const img of document.querySelectorAll('img, image')) {
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      const cls = (img.getAttribute('class') || '').toLowerCase();
      const src = img.currentSrc || img.getAttribute('src') || img.getAttribute('href') || '';
      if (!src) continue;
      if (/logo|brand|wordmark|mark/i.test(alt + cls + src)) {
        logos.push({
          kind: 'img',
          href: src.startsWith('http') || src.startsWith('data:') ? src : new URL(src, location.href).href,
          alt: img.getAttribute('alt') || '',
          w: img.naturalWidth || 0,
          h: img.naturalHeight || 0,
        });
      }
    }
    for (const a of document.querySelectorAll('a[href="/"] img, header img, nav img, .logo img, [class*="logo"] img')) {
      const src = a.currentSrc || a.src;
      if (src) logos.push({ kind: 'header-img', href: src, alt: a.alt || '' });
    }
    // Prefer explicit logo SVG assets linked from the page.
    for (const a of document.querySelectorAll('a[href$=".svg"], img[src$=".svg"]')) {
      const href = a.href || a.src;
      if (href && /logo/i.test(href)) logos.push({ kind: 'svg-link', href });
    }
    // Official brand lockup paths (not client walls under /logos/).
    for (const path of ['/logo/logo-full.svg', '/logo/logo-wordmark.svg', '/logo/logo-signet.svg', '/logo.svg']) {
      logos.push({ kind: 'brand-path', href: new URL(path, location.href).href, alt: 'brand lockup' });
    }
    // Header home-link SVG / img (often the real mark when client logos dominate the DOM).
    const home = document.querySelector('header a[href="/"], nav a[href="/"], a[aria-label*="home" i], a[aria-label*="apptension" i]');
    if (home) {
      const img = home.querySelector('img, svg image');
      const src = img?.currentSrc || img?.getAttribute?.('href') || img?.getAttribute?.('src');
      if (src) {
        logos.push({
          kind: 'header-brand',
          href: src.startsWith('http') || src.startsWith('data:') ? src : new URL(src, location.href).href,
          alt: img.getAttribute?.('alt') || 'header brand',
        });
      }
    }
    // Many modern sites ship the real lockup inline instead of exposing a logo file.
    const inline = [
      ...document.querySelectorAll(
        'header a svg, nav a svg, a[aria-label*="home" i] svg, a[aria-label*="startseite" i] svg, [class*="logo"] svg'
      ),
    ];
    inline.slice(0, 8).forEach((svg, index) => {
      const box = svg.getBoundingClientRect();
      if (box.width < 40 || box.height < 12) return;
      logos.push({
        kind: 'inline-brand',
        href: `${location.href}#inline-brand-${index}`,
        alt: svg.closest('a')?.getAttribute('aria-label') || 'inline brand lockup',
        w: Math.round(box.width),
        h: Math.round(box.height),
        svg: svg.outerHTML,
      });
    });
    const btn = [...document.querySelectorAll('a, button')].find((b) =>
      /trial|sign in|get started|demo|continue|talk to|contact|mitglied|anmelden|entdecken|buchen|einloggen/i.test(
        b.textContent || ''
      )
    );
    const colors = {};
    if (btn) {
      const s = getComputedStyle(btn);
      colors.ctaBg = s.backgroundColor;
      colors.ctaColor = s.color;
    }
    // Sample saturated accents (neon yellow / green etc.) from visible UI.
    const accentHits = new Map();
    for (const el of document.querySelectorAll('a, button, [class*="accent"], [class*="brand"], h1 span, .gradient')) {
      const s = getComputedStyle(el);
      for (const prop of ['color', 'backgroundColor', 'borderColor']) {
        const v = s[prop];
        const m = String(v).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) continue;
        const [r, g, b] = m.slice(1).map(Number);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const sat = max === 0 ? 0 : (max - min) / max;
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        if (sat > 0.4 && lum > 0.4 && lum < 0.99 && !(r > 245 && g > 245 && b > 245)) {
          const hex =
            '#' +
            [r, g, b]
              .map((n) => n.toString(16).padStart(2, '0'))
              .join('');
          accentHits.set(hex, (accentHits.get(hex) || 0) + 1);
        }
      }
    }
    const topAccent = [...accentHits.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topAccent) colors.accentSample = topAccent[0];
    const root = getComputedStyle(document.documentElement);
    colors.custom = {};
    for (let i = 0; i < root.length; i++) {
      const key = root[i];
      if (!key.startsWith('--') || !/(accent|brand|primary|yellow|gold|dark|ink|surface)/i.test(key)) continue;
      const value = root.getPropertyValue(key).trim();
      if (value) colors.custom[key] = value;
    }
    colors.bodyBg = getComputedStyle(document.body).backgroundColor;
    colors.bodyColor = getComputedStyle(document.body).color;
    colors.font = getComputedStyle(document.body).fontFamily;
    colors.fontCss =
      [...document.querySelectorAll('link[rel="stylesheet"]')]
        .map((link) => link.href)
        .find((href) => /fonts\.(googleapis|bunny)\.com/i.test(href)) || '';
    colors.theme = document.querySelector('meta[name="theme-color"]')?.content || '';
    const title = document.title;
    const h1 = document.querySelector('h1')?.innerText?.replace(/\s+/g, ' ').trim() || '';
    const sub =
      document.querySelector('h1 + p, .hero p, [class*="hero"] p')?.textContent?.trim()?.slice(0, 200) || '';
    return { url: location.href, title, h1, sub, logos, colors };
  });
}

async function download(page, url, dest) {
  if (url.startsWith('data:')) {
    const m = url.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!m) return null;
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const file = `${dest}.${ext}`;
    writeFileSync(file, Buffer.from(m[2], 'base64'));
    return file;
  }
  const res = await page.request.get(url);
  if (!res.ok()) return null;
  const buf = Buffer.from(await res.body());
  const ct = res.headers()['content-type'] || '';
  const ext = url.includes('.svg') || ct.includes('svg') ? 'svg' : url.includes('.png') || ct.includes('png') ? 'png' : 'bin';
  const file = `${dest}.${ext}`;
  writeFileSync(file, buf);
  return file;
}

function pickLogoCandidates(logos, { brandSlug = '' } = {}) {
  const scored = logos
    .filter((l) => l.href && !l.href.includes('cookie') && !/reviewer|avatar|pexels/i.test(l.href))
    .map((l) => {
      let score = 0;
      const href = l.href;
      const blob = `${href} ${l.alt || ''} ${l.rel || ''}`.toLowerCase();
      if (/\.svg(\?|$)/i.test(href) || l.kind === 'svg-link') score += 50;
      if (/logo/i.test(blob)) score += 20;
      if (/white|light|dark/i.test(href)) score += 5;
      if (l.kind === 'header-img') score += 15;
      if (l.kind === 'inline-brand') score += 400;
      if (l.w >= 120 || l.h >= 40) score += 10;
      // Official brand lockups live under /logo/… — boost hard.
      if (/\/logo\/(logo-full|logo-wordmark|logo-signet|wordmark)/i.test(href)) score += 120;
      if (/\/logo\//i.test(href) && !/\/logos\//i.test(href)) score += 80;
      if (brandSlug && new RegExp(brandSlug, 'i').test(href)) score += 40;
      // Client / partner walls on marketing sites are almost always /logos/* — demote.
      if (/\/logos\//i.test(href)) score -= 100;
      if (/logo-(viu|netflix|uber|hoover|less|universal|unit9|mill|hyper|mojo|blkbx|peptalk)/i.test(href)) {
        score -= 150;
      }
      if (/favicon|icon-16|icon-32|apple-touch|android-chrome/i.test(href)) score -= 30;
      return { ...l, score };
    })
    .sort((a, b) => b.score - a.score);
  const seen = new Set();
  return scored.filter((l) => {
    if (seen.has(l.href)) return false;
    seen.add(l.href);
    return true;
  });
}

function motionBriefTemplate({ name, audience, h1, sub, colors, sources }) {
  return `# Motion brief — ${name}

> Living brand + motion memory for every walkthrough of this product.
> Update when the site/app visual language changes. Agents must read this before plates or narration.

## Audience

${audience || '_Who watches these videos, and what should they be able to do afterwards._'}

## Product promise

- Hero line: ${h1 || '_from marketing site_'}
- Supporting: ${sub || '_from marketing site_'}

## Brand voice & tone

- Voice: clear, confident, practical — outcomes over feature lists.
- Tone: modern SaaS, energetic but not noisy; lowercase brand lockup when official.
- Narration: warm product voice (ElevenLabs Matilda unless overridden); no jargon, no internal ticket language.
- On-screen copy: short captions (≤ 5-word titles); chapter cards name the outcome.

## Visual system

| Token | Value | Notes |
| ----- | ----- | ----- |
| Accent (gold) | ${colors.gold || '_TBD_'} | Primary CTAs, focus rings, plate accents |
| Accent end (amber) | ${colors.amber || '_TBD_'} | Gradient end |
| Ink / surface | ${colors.ink || '_TBD_'} / ${colors.surface || '_TBD_'} | Dark plate backdrop |
| Text / muted | ${colors.text || '#f8fafc'} / ${colors.muted || '#a3b8a3'} | Plate type |

- **Logo:** use the official lockup in \`logo.html\` (sourced from the site/app). Never invent a substitute mark or wordmark.
- **Logo on plates:** white (or brand-provided light) lockup on dark ink; keep clear space ≈ 0.5× mark height; center horizontally; open plate larger (~40–46% width), close plate smaller (~25–28% width).
- **Live reel:** true UI color — no grade. Focus ring uses accent green.

## Plate palette

Decide 2–5 interstitials per video (not only open/close titles):

| Type | Use |
| ---- | --- |
| \`features\` | Capability pillars (3–6) before the live tour |
| \`stats\` | Ratings / KPIs / “in numbers” before the payoff |
| \`callout\` | One thesis + bullets before a hard live turn |
| \`testimonials\` | Quote flood for social proof |
| \`logos\` | Client / integration wall (assets under brands/<name>/assets/) |
| \`journey\` | First-user path map before the deep dive |
| \`compare\` | Before / after columns — the shift the product makes |
| \`quote\` | One hero quote on the full stage |
| \`metric\` | One number worth remembering, in a progress ring |
| \`orbit\` | Integrations / clients circling the lockup |

Facts must come from this brief or the live site — never invent metrics.

## Motion language

- Plates: logo builds left→right (trace), then lifts; feature/stat cards rise; black-out into the next live slice.
- Atmosphere: \`brand.json → motion.atmosphere\` picks the WebGL field behind every plate (none / schedule / aurora /
  mesh / particles / grid / waves) — choose the one that echoes the product (timelines → schedule, data → grid or
  waves, consumer warmth → aurora or mesh). Title reveal (rise / cascade / wipe), card depth (flat / soft / deep)
  and sheen live beside it; a video may override any of them in \`direction.motion\`.
- Live: chapter cards before navigation; captions right before the action they describe; every overlay exits.
- Pace: unhurried (~85–90 BPM music bed); speech over ~65% of runtime.
- Avoid: fake cursors on stills, glass/blur overlays, emoji, stub audio on delivery, title-only edits.

## Audio bed

- Style: modern SaaS underscore — soft keys/pads, light pulse, instrumental.
- Mix: narration −16 LUFS, plate music −20, bed −31, master −14 / −1 dBTP.

## Delivery

- Canvas: **1920×1080 (Full HD)** unless a video explicitly overrides \`record.viewport\`.
- Validate contact sheet before hand-off: logo legible, no cookie banners, joins clean.

## Sources

${sources.map((s) => `- ${s}`).join('\n') || '- _add marketing + app URLs_'}

---
_Generated/updated by \`cli.mjs discover-brand\`. Edit freely; keep factual._
`;
}

export async function discoverBrandFromUrls({
  name,
  url,
  appUrl,
  audience = '',
  force = false,
  onProgress = () => {},
} = {}) {
  if (!name || !url) throw new Error('discover-brand requires --name and --url');
  const say = (msg) => {
    try {
      onProgress(msg);
    } catch {
      /* progress is best-effort */
    }
  };
  const slug = slugify(name);
  const dir = join(BRANDS, slug);
  if (existsSync(join(dir, 'brand.json')) && !force) {
    throw new Error(`Brand ${slug} already exists at ${dir} — pass --force to refresh assets (keeps reviewed motion-brief edits if you merge by hand)`);
  }
  mkdirSync(dir, { recursive: true });

  say('Launching a headless browser');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const report = { name, slug, url, appUrl: appUrl || null, harvestedAt: new Date().toISOString(), pages: [], logos: [] };

  try {
    say(`Opening ${url}`);
    const marketing = await harvestPage(page, url);
    report.pages.push(marketing);
    say(
      `Read the website${marketing.h1 ? ` — headline “${String(marketing.h1).slice(0, 80)}”` : ''} · ${marketing.logos.length} logo hint${marketing.logos.length === 1 ? '' : 's'}`
    );
    let app = null;
    if (appUrl) {
      say(`Opening the app at ${appUrl}`);
      app = await harvestPage(page, appUrl);
      report.pages.push(app);
      say(`Read the app · ${app.logos.length} logo hint${app.logos.length === 1 ? '' : 's'}`);
    }

    const candidates = pickLogoCandidates(
      [
        ...marketing.logos,
        ...(app?.logos || []),
        { kind: 'guess', href: new URL('/logo/logo-full.svg', url).href, score: 40 },
        { kind: 'guess', href: new URL('/logo.svg', url).href, score: 40 },
      ],
      { brandSlug: slug }
    );
    report.logos = candidates.slice(0, 12);
    say(`Ranked ${candidates.length} logo candidate${candidates.length === 1 ? '' : 's'} · downloading the best ${Math.min(candidates.length, 6)}`);

    const saved = [];
    for (let i = 0; i < Math.min(candidates.length, 6); i++) {
      const c = candidates[i];
      let file;
      if (c.svg) {
        file = join(dir, `source-logo-${i}.svg`);
        writeFileSync(file, c.svg);
      } else {
        file = await download(page, c.href, join(dir, `source-logo-${i}`));
      }
      if (file) {
        saved.push({ ...c, file });
        say(`Saved ${basename(file)} (${c.kind})`);
      }
    }

    // Prefer SVG for logo.html; else PNG as logo-img.
    const svg = saved.find((s) => s.file.endsWith('.svg'));
    const png = saved.find((s) => s.file.endsWith('.png') && /logo|white/i.test(s.file + s.href));
    let logoHtml;
    if (svg) {
      const raw = readFileSync(svg.file, 'utf8');
      // Wrap as animated pieces when paths exist; else img fallback.
      if (/<path|<polygon/i.test(raw)) {
        logoHtml = `<!-- Sourced: ${svg.href} -->\n${raw.replace(/<svg\b/, '<svg class="logo-svg" role="img"')}`;
        // Ensure white fill for dark plates when brand SVG is white already.
        writeFileSync(join(dir, 'logo-source.svg'), raw);
      }
    }
    if (!logoHtml && (png || saved[0])) {
      const file = (png || saved[0]).file;
      const b64 = readFileSync(file).toString('base64');
      const mime = file.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
      logoHtml = `<!-- Sourced lockup — do not replace with a homemade mark. -->\n<img class="logo-img" alt="${name}" src="data:${mime};base64,${b64}" />\n`;
    }
    if (!logoHtml) {
      logoHtml = `<div class="wordmark">${name}</div>\n`;
      report.warning = 'No logo asset downloaded — wordmark placeholder only. Grab the official SVG/PNG manually.';
    }
    writeFileSync(join(dir, 'logo.html'), logoHtml);
    say(
      report.warning
        ? `Logo: ${report.warning}`
        : `Logo lockup: ${svg && logoHtml.includes('logo-svg') ? 'vector SVG' : 'image'} from ${svg?.href || png?.href || saved[0]?.href}`
    );

    // Prefer saturated brand accents harvested from the page over a white CTA.
    const customColors = Object.entries(marketing.colors.custom || {});
    const accentTokens = customColors
      .filter(([key]) => /(accent|brand|primary|yellow|gold)/i.test(key))
      .map(([, value]) => rgbToHex(value))
      .filter(Boolean);
    const harvestedHexes = [
      ...accentTokens,
      marketing.colors.accentSample,
      rgbToHex(marketing.colors.ctaBg),
      rgbToHex(marketing.colors.ctaColor),
    ].filter(Boolean);
    const neonish = harvestedHexes.find((h) => {
      const n = parseInt(h.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      return sat > 0.35 && lum > 0.35 && lum < 0.95 && !(r > 240 && g > 240 && b > 240);
    });
    const cta = neonish || harvestedHexes.find((h) => h.toLowerCase() !== '#ffffff') || '#3b82f6';
    const brandInk =
      customColors
        .filter(([key]) => /(dark|ink)/i.test(key))
        .map(([, value]) => rgbToHex(value))
        .find(Boolean) ||
      rgbToHex(marketing.colors.bodyColor);
    const fontFamily =
      String(marketing.colors.font || 'system-ui')
        .split(',')[0]
        .trim()
        .replace(/^['"]|['"]$/g, '') || 'system-ui';
    const fontCss = marketing.colors.fontCss || 'data:text/css,';
    const brand = {
      name,
      platform: marketing.h1?.slice(0, 48) || name,
      font: {
        family: fontFamily,
        css: fontCss,
      },
      colors: paletteFromAccent(cta, brandInk),
      logo: 'logo.html',
      motionBrief: 'motion-brief.md',
      placeholder: Boolean(report.warning),
      discovery: {
        status: report.warning ? 'needs-review' : 'ready',
        harvestedAt: report.harvestedAt,
        logoSource: svg?.href || png?.href || saved[0]?.href || null,
        paletteSource: url,
        fontSource: fontCss || null,
      },
      sources: { marketing: url, app: appUrl || null },
      audio: {
        voice: {
          provider: 'elevenlabs',
          name: 'Matilda',
          voiceId: 'XrExE9yKIg1WjnnlVkGX',
          model: 'eleven_v4',
          outputFormat: 'mp3_44100_128',
          direction: '[warm, clear product narration]',
          settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            style: 0.25,
            use_speaker_boost: true,
            speed: 1.05,
          },
          maxFitSpeed: 1.15,
          pronunciations: {},
        },
        music: {
          provider: 'elevenlabs',
          model: 'music_v2_5',
          styles: [
            'modern SaaS underscore',
            'soft electric piano',
            'light synth pads',
            'subtle pulse',
            'optimistic and clear',
            '88 BPM',
            'spacious mix',
            'instrumental',
          ],
          negativeStyles: ['vocals', 'lyrics', 'heavy drums', 'distorted guitar', 'harsh', 'fast', 'busy melody'],
          intro: ['bright open swell', 'clean pads', 'product reveal'],
          bed: ['understated', 'minimal', 'steady', 'background music under narration'],
          outro: ['resolving', 'warm final chord', 'gentle fade'],
        },
        mix: {
          voiceLufs: -16,
          plateLufs: -20,
          bedLufs: -31,
          duck: { threshold: 0.02, ratio: 3, attackMs: 20, releaseMs: 350 },
          targetLufs: -14,
          truePeakDb: -1,
          sampleRate: 48000,
          bitrate: '192k',
        },
      },
    };
    say(`Palette: accent ${brand.colors.gold} · ink ${brand.colors.ink} · surface ${brand.colors.surface} · teal ${brand.colors.teal}`);
    say(`Typeface: ${fontFamily}`);
    writeFileSync(join(dir, 'brand.json'), JSON.stringify(brand, null, 2) + '\n');
    say('Wrote brand.json');

    const brief = motionBriefTemplate({
      name,
      audience,
      h1: marketing.h1,
      sub: marketing.sub,
      colors: brand.colors,
      sources: [url, appUrl].filter(Boolean),
    });
    writeFileSync(join(dir, 'motion-brief.md'), brief);
    writeFileSync(join(dir, 'discover-report.json'), JSON.stringify(report, null, 2) + '\n');
    say('Wrote motion-brief.md and discover-report.json');

    return { dir, brand, report, saved };
  } finally {
    await browser.close();
  }
}

/**
 * Harvest brand signals from a live marketing site and optional app URL.
 * Does NOT pick the lockup, palette, or type — that is the agent's job
 * (`startDiscoverBrand` / CLI discover-brand after harvest).
 *
 *   node cli.mjs discover-brand --name Acme --url https://acme.example --app-url https://app.acme.example
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chromium } from 'playwright';
import { BRANDS } from './project.mjs';

export function slugifyBrand(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function dismissCookies(page) {
  const allow = page.getByRole('button', { name: /allow all|accept all|agree/i });
  if (await allow.isVisible({ timeout: 2500 }).catch(() => false)) {
    await allow.click({ force: true }).catch(() => {});
  }
}

/**
 * Collect raw DOM observations. Broad collection, minimal filtering — the agent
 * decides which asset is the official lockup vs partner marks vs favicons.
 */
async function harvestPage(page, url, brandName = '') {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1800);
  await dismissCookies(page);
  return page.evaluate((brand) => {
    const abs = (src) => {
      if (!src) return '';
      if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('blob:')) return src;
      try {
        return new URL(src, location.href).href;
      } catch {
        return src;
      }
    };
    const logos = [];
    const push = (entry) => {
      if (!entry?.href) return;
      logos.push(entry);
    };

    for (const link of document.querySelectorAll(
      'link[rel*="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]'
    )) {
      if (link.href) push({ kind: 'icon', href: link.href, rel: link.rel, sizes: link.getAttribute('sizes') });
    }

    for (const img of document.querySelectorAll('img, image')) {
      const src = img.currentSrc || img.getAttribute('src') || img.getAttribute('href') || '';
      if (!src) continue;
      push({
        kind: 'img',
        href: abs(src),
        alt: img.getAttribute('alt') || '',
        className: img.getAttribute('class') || '',
        w: img.naturalWidth || 0,
        h: img.naturalHeight || 0,
      });
    }

    for (const a of document.querySelectorAll(
      'a[href="/"] img, header img, nav img, footer img, [class*="logo"] img, [class*="brand"] img'
    )) {
      const src = a.currentSrc || a.src;
      if (src) push({ kind: 'header-img', href: abs(src), alt: a.alt || '' });
    }

    for (const el of document.querySelectorAll('a[href$=".svg"], img[src$=".svg"], link[href$=".svg"]')) {
      const href = el.href || el.src || el.getAttribute?.('href');
      if (href) push({ kind: 'svg-link', href: abs(href), alt: el.getAttribute?.('alt') || '' });
    }

    const homeSelectors = [
      'header a[href="/"]',
      'nav a[href="/"]',
      'a[aria-label*="home" i]',
      'a[aria-label*="startseite" i]',
    ];
    if (brand) homeSelectors.push(`a[aria-label*="${CSS.escape(brand)}" i]`);
    const home = document.querySelector(homeSelectors.join(', '));
    if (home) {
      const img = home.querySelector('img, svg image');
      const src = img?.currentSrc || img?.getAttribute?.('href') || img?.getAttribute?.('src');
      if (src) {
        push({
          kind: 'header-brand',
          href: abs(src),
          alt: img.getAttribute?.('alt') || home.getAttribute('aria-label') || 'header brand',
        });
      }
    }

    const inline = [
      ...document.querySelectorAll(
        'header a svg, nav a svg, a[aria-label*="home" i] svg, a[aria-label*="startseite" i] svg, [class*="logo"] svg, [class*="brand"] svg'
      ),
    ];
    inline.slice(0, 12).forEach((svg, index) => {
      const box = svg.getBoundingClientRect();
      if (box.width < 24 || box.height < 10) return;
      push({
        kind: 'inline-brand',
        href: `${location.href}#inline-brand-${index}`,
        alt: svg.closest('a')?.getAttribute('aria-label') || 'inline brand lockup',
        w: Math.round(box.width),
        h: Math.round(box.height),
        svg: svg.outerHTML,
      });
    });

    const buttons = [...document.querySelectorAll('a, button')]
      .filter((b) => (b.textContent || '').trim().length < 48)
      .slice(0, 40)
      .map((b) => {
        const s = getComputedStyle(b);
        return {
          text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
          bg: s.backgroundColor,
          color: s.color,
          border: s.borderColor,
        };
      });

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
        if (sat > 0.35 && lum > 0.25 && lum < 0.98 && !(r > 245 && g > 245 && b > 245)) {
          const hex =
            '#' +
            [r, g, b]
              .map((n) => n.toString(16).padStart(2, '0'))
              .join('');
          accentHits.set(hex, (accentHits.get(hex) || 0) + 1);
        }
      }
    }
    const accentSamples = [...accentHits.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([hex, count]) => ({ hex, count }));

    const root = getComputedStyle(document.documentElement);
    const custom = {};
    for (let i = 0; i < root.length; i++) {
      const key = root[i];
      if (!key.startsWith('--')) continue;
      const value = root.getPropertyValue(key).trim();
      if (value && value.length < 80) custom[key] = value;
    }

    const fontLinks = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .map((link) => link.href)
      .filter((href) => /font/i.test(href));

    const scrub = (t) =>
      String(t || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240);
    const junkSub = /video player|play video|cookie|consent|unmute|playback rate|seek to live/i;
    const subCandidates = [
      document.querySelector('h1 + p')?.textContent,
      document.querySelector('[class*="hero"] p, .hero p, [class*="subtitle"], [class*="subhead"]')?.textContent,
      document.querySelector('meta[name="description"]')?.content,
    ]
      .map(scrub)
      .filter((t) => t && t.length > 20 && !junkSub.test(t));

    return {
      url: location.href,
      title: document.title,
      h1: document.querySelector('h1')?.innerText?.replace(/\s+/g, ' ').trim() || '',
      sub: subCandidates[0] || '',
      logos,
      colors: {
        buttons: buttons.slice(0, 12),
        accentSamples,
        custom,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        bodyColor: getComputedStyle(document.body).color,
        font: getComputedStyle(document.body).fontFamily,
        fontLinks,
        theme: document.querySelector('meta[name="theme-color"]')?.content || '',
      },
    };
  }, brandName);
}

async function saveCandidate(page, entry, destBase) {
  if (entry.svg) {
    const file = `${destBase}.svg`;
    writeFileSync(file, entry.svg);
    return file;
  }
  const url = entry.href;
  if (!url || url.startsWith('blob:')) return null;
  if (/#inline-brand-\d+$/i.test(url)) return null;
  if (url.startsWith('data:')) {
    const m = url.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!m) return null;
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const file = `${destBase}.${ext}`;
    writeFileSync(file, Buffer.from(m[2], 'base64'));
    return file;
  }
  try {
    const res = await page.request.get(url);
    if (!res.ok()) return null;
    const buf = Buffer.from(await res.body());
    const ct = (res.headers()['content-type'] || '').toLowerCase();
    if (ct.includes('text/html') || ct.includes('application/json')) return null;
    if (buf.length < 40) return null;
    const head = buf.subarray(0, Math.min(buf.length, 64)).toString('utf8').trimStart();
    if (/^<!DOCTYPE|^<html/i.test(head)) return null;
    const looksSvg = ct.includes('svg') || /\.svg(\?|$)/i.test(url) || /^<svg[\s>]/i.test(head);
    const looksPng = ct.includes('png') || buf[0] === 0x89;
    const looksJpg = ct.includes('jpeg') || ct.includes('jpg') || (buf[0] === 0xff && buf[1] === 0xd8);
    const looksWebp = ct.includes('webp');
    const looksIco = ct.includes('icon') || /\.ico(\?|$)/i.test(url);
    if (!looksSvg && !looksPng && !looksJpg && !looksWebp && !looksIco) return null;
    const ext = looksSvg ? 'svg' : looksPng ? 'png' : looksJpg ? 'jpg' : looksWebp ? 'webp' : 'ico';
    const file = `${destBase}.${ext}`;
    writeFileSync(file, buf);
    return file;
  } catch {
    return null;
  }
}

function dedupeLogos(logos) {
  const seen = new Set();
  const out = [];
  for (const l of logos) {
    const key = l.svg ? `svg:${(l.svg || '').slice(0, 120)}` : l.href;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

/** Default audio block agents may copy into brand.json when authoring a pack. */
export const DEFAULT_BRAND_AUDIO = {
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
};

/**
 * Harvest only: write discover-report.json + candidate assets + a placeholder brand.json.
 * An agent must author logo.html, final brand.json, and motion-brief.md afterwards.
 */
export async function harvestBrandFromUrls({
  name,
  url,
  appUrl,
  audience = '',
  force = false,
  onProgress = () => {},
  maxCandidates = 30,
} = {}) {
  if (!name || !url) throw new Error('discover-brand requires --name and --url');
  const say = (msg) => {
    try {
      onProgress(msg);
    } catch {
      /* progress is best-effort */
    }
  };
  const slug = slugifyBrand(name);
  const dir = join(BRANDS, slug);
  if (existsSync(join(dir, 'brand.json')) && !force) {
    throw new Error(
      `Brand ${slug} already exists at ${dir} — pass --force to refresh assets (keeps reviewed motion-brief edits if you merge by hand)`
    );
  }
  mkdirSync(dir, { recursive: true });
  const candidatesDir = join(dir, 'candidates');
  if (existsSync(candidatesDir)) {
    for (const f of readdirSync(candidatesDir)) {
      try {
        rmSync(join(candidatesDir, f), { force: true });
      } catch {
        /* ignore */
      }
    }
  }
  mkdirSync(candidatesDir, { recursive: true });
  // Drop previous authored outputs so the agent cannot treat a stale wordmark as done.
  if (force) {
    for (const f of ['logo.html', 'logo-source.svg', 'motion-brief.md', 'studio-choices.json', 'agent-lockup.html']) {
      try {
        rmSync(join(dir, f), { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  say('Launching a headless browser');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const report = {
    name,
    slug,
    url,
    appUrl: appUrl || null,
    audience: audience || '',
    harvestedAt: new Date().toISOString(),
    phase: 'harvested',
    pages: [],
    logos: [],
    saved: [],
    instructions:
      'An agent must pick the official brand lockup from saved candidates (not partner/integration marks or favicons), write logo.html + logo-source.svg, author brand.json (placeholder:false when ready) and motion-brief.md.',
  };

  try {
    say(`Opening ${url}`);
    const marketing = await harvestPage(page, url, name);
    report.pages.push(marketing);
    say(
      `Read the website${marketing.h1 ? ` — headline “${String(marketing.h1).slice(0, 80)}”` : ''} · ${marketing.logos.length} media hint${marketing.logos.length === 1 ? '' : 's'}`
    );
    let app = null;
    if (appUrl) {
      say(`Opening the app at ${appUrl}`);
      app = await harvestPage(page, appUrl, name);
      report.pages.push(app);
      say(`Read the app · ${app.logos.length} media hint${app.logos.length === 1 ? '' : 's'}`);
    }

    const logos = dedupeLogos([...marketing.logos, ...(app?.logos || [])]);
    // Download budget: prefer vectors / header marks over favicons so the agent has
    // useful local files. This is not lockup selection — the agent still chooses.
    const downloadOrder = (l) => {
      if (l.svg || l.kind === 'inline-brand') return 0;
      if (l.kind === 'svg-link' || /\.svg(\?|$)/i.test(l.href || '')) return 1;
      if (l.kind === 'header-brand' || l.kind === 'header-img') return 2;
      if (l.kind === 'img') return 3;
      if (l.kind === 'icon') return 5;
      return 4;
    };
    const ordered = [...logos].sort((a, b) => downloadOrder(a) - downloadOrder(b));
    report.logos = ordered.map(({ svg, ...rest }) => ({
      ...rest,
      hasInlineSvg: Boolean(svg),
      svgChars: svg ? svg.length : 0,
    }));
    say(`Collected ${logos.length} unique media candidate${logos.length === 1 ? '' : 's'} · saving up to ${maxCandidates}`);

    const saved = [];
    for (let i = 0; i < ordered.length && saved.length < maxCandidates; i++) {
      const c = ordered[i];
      const safeKind = String(c.kind || 'asset').replace(/[^a-z0-9-]+/gi, '-');
      const file = await saveCandidate(page, c, join(candidatesDir, `${String(saved.length).padStart(2, '0')}-${safeKind}`));
      if (!file) continue;
      const entry = {
        index: saved.length,
        kind: c.kind,
        href: c.href,
        alt: c.alt || '',
        file: `candidates/${basename(file)}`,
        absFile: file,
        w: c.w || 0,
        h: c.h || 0,
      };
      saved.push(entry);
      say(`Saved ${entry.file} (${c.kind})`);
    }
    report.saved = saved.map(({ absFile, ...rest }) => rest);

    const stub = {
      name,
      platform: marketing.h1?.slice(0, 48) || name,
      font: { family: '', css: '' },
      colors: {},
      logo: 'logo.html',
      motionBrief: 'motion-brief.md',
      placeholder: true,
      discovery: {
        status: 'harvested',
        harvestedAt: report.harvestedAt,
        logoSource: null,
        paletteSource: url,
        fontSource: null,
        candidateCount: saved.length,
      },
      sources: { marketing: url, app: appUrl || null },
      audio: DEFAULT_BRAND_AUDIO,
    };
    writeFileSync(join(dir, 'brand.json'), JSON.stringify(stub, null, 2) + '\n');
    writeFileSync(join(dir, 'discover-report.json'), JSON.stringify(report, null, 2) + '\n');
    say(`Wrote harvest stub · ${saved.length} candidate file${saved.length === 1 ? '' : 's'} in candidates/`);
    say('Waiting for agent to author logo.html, brand.json and motion-brief.md');

    return { dir, slug, brand: stub, report, saved };
  } finally {
    await browser.close();
  }
}

/** @deprecated use harvestBrandFromUrls — kept for callers that still import the old name */
export async function discoverBrandFromUrls(opts) {
  return harvestBrandFromUrls(opts);
}

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDirection } from './direction.mjs';
import { loadDotEnv, refreshDotEnv } from './dotenv.mjs';
import { DELIVERY } from './format.mjs';
import { resolveVideoLanguage } from './languages.mjs';

export { loadDotEnv, refreshDotEnv };

export const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SKILL = resolve(KIT, '..');
export const TEMPLATES = join(KIT, 'templates');
export const BRANDS = process.env.WALKTHROUGH_BRANDS || join(KIT, 'brands');
export const VIDEOS = process.env.WALKTHROUGH_VIDEOS || join(SKILL, 'videos');
export { DELIVERY };

function repoRootOf(from) {
  let dir = from;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

/**
 * Host product repo (where videos are filmed). `WALKTHROUGH_HOST` wins — required when the skill is
 * installed from a marketplace outside the product checkout; otherwise the repo that contains the
 * skill, then the repo around the current directory, then the current directory itself.
 */
export function hostRoot() {
  if (process.env.WALKTHROUGH_HOST) return resolve(process.env.WALKTHROUGH_HOST);
  return repoRootOf(SKILL) || repoRootOf(process.cwd()) || process.cwd();
}

export const OUT_ROOT = process.env.WALKTHROUGH_OUT || join(hostRoot(), 'tmp', 'videos');

loadDotEnv();

/**
 * Upsert KEY=VALUE pairs into kit/.env (gitignored) and the running process. Used for demo-account
 * credentials so video.config.json only ever holds "$KEY" references.
 */
export function upsertDotEnv(pairs, file = join(KIT, '.env')) {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  for (const [key, value] of Object.entries(pairs)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`Bad env var name: ${key}`);
    const v = String(value ?? '');
    const line = `${key}=${/[\s#"']/.test(v) ? JSON.stringify(v) : v}`;
    const i = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
    if (i >= 0) lines[i] = line;
    else lines.push(line);
    process.env[key] = v;
  }
  writeFileSync(file, lines.join('\n').replace(/\n*$/, '\n'));
}

export function slugify(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

/** A brand may exist on disk while discovery is still running. Never render that placeholder. */
export function brandReadiness(name) {
  const dir = existsSync(name) ? resolve(name) : join(BRANDS, name);
  const path = join(dir, 'brand.json');
  const issues = [];
  if (!existsSync(path)) return { ready: false, placeholder: true, issues: ['brand.json is missing'], dir };
  let brand;
  try {
    brand = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { ready: false, placeholder: true, issues: ['brand.json is invalid'], dir };
  }
  const placeholder = brand.placeholder === true;
  if (placeholder) issues.push('brand discovery has not produced a verified logo and palette');
  const logo = brand.logo || 'logo.html';
  if (!existsSync(join(dir, logo))) issues.push(`${logo} is missing`);
  for (const role of ['ink', 'surface', 'gold', 'amber', 'teal']) {
    if (!/^#[0-9a-f]{6}$/i.test(brand.colors?.[role] || '')) issues.push(`brand color ${role} is missing`);
  }
  if (!brand.font?.family || !brand.font?.css) issues.push('brand font is incomplete');
  return {
    ready: !issues.length,
    placeholder,
    issues,
    dir,
    name: brand.name || name,
    accent: brand.colors?.gold || null,
    logo,
    discovery: brand.discovery || null,
  };
}

export function listBrands() {
  if (!existsSync(BRANDS)) return [];
  return readdirSync(BRANDS)
    .filter((d) => existsSync(join(BRANDS, d, 'brand.json')))
    .map((id) => {
      try {
        const b = JSON.parse(readFileSync(join(BRANDS, id, 'brand.json'), 'utf8'));
        const readiness = brandReadiness(id);
        return {
          id,
          name: b.name || id,
          accent: b.colors?.gold || null,
          url: b.sources?.marketing || null,
          placeholder: readiness.placeholder,
          ready: readiness.ready,
          issues: readiness.issues,
        };
      } catch {
        return { id, name: id, accent: null, url: null };
      }
    });
}

/** Copy templates/new-video into videos/<slug>/ and fill the title placeholder. */
export function scaffoldVideo(slug, { title } = {}) {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error('Slug must be kebab-case (a-z, 0-9, -)');
  const dir = join(VIDEOS, slug);
  if (existsSync(dir)) throw new Error(`Video "${slug}" already exists`);
  cpSync(join(TEMPLATES, 'new-video'), dir, { recursive: true });
  const t = title || slug.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  for (const f of ['video.config.json', 'flow.mjs']) {
    const p = join(dir, f);
    writeFileSync(p, readFileSync(p, 'utf8').replaceAll('__TITLE__', t));
  }
  return dir;
}

/** Deep-merge plain objects (arrays and scalars replace). */
export function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base?.[k], v) : v;
  }
  return out;
}

export function listVideos() {
  if (!existsSync(VIDEOS)) return [];
  return readdirSync(VIDEOS).filter((d) => existsSync(join(VIDEOS, d, 'video.config.json')));
}

const DEFAULTS = {
  brand: 'admiral',
  record: { viewport: { width: DELIVERY.width, height: DELIVERY.height }, slowMo: 35, timeoutMs: 600000 },
  env: {},
};

function readBriefLanguage(dir) {
  const path = join(dir, 'brief.json');
  if (!existsSync(path)) return '';
  try {
    return JSON.parse(readFileSync(path, 'utf8')).language || '';
  } catch {
    return '';
  }
}

export function loadVideo(slug) {
  if (!slug) throw new Error('Missing <slug>. Known videos: ' + (listVideos().join(', ') || 'none'));
  const dir = join(VIDEOS, slug);
  const configPath = join(dir, 'video.config.json');
  if (!existsSync(configPath)) {
    throw new Error(`No video "${slug}" (${configPath}). Run: node cli.mjs new ${slug}`);
  }
  const raw = JSON.parse(readFileSync(configPath, 'utf8'));
  const config = {
    ...DEFAULTS,
    ...raw,
    record: { ...DEFAULTS.record, ...raw.record },
    env: { ...DEFAULTS.env, ...raw.env },
    slug,
    // Brief is the project setting. The config copy is a fallback when no brief exists yet.
    language: resolveVideoLanguage(readBriefLanguage(dir) || raw.language).code,
  };
  for (const [key, value] of Object.entries(config.env)) {
    if (typeof value === 'string' && value.startsWith('$')) {
      config.env[key] = process.env[value.slice(1)] ?? '';
    }
  }
  const out = join(OUT_ROOT, slug);
  mkdirSync(out, { recursive: true });
  // Direction is local to this video. The shared brand pack remains the source of truth, while
  // authored surfaces can use a derived palette selected during pre-production.
  const brand = applyDirection(loadBrand(config.brand), config);
  // Audio (narrator voice, music bed, mix levels): brand defaults, overridable per video under `audio`.
  const audio = deepMerge(brand.audio || {}, raw.audio || {});
  return { slug, dir, configPath, config, out, brand, audio };
}

export function loadBrand(name) {
  const dir = existsSync(name) ? resolve(name) : join(BRANDS, name);
  const brandPath = join(dir, 'brand.json');
  if (!existsSync(brandPath)) throw new Error(`No brand pack at ${dir}`);
  const brand = JSON.parse(readFileSync(brandPath, 'utf8'));
  const logoPath = join(dir, brand.logo || 'logo.html');
  const briefPath = join(dir, brand.motionBrief || 'motion-brief.md');
  return {
    ...brand,
    dir,
    files: [brandPath, logoPath, briefPath].filter((p) => existsSync(p)),
    logoHtml: existsSync(logoPath) ? readFileSync(logoPath, 'utf8') : `<div class="wordmark">${brand.name}</div>`,
    motionBriefPath: existsSync(briefPath) ? briefPath : null,
  };
}

export function newestMtime(paths) {
  return Math.max(...paths.filter(existsSync).map((p) => statSync(p).mtimeMs));
}

export function isStale(target, sources) {
  if (!existsSync(target)) return true;
  return newestMtime(sources) > statSync(target).mtimeMs;
}

/**
 * The brand pack while discovery is still writing it: what the harvest found, what the agent
 * has authored so far, and the reviewer's own picks (logo candidate, palette tweaks). Picks live
 * in studio-choices.json until the agent has finished, so its final brand.json cannot overwrite
 * them; `applyBrandChoices` folds them in once the pack is no longer a placeholder.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { brandReadiness } from './project.mjs';

export const BRAND_ROLES = ['ink', 'surface', 'gold', 'amber', 'teal'];
const CHOICES = 'studio-choices.json';
const CANDIDATE_EXT = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.gif']);
const PLACEHOLDER_LOGO = /Preparing brand…/;
const STUDIO_PICK = /^<!-- Picked in Studio: /;
const AGENT_LOCKUP = 'agent-lockup.html';
const HEX = /^#[0-9a-f]{6}$/i;

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

/** A candidate file name inside candidates/, or null when it is not one. */
export function candidateName(name) {
  const file = basename(String(name || '').replace(/^candidates\//, ''));
  if (!file || file !== String(name || '').replace(/^candidates\//, '')) return null;
  return CANDIDATE_EXT.has(extname(file).toLowerCase()) ? file : null;
}

export function readBrandChoices(dir) {
  const raw = readJson(join(dir, CHOICES)) || {};
  const colors = {};
  for (const role of BRAND_ROLES) if (HEX.test(raw.colors?.[role] || '')) colors[role] = raw.colors[role].toLowerCase();
  const logo = raw.logo === 'logo.html' ? 'logo.html' : candidateName(raw.logo) ? `candidates/${candidateName(raw.logo)}` : null;
  return { colors, logo };
}

/** The authored logo.html, unless it is the "Preparing brand…" stub newProject writes. */
function authoredLogo(dir, brand) {
  const file = join(dir, brand?.logo || 'logo.html');
  if (!existsSync(file) || brand?.discovery?.status === 'pending') return null;
  const html = readFileSync(file, 'utf8');
  if (PLACEHOLDER_LOGO.test(html)) return null;
  return { html, rev: Math.round(statSync(file).mtimeMs) };
}

function motionExcerpt(dir, brand) {
  const file = join(dir, brand?.motionBrief || 'motion-brief.md');
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.replace(/^#+\s*|^[-*>]\s*|\*\*/g, '').trim())
    .filter((l) => l && !/^\|/.test(l));
  return { title: lines[0] || 'Motion brief', excerpt: lines.slice(1, 3).join(' ').slice(0, 220) };
}

export function brandDraftState(brandId) {
  const readiness = brandReadiness(brandId);
  const dir = readiness.dir;
  const brand = readJson(join(dir, 'brand.json')) || {};
  const report = readJson(join(dir, 'discover-report.json'));
  const pending = !brand.discovery || brand.discovery.status === 'pending';
  const colors = {};
  if (!pending) for (const role of BRAND_ROLES) if (HEX.test(brand.colors?.[role] || '')) colors[role] = brand.colors[role].toLowerCase();
  const site = report?.pages?.[0] || null;
  const hints = [];
  for (const page of report?.pages || []) {
    for (const hex of [page.colors?.theme, ...(page.colors?.accentSamples || []).map((s) => s.hex)]) {
      const h = String(hex || '').toLowerCase();
      if (HEX.test(h) && !hints.includes(h)) hints.push(h);
    }
  }
  const logo = authoredLogo(dir, brand);
  return {
    brand: basename(dir),
    name: brand.name || basename(dir),
    platform: brand.platform || '',
    status: brand.discovery?.status || 'pending',
    placeholder: readiness.placeholder,
    ready: readiness.ready,
    issues: readiness.issues,
    harvested: Boolean(report),
    site: site ? { url: site.url || '', headline: site.h1 || '', sub: site.sub || '' } : null,
    candidates: (report?.saved || [])
      .filter((c) => candidateName(c.file) && existsSync(join(dir, c.file)))
      .map((c) => ({ file: candidateName(c.file), kind: c.kind || '', alt: c.alt || '', w: c.w || 0, h: c.h || 0, href: c.href || '' })),
    hints: hints.slice(0, 10),
    colors,
    font: !pending && brand.font?.family ? { family: brand.font.family, css: brand.font.css || '' } : null,
    lockup: logo ? { rev: logo.rev, svg: /<svg[\s>]/i.test(logo.html) } : null,
    logoSource: brand.discovery?.logoSource || null,
    motionBrief: pending ? null : motionExcerpt(dir, brand),
    choices: readBrandChoices(dir),
  };
}

/** The authored lockup as a standalone image — inline SVG or a data-URI img inside logo.html. */
export function lockupImage(brandId) {
  const dir = brandReadiness(brandId).dir;
  const brand = readJson(join(dir, 'brand.json')) || {};
  const logo = authoredLogo(dir, brand);
  if (!logo) return null;
  const svg = logo.html.match(/<svg[\s\S]*<\/svg>/i)?.[0];
  if (svg) {
    const tagged = /<svg[^>]*\sxmlns=/i.test(svg) ? svg : svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    // Standalone, the plate's CSS variables (`color: var(--text)`) resolve to nothing; use the brand's own colors.
    const painted = tagged.replace(/var\(--([a-z][\w-]*)\)/gi, (m, key) => brand.colors?.[key] || m);
    return { mime: 'image/svg+xml', body: Buffer.from(painted) };
  }
  const data = logo.html.match(/src="data:(image\/[a-z+]+);base64,([^"]+)"/i);
  if (data) return { mime: data[1], body: Buffer.from(data[2], 'base64') };
  return null;
}

export function candidateFile(brandId, name) {
  const file = candidateName(name);
  if (!file) return null;
  const path = join(brandReadiness(brandId).dir, 'candidates', file);
  return existsSync(path) ? path : null;
}

function candidateLockupHtml(dir, file, name) {
  const path = join(dir, 'candidates', file);
  const ext = extname(file).toLowerCase();
  if (ext === '.svg') {
    const svg = readFileSync(path, 'utf8').match(/<svg[\s\S]*<\/svg>/i)?.[0];
    return svg ? `<!-- Picked in Studio: candidates/${file} -->\n${svg.replace(/<svg\b/i, '<svg class="logo-svg" role="img"')}\n` : null;
  }
  const mime = { '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon' }[ext] || 'image/jpeg';
  const bytes = readFileSync(path);
  if (bytes.length > 1_500_000) return null;
  return `<!-- Picked in Studio: candidates/${file} -->\n<img class="logo-img" alt="${String(name || '').replace(/"/g, '&quot;')}" src="data:${mime};base64,${bytes.toString('base64')}" />\n`;
}

/** Fold saved picks into brand.json / logo.html once the agent has authored the pack. */
export function applyBrandChoices(brandId) {
  const dir = brandReadiness(brandId).dir;
  const path = join(dir, 'brand.json');
  const brand = readJson(path);
  if (!brand || brand.placeholder === true) return false;
  const choices = readBrandChoices(dir);
  const recolor = Object.entries(choices.colors).filter(([role, hex]) => brand.colors?.[role]?.toLowerCase() !== hex);
  const logoPath = join(dir, brand.logo || 'logo.html');
  const backup = join(dir, AGENT_LOCKUP);
  const current = existsSync(logoPath) ? readFileSync(logoPath, 'utf8') : '';
  const pick = choices.logo?.startsWith('candidates/') ? choices.logo.slice('candidates/'.length) : null;
  const html = pick && existsSync(join(dir, 'candidates', pick)) ? candidateLockupHtml(dir, pick, brand.name) : null;
  const restore = choices.logo === 'logo.html' && STUDIO_PICK.test(current) && existsSync(backup);
  const relogo = Boolean(html && html !== current) || restore;
  if (!recolor.length && !relogo) return false;
  if (recolor.length) brand.colors = { ...brand.colors, ...Object.fromEntries(recolor) };
  if (html && html !== current) {
    if (current && !STUDIO_PICK.test(current)) writeFileSync(backup, current);
    writeFileSync(logoPath, html);
    brand.discovery = { ...brand.discovery, logoPick: `candidates/${pick}` };
  } else if (restore) {
    writeFileSync(logoPath, readFileSync(backup, 'utf8'));
    brand.discovery = { ...brand.discovery };
    delete brand.discovery.logoPick;
  }
  brand.discovery = { ...brand.discovery, editedInStudio: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(brand, null, 2) + '\n');
  return true;
}

/** Merge a pick into studio-choices.json, then apply it straight away if the pack is authored. */
export function saveBrandChoices(brandId, input = {}) {
  const dir = brandReadiness(brandId).dir;
  const prev = readBrandChoices(dir);
  const colors = { ...prev.colors };
  for (const [role, hex] of Object.entries(input.colors || {})) {
    if (!BRAND_ROLES.includes(role)) throw new Error(`Unknown brand colour role "${role}"`);
    if (hex === null) delete colors[role];
    else if (HEX.test(String(hex))) colors[role] = String(hex).toLowerCase();
    else throw new Error(`Colour ${role} must be #RRGGBB`);
  }
  let logo = prev.logo;
  if (input.logo !== undefined) {
    if (input.logo === null || input.logo === 'logo.html') logo = input.logo;
    else {
      const file = candidateName(input.logo);
      if (!file || !existsSync(join(dir, 'candidates', file))) throw new Error('Logo candidate not found');
      logo = `candidates/${file}`;
    }
  }
  writeFileSync(join(dir, CHOICES), JSON.stringify({ colors, logo, savedAt: new Date().toISOString() }, null, 2) + '\n');
  const applied = applyBrandChoices(brandId);
  return { applied, state: brandDraftState(brandId) };
}

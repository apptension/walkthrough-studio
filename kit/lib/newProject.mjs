/**
 * New project from a Studio brief: scaffold videos/<slug>/, pin the brief (brief.json — never
 * credential values), wire config basics, and hand the rest to the draft agent.
 *
 * Credentials typed into the wizard go to kit/.env (gitignored) under <SLUG>_EMAIL / _PASSWORD;
 * video.config.json only references them as "$VAR".
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promptLanguageLine, requireVideoLanguage } from './languages.mjs';
import { PURPOSES, PURPOSE_IDS, resolvePurpose } from './narrative.mjs';
import { BRANDS, VIDEOS, brandReadiness, scaffoldVideo, slugify, upsertDotEnv } from './project.mjs';

import { PLATE_TYPE_IDS as PLATE_TYPES } from './plateTypes.mjs';
import { applyCaptureSettings } from './captureSettings.mjs';
import { clampLengthSec } from './length.mjs';

const lines = (v) =>
  (Array.isArray(v) ? v : String(v || '').split('\n'))
    .map((s) => String(s).trim())
    .filter(Boolean);

function httpUrl(v, label, { required = false } = {}) {
  const s = String(v || '').trim();
  if (!s) {
    if (required) throw new Error(`${label} is required`);
    return '';
  }
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error(`${label} must be a full URL (https://…)`);
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`${label} must be http(s)`);
  return u.href.replace(/\/$/, '');
}

/** Neutral loading pack. It is deliberately unrenderable and never borrows another brand. */
function placeholderBrand(id, { name, url, appUrl }) {
  const dir = join(BRANDS, id);
  mkdirSync(dir, { recursive: true });
  const brand = {
    name,
    platform: name,
    placeholder: true,
    discovery: { status: 'pending', requestedAt: new Date().toISOString() },
    sources: { marketing: url || null, app: appUrl || null },
    font: {
      family: 'system-ui',
      css: 'data:text/css,',
    },
    colors: {
      ink: '#111827',
      surface: '#1f2937',
      gold: '#94a3b8',
      amber: '#cbd5e1',
      teal: '#64748b',
      text: '#f8fafc',
      muted: '#94a3b8',
      onAccent: '#111827',
    },
    logo: 'logo.html',
    motionBrief: 'motion-brief.md',
  };
  writeFileSync(join(dir, 'brand.json'), JSON.stringify(brand, null, 2) + '\n');
  writeFileSync(join(dir, 'logo.html'), '<div class="wordmark">Preparing brand…</div>\n');
  return dir;
}

/**
 * @param {object} input wizard payload
 * @returns {{ slug: string, brand: string, needsDiscovery: boolean, envVars: string[] }}
 */
export function createProject(input = {}) {
  const title = String(input.title || '').trim();
  if (!title) throw new Error('Give the video a title');
  const language = requireVideoLanguage(input.language).code;
  const slug = slugify(input.slug || title);
  if (!slug) throw new Error('Could not derive a slug from the title');
  if (existsSync(join(VIDEOS, slug))) throw new Error(`A video called "${slug}" already exists`);

  const sizing = {
    ...(input.capture?.size?.preset ? input.capture.size : {}),
    ...(input.output?.format ? { output: input.output.format } : {}),
  };
  applyCaptureSettings({}, sizing);

  const app = input.app || {};
  const startUrl = httpUrl(app.startUrl, 'Start URL', { required: true });
  const appUrl = httpUrl(app.appUrl, 'App URL');
  const marketingUrl = httpUrl(app.marketingUrl, 'Marketing site URL');

  const b = input.brand || {};
  let brandId;
  let needsDiscovery = false;
  if (b.mode === 'new') {
    const name = String(b.name || '').trim();
    if (!name) throw new Error('Name the new brand');
    brandId = slugify(name);
    // Discovery reads the marketing site when there is one, otherwise the live app itself.
    const site = httpUrl(b.url || marketingUrl || appUrl || startUrl, 'Brand website', { required: true });
    if (!existsSync(join(BRANDS, brandId, 'brand.json'))) placeholderBrand(brandId, { name, url: site, appUrl: appUrl || startUrl });
    needsDiscovery = true;
    b.url = site;
  } else {
    brandId = b.id;
    if (!brandId || !existsSync(join(BRANDS, brandId, 'brand.json'))) throw new Error('Pick a brand pack');
    const readiness = brandReadiness(brandId);
    if (!readiness.ready) {
      throw new Error(`Brand pack "${brandId}" is not ready: ${readiness.issues.join('; ')}`);
    }
  }

  const envVars = [];
  const env = {};
  if (appUrl) env.appUrl = appUrl;
  if (marketingUrl) env.marketingUrl = marketingUrl;
  if (app.loginRequired) {
    const prefix = slug.replace(/-/g, '_').toUpperCase().replace(/^(\d)/, 'V_$1');
    const emailVar = `${prefix}_EMAIL`;
    const passVar = `${prefix}_PASSWORD`;
    env.email = `$${emailVar}`;
    env.password = `$${passVar}`;
    envVars.push(emailVar, passVar);
    const creds = {};
    if (app.email) creds[emailVar] = app.email;
    if (app.password) creds[passVar] = app.password;
    if (Object.keys(creds).length) upsertDotEnv(creds);
  }

  const story = input.story || {};
  const proof = input.proof || {};
  const brief = {
    version: 1,
    createdAt: new Date().toISOString(),
    title,
    language,
    product: String(input.product || '').trim(),
    audience: String(input.audience || '').trim(),
    outcome: String(input.outcome || '').trim(),
    purpose: PURPOSE_IDS.includes(input.purpose) ? input.purpose : resolvePurpose({ audience: input.audience }),
    lengthSec: clampLengthSec(story.lengthSec),
    tone: String(story.tone || 'confident, warm, plain-spoken').trim(),
    brand: { id: brandId, mode: b.mode === 'new' ? 'new' : 'existing', name: b.name || null, url: b.url || null, appUrl: appUrl || startUrl || null },
    app: {
      startUrl,
      appUrl: appUrl || null,
      marketingUrl: marketingUrl || null,
      loginRequired: Boolean(app.loginRequired),
      envVars,
      sourcePath: String(app.sourcePath || '').trim() || null,
      notes: String(app.notes || '').trim(),
    },
    capture: {
      mode: input.capture?.mode === 'guided' ? 'guided' : 'agent',
      ...(input.capture?.size?.preset ? { size: input.capture.size.preset } : {}),
      ...(input.output?.format === 'portrait' ? { output: 'portrait' } : {}),
    },
    story: {
      mustShow: lines(story.mustShow),
      keyMessages: lines(story.keyMessages),
      mustSay: lines(story.mustSay),
      avoid: lines(story.avoid),
    },
    proof: {
      plates: (proof.plates || []).filter((p) => PLATE_TYPES.includes(p)),
      stats: lines(proof.stats),
      quotes: lines(proof.quotes),
      logos: lines(proof.logos),
    },
  };

  const dir = scaffoldVideo(slug, { title });
  const cfgPath = join(dir, 'video.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.audience = brief.audience || cfg.audience;
  cfg.purpose = brief.purpose;
  cfg.language = language;
  cfg.brand = brandId;
  cfg.record = { ...cfg.record, startUrl };
  cfg.env = env;
  const sized = applyCaptureSettings(cfg, sizing);
  cfg.record = sized.record;
  if (sized.output) cfg.output = sized.output;
  else delete cfg.output;
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  writeFileSync(join(dir, 'brief.json'), JSON.stringify(brief, null, 2) + '\n');
  return { slug, brand: brandId, needsDiscovery, envVars };
}

/** Director note for the draft agent: the brief, flattened into what matters for the script. */
export function draftNote(brief) {
  if (!brief) return 'No brief.json found — draft from video.config.json and the brand pack.';
  const list = (title, arr) => (arr?.length ? `\n${title}:\n${arr.map((s) => `- ${s}`).join('\n')}` : '');
  return [
    `## Brief`,
    `Product: ${brief.product || brief.title}`,
    promptLanguageLine(brief.language),
    `Audience: ${brief.audience || '—'}`,
    `After watching, the viewer can: ${brief.outcome || '—'}`,
    `Purpose: ${PURPOSES[brief.purpose]?.label || PURPOSES.overview.label} — follow its story spine`,
    `Target length: ~${brief.lengthSec}s · tone: ${brief.tone}`,
    `Start URL: ${brief.app.startUrl}${brief.app.appUrl ? ` · app: ${brief.app.appUrl}` : ''}`,
    brief.app.loginRequired
      ? `Login required — use env.email / env.password (resolved from ${brief.app.envVars.join(', ')}).`
      : 'No login.',
    brief.app.sourcePath ? `App source in workspace: ${brief.app.sourcePath} — read routes/labels from it.` : '',
    brief.app.notes ? `Access notes: ${brief.app.notes}` : '',
    brief.capture?.mode === 'guided'
      ? "Journey: the reviewer showed it in a real browser (guided-tour.md / guided-flow.mjs) — script that walk, optimised; don't invent screens."
      : '',
    list(
      brief.capture?.mode === 'guided'
        ? "What to show, in order (the reviewer's notes — their shown tour is the authority)"
        : "What to show, in order (the reviewer's intent — the explorer's journey once it has walked the product)",
      brief.story?.mustShow
    ),
    list('Key messages', brief.story.keyMessages),
    list('Must say', brief.story.mustSay),
    list('Avoid', brief.story.avoid),
    brief.proof.plates.length ? `\nPlates wanted: ${brief.proof.plates.join(', ')}` : '',
    list('Stats (use verbatim)', brief.proof.stats),
    list('Quotes (use verbatim, keep attribution)', brief.proof.quotes),
    list('Logos / integrations', brief.proof.logos),
  ]
    .filter(Boolean)
    .join('\n');
}

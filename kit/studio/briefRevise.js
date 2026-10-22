/** Compare two briefs and name the preparation that has to run again. Passwords are never part of the diff. */
import { requireVideoLanguage } from './languages.js';

const STORY = new Set([
  'title',
  'language',
  'product',
  'audience',
  'outcome',
  'purpose',
  'lengthSec',
  'tone',
  'mustShow',
  'keyMessages',
  'mustSay',
  'avoid',
  'plates',
  'stats',
  'quotes',
  'logos',
]);
const ACCESS = new Set(['startUrl', 'appUrl', 'marketingUrl', 'loginRequired', 'sourcePath', 'notes', 'email', 'password']);
const BRAND = new Set(['brand']);

const LABEL = {
  title: 'Title',
  language: 'Language',
  product: 'Product',
  audience: 'Audience',
  outcome: 'Outcome',
  purpose: 'Purpose',
  lengthSec: 'Length',
  tone: 'Tone',
  mustShow: 'Chapters',
  keyMessages: 'Key messages',
  mustSay: 'Must say',
  avoid: 'Avoid',
  plates: 'Proof plates',
  stats: 'Stats',
  quotes: 'Quotes',
  logos: 'Logos',
  startUrl: 'Start URL',
  appUrl: 'App URL',
  marketingUrl: 'Marketing site',
  loginRequired: 'Sign-in',
  sourcePath: 'App source',
  notes: 'Access notes',
  email: 'Demo email',
  password: 'Password',
  brand: 'Brand',
};

function lines(value) {
  return (Array.isArray(value) ? value : String(value || '').split('\n')).map((s) => String(s).trim()).filter(Boolean);
}

export function comparable(input = {}) {
  const app = input.app || {};
  const story = input.story || {};
  const proof = input.proof || {};
  const brand = input.brand || {};
  return {
    title: String(input.title || '').trim(),
    // Missing stays English. An unknown code stays unknown so the save can reject it.
    language: String(input.language || '').trim().toLowerCase() || 'en',
    product: String(input.product || '').trim(),
    audience: String(input.audience || '').trim(),
    outcome: String(input.outcome || '').trim(),
    purpose: String(input.purpose || '').trim(),
    lengthSec: Number(story.lengthSec || input.lengthSec || 0),
    tone: String(story.tone || input.tone || '').trim(),
    mustShow: lines(story.mustShow ?? input.mustShow),
    keyMessages: lines(story.keyMessages),
    mustSay: lines(story.mustSay),
    avoid: lines(story.avoid),
    plates: [...(proof.plates || [])],
    stats: lines(proof.stats),
    quotes: lines(proof.quotes),
    logos: lines(proof.logos),
    startUrl: String(app.startUrl || '').trim(),
    appUrl: String(app.appUrl || '').trim(),
    marketingUrl: String(app.marketingUrl || '').trim(),
    loginRequired: Boolean(app.loginRequired),
    sourcePath: String(app.sourcePath || '').trim(),
    notes: String(app.notes || '').trim(),
    email: String(app.email || '').trim(),
    brand: String(brand.id || brand.name || '').trim(),
  };
}

/** True when the brief (or freshness) says this tour signs in with env-backed credentials. */
export function hasStoredCredentials(brief, freshness = null) {
  const app = brief?.app || {};
  if (app.loginRequired) return true;
  if (Array.isArray(app.envVars) && app.envVars.some((v) => /_(EMAIL|PASSWORD)$/i.test(String(v || '')))) return true;
  if (freshness?.loginRequired) return true;
  return false;
}

/**
 * Credential values are blank in the form. The saved password stays in kit/.env.
 * Email is cleared for display too — settings shows “on file”, not the address.
 */
export function maskCredentials(brief, freshness = null) {
  if (!brief) return brief;
  const app = { ...(brief.app || {}) };
  const onFile = hasStoredCredentials(brief, freshness) || Boolean(String(app.email || '').trim());
  if (app.password) app.password = '';
  if (onFile) {
    app.credentialsOnFile = true;
    app.loginRequired = true;
    app.email = '';
  }
  return { ...brief, app };
}

export function revisePlan(before, after) {
  const left = comparable(before);
  const right = comparable(after);
  // Empty credential fields in the form mean “keep what is saved”, not “clear them”.
  if (!String(after?.app?.email || '').trim()) right.email = left.email;
  const changed = [];
  for (const key of Object.keys(LABEL)) {
    if (key === 'password') continue;
    if (JSON.stringify(left[key] ?? '') !== JSON.stringify(right[key] ?? '')) changed.push(key);
  }
  if (String(after?.app?.password || '').trim()) changed.push('password');
  const stages = [];
  if (changed.some((key) => BRAND.has(key))) stages.push('discover');
  // Chapters (mustShow) re-run explore so unreachable beats can be recrafted before the planner.
  if (changed.some((key) => ACCESS.has(key)) || changed.includes('mustShow')) stages.push('analyze');
  if (changed.some((key) => STORY.has(key))) stages.push('planner');
  return {
    changed: changed.map((field) => ({ field, label: LABEL[field] || field })),
    stages,
    needsRecord: changed.some((key) => ACCESS.has(key)),
  };
}

export function scrubSecrets(text, secrets = []) {
  let out = String(text || '');
  for (const secret of secrets) {
    const value = String(secret || '');
    if (value.length < 4) continue;
    out = out.split(value).join('[redacted]');
  }
  return out;
}

/** Wizard payload → brief.json shape. The password is omitted. Blank email/password keep the saved values. */
export function nextBrief(current = {}, payload = {}) {
  const story = payload.story || {};
  const incoming = { ...(payload.app || {}) };
  delete incoming.password;
  // Empty strings mean “leave as-is” so settings can offer replace-only fields.
  if (!String(incoming.email || '').trim()) delete incoming.email;
  const app = { ...(current.app || {}), ...incoming };
  delete app.password;
  delete app.credentialsOnFile;
  if ('loginRequired' in (payload.app || {})) {
    app.loginRequired = Boolean(payload.app.loginRequired);
    if (!app.loginRequired) {
      app.envVars = [];
      delete app.email;
    } else if (!Array.isArray(app.envVars) || !app.envVars.length) {
      // Env var names are minted at project create; keep any existing list when turning sign-in back on.
      app.envVars = current.app?.envVars || app.envVars || [];
    }
  }
  const brand = payload.brand || {};
  return {
    ...current,
    revisedAt: new Date().toISOString(),
    title: payload.title ?? current.title,
    language: requireVideoLanguage(payload.language ?? current.language).code,
    product: payload.product ?? current.product,
    audience: payload.audience ?? current.audience,
    outcome: payload.outcome ?? current.outcome,
    purpose: payload.purpose ?? current.purpose,
    lengthSec: Number(story.lengthSec || current.lengthSec || 120),
    tone: story.tone ?? current.tone,
    brand: brand.id
      ? { ...(current.brand || {}), id: brand.id, mode: brand.mode || 'existing', name: brand.name || current.brand?.name || null, url: brand.url || current.brand?.url || null }
      : current.brand,
    app,
    story: {
      mustShow: lines(story.mustShow ?? current.story?.mustShow),
      keyMessages: lines(story.keyMessages ?? current.story?.keyMessages),
      mustSay: lines(story.mustSay ?? current.story?.mustSay),
      avoid: lines(story.avoid ?? current.story?.avoid),
    },
    proof: payload.proof || current.proof,
  };
}

/** Compare two briefs and name the preparation that has to run again. Passwords are never part of the diff. */
import { requireVideoLanguage } from './languages';
import { asText } from './text';

/** Text lists arrive as arrays from brief.json and as newline-separated text from the form. */
export type BriefLines = string[] | string | null | undefined;

export interface BriefApp {
  startUrl?: string;
  appUrl?: string;
  marketingUrl?: string;
  loginRequired?: boolean;
  sourcePath?: string;
  notes?: string;
  email?: string;
  password?: string;
  envVars?: string[];
  credentialsOnFile?: boolean;
  [key: string]: unknown;
}

export interface BriefStory {
  lengthSec?: number;
  tone?: string;
  mustShow?: BriefLines;
  keyMessages?: BriefLines;
  mustSay?: BriefLines;
  avoid?: BriefLines;
}

export interface BriefProof {
  plates?: string[];
  stats?: BriefLines;
  quotes?: BriefLines;
  logos?: BriefLines;
  [key: string]: unknown;
}

export interface BriefBrand {
  id?: string;
  name?: string | null;
  mode?: string;
  url?: string | null;
  [key: string]: unknown;
}

export interface BriefCapture {
  mode?: string;
  [key: string]: unknown;
}

/** brief.json, or the wizard / settings payload that becomes one. */
export interface Brief {
  title?: string;
  language?: string;
  product?: string;
  audience?: string;
  outcome?: string;
  purpose?: string;
  lengthSec?: number;
  tone?: string;
  mustShow?: BriefLines;
  app?: BriefApp;
  story?: BriefStory;
  proof?: BriefProof;
  brand?: BriefBrand;
  capture?: BriefCapture;
  revisedAt?: string;
  [key: string]: unknown;
}

export interface ComparableBrief {
  title: string;
  language: string;
  product: string;
  audience: string;
  outcome: string;
  purpose: string;
  lengthSec: number;
  tone: string;
  mustShow: string[];
  keyMessages: string[];
  mustSay: string[];
  avoid: string[];
  plates: string[];
  stats: string[];
  quotes: string[];
  logos: string[];
  startUrl: string;
  appUrl: string;
  marketingUrl: string;
  loginRequired: boolean;
  sourcePath: string;
  notes: string;
  email: string;
  brand: string;
  captureMode: 'guided' | 'agent';
}

export type ReplanStage = 'discover' | 'analyze' | 'planner';

export interface RevisePlan {
  changed: { field: string; label: string }[];
  stages: ReplanStage[];
  needsRecord: boolean;
}

export interface Freshness {
  loginRequired?: boolean;
  [key: string]: unknown;
}

export interface NextBrief extends Brief {
  revisedAt: string;
  language: string;
  lengthSec: number;
  app: BriefApp;
  story: { mustShow: string[]; keyMessages: string[]; mustSay: string[]; avoid: string[] };
}

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
  'captureMode',
]);
const ACCESS = new Set(['startUrl', 'appUrl', 'marketingUrl', 'loginRequired', 'sourcePath', 'notes', 'email', 'password']);
const BRAND = new Set(['brand']);

const LABEL: Record<keyof ComparableBrief | 'password', string> = {
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
  captureMode: 'Who finds the journey',
};

function lines(value: unknown): string[] {
  return (Array.isArray(value) ? (value as unknown[]) : asText(value || '').split('\n')).map((s) => asText(s).trim()).filter(Boolean);
}

export function comparable(input: Brief = {}): ComparableBrief {
  const app: BriefApp = input.app || {};
  const story: BriefStory = input.story || {};
  const proof: BriefProof = input.proof || {};
  const brand: BriefBrand = input.brand || {};
  return {
    title: asText(input.title || '').trim(),
    // Missing stays English. An unknown code stays unknown so the save can reject it.
    language: asText(input.language || '').trim().toLowerCase() || 'en',
    product: asText(input.product || '').trim(),
    audience: asText(input.audience || '').trim(),
    outcome: asText(input.outcome || '').trim(),
    purpose: asText(input.purpose || '').trim(),
    lengthSec: Number(story.lengthSec || input.lengthSec || 0),
    tone: asText(story.tone || input.tone || '').trim(),
    mustShow: lines(story.mustShow ?? input.mustShow),
    keyMessages: lines(story.keyMessages),
    mustSay: lines(story.mustSay),
    avoid: lines(story.avoid),
    plates: [...(proof.plates || [])],
    stats: lines(proof.stats),
    quotes: lines(proof.quotes),
    logos: lines(proof.logos),
    startUrl: asText(app.startUrl || '').trim(),
    appUrl: asText(app.appUrl || '').trim(),
    marketingUrl: asText(app.marketingUrl || '').trim(),
    loginRequired: Boolean(app.loginRequired),
    sourcePath: asText(app.sourcePath || '').trim(),
    notes: asText(app.notes || '').trim(),
    email: asText(app.email || '').trim(),
    brand: asText(brand.id || brand.name || '').trim(),
    captureMode: input.capture?.mode === 'guided' ? 'guided' : 'agent',
  };
}

/** True when the brief (or freshness) says this tour signs in with env-backed credentials. */
export function hasStoredCredentials(brief: Brief | null | undefined, freshness: Freshness | null = null): boolean {
  const app: BriefApp = brief?.app || {};
  if (app.loginRequired) return true;
  if (Array.isArray(app.envVars) && app.envVars.some((v) => /_(EMAIL|PASSWORD)$/i.test(asText(v || '')))) return true;
  if (freshness?.loginRequired) return true;
  return false;
}

/**
 * Credential values are blank in the form. The saved password stays in kit/.env.
 * Email is cleared for display too — settings shows “on file”, not the address.
 */
export function maskCredentials<B extends Brief>(brief: B, freshness?: Freshness | null): B & { app: BriefApp };
export function maskCredentials<B extends Brief>(
  brief: B | null | undefined,
  freshness?: Freshness | null,
): (B & { app: BriefApp }) | null | undefined;
export function maskCredentials<B extends Brief>(
  brief: B | null | undefined,
  freshness: Freshness | null = null,
): (B & { app: BriefApp }) | null | undefined {
  if (!brief) return brief;
  const app: BriefApp = { ...(brief.app || {}) };
  const onFile = hasStoredCredentials(brief, freshness) || Boolean(asText(app.email || '').trim());
  if (app.password) app.password = '';
  if (onFile) {
    app.credentialsOnFile = true;
    app.loginRequired = true;
    app.email = '';
  }
  return { ...brief, app };
}

/** When the author clicks Save and replan with no edits, still re-explore + redraft. */
export const FORCE_REPLAN_STAGES: readonly ReplanStage[] = Object.freeze(['analyze', 'planner'] as const);

export function revisePlan(before: Brief | undefined, after: Brief | undefined): RevisePlan {
  const left = comparable(before);
  const right = comparable(after);
  // Empty credential fields in the form mean “keep what is saved”, not “clear them”.
  if (!asText(after?.app?.email || '').trim()) right.email = left.email;
  const changed: string[] = [];
  for (const key of Object.keys(LABEL) as (keyof typeof LABEL)[]) {
    if (key === 'password') continue;
    if (JSON.stringify(left[key] ?? '') !== JSON.stringify(right[key] ?? '')) changed.push(key);
  }
  if (asText(after?.app?.password || '').trim()) changed.push('password');
  const stages: ReplanStage[] = [];
  if (changed.some((key) => BRAND.has(key))) stages.push('discover');
  // Chapters (mustShow) re-run explore so unreachable beats can be recrafted before the planner.
  if (changed.some((key) => ACCESS.has(key)) || changed.includes('mustShow') || changed.includes('captureMode')) stages.push('analyze');
  if (changed.some((key) => STORY.has(key))) stages.push('planner');
  return {
    changed: changed.map((field) => ({ field, label: (LABEL as Partial<Record<string, string>>)[field] || field })),
    stages,
    needsRecord: changed.some((key) => ACCESS.has(key)),
  };
}

/**
 * Stages to run on Save and replan. Diff-driven when something changed; otherwise a forced
 * explore + planner pass so the author can re-check the product map and script recraft.
 */
export function stagesForReplan(
  plan: { stages?: ReplanStage[] | null } | null | undefined,
  { force = true }: { force?: boolean } = {},
): ReplanStage[] {
  const fromDiff = [...(plan?.stages || [])];
  if (fromDiff.length) return fromDiff;
  return force ? [...FORCE_REPLAN_STAGES] : [];
}

export function scrubSecrets(text: unknown, secrets: unknown[] = []): string {
  let out = asText(text || '');
  for (const secret of secrets) {
    const value = asText(secret || '');
    if (value.length < 4) continue;
    out = out.split(value).join('[redacted]');
  }
  return out;
}

/** Wizard payload → brief.json shape. The password is omitted. Blank email/password keep the saved values. */
export function nextBrief(current: Brief = {}, payload: Brief = {}): NextBrief {
  const story: BriefStory = payload.story || {};
  const incoming: BriefApp = { ...(payload.app || {}) };
  delete incoming.password;
  // Empty strings mean “leave as-is” so settings can offer replace-only fields.
  if (!asText(incoming.email || '').trim()) delete incoming.email;
  const app: BriefApp = { ...(current.app || {}), ...incoming };
  delete app.password;
  delete app.credentialsOnFile;
  if ('loginRequired' in (payload.app || {})) {
    app.loginRequired = Boolean(payload.app?.loginRequired);
    if (!app.loginRequired) {
      app.envVars = [];
      delete app.email;
    } else if (!Array.isArray(app.envVars) || !app.envVars.length) {
      // Env var names are minted at project create; keep any existing list when turning sign-in back on.
      app.envVars = current.app?.envVars || app.envVars || [];
    }
  }
  const brand: BriefBrand = payload.brand || {};
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
    capture: payload.capture?.mode ? { ...(current.capture || {}), mode: payload.capture.mode === 'guided' ? 'guided' : 'agent' } : current.capture,
    story: {
      mustShow: lines(story.mustShow ?? current.story?.mustShow),
      keyMessages: lines(story.keyMessages ?? current.story?.keyMessages),
      mustSay: lines(story.mustSay ?? current.story?.mustSay),
      avoid: lines(story.avoid ?? current.story?.avoid),
    },
    proof: payload.proof || current.proof,
  };
}

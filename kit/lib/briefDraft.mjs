/**
 * One description → a complete, editable brief. The agent reads the description, the start URL,
 * the workspace and the existing brand packs, and returns every wizard field as JSON. Nothing here
 * records, renders, or writes into videos/.
 */
import { PURPOSE_IDS, PURPOSES } from './narrative.mjs';
import { PLATE_TYPE_IDS, plateTypeGuide } from './plateTypes.mjs';
import { resolveVideoLanguage } from './languages.mjs';
import { BEAT_GUIDE } from './journeyBeats.mjs';

export const BRIEF_LENGTHS = [60, 90, 120, 180];

const str = (v, max = 400) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max));
const lines = (v, max = 12, chars = 240) =>
  (Array.isArray(v) ? v : String(v || '').split('\n'))
    .map((s) => str(s, chars))
    .filter(Boolean)
    .slice(0, max);

function httpUrl(v) {
  const s = str(v, 2000);
  if (!s) return '';
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) ? u.href.replace(/\/$/, '') : '';
  } catch {
    return '';
  }
}

/** `{ mode:'existing', id }` only when the pack is real and ready; otherwise `new` with name + site. */
function brandFrom(raw, brands, fallbackUrl) {
  const ready = (brands || []).filter((b) => b.ready && !b.placeholder);
  const byId = (id) => ready.find((b) => b.id === str(id, 80));
  const byName = (name) => ready.find((b) => b.name.toLowerCase() === str(name, 80).toLowerCase());
  const want = raw && typeof raw === 'object' ? raw : {};
  const hit = byId(want.id) || byName(want.name) || byId(want.name);
  if (want.mode !== 'new' && hit) return { mode: 'existing', id: hit.id };
  const url = httpUrl(want.url) || fallbackUrl || '';
  const name = str(want.name, 80) || (hit ? hit.name : '');
  if (hit && !url) return { mode: 'existing', id: hit.id };
  return { mode: 'new', name, url };
}

/**
 * Coerce whatever the agent returned into the wizard payload shape. Every field is optional on
 * input; the output always has every key so the form can be filled in one pass.
 */
export function normalizeBriefDraft(raw, { brands = [], startUrl = '', language = 'en' } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const app = r.app && typeof r.app === 'object' ? r.app : {};
  const story = r.story && typeof r.story === 'object' ? r.story : {};
  const proof = r.proof && typeof r.proof === 'object' ? r.proof : {};
  const marketingUrl = httpUrl(app.marketingUrl);
  const resolvedStart = httpUrl(app.startUrl) || httpUrl(startUrl);
  const lengthSec = Number(story.lengthSec ?? r.lengthSec);
  const purpose = PURPOSE_IDS.includes(r.purpose) ? r.purpose : 'overview';
  const plates = (Array.isArray(proof.plates) ? proof.plates : lines(proof.plates))
    .map((p) => str(p, 40).toLowerCase())
    .filter((p, i, a) => PLATE_TYPE_IDS.includes(p) && a.indexOf(p) === i)
    .slice(0, 5);
  const slug = str(r.slug, 48)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '');
  return {
    title: str(r.title, 80),
    slug,
    language: resolveVideoLanguage(language).code,
    product: str(r.product, 80),
    audience: str(r.audience, 160),
    outcome: str(r.outcome, 200),
    purpose,
    brand: brandFrom(r.brand, brands, marketingUrl),
    app: {
      startUrl: resolvedStart,
      appUrl: httpUrl(app.appUrl),
      marketingUrl,
      loginRequired: Boolean(app.loginRequired),
      email: app.loginRequired ? str(app.email, 160) : '',
      sourcePath: str(app.sourcePath, 200).replace(/^\.?\//, '').replace(/\/$/, ''),
      notes: str(app.notes, 600),
    },
    story: {
      lengthSec: BRIEF_LENGTHS.includes(lengthSec) ? lengthSec : 120,
      tone: str(story.tone, 120),
      mustShow: lines(story.mustShow, 8, 400),
      keyMessages: lines(story.keyMessages, 6),
      mustSay: lines(story.mustSay, 8),
      avoid: lines(story.avoid, 8),
    },
    proof: {
      plates,
      stats: lines(proof.stats, 6),
      quotes: lines(proof.quotes, 6),
      logos: lines(proof.logos, 12),
    },
    confidence: str(r.confidence, 40).toLowerCase() || 'medium',
    assumptions: lines(r.assumptions, 8),
    questions: lines(r.questions, 5),
  };
}

/** Pull the first JSON object out of an agent's final message (fenced, prefixed with prose, or bare). */
export function parseBriefDraft(text) {
  const s = String(text || '');
  if (!s.trim()) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(s.slice(first, last + 1));
  candidates.push(s);
  for (const c of candidates) {
    try {
      const o = JSON.parse(c.trim());
      if (o && typeof o === 'object' && !Array.isArray(o)) return o;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

const brandLine = (b) =>
  `- id "${b.id}" · ${b.name}${b.url ? ` · ${b.url}` : ''}${b.ready && !b.placeholder ? '' : ' · (not ready — do not pick)'}`;

/**
 * The agent's instructions. It may read the workspace and fetch the start URL, but it writes one
 * file only (the JSON at `outFile`) and never records or edits a project.
 */
export function briefDraftPrompt({ description, startUrl, language = 'en', brands = [], workspace = '', outFile = '' } = {}) {
  const lang = resolveVideoLanguage(language);
  const purposeGuide = PURPOSE_IDS.map((id) => `${id} — ${PURPOSES[id].label}: ${PURPOSES[id].hint} (${PURPOSES[id].framework})`).join('\n');
  const packs = brands.length ? brands.map(brandLine).join('\n') : '- (none yet — every brief needs mode "new")';
  return `You are the producer preparing a product-walkthrough video brief in Walkthrough Studio. A teammate typed one free-form description (it may be a pasted chat thread, notes, bullet points, or a paragraph in any language). Deconstruct it into a COMPLETE brief that fills every field of the New video form, so the reviewer only has to check it.

## Input
Start URL (where the recording opens): ${startUrl}
Video language: ${lang.name} (${lang.code})
Workspace root: ${workspace || process.cwd()}

Description:
"""
${String(description || '').trim()}
"""

## Discover before you decide
1. Read the description closely. Separate what to SHOW (UI beats, in order) from what to SAY (messages, claims, must-say lines) and from access details (sign-in, demo data, pages to avoid).
2. If the start URL is on localhost or 127.0.0.1, find the app that serves that port inside this workspace (package.json scripts, server files, README) and set app.sourcePath to that app's folder relative to the workspace root (e.g. "kit/studio", "packages/webapp"). Read its README / package.json / page titles to learn the product name, what it does and who it is for. If the start URL is a public site, you may fetch it once (e.g. with node fetch) to read the <title>, meta description and visible product name. Never sign in, submit forms, or place orders.
3. Decide the brand. Existing brand packs (pick by id ONLY when it is READY and it is the same product — same name or same website as the one being recorded; a different product from the same company is a new brand):
${packs}
Otherwise return mode "new" with the brand name and its marketing website (homepage, https://…). Derive the site from the description, the workspace (README links, package.json homepage) or the start URL's domain. Studio then opens that site AND the app's start URL in a browser to capture the logo, colours and type. For a localhost app with no public site, name the brand and leave url empty — the brand is read from the app itself.
4. Pick the purpose from the story the description tells:
${purposeGuide}
5. Pick the length (60, 90, 120 or 180 seconds) from any stated duration; otherwise from the number of beats (3–4 beats → 60–90, 5–6 → 120, more or a help video → 180).
6. Choose up to 4 brand plates that carry proof the screen alone cannot — only the kinds the description supports. Plate types (type — when: shape):
${plateTypeGuide()}

## Output
Write ONLY a JSON object with exactly this shape to the file ${outFile} (create parent folders; overwrite if present), then print the same JSON as your final message with no prose around it:
{
  "title": "≤8 words, the video's name as a viewer would see it",
  "slug": "kebab-case, ≤48 chars",
  "product": "product or feature name",
  "audience": "who watches, one clause",
  "outcome": "after watching, they can…",
  "purpose": "overview|feature|onboarding|launch|sales",
  "brand": { "mode": "existing", "id": "<pack id>" } or { "mode": "new", "name": "…", "url": "https://…" },
  "app": {
    "startUrl": "${startUrl}",
    "appUrl": "https://… (the app's root, or empty)",
    "marketingUrl": "https://… (public site, or empty)",
    "loginRequired": false,
    "email": "demo account email only if the description names one, else empty",
    "sourcePath": "folder in this workspace, or empty",
    "notes": "access notes: cookie banners, seed data, pages to avoid, anything the recorder must know"
  },
  "story": {
    "lengthSec": 120,
    "tone": "three adjectives, e.g. confident, warm, plain-spoken",
    "mustShow": ["Title — why it matters · how: click “Label” in the left sidebar → hover the result"],
    "keyMessages": ["1–4 messages the viewer should remember"],
    "mustSay": ["exact phrases, names or claims the description insists on"],
    "avoid": ["topics or words the description rules out"]
  },
  "proof": {
    "plates": ["features", "journey"],
    "stats": ["verbatim numbers with their source, only if given"],
    "quotes": ["“quote” — name, company, only if given"],
    "logos": ["integrations or customers named"]
  },
  "confidence": "high|medium|low",
  "assumptions": ["each guess you made that the reviewer should confirm"],
  "questions": ["≤3 things only the reviewer can answer, or empty"]
}

Rules:
- Every field present; use "" or [] when the description gives nothing and discovery finds nothing. Never invent stats, quotes, logos, customer names, or credentials. Never output a password.
- Write title, audience, outcome, tone, mustShow, keyMessages and notes in ${lang.name}. Keep product names, URLs, must-say lines, stats and quotes verbatim.
- mustShow is the journey the agent will record. Fold chat noise (timestamps, author names, greetings) away; keep the intent. When the app source is in the workspace, read its routes, nav and button labels so every how-path names real labels.
${BEAT_GUIDE}
- Do not create or edit any file other than ${outFile}. Do not run the recorder, the studio, or any build. Do not open browsers.`;
}

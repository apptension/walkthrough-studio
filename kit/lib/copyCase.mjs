/**
 * House copy style for every string a viewer reads on screen (plates, chapter cards, captions).
 *
 *   Casing      sentence case everywhere: titles, eyebrows, labels, bodies, notes. Eyebrows and
 *               kickers read in caps only through CSS (text-transform + tracking); authored copy is
 *               never ALL CAPS. Brand / product names, acronyms (API, SSO, CRM) and camelCase names
 *               (iPhone, GitHub) keep their own casing.
 *   Punctuation titles, eyebrows and labels carry no closing period (? and ! stay); a staccato title
 *               where every line ends in a period keeps them. Body copy is a sentence and ends in
 *               one. List notes and bullets agree with each other (majority wins).
 *   Typography  smart quotes per language, … for ..., spaced em dash for a spaced hyphen, single spaces.
 *
 * Roles: title | eyebrow | label | body | note | statement | quote | name | raw. `note` and
 * `statement` keep their closing punctuation (lists harmonise notes). `quote`, `name` and `raw`
 * only get typography — quotes stay verbatim, names and figures are never recased.
 * `*accent*` markers pass through untouched. German (and Luxembourgish) capitalise nouns, so
 * Title Case detection is off there; every other rule is language-neutral.
 */

const MINOR = new Set(
  'a an the and but or nor for so yet as at by in of off on per to up via with from into onto over than vs'.split(' ')
);

// Acronyms that are also everyday words: kept when authored in caps inside mixed copy, lowered in ALL CAPS copy.
const AMBIGUOUS = new Set(['it', 'us', 'am', 'pm', 'or', 'id', 'hr', 'ml', 'po', 'cd', 'rest', 'soc']);

const ACRONYMS =
  'AI API APIs ARR B2B B2C BI CI CD CI/CD CLI CMS CPU CRM CSS CSV CTA CX DNS ERP ETA EU FAQ FAQs GDPR GPU GPT HR HTML HTTP HTTPS ID IDs IP IT JSON JWT KPI KPIs LLM MFA ML MRR NPS OCR OKR OKRs OTP PDF PDFs PNG QA QR RAM REST ROI RSS SAML SCIM SDK SDKs SEO SLA SLAs SMS SOC SQL SSL SSO SVG TLS TV UI UK US URL URLs USB UX VAT VIP VPN XML YAML 2FA HN PR PRs';
const NAMES =
  'SaaS iOS iPadOS macOS watchOS tvOS iPhone iPad iMac iCloud AirPods eBay npm pnpm GitHub GitLab Bitbucket HubSpot LinkedIn YouTube WhatsApp PayPal WordPress JavaScript TypeScript Node.js Next.js OAuth OpenAI ChatGPT DevOps PostgreSQL MySQL MongoDB DynamoDB BigQuery ElevenLabs QuickBooks SharePoint OneDrive PowerPoint FaceTime TikTok Google Gmail Microsoft Apple Android Windows Linux Slack Jira Confluence Figma Notion Salesforce Stripe Shopify Zapier Asana Trello Zoom Excel Outlook Playwright Chrome Safari Firefox AWS GCP Azure Docker Kubernetes';

export const COMMON_TERMS = [...ACRONYMS.split(' '), ...NAMES.split(' ')];

const QUOTES = {
  en: ['“', '”', '‘', '’'],
  de: ['„', '“', '‚', '‘'],
  cs: ['„', '“', '‚', '‘'],
  sk: ['„', '“', '‚', '‘'],
  pl: ['„', '”', '‘', '’'],
  fr: ['«\u00a0', '\u00a0»', '‘', '’'],
  ru: ['«', '»', '‘', '’'],
  uk: ['«', '»', '‘', '’'],
};
const NOUN_CAPS = new Set(['de', 'lb']);
const ABBREV = /(?:^|\s)(?:e\.g|i\.e|etc|vs|approx|incl|no|nr|z\.\s?b|np|tj|itd|ok|ca|bzw|usw|ggf)\.$/i;

const WORD = /[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}]|['’./@_&+-](?=[\p{L}\p{N}]))*/gu;
const hasLower = (s) => /\p{Ll}/u.test(s);
const hasLetter = (s) => /\p{L}/u.test(s);
const isCapitalized = (w) => /^\p{Lu}[\p{Ll}\p{M}'’]*$/u.test(w);
/** Casing that is part of the word itself: iPhone, GitHub, KPIs, 4K, node.js, @handle. */
const shapedWord = (w) =>
  /\d/.test(w) || /[./@_&+]/.test(w) || /^\p{Ll}+\p{Lu}/u.test(w) || /^.[\p{L}\p{M}]*\p{Lu}/u.test(w.replace(/['’]s$/, ''));
const distinctive = (canon) => /\p{Lu}/u.test(canon.slice(1)) || /^\p{Ll}.*\p{Lu}/u.test(canon) || /[./]/.test(canon);
const langOf = (lang) => String(lang || 'en').toLowerCase().slice(0, 2);

/**
 * Protected terms + language for one video.
 * @param {{ brand?: object, config?: object, terms?: string[], corpus?: string[], language?: string }} opts
 */
export function copyContext({ brand = {}, config = {}, terms = [], corpus = [], language } = {}) {
  const lang = langOf(language || config?.language);
  const map = new Map();
  const forced = new Set();
  const phrases = [];
  const add = (term, force = false) => {
    const t = String(term || '').trim();
    if (!t) return;
    if (/\s/.test(t)) {
      phrases.push(t);
      for (const part of t.split(/\s+/)) add(part, false);
      return;
    }
    map.set(t.toLocaleLowerCase(lang), t);
    if (force) forced.add(t.toLocaleLowerCase(lang));
  };
  for (const t of COMMON_TERMS) add(t, distinctive(t) && !AMBIGUOUS.has(t.toLowerCase()) && (t.length > 2 || /\p{Ll}/u.test(t)));
  const declared = new Set();
  for (const t of [brand?.name, brand?.product, config?.product, ...(brand?.copyTerms || []), ...(config?.copyTerms || []), ...terms]) {
    add(t, true);
    if (t && !/\s/.test(String(t).trim())) declared.add(String(t).trim().toLocaleLowerCase(lang));
  }
  const ctx = { lang, terms: map, forced, declared, phrases, proper: new Set(), code: learnCodeWords(corpus) };
  ctx.proper = learnProperNouns(corpus, ctx);
  return ctx;
}

const codeAdjacent = (text, t) => /[/`.~@#$-]/.test(text[t.i - 1] || '') || /[/`]/.test(text[t.i + t.w.length] || '');

/** Lowercase words the copy also uses as paths, commands or code (`./studio`, `kit/`) — never recased. */
export function learnCodeWords(texts = []) {
  const found = new Set();
  for (const raw of texts) {
    const text = String(raw || '');
    for (const t of tokens(text)) {
      if (!/^\p{Ll}/u.test(t.w)) continue;
      if (/\//.test(t.w)) for (const part of t.w.split('/')) part && found.add(part);
      else if (codeAdjacent(text, t)) found.add(t.w);
    }
  }
  return found;
}

const CTX_CACHE = new WeakMap();
/** Cached context for a loaded video (or `{ brand }` alone); `corpus` teaches proper nouns once. */
export function copyContextFor(video = {}, corpus = []) {
  const key = video.config || video.brand || video;
  if (key && typeof key === 'object' && CTX_CACHE.has(key)) return CTX_CACHE.get(key);
  const ctx = copyContext({
    brand: video.brand,
    config: video.config,
    language: video.config?.language,
    corpus: [...copyCorpus(video.config), ...corpus],
  });
  if (key && typeof key === 'object') CTX_CACHE.set(key, ctx);
  return ctx;
}

/** Every authored string in a config's plates — the corpus proper nouns are learned from. */
export function copyCorpus(config) {
  const out = [];
  const walk = (v, key) => {
    if (typeof v === 'string') {
      if (!/^(id|type|before|asset|logo|icon|bg|style|motion)$/.test(key)) out.push(v);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'motion' && k !== 'style') walk(x, k);
  };
  if (config) walk({ title: config.title, open: config.open, close: config.close, interstitials: config.interstitials }, '');
  return out;
}

function tokens(text) {
  return [...String(text).matchAll(WORD)].map((m) => ({ w: m[0], i: m.index }));
}

/** Indices of tokens that open a sentence (first word, or after . ! ? … — abbreviations excluded). */
function sentenceStarts(text, toks) {
  const starts = new Set();
  let first = true;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (!hasLetter(t.w) && !/\d/.test(t.w)) continue;
    if (first) {
      if (hasLetter(t.w)) {
        starts.add(k);
        first = false;
      }
      continue;
    }
    const prev = toks[k - 1];
    const gap = text.slice(prev.i + prev.w.length, t.i);
    if (/[.!?…]/.test(gap) && /\s/.test(gap) && !ABBREV.test(text.slice(0, prev.i + prev.w.length + 1))) starts.add(k);
  }
  return starts;
}

function isAllCaps(toks, ctx) {
  const words = toks.filter((t) => hasLetter(t.w));
  if (words.length < 2 || words.some((t) => hasLower(t.w))) return false;
  return words.some((t) => t.w.replace(/\d/g, '').length >= 3 && !ctx.terms.has(t.w.toLocaleLowerCase(ctx.lang)));
}

const protectedWord = (w, ctx) => ctx.terms.has(w.toLocaleLowerCase(ctx.lang)) || ctx.proper.has(w) || shapedWord(w);

function isTitleCase(text, toks, ctx, starts = sentenceStarts(text, toks)) {
  if (NOUN_CAPS.has(ctx.lang)) return false;
  const words = toks.filter((t) => hasLetter(t.w));
  if (words.length < 3) return false;
  let content = 0;
  let minorCaps = false;
  for (let k = 0; k < toks.length; k++) {
    const { w } = toks[k];
    if (!hasLetter(w) || starts.has(k)) continue;
    for (const part of w.split('-')) {
      if (!part || protectedWord(part, ctx)) continue;
      const lower = part.toLocaleLowerCase(ctx.lang);
      if (MINOR.has(lower)) {
        if (isCapitalized(part)) minorCaps = true;
        continue;
      }
      if (!isCapitalized(part)) return false;
      content += 1;
    }
  }
  return content >= 2 || minorCaps;
}

/** Capitalised words that sit mid-sentence in ordinary (not Title Case / ALL CAPS) copy. */
export function learnProperNouns(texts = [], ctx = { lang: 'en', terms: new Map(), proper: new Set() }) {
  const found = new Set();
  const probe = { ...ctx, proper: new Set() };
  for (const raw of texts) {
    const text = String(raw || '');
    for (const line of text.split('\n')) {
      const toks = tokens(line);
      if (isAllCaps(toks, probe)) continue;
      const starts = sentenceStarts(line, toks);
      if (isTitleCase(line, toks, probe, starts)) continue;
      toks.forEach((t, k) => {
        if (!starts.has(k) && isCapitalized(t.w) && t.w.length > 1 && !MINOR.has(t.w.toLowerCase())) found.add(t.w);
      });
    }
  }
  return found;
}

const upperFirst = (w, lang) => {
  const [c, ...rest] = [...w];
  return c.toLocaleUpperCase(lang) + rest.join('');
};

function recase(text, ctx, fixes) {
  const toks = tokens(text);
  if (!toks.length) return text;
  const starts = sentenceStarts(text, toks);
  const caps = isAllCaps(toks, ctx);
  const title = !caps && isTitleCase(text, toks, ctx, starts);
  if (caps) fixes.add('ALL CAPS → sentence case');
  if (title) fixes.add('Title Case → sentence case');
  const lang = ctx.lang;
  const out = toks.map((t, k) => {
    let w = t.w;
    const lower = w.toLocaleLowerCase(lang);
    const canon = ctx.terms.get(lower);
    if (caps) {
      if (canon && !AMBIGUOUS.has(lower)) w = canon;
      else if (!/\d/.test(w)) w = lower;
    } else if (title) {
      w = w
        .split('-')
        .map((part, p) => {
          if (p === 0 && starts.has(k)) return part;
          const c = ctx.terms.get(part.toLocaleLowerCase(lang));
          if (c) return c;
          if (shapedWord(part) || ctx.proper.has(part)) return part;
          return isCapitalized(part) ? part.toLocaleLowerCase(lang) : part;
        })
        .join('-');
    } else if (canon && canon !== w && ctx.forced.has(lower) && (lang === 'en' || hasLower(canon) || ctx.declared?.has(lower))) {
      w = canon;
    }
    if (starts.has(k) && hasLetter(w) && /^\p{Ll}/u.test(w)) {
      const c = ctx.terms.get(w.toLocaleLowerCase(lang));
      if (c && /^\p{Ll}/u.test(c)) w = c;
      else if (!shapedWord(w) && !codeAdjacent(text, t) && !w.split('-').some((p) => ctx.code?.has(p))) {
        w = upperFirst(w, lang);
        if (!caps && !title) fixes.add('capitalised sentence start');
      }
    }
    if (w !== t.w && !caps && !title && !starts.has(k)) fixes.add(`${t.w} → ${w}`);
    return w;
  });
  let s = '';
  let last = 0;
  toks.forEach((t, k) => {
    s += text.slice(last, t.i) + out[k];
    last = t.i + t.w.length;
  });
  s += text.slice(last);
  for (const phrase of ctx.phrases) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
    s = s.replace(re, (m) => (m === phrase ? m : (fixes.add(`${m} → ${phrase}`), phrase)));
  }
  return s;
}

function typography(text, ctx, fixes) {
  let s = String(text);
  const before = s;
  s = s.replace(/[ \t\u00a0]{2,}/g, ' ').replace(/^[ \t]+|[ \t]+$/gm, '');
  if (s !== before) fixes.add('spacing');
  const fr = ctx.lang === 'fr';
  const t1 = s;
  s = s.replace(fr ? / +([,.])/g : / +([,.;:!?])(?=\s|$|\*)/g, '$1');
  s = s.replace(/\.{3}/g, '…');
  s = s.replace(/(\S) +(?:--?|–) +(\S)/g, (m, a, b) => (/\d/.test(a) && /\d/.test(b) ? `${a}–${b}` : `${a} — ${b}`));
  if (s !== t1) fixes.add('punctuation');
  const [dOpen, dClose, sOpen, sClose] = QUOTES[ctx.lang] || QUOTES.en;
  const t2 = s;
  s = s
    .replace(/(\p{L})'(\p{L})/gu, '$1’$2')
    .replace(/(^|[\s(\[*])'(\d{2}s?\b)/gu, '$1’$2')
    .replace(/(^|[\s(\[{*\u2014–-])"(?=\S)/gu, `$1${dOpen}`)
    .replace(/"/g, dClose)
    .replace(/(^|[\s(\[{*\u2014–-])'(?=\S)/gu, `$1${sOpen}`)
    .replace(/'/g, sClose);
  if (s !== t2) fixes.add('smart quotes');
  return s;
}

const TRAIL = /([.,;:]+)([*”’»"')\]\u00a0]*)$/u;
const internalBreak = (s) => /[.!?…]\*?["”’»)]?\s+\S/u.test(s.trim());

function stripPeriod(line, fixes) {
  const m = line.match(TRAIL);
  if (!m || internalBreak(line.slice(0, m.index))) return line;
  fixes.add('dropped closing punctuation');
  return line.slice(0, m.index) + m[2];
}

function endSentence(line, fixes) {
  const trimmed = line.trimEnd();
  if (!trimmed || /·/.test(trimmed)) return line;
  const core = trimmed.replace(/[*”’»"')\]\u00a0]+$/u, '');
  if (/[.!?…:]$/.test(core) || !hasLetter(core) || tokens(core).length < 3) return line;
  // The period goes inside closing quotes but outside an *accent* run.
  const tail = trimmed.slice(core.length);
  const cut = tail.lastIndexOf('*') + 1;
  fixes.add('closing period');
  const body = /[,;]$/.test(core) ? core.slice(0, -1) : core;
  return `${body}${tail.slice(0, cut)}.${tail.slice(cut)}`;
}

function normalizeWithFixes(text, role = 'body', ctx = copyContext()) {
  const fixes = new Set();
  if (text == null || typeof text !== 'string') return { text, fixes: [] };
  if (!text.trim() || /\{\{|<[a-z/]/i.test(text)) return { text, fixes: [] };
  let s = typography(text, ctx, fixes);
  if (role === 'quote' || role === 'name' || role === 'raw') {
    if (role === 'raw') s = text.replace(/[ \t]{2,}/g, ' ').trim();
    return { text: s, fixes: [...fixes] };
  }
  s = recase(s, ctx, fixes);
  if (role === 'title' || role === 'eyebrow' || role === 'label') {
    const lines = s.split('\n');
    const staccato = lines.length > 1 && lines.every((l) => /\.\*?["”’)]?$/.test(l.trim()));
    if (!staccato) s = lines.map((l) => stripPeriod(l, fixes)).join('\n');
  } else if (role === 'body') {
    s = endSentence(s, fixes);
  }
  return { text: s, fixes: [...fixes] };
}

/** Normalised copy for one on-screen string. Non-strings pass through. */
export function normalizeCopy(text, role = 'body', ctx = copyContext()) {
  return normalizeWithFixes(text, role, ctx).text;
}

/** Same as normalizeCopy, plus the list of fixes it made (for lint output). */
export function explainCopy(text, role = 'body', ctx = copyContext()) {
  const r = normalizeWithFixes(text, role, ctx);
  return { from: text, to: r.text, changed: r.text !== text, fixes: r.fixes };
}

/** Open / close titles are arrays of lines read as one sentence: line 2 may start lowercase. */
export function normalizeTitle(title, ctx = copyContext(), role = 'title') {
  if (Array.isArray(title)) {
    const joined = normalizeCopy(title.map(String).join('\n'), role, ctx);
    return joined.split('\n');
  }
  return normalizeCopy(title, role, ctx);
}

/** Notes / bullets in one list agree on a closing period: the majority wins, a tie drops it. */
export function harmonizeList(list) {
  const ends = list.map((s) => (typeof s === 'string' && s.trim() ? /\.\*?["”’)]?$/.test(s.trim()) : null));
  const counted = ends.filter((e) => e !== null);
  if (!counted.length) return list;
  const withDot = counted.filter(Boolean).length;
  const want = withDot > counted.length - withDot;
  const ignore = new Set();
  return list.map((s, i) => {
    if (ends[i] === null || ends[i] === want) return s;
    return want ? endSentence(s, ignore) : stripPeriod(s, ignore);
  });
}

const OBJECT_LISTS = ['items', 'steps', 'stats', 'quotes', 'logos', 'tiers'];

function itemRoles(type, listKey) {
  if (listKey === 'logos') return { label: 'name' };
  if (listKey === 'quotes') return { quote: 'quote', author: 'name', role: 'name', company: 'name' };
  if (type === 'team') return { label: 'name', note: 'name' };
  if (type === 'faq') return { label: 'title', note: 'body' };
  if (listKey === 'tiers') return { label: 'name', note: 'note', badge: 'label', value: 'raw', period: 'raw' };
  return { label: 'label', note: 'note', value: 'raw', date: 'raw', delta: 'raw', badge: 'label' };
}

function normalizeList(list, roles, ctx, stringRole = 'label') {
  if (!Array.isArray(list)) return list;
  const next = list.map((x) => {
    if (typeof x === 'string') return normalizeCopy(x, stringRole, ctx);
    if (!x || typeof x !== 'object') return x;
    const y = { ...x };
    for (const [k, role] of Object.entries(roles)) if (typeof y[k] === 'string') y[k] = normalizeCopy(y[k], role, ctx);
    if (Array.isArray(y.items)) y.items = harmonizeList(normalizeList(y.items, {}, ctx, 'note'));
    return y;
  });
  if (roles.note === 'note' && next.some((x) => x && typeof x === 'object')) {
    const notes = harmonizeList(next.map((x) => (x && typeof x === 'object' ? x.note : undefined)));
    return next.map((x, i) => (x && typeof x === 'object' && typeof x.note === 'string' ? { ...x, note: notes[i] } : x));
  }
  return next;
}

/**
 * A plate (open, close or interstitial) with every viewer-facing string in house style.
 * Returns a copy; ids, placement, motion, style and assets are untouched.
 */
export function normalizePlateCopy(plate, ctx = copyContext()) {
  if (!plate || typeof plate !== 'object') return plate;
  const it = { ...plate };
  const type = it.type || '';
  // A statement title is one editorial sentence: its closing punctuation is the author's.
  if (it.title != null) it.title = normalizeTitle(it.title, ctx, type === 'statement' ? 'statement' : 'title');
  for (const [k, role] of [
    ['eyebrow', 'eyebrow'],
    ['sub', 'body'],
    ['body', 'body'],
    ['tagline', 'label'],
    ['note', type === 'metric' ? 'note' : 'body'],
    ['unit', 'raw'],
    ['value', 'raw'],
    ['quote', 'quote'],
    ['author', 'name'],
    ['role', 'name'],
    ['company', 'name'],
  ]) {
    if (typeof it[k] === 'string') it[k] = normalizeCopy(it[k], role, ctx);
  }
  if (Array.isArray(it.bullets)) it.bullets = harmonizeList(it.bullets.map((b) => normalizeCopy(b, 'note', ctx)));
  if (Array.isArray(it.pills)) it.pills = it.pills.map((p) => normalizeCopy(p, 'label', ctx));
  for (const key of OBJECT_LISTS) {
    if (Array.isArray(it[key])) it[key] = normalizeList(it[key], itemRoles(type, key), ctx, type === 'checklist' ? 'label' : 'note');
  }
  for (const side of ['left', 'right']) {
    const col = it[side];
    if (!col || typeof col !== 'object' || Array.isArray(col)) continue;
    it[side] = {
      ...col,
      ...(typeof col.label === 'string' ? { label: normalizeCopy(col.label, 'eyebrow', ctx) } : {}),
      ...(typeof col.title === 'string' ? { title: normalizeCopy(col.title, 'title', ctx) } : {}),
      ...(Array.isArray(col.items) ? { items: harmonizeList(col.items.map((x) => normalizeCopy(x, 'label', ctx))) } : {}),
    };
  }
  return it;
}

/** Field-by-field differences between a plate and its normalised copy: `[{ field, from, to }]`. */
export function plateCopyFixes(plate, ctx = copyContext()) {
  const next = normalizePlateCopy(plate, ctx);
  const out = [];
  const walk = (a, b, path) => {
    if (typeof a === 'string') {
      if (a !== b) out.push({ field: path, from: a, to: b });
      return;
    }
    if (Array.isArray(a) && Array.isArray(b) && a.every((x) => typeof x === 'string') && path.endsWith('title')) {
      const from = a.join(' / ');
      const to = b.join(' / ');
      if (from !== to) out.push({ field: path, from, to });
      return;
    }
    if (a && typeof a === 'object' && b && typeof b === 'object') {
      for (const k of Object.keys(a)) if (k !== 'motion' && k !== 'style') walk(a[k], b[k], path ? `${path}.${k}` : k);
    }
  };
  walk(plate, next, '');
  return out;
}

/** Chapter / caption card copy (flow.mjs chapter() and say()) as `{ field, from, to, fixes }` findings. */
export function cardCopyFixes({ title, body } = {}, ctx = copyContext()) {
  const out = [];
  for (const [field, text, role] of [
    ['title', title, 'title'],
    ['body', body, 'body'],
  ]) {
    if (typeof text !== 'string' || !text) continue;
    const r = explainCopy(text, role, ctx);
    if (r.changed) out.push({ field, from: r.from, to: r.to, fixes: r.fixes });
  }
  return out;
}

/** The house style as prompt text for the draft / script / plate / brief agents. */
export const COPY_STYLE_GUIDE = `On-screen copy style (every plate, chapter and caption string):
- Sentence case everywhere: capitalise the first word and proper nouns only ("Plan the week", not "Plan The Week"). Never type ALL CAPS — eyebrows and kickers are set in caps by the template CSS. Keep product and brand names, acronyms and camelCase names exactly as the product writes them (API, SSO, CRM, iPhone, GitHub).
- Titles, eyebrows, labels and list items: no closing period (a question keeps "?"). A two-line staccato title may end both lines with a period ("Invite once." / "They're *in.*"). Bodies and captions are one sentence that ends with a period. Notes in one list all end the same way.
- Length: eyebrow 1–3 words; titles ≤5 words (open/close lines ≤4 words each); bodies ≤12 words; list labels ≤4 words, notes ≤8 words.
- Active voice, second person, present tense. Lead with the outcome, then the mechanism ("Hours land on the forecast", not "The forecast is updated with hours").
- Parallel structure: every item in a list starts the same way (all verbs or all nouns) and has the same shape.
- No jargon, buzzwords or filler (seamless, powerful, leverage, unlock, streamline, just, simply, very); no internal names, ticket keys or emojis.
- Typography: curly quotes, … not ..., a spaced em dash ( — ) between clauses, one space between words. In non-English copy follow that language's own casing and quote marks (German capitalises nouns).`;

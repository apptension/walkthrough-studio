/**
 * Script = what the viewer sees and hears, in delivery order, derived from the sources
 * (video.config.json plates, flow.mjs chapter()/say() calls, narration.mjs lines) — never a
 * separate copy that can drift. Review state (script + cut approvals) lives next to the sources
 * in videos/<slug>/review.json and is invalidated automatically when the sources change.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { shortHoldWarning } from '../studio/voiceHold.js';
import { PLATE_CATALOG, PLATE_TYPE_SET } from './plateTypes.mjs';
import { cardCopyFixes, copyContext, copyCorpus, plateCopyFixes } from './copyCase.mjs';

/** Matches narration.mjs guidance (~2.4 spoken words per second). */
const WORDS_PER_SEC = 2.4;
const MAX_LINE_WORDS = 28;
const MAX_TITLE_WORDS = 5;
const MAX_BODY_WORDS = 12;
/** chapter() blocks for its card; say() default hold when no ms is given. */
const CHAPTER_SEC = 2.8;
const SAY_DEFAULT_SEC = 2.2;
/** Keys from kit/templates/new-video/narration.mjs — not real orphan lines. */
const SCAFFOLD_NARRATION_KEYS = new Set(['Chapter title from flow.mjs', 'Caption title from flow.mjs']);
/** Titles from kit/templates/new-video/flow.mjs + config scaffold. */
const SCAFFOLD_TITLES = new Set(['First chapter', 'Sign in', 'Do the thing', 'Ready to work', 'Product walkthrough']);

/** Groups: 1 fn · 2/3 title quote+text · 4/5 body quote+text · 6 hold ms. */
const str = (n) => `(['"\`])((?:\\\\.|(?!\\${n})[^\\\\])*)\\${n}`;
const CALL_RE = new RegExp(String.raw`\b(chapter|say)\(\s*${str(2)}\s*(?:,\s*${str(4)})?\s*(?:,\s*(\d+))?`, 'g');

const unescape = (s) => (s ?? '').replace(/\\(['"`\\])/g, '$1');
const words = (s) => (String(s || '').match(/[\p{L}\p{N}'’-]+/gu) || []).length;
const lineText = (v) => (v && typeof v === 'object' ? v.text || '' : v || '');
const lineSpeed = (v) => {
  if (!(v && typeof v === 'object') || v.speed == null) return null;
  const n = Number(v.speed);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const plain = (s) => String(s || '').replace(/\*/g, '');
const ident = /^[A-Za-z_$][\w$]*$/;
const clampHoldMs = (ms) => {
  if (ms == null || ms === '') return null;
  const n = Math.round(Number(ms));
  if (!Number.isFinite(n)) return null;
  return Math.max(400, Math.min(12000, n));
};
const clampSpeed = (sp) => {
  if (sp == null || sp === '') return null;
  const n = Number(sp);
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n - 1) < 0.005) return null;
  return Math.round(Math.max(0.8, Math.min(1.3, n)) * 100) / 100;
};
const q = (s) => {
  const t = String(s).replace(/\\/g, '\\\\');
  return t.includes("'") && !t.includes('"') ? `"${t}"` : `'${t.replace(/'/g, "\\'")}'`;
};
const key = (k) => (ident.test(k) ? k : q(k));
const val = (v) =>
  v && typeof v === 'object'
    ? `{ ${Object.entries(v)
        .map(([k, x]) => `${key(k)}: ${typeof x === 'string' ? q(x) : JSON.stringify(x)}`)
        .join(', ')} }`
    : q(v);

/** Match spans for chapter()/say(), including the closing paren. */
export function flowCallMatches(source) {
  const out = [];
  for (const m of source.matchAll(CALL_RE)) {
    let end = m.index + m[0].length;
    while (end < source.length && /\s/.test(source[end])) end++;
    if (source[end] === ')') end++;
    out.push({
      kind: m[1] === 'chapter' ? 'chapter' : 'step',
      fn: m[1],
      title: unescape(m[3]),
      body: unescape(m[5]),
      holdMs: m[6] ? Number(m[6]) : null,
      dynamic: /\$\{/.test(m[3] || ''),
      start: m.index,
      end,
      line: source.slice(0, m.index).split('\n').length,
    });
  }
  return out;
}

/** chapter()/say() calls in source order. Template literals with ${} are kept verbatim. */
export function parseFlowCalls(source) {
  return flowCallMatches(source).map(({ fn: _fn, start: _s, end: _e, ...rest }, index) => ({ ...rest, index }));
}

function formatFlowCall(fn, title, body, holdMs) {
  const args = [q(title)];
  const hold = clampHoldMs(holdMs);
  if (body) args.push(q(body));
  else if (hold != null) args.push("''");
  if (hold != null) args.push(String(hold));
  return `${fn}(${args.join(', ')})`;
}

/**
 * Where the statement containing the call at `at` begins.
 *
 * `await say(...)` has a single space between the keyword and the call. Walking back over
 * that space lands *on* the space, so a lookbehind of `await ` (keyword plus the space)
 * never matches — the space is the cursor, not part of the lookbehind. Removals then
 * deleted `say(...);\n` and left `await`, which glued onto the next line (`await   const`,
 * `await   await`). Match the keyword itself, then expand to the indent when the call
 * owns the whole line.
 */
function statementStart(source, at) {
  let i = at;
  while (i > 0 && /[ \t]/.test(source[i - 1])) i--;
  const keyword = 'await';
  const keywordAt = i - keyword.length;
  if (
    keywordAt >= 0 &&
    source.slice(keywordAt, i) === keyword &&
    (keywordAt === 0 || !/[\w$]/.test(source[keywordAt - 1]))
  ) {
    i = keywordAt;
  } else {
    i = at;
  }
  const lineStart = source.lastIndexOf('\n', i - 1) + 1;
  if (/^[ \t]*$/.test(source.slice(lineStart, i))) return lineStart;
  return i;
}

/** Replace title/body/hold on the call at `index`. Returns the new source. */
export function replaceFlowCallAt(source, index, patch = {}) {
  const matches = flowCallMatches(source);
  const m = matches[index];
  if (!m) throw new Error(`No chapter/say call at index ${index}`);
  if (m.dynamic && patch.title != null && patch.title !== m.title) {
    throw new Error('Cannot rename a dynamic chapter title (template literal)');
  }
  const title = patch.title != null ? String(patch.title).trim() : m.title;
  if (!title) throw new Error('Title cannot be empty');
  const body = patch.body !== undefined ? String(patch.body ?? '').trim() : m.body;
  const holdMs = patch.holdMs !== undefined ? clampHoldMs(patch.holdMs) : m.holdMs;
  return source.slice(0, m.start) + formatFlowCall(m.fn, title, body, holdMs) + source.slice(m.end);
}

/** Move a chapter()/say() one slot up (delta −1) or down (delta +1). */
export function moveFlowCall(source, index, delta) {
  if (delta !== -1 && delta !== 1) throw new Error('delta must be -1 or 1');
  return moveFlowCallTo(source, index, index + delta);
}

/**
 * Move a chapter()/say() so it lands at `toIndex` in the call list.
 * Used by Scenario drag-and-drop; preserves title/body/hold.
 */
export function moveFlowCallTo(source, fromIndex, toIndex) {
  const matches = flowCallMatches(source);
  if (!Number.isInteger(fromIndex) || !matches[fromIndex]) throw new Error(`No chapter/say call at index ${fromIndex}`);
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= matches.length) {
    throw new Error('Cannot move further');
  }
  if (fromIndex === toIndex) return source;
  const m = matches[fromIndex];
  const cleaned = removeFlowCallAt(source, fromIndex);
  // After removal, insert after (toIndex - 1) so the call lands at toIndex.
  return insertFlowCallAfter(cleaned, toIndex - 1, {
    kind: m.kind === 'step' ? 'step' : 'chapter',
    title: m.title,
    body: m.body,
    holdMs: m.holdMs,
  });
}

/**
 * Replace flow.mjs only when the new source parses. Script edits splice that file in
 * place; a bad splice used to be written anyway, and record then died with
 * "Unexpected token 'const'" instead of the edit being rejected.
 */
export function commitFlowSource(flowPath, source) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-syntax-'));
  const file = join(dir, 'flow.mjs');
  try {
    writeFileSync(file, source);
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (check.status !== 0) {
      const detail =
        (check.stderr || '')
          .split('\n')
          .map((line) => line.trim())
          .find((line) => line.startsWith('SyntaxError')) || 'invalid syntax';
      throw new Error(`That edit would break flow.mjs (${detail}). Nothing was saved.`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  writeFileSync(flowPath, source);
}

/** Remove the await-call statement at `index`. */
export function removeFlowCallAt(source, index) {
  const matches = flowCallMatches(source);
  const m = matches[index];
  if (!m) throw new Error(`No chapter/say call at index ${index}`);
  const start = statementStart(source, m.start);
  let end = m.end;
  if (source[end] === ';') end++;
  let j = end;
  while (j < source.length && /[ \t]/.test(source[j])) j++;
  if (source[j] === '\n') end = j + 1;
  return source.slice(0, start) + source.slice(end);
}

/**
 * Insert a new chapter()/say() after `afterIndex` (−1 = before the first call).
 * Anchors on an existing call so custom navigation code stays untouched.
 */
export function insertFlowCallAfter(source, afterIndex, { kind = 'chapter', title, body, holdMs } = {}) {
  const matches = flowCallMatches(source);
  if (!matches.length) throw new Error('flow.mjs has no chapter()/say() calls to anchor an insert');
  const fn = kind === 'step' || kind === 'say' ? 'say' : 'chapter';
  const t = String(title || '').trim() || (fn === 'chapter' ? 'New chapter' : 'New caption');
  const b =
    body != null
      ? String(body).trim()
      : fn === 'chapter'
        ? 'What the viewer should take away'
        : 'On-screen caption';
  const h = holdMs != null ? holdMs : fn === 'chapter' ? 2200 : 1800;
  const call = `await ${formatFlowCall(fn, t, b, h)};`;

  let insertAt;
  let indent = '  ';
  if (afterIndex < 0) {
    const first = matches[0];
    const lineStart = source.lastIndexOf('\n', first.start - 1) + 1;
    indent = (source.slice(lineStart).match(/^([ \t]*)/) || [, '  '])[1];
    insertAt = statementStart(source, first.start);
    return `${source.slice(0, insertAt)}${indent}${call}\n${source.slice(insertAt)}`;
  }
  const anchor = matches[Math.min(afterIndex, matches.length - 1)];
  if (!anchor) throw new Error(`No chapter/say call at index ${afterIndex}`);
  insertAt = anchor.end;
  if (source[insertAt] === ';') insertAt++;
  const lineStart = source.lastIndexOf('\n', anchor.start - 1) + 1;
  indent = (source.slice(lineStart).match(/^([ \t]*)/) || [, '  '])[1];
  const prefix = source[insertAt] === '\n' ? `\n${indent}${call}` : `\n${indent}${call}`;
  return source.slice(0, insertAt) + prefix + source.slice(insertAt);
}

export async function loadNarration(video) {
  const p = join(video.dir, 'narration.mjs');
  if (!existsSync(p)) return { intro: '', outro: '', plates: {}, lines: {} };
  const mod = await import(`${pathToFileURL(p).href}?t=${statSync(p).mtimeMs}`);
  const n = mod.default || {};
  return { intro: n.intro || '', outro: n.outro || '', plates: n.plates || {}, lines: n.lines || {} };
}

/**
 * Story-facing slice of video.config.json. Desk edits (voice takes, zooms, direction,
 * record settings) live on the same file but must not void an approved script.
 */
function scriptConfigSurface(cfg) {
  const content = (block) => {
    if (!block || typeof block !== 'object') return null;
    const { style: _style, motion: _motion, ...rest } = block;
    return rest;
  };
  return {
    title: cfg.title || '',
    audience: cfg.audience || '',
    open: content(cfg.open),
    close: content(cfg.close),
    interstitials: (cfg.interstitials || []).map(content),
  };
}

/** Hash of the approved script surface — narration, flow, and plate/open/close copy. */
function sourcesHash(video) {
  const h = createHash('sha1');
  for (const f of ['narration.mjs', 'flow.mjs']) {
    const p = join(video.dir, f);
    h.update(f);
    if (existsSync(p)) h.update(readFileSync(p));
  }
  const cfgPath = join(video.dir, 'video.config.json');
  h.update('video.config.json:script');
  if (existsSync(cfgPath)) {
    try {
      h.update(JSON.stringify(scriptConfigSurface(JSON.parse(readFileSync(cfgPath, 'utf8')))));
    } catch {
      h.update(readFileSync(cfgPath));
    }
  }
  return h.digest('hex').slice(0, 12);
}

function lintScene(scene) {
  const issues = [];
  const add = (level, message) => issues.push({ level, message });
  if (scene.voiced && !scene.narration) {
    add(scene.kind === 'chapter' || scene.kind === 'plate' ? 'warn' : 'info', 'No narration — covered by the line before');
  }
  if (scene.narrationWords > MAX_LINE_WORDS) add('warn', `Narration is ${scene.narrationWords} words (max ${MAX_LINE_WORDS})`);
  if ((scene.kind === 'chapter' || scene.kind === 'step') && words(scene.title) > MAX_TITLE_WORDS) {
    add('warn', `Title is ${words(scene.title)} words (max ${MAX_TITLE_WORDS})`);
  }
  if ((scene.kind === 'chapter' || scene.kind === 'step') && words(scene.onScreen) > MAX_BODY_WORDS) {
    add('info', `Caption is ${words(scene.onScreen)} words (aim ≤ ${MAX_BODY_WORDS})`);
  }
  if (scene.narration && /\b(click|clicks|clicking|tap|press)\b/i.test(scene.narration)) {
    add('info', 'Narration describes clicks — say why it matters instead');
  }
  const holdWarn = shortHoldWarning(scene.holdSec, scene.narrationSec);
  if (holdWarn) add('warn', holdWarn);
  return issues;
}

/**
 * House copy-style fixes (casing, closing punctuation, typography) for every plate and card,
 * keyed like the scenes. `fix` names the field and the suggested text.
 */
export function copyStyleFindings(video, calls = []) {
  const cfg = video.config || {};
  const ctx = copyContext({
    brand: video.brand,
    config: cfg,
    corpus: [...copyCorpus(cfg), ...calls.flatMap((c) => [c.title, c.body].filter(Boolean))],
  });
  const out = [];
  const add = (key, target, f) =>
    out.push({
      key,
      message: `Copy style — ${f.field}: “${f.from}” → “${f.to}”${f.fixes?.length ? ` (${f.fixes.join(', ')})` : ''}`,
      fix: { ...target, field: f.field, from: f.from, text: f.to, fixes: f.fixes || [] },
    });
  for (const id of ['open', 'close']) {
    if (cfg[id]) for (const f of plateCopyFixes(cfg[id], ctx)) add(id, { plateId: id }, f);
  }
  for (const it of cfg.interstitials || []) {
    for (const f of plateCopyFixes(it, ctx)) add(`plate:${it.id}`, { plateId: it.id }, f);
  }
  for (const call of calls) {
    if (call.dynamic) continue;
    for (const f of cardCopyFixes(call, ctx)) add(`${call.kind}:${call.title}`, { flowIndex: call.index }, f);
  }
  return out;
}

function plateOnScreen(it) {
  const list = it.items || it.steps || it.stats || it.quotes || it.logos || it.tiers || [];
  const bits = list
    .slice(0, 6)
    .map((x) => x.label || x.value || x.author || x.quote || '')
    .filter(Boolean);
  const bullets = (it.bullets || []).slice(0, 4).join(' · ');
  return [it.sub, it.body, bits.join(' · '), bullets].filter(Boolean).map(plain).join(' — ');
}

/** Catalog of interstitial plate types Studio can add and edit (single source: plateTypes.mjs). */
export { PLATE_CATALOG };

function slugId(s) {
  return String(s || 'plate')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'plate';
}

function uniquePlateId(config, base) {
  const used = new Set((config.interstitials || []).map((i) => i.id));
  let id = slugId(base);
  if (!used.has(id)) return id;
  for (let n = 2; n < 100; n++) {
    const next = `${id}-${n}`;
    if (!used.has(next)) return next;
  }
  return `${id}-${Date.now().toString(36)}`;
}

/** Fresh interstitial scaffold for Studio “Add plate”. */
export function scaffoldPlate(type, { before, title } = {}) {
  if (!PLATE_TYPE_SET.has(type)) throw new Error(`Unknown plate type: ${type}`);
  const chapter = String(before || 'First chapter').trim() || 'First chapter';
  const base = {
    type,
    before: chapter,
    title: title || PLATE_CATALOG.find((p) => p.type === type)?.label || type,
    eyebrow: '',
  };
  switch (type) {
    case 'features':
      return {
        ...base,
        eyebrow: 'What you get',
        title: title || 'Everything in one place',
        items: [
          { label: 'Plan', note: 'See the work ahead', icon: 'calendar' },
          { label: 'Track', note: 'Know what landed', icon: 'clock' },
          { label: 'Prove', note: 'Reports when you need them', icon: 'chart' },
        ],
      };
    case 'journey':
      return {
        ...base,
        eyebrow: 'The tour ahead',
        title: title || 'Your first week',
        steps: [
          { label: 'Start', note: 'Arrive oriented', icon: 'dashboard' },
          { label: 'Explore', note: 'See the core loop', icon: 'calendar' },
          { label: 'Act', note: 'Do the key job', icon: 'spark' },
        ],
      };
    case 'logos':
    case 'orbit':
      return {
        ...base,
        eyebrow: type === 'orbit' ? 'In orbit' : 'Integrations',
        title: title || (type === 'orbit' ? 'The stack around you' : 'Fits the tools you already use'),
        sub: '',
        logos: [
          { asset: '', label: 'Tool one' },
          { asset: '', label: 'Tool two' },
          { asset: '', label: 'Tool three' },
        ],
      };
    case 'testimonials':
      return {
        ...base,
        eyebrow: 'From the field',
        title: title || 'Why teams stick with it',
        quotes: [
          { quote: 'Replace with a real customer quote.', author: 'Customer', role: 'Role' },
          { quote: 'Second real quote — keep it short.', author: 'Customer', role: 'Company' },
          { quote: 'A third voice makes the flood read as a pattern.', author: 'Customer', role: 'Team lead' },
        ],
      };
    case 'stats':
      return {
        ...base,
        eyebrow: 'Social proof',
        title: title || 'Trusted by teams like yours',
        stats: [
          { value: '—', label: 'Rating', note: '' },
          { value: '—', label: 'Teams', note: '' },
          { value: '—', label: 'Outcome', note: '' },
        ],
      };
    case 'callout':
      return {
        ...base,
        eyebrow: 'Why it matters',
        title: title || 'One job, done well',
        body: 'State the outcome the viewer came for.',
        bullets: ['See the pain stop', 'Repeat it tomorrow', 'Prove it to the team'],
      };
    case 'compare':
      return {
        ...base,
        eyebrow: 'Before and after',
        title: title || 'From scattered to settled',
        left: { label: 'Before', items: ['Old pain', 'Second friction', 'What slips'] },
        right: { label: 'After', items: ['What settles', 'Second win', 'What the team sees'] },
      };
    case 'quote':
      return {
        ...base,
        eyebrow: 'In their words',
        title: title || 'A line worth remembering',
        quote: 'Replace with a verbatim customer quote.',
        author: 'Customer',
        role: 'Role · Company',
      };
    case 'metric':
      return {
        ...base,
        eyebrow: 'Measured',
        title: title || 'The outcome in one number',
        value: '—',
        unit: '',
        note: 'Use a real number from the brief.',
        progress: 0.76,
      };
    case 'process':
      return {
        ...base,
        eyebrow: 'How it works',
        title: title || 'Three steps, one outcome',
        sub: '',
        steps: [
          { label: 'Connect', note: 'Sign in and link the tools you already use' },
          { label: 'Set up once', note: 'Name the rules; the product keeps them' },
          { label: 'Run the week', note: 'Every change lands where the team looks' },
        ],
      };
    case 'timeline':
      return {
        ...base,
        eyebrow: 'The road so far',
        title: title || 'Built in the open',
        steps: [
          { label: 'Launch', date: 'Q1', note: 'First teams on board' },
          { label: 'Integrations', date: 'Q2', note: 'The stack connects' },
          { label: 'Reporting', date: 'Q3', note: 'Numbers leaders ask for' },
          { label: 'Now', date: 'Today', note: 'What you will see next' },
        ],
      };
    case 'checklist':
      return {
        ...base,
        eyebrow: 'By the end',
        title: title || 'What is done when you are done',
        items: [
          { label: 'The team sees one plan', note: 'No side spreadsheets' },
          { label: 'Changes land in minutes', note: 'Not next Monday' },
          { label: 'Leaders get the number', note: 'Without asking twice' },
        ],
      };
    case 'kpi':
      return {
        ...base,
        eyebrow: 'This quarter',
        title: title || 'The board leaders look at',
        stats: [
          { value: '—', label: 'Utilisation', delta: '+0%', note: 'from brief' },
          { value: '—', label: 'On-time delivery', delta: '+0%', note: 'from brief' },
          { value: '—', label: 'Hours saved', delta: '+0', note: 'from brief' },
          { value: '—', label: 'Open requests', delta: '−0', note: 'from brief' },
        ],
      };
    case 'statement':
      return {
        ...base,
        eyebrow: 'The point',
        title: title || ['One plan the whole team', '*actually* follows.'],
        sub: 'Replace with the thesis in the brief — one line, one accent.',
      };
    case 'faq':
      return {
        ...base,
        eyebrow: 'You might be wondering',
        title: title || 'Before you ask',
        items: [
          { label: 'Does it replace our spreadsheet?', note: 'Yes — import it once; the plan lives here from then on.' },
          { label: 'How long to set up?', note: 'An afternoon for most teams; integrations connect with one login.' },
          { label: 'Who sees what?', note: 'Roles decide; leaders see totals, people see their own week.' },
        ],
      };
    case 'pricing':
      return {
        ...base,
        eyebrow: 'Plans',
        title: title || 'Start small, grow in place',
        tiers: [
          { label: 'Starter', value: '$0', period: 'per user / month', note: 'For a first team', items: ['Core planning', 'Two integrations', 'Email support'] },
          { label: 'Team', value: '$12', period: 'per user / month', note: 'Most teams land here', badge: 'Most popular', featured: true, items: ['Everything in Starter', 'Reports and exports', 'Unlimited integrations', 'Priority support'] },
          { label: 'Business', value: '$29', period: 'per user / month', note: 'For the whole org', items: ['Everything in Team', 'SSO and audit log', 'Dedicated success manager'] },
        ],
      };
    case 'team':
      return {
        ...base,
        eyebrow: 'Who it is for',
        title: title || 'Built for the people in the loop',
        items: [
          { label: 'Team lead', note: 'Plans the week, sees the gaps' },
          { label: 'Operations', note: 'Keeps the rules, answers once' },
          { label: 'Leadership', note: 'Reads the number, not the thread' },
        ],
      };
    case 'showcase':
      return {
        ...base,
        eyebrow: 'See it in action',
        title: title || 'The week, on *one* screen',
        sub: 'Grab a frame from the recording and point at what matters.',
        shot: '',
        focus: 'center',
        callouts: [
          { label: 'Live capacity', x: 30, y: 34 },
          { label: 'One click to rebalance', x: 68, y: 62 },
        ],
      };
    case 'bento':
      return {
        ...base,
        eyebrow: 'At a glance',
        title: title || 'Everything the team needs, *in view*',
        shot: '',
        caption: 'The planning board',
        value: '94%',
        label: 'of weeks shipped on plan',
        quote: 'We stopped double-booking people in the first week.',
        author: 'Ana Ruiz · COO',
        logos: [],
      };
    default:
      return base;
  }
}

/** Split a Studio "lines" cell ("a · b · c" or newline-separated) into a string array. */
function splitLines(value) {
  return String(value ?? '')
    .split(/\s*(?:\n|·|\|)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Normalize list payloads from Studio into the config shape for a plate type. */
function applyPlateList(it, list) {
  const meta = PLATE_CATALOG.find((p) => p.type === it.type);
  if (!meta?.list || !Array.isArray(list)) return;
  const rows = list
    .map((row, idx) => {
      if (meta.list === 'bullets') {
        const text = String(row?.text ?? row ?? '').trim();
        return text || null;
      }
      if (meta.list === 'quotes') {
        const quote = String(row?.quote || '').trim();
        if (!quote) return null;
        return {
          quote,
          ...(row?.author != null && String(row.author).trim() ? { author: String(row.author).trim() } : {}),
          ...(row?.role != null && String(row.role).trim() ? { role: String(row.role).trim() } : {}),
        };
      }
      if (meta.list === 'stats') {
        const value = String(row?.value || '').trim();
        const label = String(row?.label || '').trim();
        if (!value && !label) return null;
        return {
          value: value || '—',
          label: label || 'Metric',
          ...(row?.note != null && String(row.note).trim() ? { note: String(row.note).trim() } : {}),
          ...(row?.delta != null && String(row.delta).trim() ? { delta: String(row.delta).trim() } : {}),
        };
      }
      if (meta.list === 'logos') {
        const label = String(row?.label || '').trim();
        if (!label) return null;
        return {
          label,
          ...(row?.asset != null && String(row.asset).trim() ? { asset: String(row.asset).trim() } : { asset: '' }),
        };
      }
      // items / steps / tiers: label is required; the other catalog columns copy when non-empty.
      const label = String(row?.label || '').trim();
      if (!label) return null;
      const out = { label };
      for (const f of meta.fields) {
        if (f === 'label') continue;
        const v = row?.[f];
        if (v == null || !String(v).trim()) continue;
        if (f === 'lines') out.items = splitLines(v);
        else out[f] = String(v).trim();
      }
      // Flags the row editor has no column for survive a Studio save (pricing featured/badge).
      const prev = (it[meta.list] || [])[idx];
      if (prev && typeof prev === 'object') {
        for (const k of ['featured', 'badge', 'icon', 'asset', 'count']) {
          if (prev[k] != null && out[k] == null && !meta.fields.includes(k)) out[k] = prev[k];
        }
      }
      return out;
    })
    .filter(Boolean);
  it[meta.list] = rows;
}

function plateEditorState(it) {
  const meta = PLATE_CATALOG.find((p) => p.type === it.type) || { type: it.type, label: it.type, list: null, fields: [] };
  const listKey = meta.list;
  let rows = [];
  if (listKey === 'bullets') rows = (it.bullets || []).map((text) => ({ text }));
  else if (listKey === 'tiers') rows = (it.tiers || []).map(({ items, ...row }) => ({ ...row, lines: (items || []).join(' · ') }));
  else if (listKey) rows = [...(it[listKey] || [])];
  return {
    type: it.type,
    typeLabel: meta.label,
    listKey,
    fields: meta.fields || [],
    rows,
    body: it.body || '',
    quote: it.quote || '',
    author: it.author || '',
    role: it.role || '',
    value: it.value != null ? String(it.value) : '',
    unit: it.unit || '',
    note: it.note || '',
    progress: it.progress != null ? Number(it.progress) : null,
    left: it.left ? { label: it.left.label || 'Before', items: [...(it.left.items || [])] } : null,
    right: it.right ? { label: it.right.label || 'After', items: [...(it.right.items || [])] } : null,
  };
}

/**
 * @returns {Promise<{scenes:Array, lint:Array, totals:object, hash:string, orphans:string[]}>}
 */
export async function buildScript(video) {
  const cfg = video.config;
  const narration = await loadNarration(video);
  const flowPath = join(video.dir, 'flow.mjs');
  const calls = existsSync(flowPath) ? parseFlowCalls(readFileSync(flowPath, 'utf8')) : [];
  const used = new Set();
  const scenes = [];

  const push = (scene) => {
    const narrationRaw = scene.narrationRaw;
    const text = lineText(narrationRaw);
    const speed = lineSpeed(narrationRaw);
    const spokenSec = words(text) / WORDS_PER_SEC / (speed || 1);
    const s = {
      ...scene,
      narration: text,
      narrationWords: words(text),
      narrationSpeed: speed,
      narrationSec: spokenSec,
    };
    delete s.narrationRaw;
    s.issues = lintScene(s);
    scenes.push(s);
  };

  const holdForCall = (call) => {
    if (call.holdMs != null) return call.holdMs / 1000;
    return call.kind === 'chapter' ? CHAPTER_SEC : SAY_DEFAULT_SEC;
  };

  const chapterTitles = calls.filter((c) => c.kind === 'chapter').map((c) => c.title);

  push({
    kind: 'open',
    key: 'open',
    title: plain([].concat(cfg.open?.title || cfg.title).join(' ')),
    titleLines: [].concat(cfg.open?.title || cfg.title || []).map(String),
    eyebrow: cfg.open?.eyebrow || '',
    onScreen: plain(cfg.open?.sub || ''),
    sub: cfg.open?.sub || '',
    narrationKind: 'intro',
    narrationKey: 'intro',
    narrationRaw: narration.intro,
    voiced: true,
    holdSec: 6,
    holdDefault: 6,
    timingKind: 'plate',
    editable: { screen: true, structure: true, speed: true },
  });

  const plates = cfg.interstitials || [];
  const placed = new Set();
  for (const call of calls) {
    if (call.kind === 'chapter') {
      for (const it of plates.filter((p) => p.before === call.title)) {
        placed.add(it.id);
        const raw = narration.plates[it.id] ?? narration.lines[it.title] ?? narration.lines[it.id];
        if (narration.plates[it.id] !== undefined) used.add(`plate:${it.id}`);
        push({
          kind: 'plate',
          key: `plate:${it.id}`,
          plateId: it.id,
          plateType: it.type,
          title: plain(it.title || it.id),
          plateTitle: it.title || '',
          eyebrow: it.eyebrow || '',
          sub: it.sub || '',
          onScreen: plateOnScreen(it),
          before: it.before || '',
          chapters: chapterTitles,
          plate: plateEditorState(it),
          narrationKind: 'plate',
          narrationKey: it.id,
          narrationRaw: raw,
          voiced: true,
          holdSec: 5,
          holdDefault: 5,
          timingKind: 'plate',
          editable: { screen: true, place: true, speed: true, remove: true, items: true },
        });
      }
    }
    if (narration.lines[call.title] !== undefined) used.add(`line:${call.title}`);
    const holdSec = holdForCall(call);
    const holdDefault = call.kind === 'chapter' ? CHAPTER_SEC : SAY_DEFAULT_SEC;
    push({
      kind: call.kind,
      key: `${call.kind}:${call.title}`,
      title: call.title,
      onScreen: call.body,
      flowLine: call.line,
      flowIndex: call.index,
      flowCount: calls.length,
      dynamic: call.dynamic,
      holdMs: call.holdMs,
      holdExplicit: call.holdMs != null,
      narrationKind: 'line',
      narrationKey: call.title,
      narrationRaw: narration.lines[call.title],
      voiced: true,
      holdSec,
      holdDefault,
      timingKind: 'card',
      editable: {
        screen: !call.dynamic,
        remove: !call.dynamic,
        hold: !call.dynamic,
        move: !call.dynamic,
        speed: true,
      },
    });
  }

  push({
    kind: 'close',
    key: 'close',
    title: plain([].concat(cfg.close?.title || []).join(' ')),
    titleLines: [].concat(cfg.close?.title || []).map(String),
    onScreen: (cfg.close?.steps || []).map((s) => plain(s.label)).join(' · '),
    steps: (cfg.close?.steps || []).map((s) => ({ label: s.label || '', note: s.note || '' })),
    narrationKind: 'outro',
    narrationKey: 'outro',
    narrationRaw: narration.outro,
    voiced: true,
    holdSec: 7,
    holdDefault: 7,
    timingKind: 'plate',
    editable: { screen: true, steps: true, speed: true },
  });

  for (const f of copyStyleFindings(video, calls)) {
    const scene = scenes.find((s) => s.key === f.key);
    if (scene) scene.issues.push({ level: 'info', message: f.message, fix: f.fix });
  }

  const lint = [];
  for (const it of plates) {
    if (!placed.has(it.id)) {
      lint.push({ level: 'error', key: `plate:${it.id}`, message: `Plate "${it.id}" is placed before "${it.before}", which is not a chapter in flow.mjs` });
    }
  }
  const orphans = [
    ...Object.keys(narration.lines).filter((k) => !used.has(`line:${k}`) && !plates.some((p) => p.title === k || p.id === k)),
    ...Object.keys(narration.plates).filter((k) => !used.has(`plate:${k}`)),
  ];
  const scaffoldOrphans = orphans.filter((k) => SCAFFOLD_NARRATION_KEYS.has(k));
  const realOrphans = orphans.filter((k) => !SCAFFOLD_NARRATION_KEYS.has(k));
  for (const k of realOrphans) {
    lint.push({ level: 'warn', key: k, message: `Narration "${k}" matches no chapter, caption or plate` });
  }
  const chapters = scenes.filter((s) => s.kind === 'chapter');
  const scaffold =
    scenes.some((s) => SCAFFOLD_TITLES.has(s.title)) ||
    scaffoldOrphans.length > 0 ||
    /One sentence over the (opening|closing) plate/i.test(lineText(narration.intro) + lineText(narration.outro));

  if (!scaffold && calls.length && (chapters.length < 3 || chapters.length > 9)) {
    lint.push({ level: 'info', key: 'chapters', message: `${chapters.length} chapters — 4–7 reads best` });
  }
  if (!calls.length) lint.push({ level: 'error', key: 'flow', message: 'flow.mjs has no chapter() or say() calls yet' });
  // Soften "no narration" noise while the starter template is still on screen
  if (!scaffold) {
    for (const s of scenes) for (const i of s.issues) lint.push({ ...i, key: s.key });
  } else {
    for (const s of scenes) {
      for (const i of s.issues) {
        if (i.message.startsWith('No narration')) continue;
        lint.push({ ...i, key: s.key });
      }
    }
  }

  const narrated = scenes.filter((s) => s.narration);
  const estSec = scenes.reduce((sum, s) => sum + Math.max(s.holdSec || 0, s.narrationSec), 0);
  return {
    scenes,
    chapters: chapterTitles,
    plateTypes: PLATE_CATALOG,
    lint,
    orphans: realOrphans,
    scaffold,
    hash: sourcesHash(video),
    totals: {
      scenes: scenes.length,
      chapters: chapters.length,
      plates: scenes.filter((s) => s.kind === 'plate').length,
      narrated: narrated.length,
      words: narrated.reduce((sum, s) => sum + s.narrationWords, 0),
      estSec: Math.round(estSec),
      errors: lint.filter((l) => l.level === 'error').length,
      warnings: lint.filter((l) => l.level === 'warn').length,
    },
  };
}

/* ---------- narration.mjs editing ---------- */

function serializeNarration(n, preamble) {
  const block = (obj) =>
    Object.entries(obj)
      .map(([k, v]) => `    ${key(k)}: ${val(v)},`)
      .join('\n');
  const parts = [`  intro: ${val(n.intro || '')},`, `  outro: ${val(n.outro || '')},`];
  if (Object.keys(n.plates || {}).length) parts.push(`  plates: {\n${block(n.plates)}\n  },`);
  parts.push(`  lines: {\n${block(n.lines || {})}\n  },`);
  return `${preamble}export default {\n${parts.join('\n')}\n};\n`;
}

/**
 * Set (or clear, with empty text) one narration line. kind: intro | outro | plate | line.
 * Optional `speed` (0.8–1.3, or null/1 to clear) pins delivery pace on `{ text, speed }`.
 * Keeps an object line's extra fields. Preserves the file's leading comment.
 */
export async function setNarrationLine(video, { kind, key: k, text, speed }) {
  const p = join(video.dir, 'narration.mjs');
  const src = existsSync(p) ? readFileSync(p, 'utf8') : 'export default {};\n';
  const preamble = src.slice(0, Math.max(0, src.indexOf('export default')));
  const n = await loadNarration(video);
  const next = { ...n, plates: { ...n.plates }, lines: { ...n.lines } };
  const sp = speed !== undefined ? clampSpeed(speed) : undefined;

  const shape = (prev, clean) => {
    let entry;
    if (clean === '') entry = '';
    else if (prev && typeof prev === 'object') entry = { ...prev, text: clean };
    else entry = clean;
    if (sp === undefined) return entry;
    if (!entry) return entry;
    if (typeof entry === 'string') return sp == null ? entry : { text: entry, speed: sp };
    const obj = { ...entry };
    if (sp == null) delete obj.speed;
    else obj.speed = sp;
    if (Object.keys(obj).length === 1 && obj.text != null) return obj.text;
    return obj;
  };

  if (kind === 'intro' || kind === 'outro') {
    if (text !== undefined) {
      const clean = String(text ?? '').trim();
      next[kind] = !clean && sp === undefined ? '' : shape(n[kind], clean);
    } else if (sp !== undefined) {
      next[kind] = shape(n[kind], lineText(n[kind]));
    }
  } else if (kind === 'plate' || kind === 'line') {
    const bag = kind === 'plate' ? next.plates : next.lines;
    if (!k) throw new Error('Missing narration key');
    const prev = bag[k];
    if (text !== undefined) {
      const clean = String(text ?? '').trim();
      if (!clean && sp === undefined) delete bag[k];
      else bag[k] = shape(prev, clean);
    } else if (sp !== undefined) {
      if (prev === undefined) throw new Error(`No narration "${k}" to retime`);
      bag[k] = shape(prev, lineText(prev));
    }
  } else throw new Error(`Unknown narration kind: ${kind}`);
  writeFileSync(p, serializeNarration(next, preamble));
  return next;
}

async function writeNarrationState(video, next) {
  const p = join(video.dir, 'narration.mjs');
  const src = existsSync(p) ? readFileSync(p, 'utf8') : 'export default {};\n';
  const preamble = src.slice(0, Math.max(0, src.indexOf('export default')));
  writeFileSync(p, serializeNarration(next, preamble));
}

function readRawConfig(video) {
  return JSON.parse(readFileSync(join(video.dir, 'video.config.json'), 'utf8'));
}

function writeRawConfig(video, config) {
  writeFileSync(join(video.dir, 'video.config.json'), JSON.stringify(config, null, 2) + '\n');
  // Keep the in-memory video.config in sync for callers that reuse the same object.
  Object.assign(video.config, {
    open: config.open,
    close: config.close,
    interstitials: config.interstitials,
    chapterLabels: config.chapterLabels,
  });
}

/** Serialize structure mutations per video so concurrent Studio edits cannot interleave RMW. */
const structureLocks = new Map();
async function withStructureLock(video, fn) {
  const key = video.dir;
  const prev = structureLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const held = prev.catch(() => {}).then(() => gate);
  structureLocks.set(key, held);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (structureLocks.get(key) === held) structureLocks.delete(key);
  }
}

function parseTitleLines(value, previous) {
  const text = String(value ?? '').replace(/\r\n/g, '\n');
  const trimmed = text.trim();
  // Allow clearing a title in Studio (empty textarea → empty array/string).
  if (!trimmed) return Array.isArray(previous) ? [] : '';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (Array.isArray(previous) || lines.length > 1) return lines;
  return lines[0] || '';
}

async function renameNarrationKey(video, oldTitle, newTitle) {
  if (!oldTitle || !newTitle || oldTitle === newTitle) return;
  const n = await loadNarration(video);
  if (n.lines[oldTitle] === undefined) return;
  const next = { ...n, plates: { ...n.plates }, lines: { ...n.lines } };
  next.lines[newTitle] = next.lines[oldTitle];
  delete next.lines[oldTitle];
  await writeNarrationState(video, next);
}

function renameChapterRefs(config, oldTitle, newTitle) {
  if (!oldTitle || !newTitle || oldTitle === newTitle) return false;
  let dirty = false;
  for (const p of config.interstitials || []) {
    if (p.before === oldTitle) {
      p.before = newTitle;
      dirty = true;
    }
  }
  if (config.chapterLabels) {
    for (const [k, v] of Object.entries(config.chapterLabels)) {
      if (v === oldTitle) {
        config.chapterLabels[k] = newTitle;
        dirty = true;
      }
    }
  }
  return dirty;
}

/**
 * Mutate script structure (flow.mjs calls + open/close/plate placement in config).
 * Ops: open | close | close-steps | plate-before | plate-move | plate-update | plate-add | plate-remove |
 *      call-update | call-add | call-remove | call-move | call-move-to
 */
export async function applyScriptStructure(video, body = {}) {
  return withStructureLock(video, () => applyScriptStructureUnlocked(video, body));
}

async function applyScriptStructureUnlocked(video, body = {}) {
  const op = body.op;
  if (!op) throw new Error('Missing structure op');

  if (op === 'open') {
    const config = readRawConfig(video);
    if (!config.open) config.open = {};
    if (body.eyebrow != null) config.open.eyebrow = String(body.eyebrow).trim();
    if (body.title != null) config.open.title = parseTitleLines(body.title, config.open.title);
    if (body.sub != null) config.open.sub = String(body.sub).trim();
    writeRawConfig(video, config);
    return { op, wrote: 'video.config.json' };
  }

  if (op === 'close') {
    const config = readRawConfig(video);
    if (!config.close) config.close = {};
    if (body.title != null) config.close.title = parseTitleLines(body.title, config.close.title);
    if (Array.isArray(body.steps)) {
      config.close.steps = body.steps.map((s) => ({
        label: String(s?.label || '').trim(),
        ...(s?.note != null && String(s.note).trim() ? { note: String(s.note).trim() } : {}),
      })).filter((s) => s.label);
    }
    writeRawConfig(video, config);
    return { op, wrote: 'video.config.json' };
  }

  if (op === 'close-steps') {
    const config = readRawConfig(video);
    if (!config.close) config.close = {};
    const steps = [...(config.close.steps || [])];
    const action = body.action || 'set';
    if (action === 'add') {
      steps.push({
        label: String(body.label || 'New step').trim(),
        ...(body.note ? { note: String(body.note).trim() } : {}),
      });
    } else if (action === 'remove') {
      const i = Number(body.index);
      if (!Number.isInteger(i) || i < 0 || i >= steps.length) throw new Error('Bad close step index');
      steps.splice(i, 1);
    } else if (action === 'update') {
      const i = Number(body.index);
      if (!Number.isInteger(i) || i < 0 || i >= steps.length) throw new Error('Bad close step index');
      if (body.label != null) steps[i].label = String(body.label).trim();
      if (body.note != null) {
        const note = String(body.note).trim();
        if (note) steps[i].note = note;
        else delete steps[i].note;
      }
      if (!steps[i].label) throw new Error('Step label cannot be empty');
    } else if (action === 'move') {
      const from = Number(body.from);
      const to = Number(body.to);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= steps.length) {
        throw new Error('Bad close step move');
      }
      const [row] = steps.splice(from, 1);
      steps.splice(Math.max(0, Math.min(to, steps.length)), 0, row);
    } else {
      throw new Error(`Unknown close-steps action: ${action}`);
    }
    config.close.steps = steps;
    writeRawConfig(video, config);
    return { op, wrote: 'video.config.json' };
  }

  if (op === 'plate-before' || op === 'plate-move') {
    const plateId = body.plateId;
    const before = String(body.before || '').trim();
    if (!plateId) throw new Error('Missing plateId');
    if (!before) throw new Error('Pick a chapter for this plate');
    const config = readRawConfig(video);
    const list = config.interstitials || [];
    const at = list.findIndex((p) => p.id === plateId);
    if (at < 0) throw new Error(`Unknown plate "${plateId}"`);
    const it = list[at];
    const flowPath = join(video.dir, 'flow.mjs');
    const chapters = existsSync(flowPath)
      ? parseFlowCalls(readFileSync(flowPath, 'utf8')).filter((c) => c.kind === 'chapter').map((c) => c.title)
      : [];
    if (chapters.length && !chapters.includes(before)) {
      throw new Error(`"${before}" is not a chapter in flow.mjs`);
    }
    it.before = before;
    // Optional: land among other plates for the same chapter (Scenario DnD).
    if (op === 'plate-move' && body.among != null && Number.isFinite(Number(body.among))) {
      const siblings = list.filter((p) => p.id !== plateId && p.before === before).length;
      const among = Math.max(0, Math.min(Number(body.among), siblings));
      list.splice(at, 1);
      let insertAt = list.length;
      let seen = 0;
      let inGroup = false;
      for (let i = 0; i < list.length; i++) {
        if (list[i].before === before) {
          inGroup = true;
          if (seen === among) {
            insertAt = i;
            break;
          }
          seen++;
          insertAt = i + 1;
        } else if (inGroup) {
          break;
        }
      }
      if (!inGroup && !list.some((p) => p.before === before)) {
        const chapIdx = chapters.indexOf(before);
        insertAt = list.length;
        for (let i = 0; i < list.length; i++) {
          const ci = chapters.indexOf(list[i].before);
          if (ci > chapIdx) {
            insertAt = i;
            break;
          }
        }
      }
      list.splice(insertAt, 0, it);
      config.interstitials = list;
    }
    writeRawConfig(video, config);
    return { op, wrote: 'video.config.json', plateId, before };
  }

  if (op === 'plate-update') {
    const plateId = String(body.plateId || '').trim();
    if (!plateId) throw new Error('Missing plateId');
    const config = readRawConfig(video);
    const it = (config.interstitials || []).find((p) => p.id === plateId);
    if (!it) throw new Error(`Unknown plate "${plateId}"`);
    if (body.title != null) it.title = String(body.title).trim();
    if (body.eyebrow != null) it.eyebrow = String(body.eyebrow).trim();
    if (body.sub != null) {
      const sub = String(body.sub).trim();
      if (sub) it.sub = sub;
      else delete it.sub;
    }
    if (body.body != null) {
      const b = String(body.body).trim();
      if (b) it.body = b;
      else delete it.body;
    }
    if (body.quote != null) it.quote = String(body.quote).trim();
    if (body.author != null) it.author = String(body.author).trim();
    if (body.role != null) it.role = String(body.role).trim();
    if (body.value != null) it.value = String(body.value).trim();
    if (body.unit != null) {
      const unit = String(body.unit).trim();
      if (unit) it.unit = unit;
      else delete it.unit;
    }
    if (body.note != null) {
      const note = String(body.note).trim();
      if (note) it.note = note;
      else delete it.note;
    }
    if (body.progress != null) {
      const p = Number(body.progress);
      if (Number.isFinite(p)) it.progress = Math.max(0, Math.min(1, Math.round(p * 100) / 100));
    }
    if (body.left && typeof body.left === 'object') {
      it.left = {
        label: String(body.left.label || 'Before').trim() || 'Before',
        items: (Array.isArray(body.left.items) ? body.left.items : []).map((x) => String(x || '').trim()).filter(Boolean),
      };
    }
    if (body.right && typeof body.right === 'object') {
      it.right = {
        label: String(body.right.label || 'After').trim() || 'After',
        items: (Array.isArray(body.right.items) ? body.right.items : []).map((x) => String(x || '').trim()).filter(Boolean),
      };
    }
    if (body.rows != null || body.items != null || body.list != null) {
      applyPlateList(it, body.rows || body.items || body.list);
    }
    writeRawConfig(video, config);
    return { op, wrote: 'video.config.json', plateId };
  }

  if (op === 'plate-add') {
    const type = String(body.type || '').trim();
    if (!PLATE_TYPE_SET.has(type)) throw new Error(`Unknown plate type: ${type}`);
    const config = readRawConfig(video);
    const flowPath = join(video.dir, 'flow.mjs');
    const chapters = existsSync(flowPath)
      ? parseFlowCalls(readFileSync(flowPath, 'utf8')).filter((c) => c.kind === 'chapter').map((c) => c.title)
      : [];
    let before = String(body.before || '').trim();
    if (!before) before = chapters[0] || '';
    if (!before) throw new Error('Add a chapter before placing a plate');
    if (chapters.length && !chapters.includes(before)) {
      throw new Error(`"${before}" is not a chapter in flow.mjs`);
    }
    const plate = scaffoldPlate(type, { before, title: body.title });
    plate.id = uniquePlateId(config, body.id || type);
    plate.before = before;
    config.interstitials = [...(config.interstitials || []), plate];
    writeRawConfig(video, config);
    const n = await loadNarration(video);
    if (n.plates[plate.id] === undefined) {
      const next = { ...n, plates: { ...n.plates, [plate.id]: '' }, lines: { ...n.lines } };
      await writeNarrationState(video, next);
    }
    return { op, wrote: 'video.config.json', plateId: plate.id, type };
  }

  if (op === 'plate-remove') {
    const plateId = String(body.plateId || '').trim();
    if (!plateId) throw new Error('Missing plateId');
    const config = readRawConfig(video);
    const before = config.interstitials || [];
    const next = before.filter((p) => p.id !== plateId);
    if (next.length === before.length) throw new Error(`Unknown plate "${plateId}"`);
    config.interstitials = next;
    writeRawConfig(video, config);
    const n = await loadNarration(video);
    if (n.plates[plateId] !== undefined) {
      const narration = { ...n, plates: { ...n.plates }, lines: { ...n.lines } };
      delete narration.plates[plateId];
      await writeNarrationState(video, narration);
    }
    return { op, wrote: 'video.config.json', removed: plateId };
  }

  if (op === 'call-update' || op === 'call-add' || op === 'call-remove' || op === 'call-move' || op === 'call-move-to') {
    const flowPath = join(video.dir, 'flow.mjs');
    if (!existsSync(flowPath)) throw new Error('flow.mjs is missing');
    let source = readFileSync(flowPath, 'utf8');
    const beforeCalls = parseFlowCalls(source);

    if (op === 'call-update') {
      const index = Number(body.index);
      if (!Number.isInteger(index)) throw new Error('Missing call index');
      const prev = beforeCalls[index];
      if (!prev) throw new Error(`No call at index ${index}`);
      source = replaceFlowCallAt(source, index, {
        title: body.title,
        body: body.body,
        holdMs: body.holdMs,
      });
      commitFlowSource(flowPath, source);
      const nextTitle = body.title != null ? String(body.title).trim() : prev.title;
      if (nextTitle !== prev.title) {
        await renameNarrationKey(video, prev.title, nextTitle);
        if (prev.kind === 'chapter') {
          const config = readRawConfig(video);
          if (renameChapterRefs(config, prev.title, nextTitle)) writeRawConfig(video, config);
        }
      }
      return { op, wrote: 'flow.mjs', index, title: nextTitle };
    }

    if (op === 'call-add') {
      const kind = body.kind === 'step' || body.kind === 'say' ? 'step' : 'chapter';
      const afterIndex = body.afterIndex == null ? beforeCalls.length - 1 : Number(body.afterIndex);
      source = insertFlowCallAfter(source, afterIndex, {
        kind,
        title: body.title,
        body: body.body,
        holdMs: body.holdMs,
      });
      commitFlowSource(flowPath, source);
      const title =
        String(body.title || '').trim() || (kind === 'chapter' ? 'New chapter' : 'New caption');
      const n = await loadNarration(video);
      if (n.lines[title] === undefined) {
        const next = { ...n, plates: { ...n.plates }, lines: { ...n.lines, [title]: '' } };
        await writeNarrationState(video, next);
      }
      return { op, wrote: 'flow.mjs', kind, title };
    }

    if (op === 'call-remove') {
      const index = Number(body.index);
      if (!Number.isInteger(index)) throw new Error('Missing call index');
      const prev = beforeCalls[index];
      if (!prev) throw new Error(`No call at index ${index}`);
      if (prev.kind === 'chapter') {
        const chapters = beforeCalls.filter((c) => c.kind === 'chapter');
        if (chapters.length <= 1) throw new Error('Keep at least one chapter');
        const config = readRawConfig(video);
        const blocked = (config.interstitials || []).filter((p) => p.before === prev.title);
        if (blocked.length) {
          throw new Error(
            `Move plate${blocked.length > 1 ? 's' : ''} ${blocked.map((p) => p.id).join(', ')} off this chapter before removing it`
          );
        }
      }
      source = removeFlowCallAt(source, index);
      commitFlowSource(flowPath, source);
      const n = await loadNarration(video);
      if (n.lines[prev.title] !== undefined) {
        const next = { ...n, plates: { ...n.plates }, lines: { ...n.lines } };
        delete next.lines[prev.title];
        await writeNarrationState(video, next);
      }
      return { op, wrote: 'flow.mjs', removed: prev.title };
    }

    if (op === 'call-move') {
      const index = Number(body.index);
      const delta = Number(body.delta);
      if (!Number.isInteger(index)) throw new Error('Missing call index');
      if (delta !== -1 && delta !== 1) throw new Error('delta must be -1 or 1');
      source = moveFlowCall(source, index, delta);
      commitFlowSource(flowPath, source);
      return { op, wrote: 'flow.mjs', index, delta };
    }

    if (op === 'call-move-to') {
      const index = Number(body.index);
      const toIndex = Number(body.toIndex);
      if (!Number.isInteger(index)) throw new Error('Missing call index');
      if (!Number.isInteger(toIndex)) throw new Error('Missing toIndex');
      source = moveFlowCallTo(source, index, toIndex);
      commitFlowSource(flowPath, source);
      return { op, wrote: 'flow.mjs', index, toIndex };
    }
  }

  throw new Error(`Unknown structure op: ${op}`);
}

/* ---------- review / approvals ---------- */

const reviewPath = (video) => join(video.dir, 'review.json');

export function readReview(video) {
  const p = reviewPath(video);
  const base = { script: { status: 'draft', history: [] }, cut: { status: 'none', history: [] } };
  if (!existsSync(p)) return base;
  try {
    const r = JSON.parse(readFileSync(p, 'utf8'));
    return { script: { ...base.script, ...r.script }, cut: { ...base.cut, ...r.cut } };
  } catch {
    return base;
  }
}

function writeReview(video, review) {
  writeFileSync(reviewPath(video), JSON.stringify(review, null, 2) + '\n');
}

function logEntry(action, { note = '', by = '', extra = {} } = {}) {
  return { action, at: new Date().toISOString(), ...(note ? { note } : {}), ...(by ? { by } : {}), ...extra };
}

/** Effective script status: an approval whose hash no longer matches the sources reads "changed". */
export function scriptStatus(video, review = readReview(video)) {
  const hash = sourcesHash(video);
  const s = review.script;
  if (s.status === 'approved' && s.hash !== hash) return { ...s, effective: 'changed', currentHash: hash };
  return { ...s, effective: s.status, currentHash: hash };
}

export function approveScript(video, { note, by } = {}) {
  const review = readReview(video);
  const hash = sourcesHash(video);
  review.script = {
    ...review.script,
    status: 'approved',
    hash,
    approvedAt: new Date().toISOString(),
    ...(by ? { approvedBy: by } : {}),
    note: note || '',
    history: [...(review.script.history || []), logEntry('approved', { note, by, extra: { hash } })].slice(-40),
  };
  writeReview(video, review);
  return review;
}

/**
 * Keep an approved script approved after a quiet edit (narration line / pace).
 * Structure changes (flow / plates) still flip to "changed" until the human re-approves.
 */
export function refreshScriptApproval(video, { reason = 'narration' } = {}) {
  const review = readReview(video);
  if (review.script.status !== 'approved') return null;
  const hash = sourcesHash(video);
  if (review.script.hash === hash) return review;
  review.script = {
    ...review.script,
    hash,
    approvedAt: new Date().toISOString(),
    history: [
      ...(review.script.history || []),
      logEntry('approved', { note: `auto · ${reason}`, by: 'studio', extra: { hash, auto: true } }),
    ].slice(-40),
  };
  writeReview(video, review);
  return review;
}

export function requestScriptChanges(video, { note, by, jobId } = {}) {
  const review = readReview(video);
  review.script = {
    ...review.script,
    status: 'changes-requested',
    note: note || '',
    history: [...(review.script.history || []), logEntry('changes-requested', { note, by, extra: jobId ? { jobId } : {} })].slice(-40),
  };
  writeReview(video, review);
  return review;
}

/** Cut approval pins a saved version (the exact delivered file) and the script hash it was cut from. */
export function setCutReview(video, { status, version, note, by } = {}) {
  if (!['approved', 'changes-requested'].includes(status)) throw new Error(`Bad cut status: ${status}`);
  const review = readReview(video);
  review.cut = {
    ...review.cut,
    status,
    note: note || '',
    ...(status === 'approved' ? { version, approvedAt: new Date().toISOString(), scriptHash: sourcesHash(video) } : {}),
    ...(by ? { by } : {}),
    history: [...(review.cut.history || []), logEntry(status, { note, by, extra: version ? { version } : {} })].slice(-40),
  };
  writeReview(video, review);
  return review;
}

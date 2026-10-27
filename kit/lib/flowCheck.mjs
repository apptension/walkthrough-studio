/**
 * Draft gate: proves flow.mjs, narration.mjs and video.config.json can be recorded before a draft
 * job reports done. Syntax + import, config shape, a static lint of the ctx API (read from the
 * real ctx in record.mjs, so it cannot drift), title/narration balance, narration that repeats
 * itself (narrationQc.mjs) and selectors against the product map. Errors send the agent back for a
 * bounded repair; warnings ride along.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DELIVERY } from './format.mjs';
import { PLATE_TYPE_SET } from './plateTypes.mjs';
import { buildScript, flowCallMatches } from './script.mjs';

const RECORD_SOURCE = fileURLToPath(new URL('./record.mjs', import.meta.url));
const DEFAULT_REPAIRS = 2;
const MAX_REPAIRS = 4;
const SCAFFOLD_TITLES = new Set(['First chapter', 'Do the thing', 'Ready to work']);
const FRAME_SIZES = `${DELIVERY.width}|${DELIVERY.height}`;
const FRAME_LITERAL = new RegExp(String.raw`(?<![\w$.])(${FRAME_SIZES})(?![\w.])`, 'g');

/** One line per ctx key. Every key on the real ctx must be here (flowCheck.test.mjs enforces it). */
export const CTX_DOCS = Object.freeze({
  page: 'Playwright Page: page.getByRole/getByLabel/getByText/getByTestId/locator, page.goto(url, { waitUntil: "domcontentloaded" }), page.mouse, page.keyboard',
  context: 'Playwright BrowserContext (clearCookies() before switching persons)',
  browser: 'Playwright Browser',
  config: 'resolved video.config.json (read-only)',
  env: 'config.env with "$VAR" refs resolved from kit/.env',
  out: 'output folder for debug artifacts',
  mail: 'Mailcatcher: mail.waitFor({ to, subject }), mail.link(msg, /re/), mail.htmlUrl(msg)',
  wait: 'wait(ms) — viewer reading time at steady pace; the video pace scales it',
  sleep: 'sleep(ms) — raw sleep for app timing (debounce, polling); pace never touches it',
  pace: "pace('brisk' | 'calm' | number) shifts the live pace from here on; pace() resets",
  mark: 'mark(id, label) — extra timeline mark',
  say: 'say(title, body, ms = 2400) — caption; await it right before the action it describes',
  chapter: 'chapter(title, body, ms = 2800) — full-frame card that BLOCKS for its hold; call it before navigating to the next area, no wait() after it',
  story: 'internal overlay controller — never call it from a flow',
  brand: 'loaded brand pack (read-only)',
  actions: 'actions.hide() / actions.show() — pointer decoration off/on around drags and free-hand input',
  pointer: 'pointer.moveTo(x, y) glides without acting; pointer.position is a getter { x, y } (no parentheses)',
  zoom: "zoom(locator, { holdMs = 2200, level: 'bold' | 'subtle', zoom, label }) — post push-in without clicking",
  privacy: 'privacy.mask(locator, { label }) → { clear() } before a secret shows; privacy.clearAll()',
  focus: 'focus(locator, holdMs = 1400) — ring on an element without acting',
  frame: 'frame(locator, { holdMs = 400 }) → boolean — camera seat; false (no throw) when not visible',
  settle: 'settle(locator | null, holdMs = 900) — waits up to 30 s for the locator to be visible + domcontentloaded, then holds; use after every navigation',
  magnify: 'magnify(locator, { holdMs = 2400, zoom, label }) — lens over one payoff',
  follow: 'follow([locator | { locator, holdMs }], { holdMs = 1400, label }) — one lens across 2–6 related targets',
  typeInto: 'typeInto(locator, value, { timeout = 4000 }) → boolean — focus-stable typing; returns false when the field is not visible yet (settle() first)',
  fillField: 'fillField([/label or placeholder re/], value) → boolean — first visible label/placeholder/textbox match',
  near: 'near(locator, { x, y, step, nth, timeout, fallback }) → locator — the duplicate nearest a captured point; throws when none',
  spot: 'spot(box, capturedBox, { fx, fy }) → { x, y } — where inside a live box to act',
  optional: "optional(label, async () => { … }, { timeoutMs = 8000 }) → boolean — a step the story does not depend on; a miss logs ⚠ and the take continues",
});

const SUGGEST = {
  caption: 'say', title: 'chapter', narrate: 'say', step: 'say', card: 'chapter',
  click: 'page.getByRole(…).click()', tap: 'page.getByRole(…).click()', goto: 'page.goto(url, { waitUntil: "domcontentloaded" })',
  navigate: 'page.goto', type: 'typeInto', fill: 'typeInto or fillField', hover: 'locator.hover()',
  highlight: 'focus or magnify', spotlight: 'magnify', lens: 'magnify', hold: 'wait', pause: 'wait', delay: 'wait',
  scroll: 'frame(locator) or page.mouse.wheel', waitFor: 'settle(locator)', log: 'mark', zoomTo: 'zoom',
  cursor: 'pointer', keyboard: 'page.keyboard', mouse: 'page.mouse', screenshot: 'page.screenshot',
};

/* ---------- source masking ---------- */

const REGEX_BEFORE = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);

/** Same-length copy with comments blanked; `strings` also blanks string/template/regex contents. */
export function maskSource(src, { strings = true } = {}) {
  const out = src.split('');
  const n = src.length;
  const blank = (a, b) => {
    for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  const blankText = (a, b) => strings && blank(a, b);
  const tmpl = [];
  let depth = 0;
  let prev = '';
  const scanTemplate = (j) => {
    const start = j;
    while (j < n) {
      if (src[j] === '\\') j += 2;
      else if (src[j] === '`') {
        blankText(start, j);
        return j + 1;
      } else if (src[j] === '$' && src[j + 1] === '{') {
        blankText(start, j);
        tmpl.push(depth);
        depth++;
        return j + 2;
      } else j++;
    }
    blankText(start, n);
    return n;
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? n : e;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      blankText(i + 1, j);
      i = j + 1;
      prev = c;
      continue;
    }
    if (c === '`') {
      i = scanTemplate(i + 1);
      prev = '`';
      continue;
    }
    if (c === '/' && REGEX_BEFORE.has(prev)) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      blankText(i + 1, j);
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      i = j;
      prev = 'a';
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (tmpl.length && depth === tmpl[tmpl.length - 1]) {
        tmpl.pop();
        i = scanTemplate(i + 1);
        prev = '`';
        continue;
      }
    }
    if (!/\s/.test(c)) prev = /[\w$]/.test(c) ? 'a' : c;
    i++;
  }
  return out.join('');
}

const lineAt = (src, index) => src.slice(0, index).split('\n').length;

/** Keys of the object literal opening at `open` in masked code; `key: { … }` values nest. */
function objectKeys(code, open) {
  const keys = {};
  let depth = 0;
  let expectKey = true;
  let i = open + 1;
  while (i < code.length) {
    const c = code[i];
    if (depth === 0 && c === '}') return { keys, end: i };
    if (depth === 0 && expectKey && !/\s/.test(c)) {
      const m = code.slice(i).match(/^(?:async\s+)?(?:(get|set)\s+(?=[\w$]+\s*\())?([A-Za-z_$][\w$]*)/);
      expectKey = false;
      if (m) {
        const name = m[2];
        const after = code.slice(i + m[0].length).match(/^\s*:\s*\{/);
        if (after) {
          const inner = objectKeys(code, i + m[0].length + after[0].length - 1);
          keys[name] = { kind: 'object', keys: inner.keys };
          i = inner.end + 1;
          continue;
        }
        keys[name] = { kind: m[1] === 'get' ? 'getter' : 'value' };
        i += m[0].length;
        continue;
      }
    }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) expectKey = true;
    i++;
  }
  return { keys, end: code.length };
}

/** The ctx a flow receives, parsed from record.mjs: { keys: { name: { kind, keys? } } }. */
export function ctxApiFromSource(source) {
  const code = maskSource(source);
  const at = code.search(/const\s+ctx\s*=\s*\{/);
  if (at < 0) throw new Error('record.mjs has no `const ctx = {` literal');
  return { keys: objectKeys(code, code.indexOf('{', at)).keys };
}

let cachedApi = null;
export function ctxApi() {
  cachedApi ||= ctxApiFromSource(readFileSync(RECORD_SOURCE, 'utf8'));
  return cachedApi;
}

/** Compact ctx contract for prompts, one line per real key. */
export function ctxContract(api = ctxApi()) {
  return Object.keys(api.keys)
    .filter((k) => k !== 'story' && k !== 'browser')
    .map((k) => `- ${CTX_DOCS[k] || k}`)
    .join('\n');
}

export const FLOW_SKELETON = `export default async function flow(ctx) {
  const { page, chapter, say, wait, settle, typeInto, optional } = ctx;

  await optional('Dismiss cookie banner', async () => {
    const accept = page.getByRole('button', { name: /accept|agree|allow all/i });
    if (await accept.isVisible().catch(() => false)) await accept.click();
  });

  await chapter('Beat title', 'Why this beat matters to the viewer');
  await page.getByRole('link', { name: /reports/i }).click();
  await settle(page.getByRole('heading', { name: /reports/i }));

  await say('Step title', 'What the viewer should notice');
  await typeInto(page.locator('input[name="search"]'), 'Q3 revenue');
  await wait(1200);

  return { route: page.url() };
}`;

/* ---------- flow lint ---------- */

function balanced(code, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const close = pairs[code[open]];
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === code[open]) depth++;
    else if (code[i] === close && --depth === 0) return i;
  }
  return -1;
}

/** Names bound by a destructuring pattern body (no outer braces): { name: { key, alias, nested } }. */
function destructured(code, text, offset) {
  const out = [];
  let depth = 0;
  let start = 0;
  const parts = [];
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    if ((c === ',' && depth === 0) || i === text.length) {
      parts.push({ s: text.slice(start, i), at: offset + start });
      start = i + 1;
    }
  }
  for (const { s, at } of parts) {
    const t = s.trim();
    if (!t || t.startsWith('...')) continue;
    const m = t.match(/^([A-Za-z_$][\w$]*)\s*(?::\s*([\s\S]+?))?\s*(?:=[\s\S]*)?$/);
    if (!m) continue;
    const lead = s.length - s.trimStart().length;
    const entry = { key: m[1], alias: m[1], index: at + lead, nested: null };
    if (m[2]) {
      const v = m[2].trim();
      if (v.startsWith('{')) entry.nested = destructured(code, v.slice(1, -1), 0).map((x) => x.key);
      else if (/^[A-Za-z_$][\w$]*$/.test(v)) entry.alias = v;
    }
    out.push(entry);
  }
  return out;
}

function flowParam(code) {
  let m = code.match(/export\s+default\s+(?:async\s+)?(?:function\s*[\w$]*\s*)?\(/);
  if (!m) {
    const named = code.match(/export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/);
    if (named) {
      const re = new RegExp(String.raw`(?:function\s+${named[1]}\s*\(|(?:const|let|var)\s+${named[1]}\s*=\s*(?:async\s*)?(?:function\s*[\w$]*\s*)?\()`);
      m = code.match(re);
    }
  }
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = balanced(code, open);
  if (close < 0) return null;
  return { text: code.slice(open + 1, close), index: open + 1, exported: true };
}

/**
 * Static checks on flow.mjs source. Returns [{ level: 'error'|'warn', rule, line, message }].
 * `corpus` is lowercased product-map text; selectors absent from it are warned about.
 */
export function lintFlowSource(source, { api = ctxApi(), corpus = '' } = {}) {
  const issues = [];
  const add = (level, rule, index, message) => issues.push({ level, rule, file: 'flow.mjs', line: index == null ? null : lineAt(source, index), message });
  const code = maskSource(source);
  const text = maskSource(source, { strings: false });
  const known = api.keys;
  const available = Object.keys(known).filter((k) => k !== 'story').join(', ');

  if (!/export\s+default\b/.test(code)) add('error', 'default-export', null, 'flow.mjs has no `export default async function flow(ctx)`');

  const unknown = (key, index, how) => {
    const hint = SUGGEST[key] ? ` — use ${SUGGEST[key]}` : '';
    add('error', 'ctx-unknown', index, `${how} is not part of ctx${hint}. ctx has: ${available}`);
  };
  const checkNested = (owner, alias, scanCode) => {
    const spec = known[owner];
    if (spec?.kind !== 'object') return;
    for (const m of scanCode.matchAll(new RegExp(String.raw`(?<![\w$.])${alias.replace(/\$/g, '\\$')}\s*\.\s*([A-Za-z_$][\w$]*)(\s*\()?`, 'g'))) {
      const member = spec.keys[m[1]];
      if (!member) add('error', 'ctx-unknown', m.index, `${owner}.${m[1]} is not part of ctx.${owner} (has: ${Object.keys(spec.keys).join(', ')})`);
      else if (member.kind === 'getter' && m[2]) add('error', 'ctx-getter', m.index, `${owner}.${m[1]} is a getter — read it without ()`);
    }
  };
  const checkBindings = (bindings, how) => {
    for (const b of bindings) {
      if (!known[b.key]) {
        unknown(b.key, b.index, `${how} \`${b.key}\``);
        continue;
      }
      if (b.nested && known[b.key].kind === 'object') {
        for (const n of b.nested) if (!known[b.key].keys[n]) add('error', 'ctx-unknown', b.index, `${b.key}.${n} is not part of ctx.${b.key}`);
      }
      checkNested(b.key, b.alias, code);
    }
  };

  const param = flowParam(code);
  const ctxNames = [];
  if (param) {
    const p = param.text.trim();
    if (p.startsWith('{')) {
      const lead = param.text.indexOf('{');
      checkBindings(destructured(code, p.slice(1, p.lastIndexOf('}')), param.index + lead + 1), 'destructured');
    } else if (/^[A-Za-z_$][\w$]*/.test(p)) ctxNames.push(p.match(/^[A-Za-z_$][\w$]*/)[0]);
  }
  for (const name of ctxNames) {
    const esc = name.replace(/\$/g, '\\$');
    for (const m of code.matchAll(new RegExp(String.raw`(?:const|let|var)\s*\{`, 'g'))) {
      const open = m.index + m[0].length - 1;
      const close = balanced(code, open);
      if (close < 0) continue;
      if (!new RegExp(String.raw`^\s*=\s*${esc}\b(?!\s*\.)`).test(code.slice(close + 1, close + 1 + name.length + 8))) continue;
      checkBindings(destructured(code, code.slice(open + 1, close), open + 1), 'destructured');
    }
    for (const m of code.matchAll(new RegExp(String.raw`(?<![\w$.])${esc}\s*\.\s*([A-Za-z_$][\w$]*)`, 'g'))) {
      if (!known[m[1]]) unknown(m[1], m.index, `${name}.${m[1]}`);
    }
    for (const owner of Object.keys(known)) {
      if (known[owner].kind === 'object') checkNested(owner, `${name}.${owner}`, code);
    }
  }

  const calls = flowCallMatches(text);
  const chapters = calls.filter((c) => c.kind === 'chapter');
  if (!chapters.length) add('error', 'no-chapters', null, 'flow.mjs has no chapter() call — the journey needs 4–7 chapter() beats');
  for (const c of calls) {
    if (SCAFFOLD_TITLES.has(c.title)) add('error', 'scaffold', c.start, `"${c.title}" is the starter template — replace it with the real journey`);
    const before = code.slice(Math.max(0, c.start - 40), c.start);
    if (!/(await|return|=|\()\s*(?:ctx\s*\.\s*)?$/.test(before)) add('warn', 'not-awaited', c.start, `${c.fn}('${c.title}') is not awaited — cards overlap the next action`);
    if (c.kind === 'chapter' && /^\s*;?\s*await\s+(?:[\w$]+\s*\.\s*)?wait\s*\(/.test(code.slice(c.end, c.end + 60))) {
      add('warn', 'wait-after-chapter', c.end, `wait() right after chapter('${c.title}') adds dead air — the card already holds; act (navigate, settle) instead`);
    }
  }
  const seen = new Map();
  for (const c of chapters) {
    if (seen.has(c.title)) add('warn', 'duplicate-title', c.start, `chapter('${c.title}') appears twice — narration keys collide`);
    seen.set(c.title, true);
  }

  // getByPlaceholder → click → fill hangs when the placeholder clears on focus.
  const placeholderVars = [...text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*?getByPlaceholder\(([^)]*)\)/g)];
  const placeholderArgs = new Set();
  for (const m of text.matchAll(/getByPlaceholder\(([^)]*)\)/g)) {
    if (placeholderArgs.has(m[1])) continue;
    placeholderArgs.add(m[1]);
    const arg = m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const clicked = new RegExp(String.raw`getByPlaceholder\(${arg}\)\s*\.\s*click\(`).test(text);
    const filled = new RegExp(String.raw`getByPlaceholder\(${arg}\)\s*\.\s*(fill|type|pressSequentially)\(`).test(text);
    if (clicked && filled) add('error', 'placeholder-click-fill', m.index, 'getByPlaceholder(…).click() then .fill() hangs once the placeholder clears — use ctx.typeInto(page.locator(\'input[name="…"]\'), value)');
    else if (filled) add('warn', 'placeholder-fill', m.index, 'Fill fields with ctx.typeInto / ctx.fillField instead of getByPlaceholder(…).fill()');
  }
  for (const m of placeholderVars) {
    const v = m[1].replace(/\$/g, '\\$');
    if (new RegExp(String.raw`\b${v}\s*\.\s*click\(`).test(code) && new RegExp(String.raw`\b${v}\s*\.\s*(fill|type|pressSequentially)\(`).test(code)) {
      add('error', 'placeholder-click-fill', m.index, `${m[1]} = getByPlaceholder(…) then click() + fill() hangs once the placeholder clears — use ctx.typeInto(${m[1]}, value) or a name= selector`);
    }
  }

  for (const m of code.matchAll(/\bsetViewportSize\s*\(/g)) {
    add('error', 'viewport', m.index, 'Do not resize the page — the recording size is record.viewport / record.device; read page.viewportSize()');
  }
  for (const m of code.matchAll(FRAME_LITERAL)) {
    add('warn', 'hardcoded-size', m.index, `Hard-coded ${m[1]} — use page.viewportSize() or a locator box; the recording size can change`);
  }
  for (const m of code.matchAll(/\.\s*waitForTimeout\s*\(/g)) {
    add('warn', 'wait-for-timeout', m.index, 'page.waitForTimeout ignores the video pace — use wait(ms) for viewers or sleep(ms) for app timing');
  }
  for (const m of code.matchAll(/\bpage\s*\.\s*goto\s*\(/g)) {
    const close = balanced(text, m.index + m[0].length - 1);
    if (close > 0 && !/waitUntil/.test(text.slice(m.index, close))) {
      add('warn', 'goto-wait', m.index, "page.goto without waitUntil waits for 'load', which analytics can hold forever — pass { waitUntil: 'domcontentloaded' } then settle()");
    }
  }
  for (const m of text.matchAll(/\b(?:typeInto|fillField|fill|type|pressSequentially)\s*\([^;\n]*\benv\s*\.\s*\w*(?:pass|pwd|secret|token)\w*/gi)) {
    add('error', 'credentials', m.index, 'Sign-in stays off camera — the kit signs in before capture; never type credentials inside flow()');
  }

  if (corpus) issues.push(...selectorIssues(source, text, corpus));
  return issues;
}

/* ---------- selectors vs the product map ---------- */

const selectorWords = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\\[bBdDsSwW]/g, ' ')
    .replace(/[\^$\\()?*+.[\]{}]/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2);

function literalAt(text, i) {
  const s = text.slice(i).trimStart();
  const re = s.match(/^\/((?:\\.|\[[^\]]*\]|[^/\\\n])+)\/[a-z]*/);
  if (re) return { value: re[1], regex: true };
  const str = s.match(/^(['"`])((?:\\.|(?!\1)[^\\])*)\1/);
  if (str) return { value: str[2], regex: false };
  return null;
}

/** Selector literals in a flow: [{ method, value, regex, index }]. */
export function flowSelectors(text) {
  const out = [];
  for (const m of text.matchAll(/\b(getByRole|getByLabel|getByText|getByPlaceholder|getByTestId|locator)\s*\(/g)) {
    const at = m.index + m[0].length;
    if (m[1] === 'getByRole') {
      const close = balanced(text, at - 1);
      const inner = close > 0 ? text.slice(at, close) : '';
      const name = inner.match(/\bname\s*:\s*/);
      if (!name) continue;
      const lit = literalAt(inner, name.index + name[0].length);
      if (lit) out.push({ method: m[1], ...lit, index: m.index });
      continue;
    }
    const lit = literalAt(text, at);
    if (!lit) continue;
    if (m[1] === 'locator') {
      const attr = lit.value.match(/\[(?:name|id|data-testid|aria-label|placeholder)\s*=\s*\\?["']?([^"'\]\\]+)/i) || lit.value.match(/^#([\w-]+)$/);
      if (!attr) continue;
      out.push({ method: m[1], value: attr[1], regex: false, index: m.index });
    } else out.push({ method: m[1], ...lit, index: m.index });
  }
  return out;
}

function selectorIssues(source, text, corpus) {
  const have = new Set(corpus.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
  const issues = [];
  for (const sel of flowSelectors(text)) {
    const alternatives = sel.regex ? sel.value.split('|') : [sel.value];
    const matched = alternatives.some((alt) => {
      const words = selectorWords(alt);
      return !words.length || words.every((w) => have.has(w) || corpus.includes(w));
    });
    if (matched) continue;
    const line = lineAt(source, sel.index);
    const lineText = source.split('\n')[line - 1] || '';
    if (/TODO\(verify selector\)/.test(lineText)) continue;
    issues.push({
      level: 'warn',
      rule: 'selector-unmapped',
      file: 'flow.mjs',
      line,
      message: `${sel.method}(${sel.regex ? `/${sel.value}/` : `'${sel.value}'`}) matches nothing in the product map — use a control from flow-analysis.md, or wrap the step in optional()`,
    });
    if (issues.length >= 10) break;
  }
  return issues;
}

/** Lowercased text of everything the explore/analyze/guide steps saw. */
export function productCorpus(dir) {
  const files = ['flow-analysis.json', 'flow-analysis.md', 'explore-journey.md', 'guided-tour.json', 'guided-tour.md'];
  const parts = files.map((f) => join(dir, f)).filter(existsSync).map((p) => readFileSync(p, 'utf8'));
  return parts.join('\n').toLowerCase();
}

/* ---------- module + config checks ---------- */

function syntaxIssue(file, path) {
  const r = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  if (r.status === 0) return null;
  const err = String(r.stderr || '').trim();
  const line = Number(err.match(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)`))?.[1]) || null;
  const message = err.split('\n').find((l) => /Error/.test(l)) || err.split('\n')[0] || 'syntax error';
  const pointer = err.split('\n').slice(1, 4).join('\n');
  return { level: 'error', rule: 'syntax', file, line, message: `${message.trim()}${pointer ? `\n${pointer}` : ''}` };
}

async function importIssue(file, path, check) {
  try {
    const mod = await import(`${pathToFileURL(path).href}?check=${Date.now()}`);
    return check(mod);
  } catch (err) {
    return { level: 'error', rule: 'import', file, line: null, message: `${file} throws when loaded: ${String(err?.message || err).split('\n')[0]}` };
  }
}

const SECRET_KEY = /pass|pwd|secret|token|api.?key/i;

function configIssues(config, baseline) {
  const issues = [];
  const add = (level, rule, message) => issues.push({ level, rule, file: 'video.config.json', line: null, message });
  const url = config.record?.startUrl;
  if (!url) add('error', 'start-url', 'record.startUrl is missing — the recorder cannot open the product');
  else if (!/^https?:\/\/\S+$/.test(String(url))) add('error', 'start-url', `record.startUrl "${url}" is not an http(s) URL`);
  if (!config.brand) add('error', 'brand', 'brand is missing');
  if (!config.title) add('warn', 'title', 'title is empty');
  for (const [key, value] of Object.entries(config.env || {})) {
    if (SECRET_KEY.test(key) && typeof value === 'string' && value && !value.startsWith('$')) {
      add('error', 'env-secret', `env.${key} holds a literal secret — use a "$ENV_VAR" reference`);
    }
  }
  const ids = new Set();
  for (const [i, plate] of (config.interstitials || []).entries()) {
    const label = plate?.id || `interstitials[${i}]`;
    if (!plate?.id) add('error', 'plate-id', `${label} has no id`);
    else if (ids.has(plate.id)) add('error', 'plate-id', `interstitial id "${plate.id}" is used twice`);
    ids.add(plate?.id);
    if (!PLATE_TYPE_SET.has(plate?.type)) add('error', 'plate-type', `${label} has unknown type "${plate?.type}" (types: ${[...PLATE_TYPE_SET].join('|')})`);
    if (!plate?.before) add('error', 'plate-before', `${label} has no "before" chapter title`);
  }
  if (baseline) {
    const now = { viewport: config.record?.viewport || null, device: config.record?.device || null, format: config.output?.format || null };
    for (const key of ['viewport', 'device', 'format']) {
      if (JSON.stringify(now[key]) !== JSON.stringify(baseline[key] ?? null)) {
        add('error', 'recording-size', `${key === 'format' ? 'output.format' : `record.${key}`} changed — the reviewer picks the recording size in Studio; restore ${JSON.stringify(baseline[key] ?? null)}`);
      }
    }
  }
  return issues;
}

/** What the gate pins: the recording size and shape the reviewer chose. */
export function recordingBaseline(config = {}) {
  return { viewport: config.record?.viewport || null, device: config.record?.device || null, format: config.output?.format || null };
}

/**
 * Run the whole gate on a video folder. `video` needs { slug, dir }; files are read fresh.
 * Returns { ok, errors, warnings }.
 */
export async function checkFlow(video, { baseline = null, corpus } = {}) {
  const issues = [];
  const configPath = join(video.dir, 'video.config.json');
  const flowPath = join(video.dir, 'flow.mjs');
  const narrationPath = join(video.dir, 'narration.mjs');

  let config = null;
  if (!existsSync(configPath)) issues.push({ level: 'error', rule: 'config', file: 'video.config.json', line: null, message: 'video.config.json is missing' });
  else {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8'));
      issues.push(...configIssues(config, baseline));
    } catch (err) {
      issues.push({ level: 'error', rule: 'config', file: 'video.config.json', line: null, message: `video.config.json is not valid JSON: ${err.message}` });
    }
  }

  let flowLoads = false;
  if (!existsSync(flowPath)) issues.push({ level: 'error', rule: 'flow', file: 'flow.mjs', line: null, message: 'flow.mjs is missing' });
  else {
    const source = readFileSync(flowPath, 'utf8');
    const syntax = syntaxIssue('flow.mjs', flowPath);
    if (syntax) issues.push(syntax);
    else {
      const loaded = await importIssue('flow.mjs', flowPath, (mod) =>
        typeof mod.default === 'function'
          ? null
          : { level: 'error', rule: 'default-export', file: 'flow.mjs', line: null, message: 'flow.mjs must `export default async function flow(ctx)`' }
      );
      if (loaded) issues.push(loaded);
      else flowLoads = true;
    }
    issues.push(...lintFlowSource(source, { corpus: corpus ?? productCorpus(video.dir) }).filter((i) => !(syntax && i.rule === 'default-export')));
  }

  let narrationLoads = !existsSync(narrationPath);
  if (!existsSync(narrationPath)) issues.push({ level: 'warn', rule: 'narration', file: 'narration.mjs', line: null, message: 'narration.mjs is missing — the video will have no voice' });
  else {
    const syntax = syntaxIssue('narration.mjs', narrationPath);
    if (syntax) issues.push(syntax);
    else {
      const loaded = await importIssue('narration.mjs', narrationPath, (mod) => {
        const n = mod.default;
        if (!n || typeof n !== 'object') return { level: 'error', rule: 'default-export', file: 'narration.mjs', line: null, message: 'narration.mjs must `export default { intro, outro, plates: {…}, lines: {…} }`' };
        if (n.lines != null && typeof n.lines !== 'object') return { level: 'error', rule: 'narration-shape', file: 'narration.mjs', line: null, message: 'narration.lines must be an object keyed by chapter()/say() title' };
        return null;
      });
      if (loaded) issues.push(loaded);
      else narrationLoads = true;
    }
  }

  if (config && flowLoads && narrationLoads) {
    try {
      const script = await buildScript({ ...video, config });
      for (const l of script.lint) {
        if (l.key === 'flow') continue;
        if (l.qc) {
          if (l.qc !== 'low') issues.push({ level: l.qc === 'high' ? 'error' : 'warn', rule: 'narration-repeat', file: 'narration.mjs', line: null, message: `${l.key}: ${l.message}` });
          continue;
        }
        const narrationKey = /^Narration "/.test(l.message) || (/^No narration/.test(l.message) && /^chapter:/.test(l.key || ''));
        if (l.level !== 'error' && !narrationKey) continue;
        const message = narrationKey && /^No narration/.test(l.message) ? 'has no narration.mjs line with this exact key' : l.message;
        issues.push({ level: l.level === 'error' ? 'error' : 'warn', rule: 'script', file: narrationKey ? 'narration.mjs' : l.key?.startsWith('plate:') ? 'video.config.json' : 'flow.mjs', line: null, message: `${l.key}: ${message}` });
      }
    } catch (err) {
      issues.push({ level: 'warn', rule: 'script', file: 'flow.mjs', line: null, message: `could not read the script: ${err.message}` });
    }
  }

  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level !== 'error');
  return { ok: errors.length === 0, errors, warnings };
}

export function formatIssue(i) {
  return `${i.level === 'error' ? '✗' : '⚠'} ${i.file}${i.line ? `:${i.line}` : ''} · ${i.message}`;
}

export function formatFlowCheck(result, { maxWarnings = 12 } = {}) {
  const lines = [...result.errors.map(formatIssue), ...result.warnings.slice(0, maxWarnings).map(formatIssue)];
  if (result.warnings.length > maxWarnings) lines.push(`⚠ … ${result.warnings.length - maxWarnings} more warning(s)`);
  return lines.join('\n');
}

export function flowRepairLimit(env = process.env) {
  const value = Number.parseInt(env?.WALKTHROUGH_DRAFT_REPAIRS, 10);
  if (!Number.isFinite(value)) return DEFAULT_REPAIRS;
  return Math.max(0, Math.min(MAX_REPAIRS, value));
}

/** After a check: settle, or send the agent back (bounded). */
export function flowGateDecision({ ok, round = 0, max = DEFAULT_REPAIRS } = {}) {
  if (ok) return { action: 'done', round };
  if (round >= max) return { action: 'fail', reason: 'exhausted', round };
  return { action: 'repair', round: round + 1, remaining: max - round - 1 };
}

export function checkFlowCommand(kitDir, slug) {
  return `node ${join(kitDir, 'cli.mjs')} check-flow ${slug}`;
}

/** Prompt block: the exact ctx contract, a known-good skeleton and the self-check command. */
export function flowContractBlock({ kitDir, slug, api = ctxApi() } = {}) {
  return `flow.mjs contract (generated from the recorder — these are the ONLY ctx members; anything else throws):
${ctxContract(api)}
Known-good shape:
\`\`\`js
${FLOW_SKELETON}
\`\`\`
Defensive rules: after every navigation settle(<a locator on the new screen>) before acting; fill fields with typeInto/fillField (never getByPlaceholder→click→fill); never resize the page or hard-code frame sizes (${DELIVERY.width}/${DELIVERY.height}) — use page.viewportSize(); wrap anything the story does not depend on (cookie banners, tips, guessed selectors) in optional('label', async () => …) so a miss logs a warning instead of killing the take; story steps stay unguarded so a real break still fails loudly. Every chapter()/say() title must have a narration.mjs line with the same key, and every interstitials[].before must name a chapter title.
Before you finish, run \`${checkFlowCommand(kitDir, slug)}\` and fix every ✗ until it prints ✓ — Studio runs the same check and sends the draft back when it fails.`;
}

export function flowRepairPrompt({ video, result, round, max, skillPath, kitDir }) {
  const flow = join(video.dir, 'flow.mjs');
  const narration = join(video.dir, 'narration.mjs');
  const config = join(video.dir, 'video.config.json');
  const analysis = join(video.dir, 'flow-analysis.md');
  return `DRAFT CHECK FAILED for "${video.slug}" (repair ${round}/${max}). The script you just wrote would not record, or its narration repeats itself. Fix exactly these problems, then stop:
${formatFlowCheck(result)}

Read ${flow}, ${narration}, ${config}${existsSync(analysis) ? ` and ${analysis}` : ''}; ${skillPath}/authoring.md has the flow rules.
Make the smallest change that clears every ✗ (⚠ lines are worth fixing when it is cheap). A repeated narration line or phrase is fixed by rewriting one of the lines in narration.mjs to make a new point — never by deleting the line or its key. Keep the journey, titles and copy unless a ✗ is about them; when a chapter()/say() title changes, rename its narration.mjs key and any interstitials[].before to match. Do not change record.viewport, record.device or output.format. Do not record or render.

${flowContractBlock({ kitDir, slug: video.slug })}`;
}

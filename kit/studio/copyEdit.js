/**
 * Plate copy as a flat run of characters, each with an accent flag.
 *
 * Config copy is plain text where `*word*` marks an accent. The Editor shows the field with the
 * plate's own CSS (gradient accents, line blocks) and lets the user type into it, so the same
 * text has three shapes here:
 *
 *   source  "Plan the *week*"                      what the config stores
 *   chars   [{ch:'P',accent:false} … {ch:'k',accent:true}]   what this module reasons about
 *   html    Plan the <span class="accent">week</span>        what the contenteditable shows
 *
 * `\n` separates lines for `lines` fields (open and close titles). Accents never cross a line.
 * Runs in the browser (Studio) and under node (tests); no DOM access outside `fromElement`
 * and `positionAt`, which take the element in.
 */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const isSpace = (ch) => ch !== '\n' && /\s/.test(ch);

/** Source text → chars. `*x*` pairs inside a line toggle the accent; a lone `*` stays literal. */
export function parseSource(source) {
  const out = [];
  String(source ?? '')
    .split('\n')
    .forEach((line, li) => {
      if (li) out.push({ ch: '\n', accent: false });
      const re = /\*([^*\n]+)\*/g;
      let last = 0;
      let m;
      while ((m = re.exec(line))) {
        for (const ch of line.slice(last, m.index)) out.push({ ch, accent: false });
        for (const ch of m[1]) out.push({ ch, accent: true });
        last = m.index + m[0].length;
      }
      for (const ch of line.slice(last)) out.push({ ch, accent: false });
    });
  return out;
}

/**
 * Whitespace takes the accent only when both neighbours on its line carry it, so a run never
 * opens or closes on a space (`* word*` → ` *word*`) and two accented words with a space between
 * stay one run.
 */
export function normalizeAccents(chars) {
  const solid = (i, step) => {
    for (let k = i + step; k >= 0 && k < chars.length; k += step) {
      if (chars[k].ch === '\n') return null;
      if (!isSpace(chars[k].ch)) return chars[k];
    }
    return null;
  };
  return chars.map((c, i) => {
    if (c.ch === '\n') return { ch: c.ch, accent: false };
    if (!isSpace(c.ch)) return c;
    return { ch: c.ch, accent: Boolean(solid(i, -1)?.accent && solid(i, 1)?.accent) };
  });
}

/** Chars → source text with `*…*` around accent runs. */
export function toSource(chars) {
  let s = '';
  let on = false;
  for (const c of normalizeAccents(chars)) {
    const accent = c.accent && c.ch !== '\n';
    if (accent !== on) {
      s += '*';
      on = accent;
    }
    s += c.ch;
  }
  if (on) s += '*';
  return s;
}

/**
 * Chars → the markup the contenteditable shows.
 *   tag    'span' → <span class="accent">, 'b' → <b> (the open sub paints accents with <b>)
 *   lines  one <div> per line (an empty line keeps its height with <br>)
 *   sep    wrap `·` in <span class="sep"> so the open sub keeps its beat colour
 */
export function toHtml(chars, { tag = 'span', lines = false, sep = false } = {}) {
  const open = tag === 'b' ? '<b>' : '<span class="accent">';
  const close = tag === 'b' ? '</b>' : '</span>';
  const line = (run) => {
    let html = '';
    let on = false;
    for (const c of run) {
      if (c.accent !== on) {
        html += c.accent ? open : close;
        on = c.accent;
      }
      html += sep && c.ch === '·' ? '<span class="sep">·</span>' : esc(c.ch);
    }
    if (on) html += close;
    return html;
  };
  const runs = [];
  let cur = [];
  for (const c of normalizeAccents(chars)) {
    if (c.ch === '\n') {
      runs.push(cur);
      cur = [];
    } else cur.push(c);
  }
  runs.push(cur);
  if (!lines) return runs.map(line).join(' ');
  return runs.map((run) => `<div>${run.length ? line(run) : '<br>'}</div>`).join('');
}

/**
 * Contenteditable → chars. Text inside <b> or .accent carries the accent; block children and
 * <br> become `\n`. `marks` are DOM positions ([node, offset], as in a Range) and come back as
 * char offsets in the same order, so a selection survives a re-render.
 */
export function fromElement(el, { isBlock = null, marks = [] } = {}) {
  const chars = [];
  const offsets = marks.map(() => null);
  const block = (n) => (isBlock ? isBlock(n) : n.tagName === 'DIV' || n.tagName === 'P');
  const breakLine = () => {
    if (chars.length && chars.at(-1).ch !== '\n') chars.push({ ch: '\n', accent: false });
  };
  const mark = (node, offset) => {
    marks.forEach(([n, o], i) => {
      if (offsets[i] == null && n === node && o === offset) offsets[i] = chars.length;
    });
  };
  const walk = (node, accent) => {
    if (node.nodeType === 3) {
      const text = node.nodeValue.replace(/\u00a0/g, ' ');
      for (let k = 0; k < text.length; k++) {
        mark(node, k);
        chars.push({ ch: text[k], accent });
      }
      mark(node, text.length);
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.tagName === 'BR') {
      chars.push({ ch: '\n', accent: false });
      return;
    }
    const on = accent || node.tagName === 'B' || node.classList.contains('accent');
    const isBlk = node !== el && block(node);
    if (isBlk) breakLine();
    const kids = [...node.childNodes];
    kids.forEach((kid, i) => {
      mark(node, i);
      walk(kid, on);
    });
    mark(node, kids.length);
    if (isBlk) breakLine();
  };
  walk(el, false);
  // A mark past the end (or on a node we did not walk) lands at the end.
  const total = chars.length;
  while (chars.length && chars.at(-1).ch === '\n') chars.pop();
  while (chars.length && chars[0].ch === '\n') {
    chars.shift();
    for (let i = 0; i < offsets.length; i++) if (offsets[i] != null && offsets[i] > 0) offsets[i] -= 1;
  }
  return { chars, offsets: offsets.map((o) => Math.min(o ?? total, chars.length)) };
}

/** DOM position (as a Range boundary) for a char offset, walking the element like fromElement. */
export function positionAt(el, offset, { isBlock = null } = {}) {
  const block = (n) => (isBlock ? isBlock(n) : n.tagName === 'DIV' || n.tagName === 'P');
  let count = 0;
  let lastText = null;
  let started = false; // fromElement drops breaks before the first character
  let lastWasBreak = false;
  let found = null;
  const lineBreak = (always) => {
    if (started && (always || !lastWasBreak)) count += 1;
    lastWasBreak = true;
  };
  const walk = (node) => {
    if (found) return;
    if (node.nodeType === 3) {
      const len = node.nodeValue.length;
      if (offset <= count + len) {
        found = { node, offset: Math.max(0, offset - count) };
        return;
      }
      count += len;
      if (len) {
        started = true;
        lastWasBreak = false;
      }
      lastText = node;
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.tagName === 'BR') {
      lineBreak(true);
      return;
    }
    const isBlk = node !== el && block(node);
    if (isBlk) lineBreak(false);
    for (const kid of node.childNodes) walk(kid);
    if (found) return;
    if (isBlk) lineBreak(false);
  };
  walk(el);
  if (found) return found;
  if (lastText) return { node: lastText, offset: lastText.nodeValue.length };
  return { node: el, offset: el.childNodes.length };
}

/** 'on' | 'off' | 'mixed' for the solid chars in [start, end); a caret reads its word. */
export function accentState(chars, start, end) {
  const [a, b] = start === end ? wordAt(chars, start) : [start, end];
  const solid = chars.slice(a, b).filter((c) => !isSpace(c.ch) && c.ch !== '\n');
  if (!solid.length) return 'off';
  const on = solid.filter((c) => c.accent).length;
  return on === solid.length ? 'on' : on === 0 ? 'off' : 'mixed';
}

/** Word boundaries around a caret offset (whitespace and line breaks end a word). */
export function wordAt(chars, at) {
  const solid = (c) => c && !isSpace(c.ch) && c.ch !== '\n';
  let a = Math.max(0, Math.min(at, chars.length));
  let b = a;
  while (a > 0 && solid(chars[a - 1])) a -= 1;
  while (b < chars.length && solid(chars[b])) b += 1;
  return [a, b];
}

/**
 * Flip the accent on a selection. All accented → off; otherwise on. A caret toggles its word.
 * Returns the new chars and the range it touched, or null when there is nothing solid to mark.
 */
export function toggleAccent(chars, start, end) {
  const [a, b] = start === end ? wordAt(chars, start) : [Math.min(start, end), Math.max(start, end)];
  const inRange = chars.slice(a, b);
  if (!inRange.some((c) => !isSpace(c.ch) && c.ch !== '\n')) return null;
  const on = accentState(chars, a, b) !== 'on';
  const next = chars.map((c, i) => (i >= a && i < b && c.ch !== '\n' ? { ch: c.ch, accent: on } : c));
  return { chars: normalizeAccents(next), start: a, end: b };
}

/**
 * Source as the config stores it for a field kind: `lines` keeps one line per row and drops
 * blank rows, everything else is one line of collapsed whitespace. `beats` fields (the open
 * sub) space their `·` separators the way openSub splits them.
 */
export function fieldSource(chars, { kind = 'text', beats = false } = {}) {
  let s = toSource(chars);
  if (kind === 'lines') {
    s = s
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
  } else {
    s = s.replace(/\s+/g, ' ').trim();
  }
  if (beats) s = s.replace(/\s*·\s*/g, ' · ').trim();
  return s;
}

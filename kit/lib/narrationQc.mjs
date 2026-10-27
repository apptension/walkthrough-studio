/**
 * Narration repetition check — the whole script read in spoken order, not one line at a time.
 *
 * Per-line lint (length, "click" wording, missing keys) passes a script whose lines repeat each
 * other: two chapters saying the same sentence, a phrase coming back three times, a line that
 * just reads its on-screen title aloud. Heard back to back in the voiceover, those are the
 * repeats a viewer notices first. Every consumer (script lint, the draft gate, the narration
 * gate after an agent edit, the critic, the voice step) reads the same findings from here.
 */

const STOP = new Set(
  (
    'a an the and or but so if then than that this these those it its it’s it\'s is are was were be been being ' +
    'to of in on at by for with from into onto over under up down out off as about after before ' +
    'you your you’re you\'re you’ll you\'ll we our us they their them he she his her i me my ' +
    'what which who whom where when why how there here all any each every both few more most some such ' +
    'no not only own same too very can will just do does did done have has had get gets got ' +
    'one two three now also again still yet even ever'
  ).split(/\s+/)
);

/** Intro and outro are meant to echo each other; a short shared phrase there is the loop closing. */
const ECHO_PAIR = new Set(['intro|outro', 'outro|intro']);

const spokenText = (s) =>
  String(s || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\*/g, '')
    .replace(/\.{3}|…/g, ' ');

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;

export function tokens(s) {
  // Stopword check must use the written form — stemming "this"→"thi" / "does"→"doe"
  // would leak common words into content sets and inflate near-dupes.
  return (spokenText(s).toLowerCase().match(WORD) || []).map((w) => (STOP.has(w) ? w : stem(w)));
}

/** The words as written, aligned with `tokens`, so a finding quotes what was actually said. */
const rawWords = (s) => spokenText(s).match(WORD) || [];

function stem(w) {
  let t = w.replace(/['’]s$/, '');
  if (t.length > 4 && t.endsWith('ies')) t = `${t.slice(0, -3)}y`;
  else if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
  return t;
}

const isContent = (w) => w.length >= 3 && !STOP.has(w);

function contentSet(toks) {
  return new Set(toks.filter(isContent));
}

/** Longest run of identical tokens shared by two lines. */
function longestRun(a, b) {
  let best = { len: 0, at: 0 };
  const row = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prev + 1 : 0;
      if (row[j] > best.len) best = { len: row[j], at: i - row[j] };
      prev = tmp;
    }
  }
  return a.slice(best.at, best.at + best.len);
}

/** Trim stopwords off both ends so "the thread then" reports as "thread". */
function trimRun(run) {
  let s = 0;
  let e = run.length;
  while (s < e && !isContent(run[s])) s += 1;
  while (e > s && !isContent(run[e - 1])) e -= 1;
  return run.slice(s, e);
}

const runAt = (toks, run) => {
  outer: for (let i = 0; i + run.length <= toks.length; i++) {
    for (let k = 0; k < run.length; k++) if (toks[i + k] !== run[k]) continue outer;
    return i;
  }
  return -1;
};
const containsRun = (toks, run) => runAt(toks, run) >= 0;

const said = (line, run) => {
  const at = runAt(line.toks, run);
  return at < 0 ? run.join(' ') : line.raw.slice(at, at + run.length).join(' ');
};

const quote = (s, n = 60) => {
  const t = spokenText(s).replace(/\s+/g, ' ').trim();
  return `“${t.length > n ? `${t.slice(0, n - 1)}…` : t}”`;
};

/**
 * @param {{ key: string, text: string, kind?: string, title?: string, onScreen?: string }[]} lines
 *   spoken lines in delivery order (intro first, outro last)
 * @returns {{ rule: string, severity: 'high'|'medium'|'low', key: string, keys: string[], message: string, phrase?: string }[]}
 */
export function narrationRepeats(lines = []) {
  const spoken = lines
    .filter((l) => l && spokenText(l.text).trim())
    .map((l) => ({ ...l, toks: tokens(l.text), raw: rawWords(l.text) }))
    .map((l) => ({ ...l, content: contentSet(l.toks) }));
  // Chapter and caption titles name the product's own screens; saying one twice is not a repeat.
  const titles = lines.map((l) => tokens(l?.title)).filter((t) => t.length);
  const isUiName = (run) => titles.some((t) => containsRun(t, run));
  const findings = [];
  const pairKey = (a, b) => `${a.kind || ''}|${b.kind || ''}`;

  // 1. Two lines that say the same thing.
  const nearDup = new Set();
  for (let i = 0; i < spoken.length; i++) {
    for (let j = i + 1; j < spoken.length; j++) {
      const a = spoken[i];
      const b = spoken[j];
      if (ECHO_PAIR.has(pairKey(a, b))) continue;
      const shared = [...a.content].filter((w) => b.content.has(w));
      const union = new Set([...a.content, ...b.content]).size;
      const score = union ? shared.length / union : 0;
      if (shared.length < 3 || score < 0.45) continue;
      nearDup.add(`${i}|${j}`);
      findings.push({
        rule: 'near-duplicate',
        severity: score >= 0.6 ? 'high' : 'medium',
        key: b.key,
        keys: [a.key, b.key],
        message: `Says the same as "${a.key}" (${Math.round(score * 100)}% of the words) — ${quote(a.text)} / ${quote(b.text)}. Give one of them a new point.`,
      });
    }
  }

  // 2. A phrase that comes back. Longest shared run per pair, then grouped by phrase.
  const phrases = new Map();
  for (let i = 0; i < spoken.length; i++) {
    for (let j = i + 1; j < spoken.length; j++) {
      if (nearDup.has(`${i}|${j}`)) continue;
      const a = spoken[i];
      const b = spoken[j];
      const run = trimRun(longestRun(a.toks, b.toks));
      const content = run.filter(isContent).length;
      if (run.length < 2 || content < 2) continue;
      if (ECHO_PAIR.has(pairKey(a, b)) && run.length < 4) continue;
      const phrase = run.join(' ');
      if (!phrases.has(phrase)) phrases.set(phrase, run);
    }
  }
  const reported = [];
  for (const [phrase, run] of [...phrases].sort((x, y) => y[1].length - x[1].length)) {
    const where = spoken.filter((l) => containsRun(l.toks, run));
    if (where.length < 2) continue;
    if (reported.some((r) => r.phrase.includes(phrase) && where.every((l) => r.keys.includes(l.key)))) continue;
    if (isUiName(run)) continue;
    // Two words in two lines is a product noun ("front page"), not a repeat worth a rewrite.
    if (run.length === 2 && where.length < 3) continue;
    const severity =
      run.length >= 5 || (run.length >= 3 && where.length >= 3) ? 'high' : run.length >= 3 || where.length >= 4 ? 'medium' : 'low';
    const keys = where.map((l) => l.key);
    const text = said(where[0], run);
    reported.push({ phrase, keys });
    findings.push({
      rule: 'repeated-phrase',
      severity,
      key: keys[keys.length - 1],
      keys,
      phrase: text,
      message: `“${text}” is said ${where.length}× (${keys.map((k) => `"${k}"`).join(', ')}). Keep it once; say something new in the others.`,
    });
  }

  // 3. A line that reads the screen aloud, or starts like a fragment of its title.
  for (const l of spoken) {
    const screen = tokens(l.onScreen);
    if (screen.length >= 4) {
      const run = trimRun(longestRun(l.toks, screen));
      if (run.length >= 4 && run.filter(isContent).length >= 2) {
        const text = said(l, run);
        findings.push({
          rule: 'reads-screen',
          severity: 'medium',
          key: l.key,
          keys: [l.key],
          phrase: text,
          message: `Reads the on-screen text aloud (“${text}”). The caption already says it — the voice should add the why.`,
        });
      }
    }
    const first = spokenText(l.text).trim().match(/^[\p{L}][\p{L}\p{N}'’-]*/u)?.[0] || '';
    if (first && first[0] !== first[0].toUpperCase() && first === first.toLowerCase()) {
      findings.push({
        rule: 'lowercase-start',
        severity: 'low',
        key: l.key,
        keys: [l.key],
        message: `Starts lowercase (“${first}…”) — reads as a fragment of the title rather than its own sentence.`,
      });
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Spoken lines in delivery order from buildScript scenes. */
export function scriptSpokenLines(scenes = []) {
  return scenes
    .filter((s) => s.narration)
    .map((s) => ({
      key: s.narrationKind === 'plate' ? `plate:${s.narrationKey}` : s.narrationKey,
      sceneKey: s.key,
      kind: s.narrationKind,
      text: s.narration,
      title: s.title,
      onScreen: s.kind === 'chapter' || s.kind === 'say' ? s.onScreen : '',
    }));
}

/** Plain-text block for an agent prompt. */
export function formatRepeats(findings) {
  return findings.map((f) => `${f.severity === 'high' ? '✗' : '⚠'} ${f.message}`).join('\n');
}

/**
 * Draft rhythm: is the first draft crafted, or plain? Reads `flow.mjs` the way the recorder will run
 * it (chapter / say cards, waits, actions, ctx.zoom / magnify / follow accents) and estimates where
 * each beat lands in live time, then checks the rhythm:
 *
 *   - one camera accent (zoom, magnifier or guided lens) every `accentEverySec` of live time —
 *     closer than `minGapSec` reads as chaos, a gap past 1.6× the beat reads as a static screen
 *   - the accents mix kinds (a run of the same move is monotone)
 *   - captions keep the voice and the screen in step (no chapter runs long without a say())
 *   - proof-plate joins vary (one fixed transition everywhere is flagged)
 *   - plates never repeat a layout family back to back
 *
 * `enrichDraft` applies the config-side defaults a plain draft is missing (auto zoom strength, the
 * variety pick, varied joins); flow changes stay suggestions with a line number, because the flow is
 * the agent's and the reviewer's to edit.
 */
import { applyVariety, layoutFamily, TRANSITION_PALETTES } from './variety.mjs';
import { layoutGuide, resolveLayout } from './plateLayouts.mjs';

/** The rhythm by energy: seconds of live time between camera accents, and the floor between two. */
export const RHYTHM = Object.freeze({
  calm: { accentEverySec: 18, minGapSec: 6, captionEverySec: 14 },
  clear: { accentEverySec: 14, minGapSec: 5, captionEverySec: 12 },
  punchy: { accentEverySec: 10, minGapSec: 4, captionEverySec: 10 },
});

/** Steady-pace time a call costs when its source gives no number (ms). */
const DEFAULT_MS = {
  chapter: 2800,
  say: 2400,
  zoom: 2200,
  magnify: 2400,
  follow: 1400,
  focus: 1400,
  frame: 900,
  action: 900,
  goto: 1500,
};

const CALL_RE =
  /(?<![\w$])(?:ctx\.)?(chapter|say|wait|zoom|magnify|follow|focus|frame|goto)\s*\(|\.(click|dblclick|fill|check|selectOption|hover|press|pressSequentially|dragTo|typeInto|fillField)\s*\(/g;

/** Text between the parenthesis at `open` and its match (strings and template literals skipped). */
function callArgs(src, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

/** Top-level comma split (keeps nested calls, objects and strings whole). */
function splitArgs(text) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (text.slice(start).trim()) out.push(text.slice(start).trim());
  return out;
}

const num = (s) => (/^\d[\d_]*$/.test(String(s || '').trim()) ? Number(String(s).replace(/_/g, '')) : null);
const holdOf = (args) => {
  const m = args.match(/holdMs\s*:\s*(\d[\d_]*)/);
  return m ? Number(m[1].replace(/_/g, '')) : null;
};
const firstString = (s) => s?.match(/^(['"`])([\s\S]*?)\1$/)?.[2] ?? null;
const lineAt = (src, i) => src.slice(0, i).split('\n').length;

/** Strip line and block comments so commented-out calls do not count. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

/**
 * Beats of a flow source in order: `{ kind, t, ms, line, title? }` with `t` the estimated start in
 * steady-pace seconds. Accents are `zoom`, `magnify` and `follow`.
 */
export function scanFlow(source = '') {
  const src = stripComments(String(source));
  const beats = [];
  let t = 0;
  let prevEnd = 0;
  CALL_RE.lastIndex = 0;
  for (let m; (m = CALL_RE.exec(src)); ) {
    const kind = m[1] || 'action';
    const args = callArgs(src, m.index + m[0].length - 1);
    // An `else` branch replaces the beat before it: it neither adds time nor crowds it.
    const alt = /\}\s*else\b/.test(src.slice(prevEnd, m.index));
    prevEnd = m.index + m[0].length + args.length;
    const parts = splitArgs(args);
    let ms;
    if (kind === 'wait') ms = num(parts[0]) ?? 1000;
    else if (kind === 'chapter' || kind === 'say') ms = num(parts[2]) ?? DEFAULT_MS[kind];
    else if (kind === 'follow') {
      const targets = (args.match(/^\s*\[([\s\S]*?)\]/)?.[1] || '').split(',').filter((x) => x.trim()).length || 2;
      ms = holdOf(args) ?? DEFAULT_MS.follow * targets + 520 * (targets - 1);
    } else if (kind === 'zoom' || kind === 'magnify' || kind === 'focus') ms = holdOf(args) ?? num(parts[1]) ?? DEFAULT_MS[kind];
    else ms = DEFAULT_MS[kind] ?? DEFAULT_MS.action;
    const beat = { kind, t: Math.round(t * 10) / 10, ms, line: lineAt(src, m.index) };
    if (kind === 'chapter' || kind === 'say') beat.title = firstString(parts[0]);
    if (alt) beat.alt = true;
    beats.push(beat);
    if (!alt) t += ms / 1000;
  }
  return { beats, liveSec: Math.round(t * 10) / 10 };
}

const ACCENTS = new Set(['zoom', 'magnify', 'follow']);

function chapterAt(beats, t) {
  let title = null;
  for (const b of beats) {
    if (b.t > t) break;
    if (b.kind === 'chapter') title = b.title;
  }
  return title;
}

function energyOf(config = {}, brand = {}) {
  const e = config.direction?.motion?.energy || brand?.motion?.energy;
  return RHYTHM[e] ? e : 'clear';
}

/**
 * Rhythm findings for a draft: `{ liveSec, energy, rhythm, accents, findings, stats }`.
 * Findings are `{ id, severity: 'warn'|'info', message, fix, line? }`.
 */
export function analyzeRhythm({ flowSource = '', config = {}, brand = {} } = {}) {
  const energy = energyOf(config, brand);
  const rhythm = RHYTHM[energy];
  const { beats, liveSec } = scanFlow(flowSource);
  const accents = beats.filter((b) => ACCENTS.has(b.kind) && !b.alt);
  const chapters = beats.filter((b) => b.kind === 'chapter');
  const captions = beats.filter((b) => b.kind === 'say');
  const findings = [];
  const add = (f) => findings.push(f);
  const zoomLevel = config.direction?.camera?.zoom;

  if (!beats.length) {
    add({ id: 'no-flow', severity: 'info', message: 'No flow beats found yet.', fix: 'Write flow.mjs with chapter()/say() beats first.' });
    return { liveSec, energy, rhythm, accents, findings, stats: { chapters: 0, captions: 0, zooms: 0, lenses: 0 } };
  }

  // Gaps: start of live → first accent, between accents, last accent → end.
  const marks = [0, ...accents.map((a) => a.t), liveSec];
  const limit = rhythm.accentEverySec * 1.6;
  for (let i = 1; i < marks.length; i++) {
    const from = marks[i - 1];
    const to = marks[i];
    if (to - from <= limit) continue;
    const mid = from + rhythm.accentEverySec;
    const near = beats.find((b) => b.t >= mid && (b.kind === 'action' || b.kind === 'say')) || beats.find((b) => b.t >= from);
    const chapter = chapterAt(beats, mid);
    add({
      id: 'accent-gap',
      severity: 'warn',
      message: `${Math.round(to - from)} s of live time without a camera accent (${from.toFixed(0)}–${to.toFixed(0)} s${chapter ? `, in “${chapter}”` : ''}).`,
      fix: `Add ctx.zoom(<payoff locator>, { holdMs: 2200 }) or ctx.magnify(<value locator>) near line ${near?.line ?? '?'} — one accent every ~${rhythm.accentEverySec} s at ${energy} energy.`,
      line: near?.line,
    });
  }
  for (let i = 1; i < accents.length; i++) {
    const gap = accents[i].t - (accents[i - 1].t + accents[i - 1].ms / 1000);
    if (gap < rhythm.minGapSec) {
      add({
        id: 'accent-crowded',
        severity: 'warn',
        message: `Two camera accents ${Math.max(0, gap).toFixed(1)} s apart (lines ${accents[i - 1].line} and ${accents[i].line}) — reads as chaotic.`,
        fix: `Keep ≥ ${rhythm.minGapSec} s between accents; merge related targets into one ctx.follow([...]).`,
        line: accents[i].line,
      });
    }
  }
  const kinds = new Set(accents.map((a) => a.kind));
  if (accents.length >= 3 && kinds.size === 1) {
    add({
      id: 'accent-monotone',
      severity: 'info',
      message: `Every accent is a ${[...kinds][0]} — the camera repeats one move.`,
      fix: 'Mix the moves: a push-in (ctx.zoom) on a region, a magnifier (ctx.magnify) on one value, a guided lens (ctx.follow) across related controls.',
    });
  }
  if (liveSec > 30 && !accents.some((a) => a.kind === 'magnify' || a.kind === 'follow')) {
    add({
      id: 'no-lens',
      severity: 'warn',
      message: 'No magnifier in the draft — the payoff numbers and labels stay small on screen.',
      fix: 'Add one ctx.magnify(<value locator>, { label }) on the strongest payoff, or ctx.follow([...]) across 2–4 related controls.',
    });
  }
  if (!accents.some((a) => a.kind === 'zoom') && (zoomLevel == null || zoomLevel === 'off')) {
    add({
      id: 'no-zoom',
      severity: zoomLevel === 'off' ? 'info' : 'warn',
      message: zoomLevel === 'off' ? 'Auto zoom is off and the flow authors no push-in.' : 'No authored push-in and no auto zoom strength set.',
      fix: 'Set direction.camera.zoom subtle|bold (auto push-ins on clicks) or add ctx.zoom(<region>) on a payoff without a click.',
    });
  }

  // Captions: a chapter that runs long on silence-of-screen.
  for (let i = 0; i < chapters.length; i++) {
    const from = chapters[i].t;
    const to = chapters[i + 1]?.t ?? liveSec;
    const says = captions.filter((c) => c.t >= from && c.t < to).length;
    if (to - from > rhythm.captionEverySec * 1.8 && says < Math.floor((to - from) / (rhythm.captionEverySec * 1.8))) {
      add({
        id: 'caption-sparse',
        severity: 'info',
        message: `“${chapters[i].title || `chapter ${i + 1}`}” runs ${Math.round(to - from)} s with ${says} caption(s).`,
        fix: `Add a say(title, body) before the key action — about one every ${rhythm.captionEverySec} s keeps voice and screen in step.`,
        line: chapters[i].line,
      });
    }
  }

  // Transitions: proof-plate joins.
  const plates = config.interstitials || [];
  const style = config.transitions?.style || 'directed';
  const pinned = Object.keys(config.edit?.transitions || {}).filter((k) => k.startsWith('live>'));
  if (plates.length >= 2 && !pinned.length) {
    add({
      id: 'transition-monotone',
      severity: 'info',
      message: style === 'directed'
        ? `Every live → plate join uses the directed brand wipe (${plates.length} plates).`
        : `Every join uses ${style}.`,
      fix: `Pin varied joins from the ${energy} palette (${TRANSITION_PALETTES[energy].join(', ')}) — \`rhythm --apply\` or the Editor join markers.`,
    });
  }

  // Layout repeats across the plate sequence.
  let prev = config.open ? layoutFamily('open', resolveLayout('open', config.open.layout)) : null;
  for (const it of plates) {
    const fam = resolveLayout(it.type, it.layout) ? layoutFamily(it.type, resolveLayout(it.type, it.layout)) : `type:${it.type}`;
    if (fam === prev) {
      add({ id: 'layout-repeat', severity: 'warn', message: `Plate “${it.id}” repeats the composition before it (${fam}).`, fix: 'Pick another layout or type for one of them.' });
    }
    prev = fam;
  }

  return {
    liveSec,
    energy,
    rhythm,
    accents,
    findings,
    stats: {
      chapters: chapters.length,
      captions: captions.length,
      zooms: accents.filter((a) => a.kind === 'zoom').length,
      lenses: accents.filter((a) => a.kind !== 'zoom').length,
    },
  };
}

/**
 * Enrich a plain draft's config: the variety pick for every open choice, auto zoom strength when the
 * draft never set one, and varied proof-plate joins. Returns `{ config, applied, report }`.
 */
export function enrichDraft(config = {}, { slug = '', brand = {}, flowSource = '' } = {}) {
  const { config: varied, applied, pick } = applyVariety(config, { slug, brand });
  const next = varied;
  const direction = (next.direction = next.direction || {});
  if (direction.camera?.zoom == null) {
    const zoom = pick.mood === 'punchy' ? 'bold' : 'subtle';
    direction.camera = { ...(direction.camera || {}), zoom };
    delete direction.look;
    delete direction.approvedAt;
    applied.push(`camera.zoom=${zoom}`);
  }
  const rhythm = analyzeRhythm({ flowSource, config: next, brand });
  return { config: next, applied, pick, rhythm, report: rhythmReport(rhythm, { slug, applied }) };
}

/** Markdown report of a rhythm pass. */
export function rhythmReport(r, { slug = '', applied = [] } = {}) {
  const lines = [
    `# Draft rhythm${slug ? ` — ${slug}` : ''}`,
    '',
    `Live ≈ ${r.liveSec}s at steady pace · ${r.energy} energy · one accent every ~${r.rhythm.accentEverySec}s (≥ ${r.rhythm.minGapSec}s apart)`,
    `Chapters ${r.stats.chapters} · captions ${r.stats.captions} · push-ins ${r.stats.zooms} · magnifiers ${r.stats.lenses}`,
    '',
  ];
  if (applied.length) lines.push('Applied:', ...applied.map((a) => `- ${a}`), '');
  lines.push(r.findings.length ? 'Findings:' : 'No rhythm findings — the draft breathes.');
  for (const f of r.findings) lines.push(`- ${f.severity === 'warn' ? '⚠' : '·'} ${f.message}${f.line ? ` (flow.mjs:${f.line})` : ''}\n  → ${f.fix}`);
  return lines.join('\n') + '\n';
}

/** The rhythm as prompt guidance for draft agents. */
export function rhythmGuide() {
  const r = RHYTHM;
  return [
    `Rhythm (live time at steady pace): one camera accent every ~${r.clear.accentEverySec} s (calm ${r.calm.accentEverySec} s, punchy ${r.punchy.accentEverySec} s), never two closer than ${r.clear.minGapSec} s. Accents: ctx.zoom(<region>, { holdMs }) for a push-in without a click, ctx.magnify(<value>, { label }) for one payoff number or label, ctx.follow([a, b, c]) for 2–4 related controls. Mix the three — not the same move every time — and put each on a payoff, never on navigation.`,
    `Captions: a say() roughly every ${r.clear.captionEverySec} s, right before the action it names. Every chapter opens on chapter() before its navigation.`,
    `Transitions: live → proof-plate joins vary inside the energy's palette (calm ${TRANSITION_PALETTES.calm.join('/')}; clear ${TRANSITION_PALETTES.clear.join('/')}; punchy ${TRANSITION_PALETTES.punchy.join('/')}) via edit.transitions {"live><plateId>": {"style": …}}; joins into a chapter card stay a dissolve.`,
    'Crafted, not chaotic: one atmosphere and one title reveal per video, one layout family never twice in a row, and a quiet stretch after every accent.',
  ].join('\n');
}

/** Layout + rhythm guidance for agents that write plates (draft, plates). */
export function draftCraftGuide() {
  return [
    'Plate layouts — set "layout" on open, close and each interstitial to stage the beat it carries (omit it to keep the classic composition):',
    layoutGuide(),
    'Choose per story beat: a launch or bold promise → kinetic or mesh opener; a product-first story → device; a calm explainer → classic or split. A recap the viewer should act on → cards or split closer; a brand sign-off → finale. A capability set with one lead feature → bento; a sequence → stack; a tour of equals → carousel; one hard number set → burst; a line that must land → kinetic or marquee statement. Never repeat a layout (or the same staging, e.g. kinetic opener then kinetic statement) back to back, and let the closer answer the opener. After the draft, Studio fills any layout you leave open with a deterministic pick for this video — choose deliberately where the beat calls for it.',
    rhythmGuide(),
  ].join('\n');
}

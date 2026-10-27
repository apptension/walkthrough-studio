/**
 * One-shot persona critic for a walkthrough video.
 *
 * Embodies target personas (skeptical evaluator, hands-on implementer, economic buyer,
 * first-week onboarder) and reviews config + narration + plate set + optional timeline.
 * Writes critic-report.md/.json once; re-runs only with --force.
 * --apply patches high-confidence narration rewrites and optional plate stubs.
 *
 * Standards used (SaaS demo research):
 * - Pain / outcome early; magic moment by ~20s of live value
 * - Narrate why, not visible clicks; ~120–140 WPM; cut 20% of first draft
 * - Visual change every 2.5–4s in live; plates as midcards / proof, not filler
 * - Mute-test: argument readable from captions + UI
 * - Social proof before close; one clear CTA
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { suggestPlates } from './suggestPlates.mjs';
import { PURPOSES, critiqueStory } from './narrative.mjs';
import { beatsForCritic, critiqueSpokenFrames, formatSampleList } from './shared/frameCheck.js';
import { narrationRepeats, scriptSpokenLines } from './narrationQc.mjs';

const PERSONAS = [
  {
    id: 'skeptic',
    name: 'Skeptical evaluator',
    need: 'In the first 20 seconds, see my pain stop — not a lobby tour or company intro.',
    watches: 'muted first; captions + UI must carry the argument',
  },
  {
    id: 'implementer',
    name: 'Hands-on implementer',
    need: 'Know the exact click path I will use on Monday, with controls named before they are clicked.',
    watches: 'with sound; VO must lead the pointer',
  },
  {
    id: 'buyer',
    name: 'Economic buyer',
    need: 'Proof it is not a trick — ratings, peers, integrations, hard outcomes before I commit time.',
    watches: 'skims plates and close; cares about logos / stats / testimonials',
  },
  {
    id: 'onboarder',
    name: 'First-week onboarder',
    need: 'A map of what we will cover, then calm pacing — not eight features at once.',
    watches: 'journey plate + chapter list; drops if overwhelmed',
  },
];

const UI_NARRATE =
  /\b(now\s+)?(i\s+)?(click|tap|press|select|open the menu|from the menu|hover)\b/i;
const WHY_WORDS = /\b(so that|so you|because|to see|to know|without|instead|saves?|avoids?|frees?)\b/i;

async function loadNarrationFile(video) {
  const file = join(video.dir, 'narration.mjs');
  if (!existsSync(file)) return null;
  const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
  return mod.default || mod;
}

function setupFingerprint(video, narration) {
  const payload = JSON.stringify({
    title: video.config.title,
    audience: video.config.audience,
    interstitials: (video.config.interstitials || []).map((i) => ({ id: i.id, type: i.type, before: i.before })),
    purpose: video.config.purpose,
    open: video.config.open,
    close: video.config.close,
    narration,
  });
  return createHash('sha1').update(payload).digest('hex').slice(0, 12);
}

/** Narration as flat lines (intro, chapter/caption lines, plate lines, outro) for story checks. */
export async function loadNarrationLines(video) {
  return collectLines(await loadNarrationFile(video).catch(() => null));
}

function collectLines(narration) {
  if (!narration) return [];
  const out = [];
  if (narration.intro) out.push({ key: 'intro', text: String(narration.intro), kind: 'intro' });
  for (const [key, raw] of Object.entries(narration.lines || {})) {
    const text = typeof raw === 'string' ? raw : raw?.text || '';
    out.push({ key, text, kind: 'line' });
  }
  for (const [key, raw] of Object.entries(narration.plates || {})) {
    const text = typeof raw === 'string' ? raw : raw?.text || '';
    out.push({ key: `plate:${key}`, text, kind: 'plate' });
  }
  if (narration.outro) out.push({ key: 'outro', text: String(narration.outro), kind: 'outro' });
  return out;
}

function wordCount(s) {
  return String(s).trim().split(/\s+/).filter(Boolean).length;
}

function critiqueNarration(lines) {
  const findings = [];
  for (const line of lines) {
    const words = wordCount(line.text);
    if (UI_NARRATE.test(line.text) && !WHY_WORDS.test(line.text)) {
      findings.push({
        severity: 'high',
        persona: 'implementer',
        action: 'change',
        target: `narration:${line.key}`,
        issue: 'Narrates the visible click instead of the why.',
        suggestion: rewriteWhy(line.text),
        apply: { type: 'narration', key: line.key, text: rewriteWhy(line.text) },
      });
    }
    if (words > 32 && line.kind !== 'plate') {
      findings.push({
        severity: 'medium',
        persona: 'skeptic',
        action: 'change',
        target: `narration:${line.key}`,
        issue: `Line is ~${words} words — cut toward ≤28 for 120–140 WPM fit.`,
        suggestion: shorten(line.text),
        apply: { type: 'narration', key: line.key, text: shorten(line.text) },
      });
    }
    if (line.kind === 'intro' && /hi[, ]|i'?m |welcome to|today (i|we)|let me show you around/i.test(line.text)) {
      findings.push({
        severity: 'high',
        persona: 'skeptic',
        action: 'change',
        target: 'narration:intro',
        issue: 'Org-chart / lobby open — costs retention before the magic moment.',
        suggestion: 'Lead with the viewer’s pain or the outcome they came for.',
        apply: null,
      });
    }
  }
  return findings;
}

function rewriteWhy(text) {
  const cleaned = text
    .replace(/\b(now\s+)?(i\s+)?(click|tap|press)\b[^,.!]*/gi, 'use this')
    .replace(/\s+/g, ' ')
    .trim();
  if (WHY_WORDS.test(cleaned)) return cleaned;
  return `${cleaned.replace(/\.$/, '')} — so you see the outcome without hunting.`;
}

function shorten(text) {
  const parts = text.split(/[,;—–-]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, 2).join(' — ').replace(/\s+/g, ' ');
  const words = text.split(/\s+/);
  if (words.length <= 28) return text;
  return words.slice(0, 26).join(' ').replace(/[,:;]?$/, '') + '.';
}

function critiqueStructure(video, plateSuggest) {
  const findings = [];
  const inter = video.config.interstitials || [];
  const types = new Set(inter.map((i) => i.type));
  const audience = String(video.config.audience || '');

  if (inter.length === 0) {
    findings.push({
      severity: 'high',
      persona: 'onboarder',
      action: 'add',
      target: 'interstitials',
      issue: 'Title-only open/close — missing proof and journey midcards.',
      suggestion: 'Run suggest-plates and add features + journey + social proof.',
      apply: null,
    });
  }
  if (!types.has('features') && !types.has('callout')) {
    findings.push({
      severity: 'medium',
      persona: 'skeptic',
      action: 'add',
      target: 'interstitials',
      issue: 'No capability/thesis plate before live UI — magic moment is buried in chrome.',
      suggestion: plateSuggest.proposals.find((p) => p.type === 'features' || p.type === 'callout')?.title || 'Add a features plate',
      apply: null,
    });
  }
  if (!types.has('testimonials') && !types.has('stats') && !types.has('logos')) {
    findings.push({
      severity: 'high',
      persona: 'buyer',
      action: 'add',
      target: 'interstitials',
      issue: 'No social-proof plate (logos / testimonials / stats) before close.',
      suggestion: 'Add logos or testimonials harvested from the site/brief.',
      apply: null,
    });
  }
  if (/first|onboard|new user|getting started/i.test(audience) && !types.has('journey')) {
    findings.push({
      severity: 'medium',
      persona: 'onboarder',
      action: 'add',
      target: 'interstitials',
      issue: 'First-user audience without a journey map.',
      suggestion: 'Add a journey plate naming the chapters ahead.',
      apply: null,
    });
  }
  if (inter.length > 5) {
    findings.push({
      severity: 'medium',
      persona: 'skeptic',
      action: 'remove',
      target: 'interstitials',
      issue: `${inter.length} interstitials — completeness disease; prefer ≤5 denser cards.`,
      suggestion: 'Merge weakest proof plates; keep features + one proof + journey.',
      apply: null,
    });
  }
  const closeSteps = video.config.close?.steps || [];
  if (closeSteps.length && closeSteps.length !== 3) {
    findings.push({
      severity: 'low',
      persona: 'onboarder',
      action: 'change',
      target: 'close.steps',
      issue: 'Close plate works best with exactly 3 numbered takeaways.',
      suggestion: 'Trim or expand close.steps to three outcome-led lines.',
      apply: null,
    });
  }
  return findings;
}

function critiqueTimeline(video) {
  const findings = [];
  const tlPath = join(video.out, 'timeline.json');
  if (!existsSync(tlPath)) return findings;
  const timeline = JSON.parse(readFileSync(tlPath, 'utf8'));
  const chapters = timeline.filter((m) => m.kind === 'chapter');
  if (chapters.length && chapters[0].t > 25) {
    findings.push({
      severity: 'medium',
      persona: 'skeptic',
      action: 'change',
      target: 'flow',
      issue: `First chapter lands at ${chapters[0].t.toFixed(0)}s of live — magic moment may arrive late.`,
      suggestion: 'Pull the highest-value UI action earlier in flow.mjs.',
      apply: null,
    });
  }
  const captions = timeline.filter((m) => m.kind === 'caption');
  let longStatic = 0;
  for (let i = 1; i < captions.length; i++) {
    if (captions[i].t - captions[i - 1].t > 8) longStatic += 1;
  }
  if (longStatic >= 3) {
    findings.push({
      severity: 'medium',
      persona: 'skeptic',
      action: 'change',
      target: 'flow',
      issue: `${longStatic} caption gaps >8s — risk of static narrated screens.`,
      suggestion: 'Add focus/magnify beats or shorten holds so something changes every ~3–4s.',
      apply: null,
    });
  }
  return findings;
}

/** Lines that repeat each other, read in spoken order (narrationQc.mjs). */
export function critiqueRepeats(scenes = []) {
  return narrationRepeats(scriptSpokenLines(scenes))
    .filter((f) => f.severity !== 'low')
    .map((f) => ({
      severity: f.severity,
      persona: 'skeptic',
      action: 'change',
      target: `narration:${f.key}`,
      issue: f.message,
      suggestion: 'Keep the line where the idea first lands; rewrite the other to add the outcome, the reason or what comes next.',
      apply: null,
    }));
}

/** House copy style (sentence case, closing punctuation, typography) from the script's scene lint. */
export function critiqueCopyStyle(scenes = []) {
  const findings = [];
  for (const scene of scenes) {
    for (const issue of scene.issues || []) {
      if (!issue.fix) continue;
      const { plateId, flowIndex, field, from, text, fixes = [] } = issue.fix;
      findings.push({
        severity: 'low',
        persona: 'skeptic',
        action: 'change',
        target: plateId ? `${plateId}.${field}` : `flow:${scene.title}.${field}`,
        issue: `Off house copy style: “${from}”${fixes.length ? ` — ${fixes.join(', ')}` : ''}.`,
        suggestion: text,
        apply: { type: 'copy', plateId, flowIndex, field, text },
      });
    }
  }
  return findings;
}

function renderMarkdown(video, fingerprint, personas, findings, plateSuggest, purpose, samples = []) {
  const spine = PURPOSES[purpose];
  const byPersona = Object.fromEntries(PERSONAS.map((p) => [p.id, []]));
  for (const f of findings) {
    (byPersona[f.persona] || (byPersona[f.persona] = [])).push(f);
  }
  const lines = [
    `# Critic report — ${video.slug}`,
    '',
    `Fingerprint: \`${fingerprint}\` · generated ${new Date().toISOString()}`,
    `Audience: ${video.config.audience || '(unset)'}`,
    `Purpose: ${spine.label} — ${spine.framework}`,
    '',
    '## Story spine',
    ...spine.beats.map((b, i) => `${i + 1}. **${b.id}** (${b.where}) — ${b.job}`),
    '',
    '## Personas',
    ...PERSONAS.map((p) => `- **${p.name}** — need: ${p.need} _(watches ${p.watches})_`),
    '',
    '## Sampled frames',
  ];
  const sampleBlock = formatSampleList(samples);
  lines.push(sampleBlock || '_No voiced frame was sampled._');
  lines.push('', '## Findings');
  if (!findings.length) {
    lines.push('_No blocking findings — structure and narration look aligned with the spine._');
  } else {
    for (const f of findings.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]))) {
      lines.push(
        `- **[${f.severity}] ${f.action.toUpperCase()}** (${f.persona}) \`${f.target}\` — ${f.issue}`,
        `  → ${f.suggestion}`
      );
      if (f.frame?.path || f.frame?.at != null) {
        lines.push(`  ${formatSampleList([{ key: f.target, at: f.frame.at, path: f.frame.path }]).replace(/^- /, 'sampled ')}`);
      }
    }
  }
  lines.push('', '## Plate suggestions', plateSuggest.report, '', '## How to use', '1. Adjust narration / plates / flow from the findings.', '2. Re-record or re-produce only what changed.', '3. Critic stays frozen until `node cli.mjs critic <slug> --force`.', '4. Optional: `node cli.mjs critic <slug> --apply` to write high-confidence narration rewrites + missing plate scaffolds.');
  return lines.join('\n');
}

async function applyFindings(video, findings, plateSuggest, { applyPlates }) {
  const narrationPath = join(video.dir, 'narration.mjs');
  const narrationPatches = findings.filter((f) => f.apply?.type === 'narration' && f.severity === 'high');
  let narrationApplied = 0;
  if (narrationPatches.length && existsSync(narrationPath)) {
    let src = readFileSync(narrationPath, 'utf8');
    for (const f of narrationPatches) {
      const key = f.apply.key.replace(/^plate:/, '');
      // Best-effort string replace of the old line text inside the module source.
      const old = collectLines(await loadNarrationFile(video)).find((l) => l.key === f.apply.key || l.key === key);
      if (!old?.text) continue;
      if (src.includes(old.text)) {
        src = src.replace(old.text, f.apply.text);
        narrationApplied += 1;
      }
    }
    if (narrationApplied) writeFileSync(narrationPath, src);
  }
  let platesAdded = [];
  if (applyPlates && plateSuggest.proposals.length) {
    const { applyPlateSuggestions } = await import('./suggestPlates.mjs');
    platesAdded = applyPlateSuggestions(video, plateSuggest.proposals);
  }
  return { narrationApplied, platesAdded };
}

function writeFrameStill(video, at, relPath) {
  const live = join(video.out, 'live.mp4');
  if (!existsSync(live) || !(Number(at) >= 0)) return;
  const dest = join(video.out, relPath);
  mkdirSync(dirname(dest), { recursive: true });
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', '-ss', Number(at).toFixed(3), '-i', live, '-frames:v', '1', dest],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) return;
}

/**
 * @param {object} video
 * @param {{ force?: boolean, apply?: boolean, applyPlates?: boolean }} opts
 */
export async function runCritic(video, { force = false, apply = false, applyPlates = false } = {}) {
  const outDir = video.out;
  const reportJson = join(outDir, 'critic-report.json');
  const reportMd = join(outDir, 'critic-report.md');
  const narration = await loadNarrationFile(video);
  const fingerprint = setupFingerprint(video, narration);

  if (!force && existsSync(reportJson)) {
    const prev = JSON.parse(readFileSync(reportJson, 'utf8'));
    if (prev.fingerprint === fingerprint) {
      console.log(`· critic already reviewed this setup (${fingerprint}) — pass --force to re-run`);
      console.log(`  ${reportMd}`);
      return prev;
    }
  }

  const lines = collectLines(narration);
  const plateSuggest = suggestPlates(video);
  const briefPath = join(video.dir, 'brief.json');
  const brief = existsSync(briefPath) ? JSON.parse(readFileSync(briefPath, 'utf8')) : null;
  const story = critiqueStory(video.config, lines, { brief });
  let scenes = [];
  try {
    const { buildScript } = await import('./script.mjs');
    scenes = (await buildScript(video)).scenes || [];
  } catch {
    /* Frame check still runs on narration length when the script cannot be built. */
  }
  const frameTextPath = join(video.out, 'frame-text.json');
  const frameText = existsSync(frameTextPath) ? JSON.parse(readFileSync(frameTextPath, 'utf8')) : [];
  const beats = beatsForCritic(scenes, frameText);
  for (const beat of beats) {
    if (beat.frame?.path && beat.frame.at != null) writeFrameStill(video, beat.frame.at, beat.frame.path);
  }
  const samples = beats
    .filter((beat) => beat.frame?.path || beat.frame?.at != null)
    .map((beat) => ({ key: beat.key, at: beat.frame.at, path: beat.frame.path }));
  const findings = [
    ...critiqueNarration(lines),
    ...story.findings,
    ...critiqueStructure(video, plateSuggest),
    ...critiqueTimeline(video),
    ...critiqueSpokenFrames(beats),
    ...critiqueRepeats(scenes),
    ...critiqueCopyStyle(scenes),
  ];

  const report = {
    slug: video.slug,
    fingerprint,
    generatedAt: new Date().toISOString(),
    purpose: story.purpose,
    personas: PERSONAS,
    samples,
    findings,
    plateProposals: plateSuggest.proposals.map(({ _reason, _beforeHint, ...p }) => ({
      ...p,
      reason: _reason,
      beforeHint: _beforeHint,
    })),
  };

  writeFileSync(reportJson, JSON.stringify(report, null, 2));
  writeFileSync(reportMd, renderMarkdown(video, fingerprint, PERSONAS, findings, plateSuggest, story.purpose, samples));

  console.log(`✓ critic → ${reportMd}`);
  console.log(`  ${findings.length} finding(s) · ${plateSuggest.proposals.length} plate proposal(s)`);
  for (const f of findings.filter((x) => x.severity === 'high').slice(0, 8)) {
    console.log(`  ⚠ [${f.action}] ${f.target}: ${f.issue}`);
  }

  if (apply) {
    const res = await applyFindings(video, findings, plateSuggest, { applyPlates: applyPlates || apply });
    console.log(`  applied: ${res.narrationApplied} narration rewrite(s), plates +[${res.platesAdded.join(', ') || 'none'}]`);
    writeFileSync(join(outDir, 'critic-applied.json'), JSON.stringify({ at: new Date().toISOString(), ...res }, null, 2));
  }

  return report;
}

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

/**
 * Fold the critic agent's review (critic-agent.json) into critic-report.json/.md. Agent findings
 * lead; rule findings stay only where the agent did not already speak to the same target.
 */
export function mergeAgentReview(video, review) {
  const reportJson = join(video.out, 'critic-report.json');
  const reportMd = join(video.out, 'critic-report.md');
  const base = existsSync(reportJson) ? JSON.parse(readFileSync(reportJson, 'utf8')) : { slug: video.slug, personas: PERSONAS };
  const rules = (base.findings || []).filter((f) => f.source !== 'agent').map((f) => ({ ...f, source: 'rules' }));
  const agent = (review.findings || [])
    .filter((f) => f && (f.issue || f.suggestion))
    .map((f) => ({
      severity: SEVERITY_RANK[f.severity] != null ? f.severity : 'medium',
      persona: f.persona || 'skeptic',
      action: f.action || 'change',
      target: String(f.target || 'story'),
      issue: String(f.issue || ''),
      suggestion: String(f.suggestion || ''),
      evidence: f.evidence ? String(f.evidence) : undefined,
      at: Number.isFinite(Number(f.at)) && f.at !== null ? Number(f.at) : undefined,
      source: 'agent',
    }))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const covered = new Set(agent.map((f) => f.target));
  const report = {
    ...base,
    generatedAt: new Date().toISOString(),
    agent: {
      summary: String(review.summary || ''),
      score: Number.isFinite(Number(review.score)) ? Math.max(0, Math.min(100, Number(review.score))) : null,
      strengths: Array.isArray(review.strengths) ? review.strengths.map(String).slice(0, 6) : [],
      generatedAt: new Date().toISOString(),
    },
    findings: [...agent, ...rules.filter((f) => !covered.has(f.target))],
  };
  writeFileSync(reportJson, JSON.stringify(report, null, 2));
  const agentMdPath = join(video.out, 'critic-agent.md');
  const agentMd = existsSync(agentMdPath) ? readFileSync(agentMdPath, 'utf8').trim() : `# Critic review — ${video.slug}\n\n${report.agent.summary}`;
  const rulesMd = existsSync(reportMd) ? readFileSync(reportMd, 'utf8').split('\n<!-- rules -->\n').pop().trim() : '';
  writeFileSync(reportMd, `${agentMd}\n\n---\n\n## Automatic rule pass\n\n<!-- rules -->\n${rulesMd}\n`);
  return report;
}

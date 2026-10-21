/**
 * Purpose-driven story spines for walkthrough videos.
 *
 * A spine is the ordered set of beats a video of that purpose must land, with the job
 * of each beat, where it lives (open plate, chapter, interstitial, close) and the plate
 * types that carry it best. The same data feeds three consumers:
 *   - the draft / script agents (`storyBrief`) so first drafts follow the spine,
 *   - the persona critic (`critiqueStory`) so drafts are checked against it,
 *   - authoring.md, which documents the spines for humans.
 *
 * Messaging canon the spines encode:
 *   - Lead with the viewer's job and its cost (Jobs-to-be-Done, "pain before product").
 *   - Show the outcome before the mechanism ("magic moment" inside ~20s of live).
 *   - Before → After → Bridge for feature stories; Problem → Agitate → Solve for sales.
 *   - Proof (numbers, peers, logos) lands before the ask, never after it.
 *   - Rule of three for takeaways; one call to action; the close echoes the open.
 *   - Second person, concrete nouns, real numbers; no category adjectives.
 */

export const PURPOSES = {
  overview: {
    label: 'Product overview',
    short: 'Overview',
    hint: 'First look for someone deciding whether the product is worth their time.',
    framework: 'Problem → Promise → Proof → Path → Payoff',
    beats: [
      { id: 'problem', where: 'open + intro', job: 'Name the viewer’s job and what it costs them today, in their words.' },
      { id: 'promise', where: 'first chapter', job: 'Show the single outcome the product delivers — the result on screen, not the menu.' },
      { id: 'proof', where: 'interstitial', job: 'Back the promise with one hard number, peer logos or a customer line.', plates: ['metric', 'stats', 'kpi', 'logos', 'testimonials', 'quote'] },
      { id: 'path', where: 'chapters', job: '2–4 capabilities, each framed as a job done, in the order a real day uses them.', plates: ['features', 'journey', 'process', 'orbit', 'team'] },
      { id: 'payoff', where: 'close + outro', job: 'Restate the promise as the viewer’s new normal, then one next step.' },
    ],
  },
  feature: {
    label: 'Feature spotlight',
    short: 'Feature',
    hint: 'One capability, shown deeply, for people who already know the product.',
    framework: 'Before → After → Bridge',
    beats: [
      { id: 'before', where: 'open + intro', job: 'The workaround people use today and the moment it breaks.' },
      { id: 'after', where: 'first chapter', job: 'The same moment with the feature — outcome visible within seconds.' },
      { id: 'bridge', where: 'chapters', job: 'The 2–3 steps that get you from before to after, each with its why.', plates: ['compare', 'callout', 'process', 'features'] },
      { id: 'proof', where: 'interstitial', job: 'Quantify the difference: time saved, errors avoided, steps removed.', plates: ['compare', 'metric', 'stats', 'kpi', 'checklist'] },
      { id: 'payoff', where: 'close + outro', job: 'Where to find it and the first thing to try with it.' },
    ],
  },
  onboarding: {
    label: 'Onboarding / how-to',
    short: 'Onboarding',
    hint: 'A new user who has access and needs to get to their first win.',
    framework: 'Goal → Map → Steps → First win',
    beats: [
      { id: 'goal', where: 'open + intro', job: 'The concrete thing they will have done by the end of the video.' },
      { id: 'map', where: 'interstitial', job: 'The 3–5 stops ahead, named the way the UI names them.', plates: ['journey', 'process', 'timeline'] },
      { id: 'steps', where: 'chapters', job: 'One action per step; name the control before the pointer reaches it; say why it matters.' },
      { id: 'win', where: 'chapter', job: 'Pause on the finished result so the first win is unmistakable.', plates: ['callout', 'checklist', 'statement'] },
      { id: 'next', where: 'close + outro', job: 'Three next habits, numbered, then where to get help.' },
    ],
  },
  launch: {
    label: 'Release / launch',
    short: 'Launch',
    hint: 'Announce what is new to existing users and the market.',
    framework: 'Shift → What’s new → Why now → Try it',
    beats: [
      { id: 'shift', where: 'open + intro', job: 'The change in the world or the workflow that makes this release matter.' },
      { id: 'new', where: 'chapters', job: 'Lead with the most valuable change; each item framed as what you can now do.', plates: ['features', 'timeline', 'checklist', 'orbit', 'compare'] },
      { id: 'why', where: 'interstitial', job: 'Evidence it works: beta numbers, customer quote, adoption.', plates: ['metric', 'kpi', 'quote', 'testimonials', 'stats'] },
      { id: 'try', where: 'close + outro', job: 'Availability (who gets it, when) and the one thing to try first.' },
    ],
  },
  sales: {
    label: 'Sales demo',
    short: 'Sales',
    hint: 'A buyer comparing options; every minute must earn the next.',
    framework: 'Problem → Agitate → Solve → Prove → Ask',
    beats: [
      { id: 'problem', where: 'open + intro', job: 'The business problem in the buyer’s numbers — hours, money, risk.' },
      { id: 'agitate', where: 'intro or compare plate', job: 'What it costs to keep doing it the old way; make the gap visible.', plates: ['compare', 'statement'] },
      { id: 'solve', where: 'chapters', job: 'The shortest path to the outcome, value moment first, setup last.', plates: ['features', 'process', 'journey', 'team'] },
      { id: 'prove', where: 'interstitial', job: 'Peers, ratings and hard outcomes before the ask.', plates: ['logos', 'testimonials', 'metric', 'kpi', 'stats', 'quote', 'faq', 'pricing'] },
      { id: 'ask', where: 'close + outro', job: 'One clear call to action with a low-friction first step.' },
    ],
  },
};

export const PURPOSE_IDS = Object.keys(PURPOSES);

export const PRINCIPLES = [
  'Open on the viewer, not the company: their job, its cost, or the outcome they came for. Never "Hi, I’m…", "Welcome to…", or "X is a platform that…".',
  'Outcome before mechanism: show the finished result early, then how to get there.',
  'Say why, not what: the screen already shows the click; the voice adds the reason.',
  'Second person and present tense: "you see who is free", not "users are able to view availability".',
  'Concrete beats clever: real nouns from the UI, real numbers from the brief, no category adjectives.',
  'One idea per line; ≤28 spoken words; on-screen titles ≤5 words, bodies ≤12.',
  'Proof before the ask; one call to action; three takeaways, numbered.',
  'The close echoes the open: the problem named at the start is answered in the last line.',
];

/** Words that sound like marketing and say nothing — flagged in narration and plate copy. */
export const EMPTY_WORDS = [
  'seamless', 'seamlessly', 'powerful', 'robust', 'leverage', 'cutting-edge', 'revolutionary', 'innovative',
  'best-in-class', 'world-class', 'game-changing', 'game changer', 'next-generation', 'synergy', 'empower',
  'unlock', 'supercharge', 'streamline', 'holistic', 'state-of-the-art', 'one-stop', 'all-in-one solution',
];

const HEDGES = /\b(just|simply|basically|really|very|actually|kind of|sort of)\b/gi;
const CTA = /\b(start|try|book|sign up|open|invite|set up|connect|request|get started|schedule|visit|join|create|turn on|switch on|explore)\b/i;
const VIEWER = /\b(you|your|you're|you’ll|you'll|yourself)\b/i;
const NUMBER = /\d/;

/** Purpose from config, then brief, then a guess from the audience line. */
export function resolvePurpose(config = {}, brief = null) {
  const explicit = String(config.purpose || brief?.purpose || '').toLowerCase();
  if (PURPOSES[explicit]) return explicit;
  const audience = `${config.audience || ''} ${brief?.audience || ''}`;
  if (/onboard|new user|first week|getting started|how to/i.test(audience)) return 'onboarding';
  if (/buyer|evaluat|prospect|decision|procure/i.test(audience)) return 'sales';
  if (/release|launch|what'?s new|existing customers/i.test(audience)) return 'launch';
  return 'overview';
}

/** Prompt block for draft / script agents: the spine plus the messaging rules. */
export function storyBrief(purposeId) {
  const p = PURPOSES[purposeId] || PURPOSES.overview;
  return [
    `## Story spine — ${p.label} (${p.framework})`,
    p.hint,
    ...p.beats.map((b, i) => `${i + 1}. ${b.id.toUpperCase()} · ${b.where} — ${b.job}${b.plates ? ` Plates: ${b.plates.join('/')}.` : ''}`),
    '',
    '## Messaging rules',
    ...PRINCIPLES.map((s) => `- ${s}`),
    `- Never use: ${EMPTY_WORDS.slice(0, 12).join(', ')}…`,
  ].join('\n');
}

function words(s) {
  return String(s || '').toLowerCase().match(/[a-z0-9’']+/g) || [];
}

function emptyWordsIn(text) {
  const lower = String(text || '').toLowerCase();
  return EMPTY_WORDS.filter((w) => new RegExp(`(^|[^a-z-])${w.replace(/[-]/g, '[- ]')}([^a-z-]|$)`).test(lower));
}

function plateCopy(config) {
  const out = [];
  const push = (target, text) => text && out.push({ target, text: String(text).replace(/\*/g, '') });
  push('open.title', [].concat(config.open?.title || []).join(' '));
  push('open.sub', config.open?.sub);
  push('close.title', [].concat(config.close?.title || []).join(' '));
  (config.close?.steps || []).forEach((s, i) => push(`close.steps[${i}]`, s));
  for (const p of config.interstitials || []) {
    push(`${p.id}.title`, [].concat(p.title || []).join(' '));
    push(`${p.id}.copy`, p.copy || p.sub);
    for (const [i, it] of (p.items || []).entries()) push(`${p.id}.items[${i}]`, typeof it === 'string' ? it : it?.label || it?.title);
  }
  return out;
}

/**
 * Story-level critique: spine coverage, open/close craft and copy hygiene.
 * `lines` is critic.collectLines output: [{ key, text, kind }].
 */
export function critiqueStory(config = {}, lines = [], { brief = null } = {}) {
  const findings = [];
  const purpose = resolvePurpose(config, brief);
  const spine = PURPOSES[purpose];
  const add = (severity, persona, target, issue, suggestion) =>
    findings.push({ severity, persona, action: 'change', target, issue, suggestion, apply: null });

  const intro = lines.find((l) => l.kind === 'intro')?.text || '';
  const outro = lines.find((l) => l.kind === 'outro')?.text || '';
  const product = String(config.product || brief?.product || '').trim();

  if (intro) {
    if (!VIEWER.test(intro)) {
      add('medium', 'skeptic', 'narration:intro', 'Intro never addresses the viewer — it describes the product instead of their job.', `${spine.beats[0].job} Use "you".`);
    }
    if (product && new RegExp(`^\\s*${product.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(is|helps|lets|gives)\\b`, 'i').test(intro)) {
      add('medium', 'skeptic', 'narration:intro', 'Opens with a definition of the product — the category sentence viewers skip.', 'Start with the problem or the outcome; let the product arrive as the answer.');
    }
  }
  if (outro && !CTA.test(outro)) {
    add('medium', 'buyer', 'narration:outro', 'Outro has no next step — the video ends without an ask.', `${spine.beats.at(-1).job}`);
  }
  if (intro && outro) {
    const shared = new Set(words(intro).filter((w) => w.length > 4));
    const echo = words(outro).some((w) => shared.has(w));
    if (!echo) add('low', 'onboarder', 'narration:outro', 'Close does not echo the open — the opening problem is never answered.', 'Reuse the key noun from the intro in the outro so the story lands as a loop.');
  }

  const spoken = lines.filter((l) => l.kind !== 'plate' || l.text);
  const viewerLines = spoken.filter((l) => VIEWER.test(l.text)).length;
  if (spoken.length >= 4 && viewerLines / spoken.length < 0.3) {
    add('medium', 'implementer', 'narration', `Only ${viewerLines}/${spoken.length} lines speak to the viewer.`, 'Rewrite in second person, present tense: "you see…", "you book…".');
  }

  const openers = new Map();
  for (const l of spoken) {
    const first = words(l.text)[0];
    if (!first) continue;
    openers.set(first, (openers.get(first) || 0) + 1);
  }
  for (const [w, n] of openers) {
    if (n >= 3 && spoken.length >= 5 && !['you', 'your'].includes(w)) {
      add('low', 'skeptic', 'narration', `${n} lines start with "${w}" — the read turns monotonous.`, 'Vary sentence openings; lead some lines with the outcome.');
    }
  }

  let hedges = 0;
  for (const l of spoken) hedges += (String(l.text).match(HEDGES) || []).length;
  if (hedges >= 3) add('low', 'skeptic', 'narration', `${hedges} hedge words (just/simply/really/very…) soften the read.`, 'Delete them; the sentence is stronger without.');

  const fluff = new Map();
  for (const l of spoken) for (const w of emptyWordsIn(l.text)) fluff.set(w, [...(fluff.get(w) || []), `narration:${l.key}`]);
  for (const c of plateCopy(config)) for (const w of emptyWordsIn(c.text)) fluff.set(w, [...(fluff.get(w) || []), c.target]);
  for (const [w, targets] of fluff) {
    add('medium', 'buyer', targets[0], `"${w}" is a claim without content${targets.length > 1 ? ` (${targets.length}×)` : ''}.`, 'Replace with what actually happens or a number.');
  }

  const proofTypes = new Set(['metric', 'stats', 'logos', 'testimonials', 'quote']);
  const inter = config.interstitials || [];
  const hasNumbers = spoken.some((l) => NUMBER.test(l.text)) || inter.some((p) => p.type === 'metric' || p.type === 'stats');
  const briefStats = brief?.proof?.stats?.length || 0;
  if (!hasNumbers && briefStats) {
    add('medium', 'buyer', 'narration', 'The brief has stats but no line or plate uses a number.', `Put "${brief.proof.stats[0]}" on a metric/stats plate or into the proof line.`);
  }

  for (const beat of spine.beats) {
    if (!beat.plates || beat.where !== 'interstitial') continue;
    if (!inter.some((p) => beat.plates.includes(p.type))) {
      add('medium', beat.id === 'proof' || beat.id === 'prove' || beat.id === 'why' ? 'buyer' : 'onboarder', 'interstitials',
        `${spine.label} spine: the ${beat.id.toUpperCase()} beat has no plate.`, `${beat.job} Use ${beat.plates.join(' or ')}.`);
    }
  }

  const proofIdx = inter.findIndex((p) => proofTypes.has(p.type));
  if (proofIdx >= 0 && inter[proofIdx].before == null && inter.length > 1) {
    add('low', 'buyer', `${inter[proofIdx].id}`, 'Proof plate has no "before" — it may land after the ask.', 'Place proof before the last chapter so it precedes the close.');
  }

  const titleLines = [].concat(config.open?.title || []);
  for (const [i, t] of titleLines.entries()) {
    if (words(String(t).replace(/\*/g, '')).length > 5) {
      add('low', 'skeptic', `open.title[${i}]`, 'Open title line is longer than five words — it will set small.', 'Cut to a 2–5 word line; move detail into the sub.');
    }
  }

  return { purpose, findings };
}

/**
 * Sound and tone for one video: the narrator, the music bed and the written voice all come from
 * one tone profile, so captions, plate copy, voice-over and score speak like the same brand.
 *
 * The profile reads, in order: video.config.json → tone, brief.json → story.tone, brand.json →
 * tone, then the story purpose. From it:
 *   - `pickVoice`   chooses a narrator from the curated catalog (or keeps a brand's own voice) and
 *                   tunes its delivery to the energy,
 *   - `craftMusic`  writes an ElevenLabs music brief: genre, instruments, tempo, mood, an intro /
 *                   bed / outro arc and evolving sections for long beds,
 *   - `toneBlock`   is the prompt text every writing agent gets (draft, script, plates, narration),
 *   - `auditTone`   checks a draft's narration and plate copy against the profile.
 * `enrichSound` fills only what the draft left open: an explicit choice always wins.
 */
import { EMPTY_WORDS } from './narrative.mjs';
import { hashSeed, seededRandom } from './variety.mjs';

/** The kit's default narrator. A brand that still carries it has not chosen a voice of its own. */
export const DEFAULT_VOICE_ID = 'XrExE9yKIg1WjnnlVkGX';

/** Tone axes and the brief words that pull toward each. */
const AXES = {
  warm: ['warm', 'friendly', 'human', 'caring', 'approachable', 'empathetic', 'kind', 'welcoming', 'personal', 'supportive', 'inviting', 'helpful'],
  confident: ['confident', 'bold', 'authoritative', 'expert', 'assured', 'direct', 'decisive', 'trustworthy', 'credible', 'serious', 'senior', 'enterprise', 'professional', 'reliable'],
  energetic: ['energetic', 'upbeat', 'punchy', 'exciting', 'dynamic', 'lively', 'fast', 'vibrant', 'bright', 'optimistic', 'enthusiastic', 'ambitious', 'fresh'],
  calm: ['calm', 'clear', 'plain', 'simple', 'reassuring', 'patient', 'gentle', 'quiet', 'minimal', 'relaxed', 'steady', 'thoughtful', 'honest', 'practical'],
  playful: ['playful', 'quirky', 'witty', 'cheeky', 'fun', 'cheerful', 'light', 'irreverent', 'casual', 'conversational'],
  technical: ['technical', 'precise', 'developer', 'crisp', 'exact', 'engineering', 'rigorous', 'data', 'analytical', 'smart', 'efficient'],
  premium: ['premium', 'elegant', 'refined', 'luxury', 'sophisticated', 'polished', 'classy', 'understated', 'editorial', 'cinematic'],
};
const AXIS_IDS = Object.keys(AXES);

/** Tone words a purpose implies when nobody wrote any. */
const PURPOSE_WORDS = {
  overview: ['clear', 'confident', 'warm'],
  feature: ['clear', 'precise', 'confident'],
  onboarding: ['patient', 'warm', 'clear'],
  launch: ['energetic', 'confident', 'bright'],
  sales: ['confident', 'direct', 'warm'],
};

const PERSONA = {
  warm: 'a friendly colleague who already uses the product every day',
  confident: 'a senior product lead who knows it works and has nothing to prove',
  energetic: 'a teammate who just shipped this and cannot wait to show you',
  calm: 'a patient guide who lets each screen land before the next',
  playful: 'a witty friend who keeps it light without wasting your time',
  technical: 'an engineer walking a peer through the real thing',
  premium: 'an unhurried expert who chooses every word',
};

const RULES = {
  warm: { do: 'Talk to one person: “you” and contractions (you’ll, it’s, there’s).', avoid: 'Cold system language (“the user”, “the system allows”).' },
  confident: { do: 'Plain declaratives that state results as facts.', avoid: 'Hedges (might, could, try to, hopefully, kind of).' },
  energetic: { do: 'Lead with a strong verb and vary sentence length; one lift on the payoff.', avoid: 'An exclamation mark on more than one line.' },
  calm: { do: 'One idea per sentence; let a line breathe before the next action.', avoid: 'Exclamation marks and hype words.' },
  playful: { do: 'At most one light turn of phrase per chapter, never at the cost of clarity.', avoid: 'Puns in titles and jokes about the viewer’s problem.' },
  technical: { do: 'Exact UI nouns, real numbers and units.', avoid: 'Metaphors and vague benefits (“better”, “faster” with nothing to compare).' },
  premium: { do: 'Restraint: fewer, precise words and space around them.', avoid: 'Slang, discount language and exclamation marks.' },
};

/**
 * Curated ElevenLabs premade narrators. `traits` are tone axes the voice carries; `energy` the
 * energies it suits. Every one speaks the eleven_v4 languages, so the pick holds for any locale.
 */
export const VOICE_CATALOG = Object.freeze([
  { voiceId: 'nPczCjzI2devNBz1zQrb', name: 'Brian', gender: 'male', accent: 'american', traits: ['confident', 'calm', 'premium'], energy: ['calm', 'clear'], note: 'deep, resonant, senior' },
  { voiceId: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'female', accent: 'american', traits: ['warm', 'calm', 'confident'], energy: ['clear', 'calm'], note: 'warm, friendly, professional' },
  { voiceId: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'female', accent: 'american', traits: ['calm', 'warm', 'premium'], energy: ['calm', 'clear'], note: 'soft, reassuring, mature' },
  { voiceId: 'cjVigY5qzO86Huf0OWal', name: 'Eric', gender: 'male', accent: 'american', traits: ['confident', 'warm', 'calm'], energy: ['clear', 'calm'], note: 'smooth, trustworthy' },
  { voiceId: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', gender: 'male', accent: 'american', traits: ['energetic', 'technical', 'confident'], energy: ['punchy', 'clear'], note: 'articulate, young, forward' },
  { voiceId: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', gender: 'female', accent: 'american', traits: ['energetic', 'playful', 'warm'], energy: ['punchy', 'clear'], note: 'bright, expressive, young' },
  { voiceId: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', gender: 'female', accent: 'american', traits: ['energetic', 'playful'], energy: ['punchy'], note: 'upbeat, quirky' },
  { voiceId: 'bIHbv24MWmeRgasZH58o', name: 'Will', gender: 'male', accent: 'american', traits: ['warm', 'playful', 'energetic'], energy: ['clear', 'punchy'], note: 'relaxed optimist, friendly' },
  { voiceId: 'iP95p4xoKVk53GoZ742B', name: 'Chris', gender: 'male', accent: 'american', traits: ['warm', 'playful', 'calm'], energy: ['clear', 'calm'], note: 'down to earth, conversational' },
  { voiceId: 'SAz9YHcvj6GT2YYXdXww', name: 'River', gender: 'neutral', accent: 'american', traits: ['calm', 'technical', 'warm'], energy: ['calm', 'clear'], note: 'relaxed, neutral, informative' },
  { voiceId: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', gender: 'male', accent: 'american', traits: ['confident', 'premium', 'calm'], energy: ['calm', 'clear'], note: 'laid back, classy' },
  { voiceId: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male', accent: 'british', traits: ['warm', 'premium', 'calm'], energy: ['calm', 'clear'], note: 'warm British storyteller' },
  { voiceId: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', gender: 'male', accent: 'british', traits: ['confident', 'technical', 'premium'], energy: ['clear', 'calm'], note: 'authoritative British broadcaster' },
  { voiceId: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', gender: 'female', accent: 'british', traits: ['confident', 'technical', 'calm'], energy: ['clear'], note: 'clear, engaging British educator' },
  { voiceId: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', gender: 'female', accent: 'british', traits: ['warm', 'premium', 'calm'], energy: ['calm', 'clear'], note: 'velvety British, warm' },
  { voiceId: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', gender: 'male', accent: 'australian', traits: ['playful', 'warm', 'energetic'], energy: ['clear', 'punchy'], note: 'natural, casual Australian' },
]);

const byId = new Map(VOICE_CATALOG.map((v) => [v.voiceId, v]));

/** Delivery per energy: steadier and slower when calm, more expressive and quicker when punchy. */
const DELIVERY = {
  calm: { stability: 0.6, similarity_boost: 0.8, style: 0.18, use_speaker_boost: true, speed: 1.0 },
  clear: { stability: 0.5, similarity_boost: 0.8, style: 0.28, use_speaker_boost: true, speed: 1.04 },
  punchy: { stability: 0.42, similarity_boost: 0.8, style: 0.4, use_speaker_boost: true, speed: 1.08 },
};

const ENERGIES = ['calm', 'clear', 'punchy'];
const uniq = (list) => [...new Set(list.filter(Boolean))];
const str = (v) => (typeof v === 'string' ? v.trim() : '');

function splitWords(text) {
  if (Array.isArray(text)) return text.flatMap(splitWords);
  return str(text)
    .toLowerCase()
    .split(/[,;/|·]+|\band\b|\s+-\s+/)
    .map((w) => w.replace(/[^a-z\s-]/g, '').trim())
    .filter((w) => w && w.length <= 24);
}

function axisOf(word) {
  for (const id of AXIS_IDS) {
    if (AXES[id].some((stem) => word === stem || word.includes(stem))) return id;
  }
  return null;
}

/**
 * The one tone profile for a video: `{ words, axes, lead, energy, purpose, persona, rules, accent }`.
 * `axes` scores each tone axis; `lead` lists the strongest first.
 */
export function toneProfile({ config = {}, brief = null, brand = {}, purpose = 'overview', energy = null } = {}) {
  const own = config.tone && typeof config.tone === 'object' ? config.tone : null;
  const written = uniq([
    ...splitWords(own?.words || (typeof config.tone === 'string' ? config.tone : '')),
    ...splitWords(brief?.story?.tone),
    ...splitWords(brand?.tone?.words || (typeof brand?.tone === 'string' ? brand.tone : '')),
  ]).slice(0, 6);
  const words = written.length ? written : PURPOSE_WORDS[purpose] || PURPOSE_WORDS.overview;
  const axes = Object.fromEntries(AXIS_IDS.map((id) => [id, 0]));
  words.forEach((w, i) => {
    const axis = axisOf(w);
    if (axis) axes[axis] += i < 3 ? 2 : 1;
  });
  for (const w of PURPOSE_WORDS[purpose] || []) {
    const axis = axisOf(w);
    if (axis) axes[axis] += 0.5;
  }
  const lead = AXIS_IDS.filter((id) => axes[id] > 0).sort((a, b) => axes[b] - axes[a] || AXIS_IDS.indexOf(a) - AXIS_IDS.indexOf(b));
  const fromConfig = config.direction?.motion?.energy;
  const fromTone = axes.energetic + axes.playful > axes.calm + axes.premium + 1 ? 'punchy' : axes.calm + axes.premium > axes.energetic + axes.playful + 1 ? 'calm' : null;
  const resolved = [fromConfig, energy, fromTone, brand?.motion?.energy].find((e) => ENERGIES.includes(e)) || 'clear';
  const text = `${words.join(' ')} ${str(brief?.story?.tone)} ${str(brand?.tone?.accent)}`.toLowerCase();
  const accent = /\bbrit|\buk\b|english accent/.test(text) ? 'british' : /austral/.test(text) ? 'australian' : /americ|\bus\b/.test(text) ? 'american' : null;
  const top = lead.length ? lead : ['calm', 'confident'];
  return {
    words,
    axes,
    lead: top,
    energy: resolved,
    purpose,
    accent,
    persona: str(own?.persona) || PERSONA[top[0]],
    rules: top.slice(0, 3).map((id) => RULES[id]),
    avoid: uniq([...(Array.isArray(own?.avoid) ? own.avoid.map(str) : []), ...(Array.isArray(brief?.story?.avoid) ? brief.story.avoid.map(str) : [])]).slice(0, 8),
  };
}

/** Score one catalog voice against the profile. */
function voiceScore(voice, profile) {
  let s = 0;
  voice.traits.forEach((t, i) => (s += (profile.axes[t] || 0) * (i === 0 ? 1.4 : 1)));
  if (voice.energy.includes(profile.energy)) s += 2;
  else if (voice.energy[0] && Math.abs(ENERGIES.indexOf(voice.energy[0]) - ENERGIES.indexOf(profile.energy)) > 1) s -= 2;
  if (profile.accent) s += voice.accent === profile.accent ? 3 : -1;
  if (profile.purpose === 'onboarding' && voice.traits.includes('calm')) s += 0.6;
  if (profile.purpose === 'sales' && voice.traits.includes('confident')) s += 0.6;
  if (profile.purpose === 'launch' && voice.traits.includes('energetic')) s += 0.6;
  return s;
}

/** Candidates best first, for the report and the agent's shortlist. */
export function rankVoices(profile, { slug = '' } = {}) {
  const rand = seededRandom(hashSeed('voice', slug));
  return VOICE_CATALOG.map((v) => ({ voice: v, score: voiceScore(v, profile) + rand() * 0.35 })).sort((a, b) => b.score - a.score);
}

function directionTag(profile) {
  const words = profile.words.slice(0, 2).join(', ');
  const kind = profile.purpose === 'onboarding' ? 'guided product narration' : profile.purpose === 'sales' ? 'product demo narration' : 'product narration';
  return `[${words || 'clear'}, ${kind}]`;
}

/**
 * The narrator: `{ voice, source, reason }`. A brand that chose its own voice keeps it (the delivery
 * is tuned to this video); otherwise the best catalog fit for the tone.
 */
export function pickVoice(profile, { brand = {}, slug = '' } = {}) {
  const settings = { ...DELIVERY[profile.energy] };
  const brandVoice = brand?.audio?.voice;
  const direction = directionTag(profile);
  if (brandVoice?.voiceId && brandVoice.voiceId !== DEFAULT_VOICE_ID) {
    return {
      voice: { direction, settings: { ...(brandVoice.settings || {}), stability: settings.stability, style: settings.style, speed: settings.speed } },
      name: brandVoice.name || brandVoice.voiceId,
      source: 'brand',
      reason: `the brand’s own narrator, delivery tuned to ${profile.energy}`,
    };
  }
  const [best] = rankVoices(profile, { slug });
  const v = best.voice;
  return {
    voice: { name: v.name, voiceId: v.voiceId, direction, settings },
    name: v.name,
    source: 'catalog',
    reason: `${v.note} — fits ${profile.lead.slice(0, 2).join(' + ')} at ${profile.energy} energy`,
  };
}

/** Genre, instruments and tempo range by energy; the lead tone axis colours the instrumentation. */
const MUSIC_BASE = {
  calm: { genre: 'ambient electronic underscore', tempo: [78, 90], pulse: 'slow, gentle pulse', mood: 'reassuring and open' },
  clear: { genre: 'modern electronic underscore', tempo: [94, 106], pulse: 'steady mid-tempo pulse', mood: 'optimistic and clear' },
  punchy: { genre: 'upbeat electronic pop instrumental', tempo: [112, 124], pulse: 'driving four-on-the-floor pulse', mood: 'energetic and forward-moving' },
};
const MUSIC_COLOUR = {
  warm: ['warm felt piano', 'soft acoustic guitar plucks', 'analog pads'],
  confident: ['clean synth bass', 'tight light percussion', 'wide pads'],
  energetic: ['bright synth plucks', 'crisp claps', 'sidechained pads'],
  calm: ['soft electric piano', 'airy pads', 'light shaker'],
  playful: ['marimba', 'bouncy synth plucks', 'finger snaps'],
  technical: ['precise arpeggiated synths', 'glassy plucks', 'tight electronic percussion'],
  premium: ['minimal felt piano', 'subtle string pads', 'deep sub swells'],
};
const PURPOSE_ARC = {
  overview: { mood: 'confident, curious', bed: 'warm momentum under the story' },
  feature: { mood: 'focused, curious', bed: 'focused and steady' },
  onboarding: { mood: 'patient, encouraging', bed: 'patient and encouraging' },
  launch: { mood: 'anticipation and lift', bed: 'building momentum' },
  sales: { mood: 'confident, decisive', bed: 'confident forward motion' },
};

/** Brand music phrases that are instrumentation (not tempo, mix or mood) — the brand's sonic signature. */
function signatureOf(brandMusic) {
  const styles = Array.isArray(brandMusic?.styles) ? brandMusic.styles : [];
  return styles.filter((s) => /piano|synth|pad|guitar|bass|string|marimba|pluck|percussion|kick|drum|bell|keys|brass|choir|organ/i.test(s) && !/bpm/i.test(s)).slice(0, 3);
}

/**
 * An ElevenLabs music brief for this video: `{ styles, negativeStyles, intro, bed, outro, sections, bpm }`.
 * `sections` are cues the bed cycles through when it is composed in several parts, so a long bed
 * evolves instead of repeating one loop.
 */
export function craftMusic(profile, { brand = {}, slug = '', lengthSec = 120 } = {}) {
  const base = MUSIC_BASE[profile.energy] || MUSIC_BASE.clear;
  const rand = seededRandom(hashSeed('music', slug, profile.words.join(',')));
  const bpm = base.tempo[0] + Math.round(rand() * (base.tempo[1] - base.tempo[0]));
  const lead = profile.lead[0] || 'calm';
  const second = profile.lead[1];
  const brandMusic = brand?.audio?.music;
  const signature = brandMusic && JSON.stringify(brandMusic.styles || []) !== JSON.stringify(DEFAULT_MUSIC_STYLES) ? signatureOf(brandMusic) : [];
  const colour = signature.length ? signature : uniq([...(MUSIC_COLOUR[lead] || []).slice(0, 2), ...(second ? (MUSIC_COLOUR[second] || []).slice(0, 1) : [])]);
  const arc = PURPOSE_ARC[profile.purpose] || PURPOSE_ARC.overview;
  const feel = profile.words.slice(0, 2).join(' and ') || base.mood;
  const arcMood = arc.mood.split(/,\s*/).filter((w) => !feel.includes(w)).join(', ');
  const hasPulse = colour.some((c) => /pulse|kick|beat|groove/i.test(c));
  const styles = uniq([
    base.genre,
    ...colour,
    hasPulse ? null : base.pulse,
    feel,
    arcMood,
    `${bpm} BPM`,
    'spacious mix that leaves room for voice-over',
    'great production quality',
    'instrumental',
  ]);
  const negativeStyles = uniq([
    'vocals',
    'lyrics',
    'choir',
    'spoken word',
    'harsh',
    'distorted guitar',
    'busy melody',
    'aggressive drops',
    profile.energy === 'punchy' ? null : 'heavy drums',
    profile.energy === 'calm' ? 'fast' : null,
    profile.lead.includes('premium') ? 'cheesy' : null,
    profile.lead.includes('playful') ? null : 'comedic',
    'lo-fi',
  ]);
  const intro = profile.energy === 'punchy'
    ? ['bright riser into the first beat', 'logo hit on the downbeat', 'product reveal']
    : profile.energy === 'calm'
      ? ['soft swell from silence', 'pads bloom open', 'product reveal']
      : ['clean open swell', 'pulse enters after two bars', 'product reveal'];
  const bed = ['background music under narration', 'understated', arc.bed, 'no lead melody over the voice'];
  const outro = profile.energy === 'punchy'
    ? ['final lift', 'resolving on the tonic', 'clean button ending']
    : ['resolving', 'warm final chord under the logo', 'gentle tail'];
  const parts = Math.max(1, Math.ceil(Number(lengthSec || 120) / 110));
  const sections = parts > 1
    ? [['settled groove'], ['slight lift, new texture enters'], ['brief breakdown, pads only'], ['groove returns, fuller']].slice(0, Math.min(4, parts))
    : [];
  return { styles, negativeStyles, intro, bed, outro, ...(sections.length ? { sections } : {}), bpm };
}

/** The kit default bed's styles (`DEFAULT_BRAND_AUDIO.music.styles`) — a brand that still has them never chose a sound. */
export const DEFAULT_MUSIC_STYLES = Object.freeze([
  'modern SaaS underscore',
  'soft electric piano',
  'light synth pads',
  'subtle pulse',
  'optimistic and clear',
  '88 BPM',
  'spacious mix',
  'instrumental',
]);

/** The `tone` object stored on a video. */
export function toneRecord(profile) {
  return {
    words: profile.words.slice(0, 4),
    persona: profile.persona,
    do: profile.rules.map((r) => r.do),
    avoid: uniq([...profile.rules.map((r) => r.avoid), ...profile.avoid]),
  };
}

/** Voice and tone as prompt text: one voice across captions, plate copy and narration. */
export function toneBlock(profile) {
  const rec = toneRecord(profile);
  return [
    `## Voice and tone — ${rec.words.join(', ')} · ${profile.energy} energy`,
    `Speak as ${rec.persona}. Captions, chapter cards, plate copy and every spoken line share this one voice: the viewer must never hear one personality and read another.`,
    ...rec.do.map((d) => `- Do: ${d}`),
    ...rec.avoid.map((a) => `- Avoid: ${a}`),
    `- On screen the words are short and visual (titles ≤5 words, bodies ≤12); spoken lines say the why behind the screen in the same voice (≤28 words). Never read the caption aloud word for word.`,
    profile.energy === 'calm'
      ? '- Pace: unhurried. Leave a breath after each payoff; no exclamation marks.'
      : profile.energy === 'punchy'
        ? '- Pace: brisk. Short lines, strong verbs up front; one exclamation mark at most, on the biggest payoff.'
        : '- Pace: steady and clear. Vary sentence length; at most one exclamation mark in the whole video.',
  ].join('\n');
}

/** Prompt text for agents that choose the narrator and the score (draft, voice, brand discovery). */
export function soundGuide(profile, { brand = {}, slug = '' } = {}) {
  const ranked = rankVoices(profile, { slug }).slice(0, 5);
  const pick = pickVoice(profile, { brand, slug });
  const music = craftMusic(profile, { brand, slug });
  const catalog = VOICE_CATALOG.map((v) => `  ${v.name} ${v.voiceId} — ${v.gender}, ${v.accent}, ${v.note}; ${v.traits.join('/')}; ${v.energy.join('/')}`).join('\n');
  return [
    '## Sound — narrator and music bed',
    `The narrator and the bed carry the same tone as the copy (${profile.words.join(', ')}, ${profile.energy}).`,
    pick.source === 'brand'
      ? `Narrator: keep the brand’s own voice (${pick.name}); tune only direction and settings for this video.`
      : `Narrator: pick from this catalog (eleven_v4, every language). Best fits for this tone: ${ranked.map((r) => r.voice.name).join(', ')}.\n${catalog}`,
    `Delivery for ${profile.energy}: settings ${JSON.stringify(DELIVERY[profile.energy])}; direction is a short bracketed performance cue, e.g. ${directionTag(profile)}.`,
    `Music: a brief ElevenLabs can compose — genre, 2–3 instruments, pulse, mood, one "<n> BPM", "instrumental" and room for the voice; negativeStyles always exclude vocals and lyrics. Shape the arc: intro (the open plate reveal), bed (sits under narration, no lead melody), outro (resolves under the logo). A sketch for this tone:\n  ${JSON.stringify({ styles: music.styles, negativeStyles: music.negativeStyles, intro: music.intro, bed: music.bed, outro: music.outro })}`,
  ].join('\n');
}

/** Spoken strings in a narration.mjs source (values, not keys), for a sync audit. */
export function narrationLines(source = '') {
  const out = [];
  const re = /(['"`])((?:\\.|(?!\1)[^\\])*)\1(\s*:)?/g;
  for (let m; (m = re.exec(String(source))); ) {
    if (m[3]) continue;
    const text = m[2].replace(/\\(['"`\\])/g, '$1').replace(/\s+/g, ' ').trim();
    if (text.split(' ').length >= 3) out.push(text);
  }
  return out;
}

function plateStrings(config = {}) {
  const out = [];
  const walk = (v, path) => {
    if (typeof v === 'string') out.push({ path, text: v });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!['style', 'motion', 'layout', 'type', 'id', 'before', 'asset', 'logo', 'icon', 'src'].includes(k)) walk(x, `${path}.${k}`);
  };
  walk(config.open, 'open');
  walk(config.close, 'close');
  (config.interstitials || []).forEach((it, i) => walk(it, `interstitials[${i}]`));
  return out;
}

const HEDGE_RE = /\b(might|could|try to|hopefully|kind of|sort of|basically|simply|just)\b/i;

/** Tone findings over narration lines and plate copy: `{ id, severity, message, fix }[]`. */
export function auditTone({ narrationSource = '', config = {}, profile } = {}) {
  const lines = narrationLines(narrationSource);
  const plates = plateStrings(config);
  const findings = [];
  const add = (f) => findings.push(f);
  const long = lines.filter((l) => l.split(' ').length > 28);
  if (long.length) add({ id: 'line-long', severity: 'warn', message: `${long.length} spoken line(s) run past 28 words: “${long[0].slice(0, 60)}…”.`, fix: 'Split the idea or cut the clause the screen already shows.' });
  const bangs = lines.filter((l) => l.includes('!')).length + plates.filter((p) => p.text.includes('!')).length;
  const maxBangs = profile.energy === 'calm' || profile.lead.includes('premium') ? 0 : 1;
  if (bangs > maxBangs) add({ id: 'exclaim', severity: 'warn', message: `${bangs} exclamation mark(s) for a ${profile.words.join(', ')} voice.`, fix: maxBangs ? 'Keep one, on the biggest payoff.' : 'Drop them; let the result carry the energy.' });
  const all = [...lines, ...plates.map((p) => p.text)].join(' \n ').toLowerCase();
  const empty = EMPTY_WORDS.filter((w) => new RegExp(`\\b${w}\\b`).test(all));
  if (empty.length) add({ id: 'empty-words', severity: 'warn', message: `Marketing filler in the copy: ${empty.slice(0, 5).join(', ')}.`, fix: 'Replace each with the concrete result the viewer sees.' });
  const banned = (profile.avoid || []).filter((w) => w && w.length <= 30 && all.includes(w.toLowerCase()));
  if (banned.length) add({ id: 'avoid-list', severity: 'warn', message: `The brief says to avoid: ${banned.join(', ')}.`, fix: 'Rewrite those lines without it.' });
  if (profile.lead.includes('confident')) {
    const hedged = lines.filter((l) => HEDGE_RE.test(l));
    if (hedged.length) add({ id: 'hedges', severity: 'info', message: `${hedged.length} hedged line(s) in a confident voice: “${hedged[0].slice(0, 60)}”.`, fix: 'State the result as a fact.' });
  }
  if (lines.length >= 3 && !lines.some((l) => /\b(you|your|you['’]ll|you['’]re)\b/i.test(l))) {
    add({ id: 'no-viewer', severity: 'warn', message: 'No spoken line talks to the viewer (“you”).', fix: 'Second person, present tense: “you see who is free”.' });
  }
  const cold = lines.filter((l) => /\bthe user(s)?\b|\busers are able\b|\bthe system\b/i.test(l));
  if (cold.length) add({ id: 'cold', severity: 'info', message: `${cold.length} line(s) speak about “the user” instead of to the viewer.`, fix: 'Say “you”.' });
  const opener = lines[0] || '';
  if (/^(hi|hello|welcome)\b/i.test(opener)) add({ id: 'opener', severity: 'warn', message: `The intro opens on a greeting: “${opener.slice(0, 50)}”.`, fix: 'Open on the viewer’s job or the outcome they came for.' });
  const caps = plates.filter((p) => /[A-Z]{5,}/.test(p.text) && p.text === p.text.toUpperCase() && /[A-Z]/.test(p.text));
  if (caps.length) add({ id: 'all-caps', severity: 'info', message: `${caps.length} plate string(s) typed in ALL CAPS (${caps[0].path}).`, fix: 'Sentence case; the template sets kickers in caps.' });
  return { lines: lines.length, plateStrings: plates.length, findings };
}

/**
 * Fill the sound and tone a draft left open: `config.tone`, `config.audio.voice`, `config.audio.music`.
 * Returns `{ config, applied, profile, voice, music, audit, report }`.
 */
export function enrichSound(config = {}, { slug = '', brand = {}, brief = null, purpose = 'overview', energy = null, narrationSource = '' } = {}) {
  const next = { ...config };
  const applied = [];
  const profile = toneProfile({ config, brief, brand, purpose, energy });
  if (!next.tone || typeof next.tone !== 'object' || !Array.isArray(next.tone.words) || !next.tone.words.length) {
    next.tone = toneRecord(profile);
    applied.push(`tone=${next.tone.words.join(', ')}`);
  }
  const audio = { ...(next.audio || {}) };
  const own = audio.voice || {};
  let voiceNote;
  if (own.voiceId && (byId.has(own.voiceId) || /^[A-Za-z0-9]{20}$/.test(own.voiceId))) {
    const v = byId.get(own.voiceId);
    voiceNote = `${own.name || v?.name || own.voiceId} (chosen in the draft)`;
    if (!own.direction || !own.settings) {
      const pick = pickVoice(profile, { slug });
      audio.voice = { ...own, direction: own.direction || pick.voice.direction, settings: { ...DELIVERY[profile.energy], ...(own.settings || {}) } };
      applied.push('voice delivery');
    }
  } else {
    const pick = pickVoice(profile, { brand, slug });
    audio.voice = { ...own, ...pick.voice };
    delete audio.voice.voiceId;
    if (pick.voice.voiceId) audio.voice.voiceId = pick.voice.voiceId;
    voiceNote = `${pick.name} — ${pick.reason}`;
    applied.push(`voice=${pick.name}`);
  }
  const music = craftMusic(profile, { brand, slug, lengthSec: brief?.story?.lengthSec });
  const ownMusic = audio.music || {};
  if (!Array.isArray(ownMusic.styles) || !ownMusic.styles.length) {
    const { bpm, ...crafted } = music;
    audio.music = { ...ownMusic, ...crafted };
    applied.push(`music=${music.styles[0]} · ${bpm} BPM`);
  } else if (!(ownMusic.negativeStyles || []).some((s) => /vocal/i.test(s))) {
    audio.music = { ...ownMusic, negativeStyles: uniq([...(ownMusic.negativeStyles || []), 'vocals', 'lyrics']) };
    applied.push('music negativeStyles += vocals');
  }
  next.audio = audio;
  const audit = auditTone({ narrationSource, config: next, profile });
  const report = soundReport({ slug, profile, voiceNote, music: next.audio.music, audit, applied });
  return { config: next, applied, profile, voice: next.audio.voice, music: next.audio.music, audit, report };
}

/** Markdown summary of the sound pass. */
export function soundReport({ slug = '', profile, voiceNote, music = {}, audit, applied = [] }) {
  const lines = [
    `# Sound and tone${slug ? ` — ${slug}` : ''}`,
    '',
    `Tone: ${profile.words.join(', ')} · ${profile.energy} energy · ${profile.purpose}`,
    `Persona: ${profile.persona}`,
    `Narrator: ${voiceNote}`,
    `Music: ${(music.styles || []).join(' · ')}`,
    music.negativeStyles?.length ? `Never: ${music.negativeStyles.join(', ')}` : '',
    music.intro?.length ? `Arc: intro ${music.intro.join(', ')} → bed ${(music.bed || []).join(', ')} → outro ${(music.outro || []).join(', ')}` : '',
    '',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
  if (applied.length) lines.push('Applied:', ...applied.map((a) => `- ${a}`), '');
  lines.push(audit.findings.length ? 'Tone findings:' : `Tone check: ${audit.lines} spoken line(s) and ${audit.plateStrings} plate string(s) speak in one voice.`);
  for (const f of audit.findings) lines.push(`- ${f.severity === 'warn' ? '⚠' : '·'} ${f.message}\n  → ${f.fix}`);
  return lines.join('\n') + '\n';
}

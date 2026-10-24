import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compositionPlan } from './audio/music.mjs';
import {
  DEFAULT_VOICE_ID,
  VOICE_CATALOG,
  auditTone,
  craftMusic,
  enrichSound,
  narrationLines,
  pickVoice,
  toneBlock,
  toneProfile,
} from './soundCraft.mjs';

const defaultBrand = { name: 'Acme', audio: { voice: { voiceId: DEFAULT_VOICE_ID, name: 'Matilda' }, music: { styles: ['x'] } } };

test('the tone profile reads the brief first, then falls back to the purpose', () => {
  const p = toneProfile({ brief: { story: { tone: 'calm, premium, reassuring' } }, purpose: 'sales' });
  assert.deepEqual(p.words.slice(0, 3), ['calm', 'premium', 'reassuring']);
  assert.equal(p.energy, 'calm');
  assert.ok(p.lead.includes('calm'));

  const fallback = toneProfile({ purpose: 'launch' });
  assert.deepEqual(fallback.words, ['energetic', 'confident', 'bright']);
  assert.equal(fallback.energy, 'punchy');

  assert.equal(toneProfile({ brief: { story: { tone: 'calm' } }, config: { direction: { motion: { energy: 'punchy' } } } }).energy, 'punchy');
});

test('the narrator follows the tone, the accent and a brand’s own voice', () => {
  const calm = pickVoice(toneProfile({ brief: { story: { tone: 'calm, premium, authoritative' } } }), { brand: defaultBrand, slug: 'a' });
  const playful = pickVoice(toneProfile({ brief: { story: { tone: 'playful, energetic, fun' } } }), { brand: defaultBrand, slug: 'a' });
  assert.equal(calm.source, 'catalog');
  assert.notEqual(calm.voice.voiceId, playful.voice.voiceId);
  const calmVoice = VOICE_CATALOG.find((v) => v.voiceId === calm.voice.voiceId);
  const playfulVoice = VOICE_CATALOG.find((v) => v.voiceId === playful.voice.voiceId);
  assert.ok(calmVoice.energy.includes('calm'));
  assert.ok(playfulVoice.traits.some((t) => t === 'playful' || t === 'energetic'));
  assert.ok(playful.voice.settings.speed > calm.voice.settings.speed);
  assert.ok(playful.voice.settings.style > calm.voice.settings.style);

  const british = pickVoice(toneProfile({ brief: { story: { tone: 'warm, British, thoughtful' } } }), { brand: defaultBrand });
  assert.equal(VOICE_CATALOG.find((v) => v.voiceId === british.voice.voiceId).accent, 'british');

  const own = pickVoice(toneProfile({ brief: { story: { tone: 'energetic' } } }), {
    brand: { audio: { voice: { voiceId: 'nPczCjzI2devNBz1zQrb', name: 'Brian', settings: { similarity_boost: 0.9 } } } },
  });
  assert.equal(own.source, 'brand');
  assert.equal(own.voice.voiceId, undefined, 'the brand voice id stays in the pack');
  assert.equal(own.voice.settings.similarity_boost, 0.9);
});

test('the music brief carries genre, tempo, an arc and no vocals', () => {
  const calm = craftMusic(toneProfile({ brief: { story: { tone: 'calm, warm' } } }), { slug: 'demo', brand: defaultBrand });
  const punchy = craftMusic(toneProfile({ brief: { story: { tone: 'energetic, bold, playful' } } }), { slug: 'demo', brand: defaultBrand });
  assert.ok(calm.bpm < punchy.bpm);
  assert.ok(calm.styles.includes(`${calm.bpm} BPM`));
  assert.ok(calm.styles.includes('instrumental'));
  for (const m of [calm, punchy]) {
    assert.ok(m.negativeStyles.includes('vocals'));
    assert.ok(m.intro.length && m.bed.length && m.outro.length);
  }
  assert.ok(calm.negativeStyles.includes('heavy drums'));
  assert.ok(!punchy.negativeStyles.includes('heavy drums'));
  assert.deepEqual(craftMusic(toneProfile({ brief: { story: { tone: 'calm, warm' } } }), { slug: 'demo', brand: defaultBrand }), calm, 'deterministic');

  const signed = craftMusic(toneProfile({}), { brand: { audio: { music: { styles: ['warm analog pads', 'clean synth pulse', '100 BPM'] } } } });
  assert.ok(signed.styles.includes('warm analog pads'), 'a brand with its own sound keeps its instruments');
});

test('a long bed evolves through sections instead of repeating', () => {
  const music = craftMusic(toneProfile({}), { lengthSec: 600 });
  assert.ok(music.sections.length >= 2);
  const plan = compositionPlan({ ...music, model: 'music_v2_5' }, { totalSec: 600, openSec: 5, closeSec: 6 });
  const beds = plan.chunks.slice(1, -1).map((c) => c.positive_styles.join('|'));
  assert.ok(beds.length > 2);
  assert.notEqual(beds[0], beds[1]);
  assert.equal(craftMusic(toneProfile({}), { lengthSec: 90 }).sections, undefined);
});

test('the tone audit flags lines that break the voice', () => {
  const profile = toneProfile({ brief: { story: { tone: 'calm, confident', avoid: ['cheap'] } } });
  const narration = `export default {
    intro: 'Welcome to Acme, the seamless way the user plans!',
    lines: {
      'Plan the week': 'It might help the team plan the week without the cheap spreadsheets.',
      'Book': { text: 'One click books the room for the whole team today.' },
    },
  };`;
  assert.deepEqual(narrationLines(narration).length, 3);
  const { findings } = auditTone({ narrationSource: narration, config: { open: { title: 'PLAN FASTER' } }, profile });
  const ids = findings.map((f) => f.id);
  for (const id of ['exclaim', 'empty-words', 'avoid-list', 'hedges', 'no-viewer', 'cold', 'opener', 'all-caps']) assert.ok(ids.includes(id), id);

  const clean = auditTone({
    narrationSource: `export default { intro: 'You see the whole week at a glance.', lines: { 'A': 'Your team books a room in one click.', 'B': 'You know who is free before you ask.' } };`,
    config: { open: { title: 'Plan the week' } },
    profile,
  });
  assert.deepEqual(clean.findings, []);
});

test('enrichSound fills only what the draft left open', () => {
  const brief = { story: { tone: 'warm, plain-spoken, patient', lengthSec: 90 } };
  const filled = enrichSound({}, { slug: 'demo', brand: defaultBrand, brief, purpose: 'onboarding' });
  assert.ok(filled.config.tone.words.includes('warm'));
  assert.ok(filled.config.audio.voice.voiceId);
  assert.match(filled.config.audio.voice.direction, /^\[warm/);
  assert.ok(filled.config.audio.music.styles.length > 4);
  assert.equal(filled.config.audio.music.bpm, undefined);
  assert.match(filled.report, /Narrator: /);

  const chosen = {
    tone: { words: ['bold'], persona: 'p', do: [], avoid: [] },
    audio: { voice: { voiceId: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam' }, music: { styles: ['house'], negativeStyles: [] } },
  };
  const kept = enrichSound(chosen, { slug: 'demo', brand: defaultBrand, brief });
  assert.deepEqual(kept.config.tone, chosen.tone);
  assert.equal(kept.config.audio.voice.voiceId, 'TX3LPaxmHKxFdv7VOQHJ');
  assert.ok(kept.config.audio.voice.settings, 'delivery is filled in');
  assert.deepEqual(kept.config.audio.music.styles, ['house']);
  assert.ok(kept.config.audio.music.negativeStyles.includes('vocals'));
});

test('the tone block gives every writer the same voice', () => {
  const block = toneBlock(toneProfile({ brief: { story: { tone: 'calm, premium' } } }));
  assert.match(block, /Voice and tone — calm, premium · calm energy/);
  assert.match(block, /no exclamation marks/);
  assert.match(block, /Captions, chapter cards, plate copy and every spoken line share this one voice/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRepeats, narrationRepeats, scriptSpokenLines } from './narrationQc.mjs';
import { narrationGate, narrationRepairPrompt } from './agentRunner.mjs';
import { spokenRepeats } from './audio/voice.mjs';
import { critiqueRepeats } from './critic.mjs';

const rules = (findings, rule) => findings.filter((f) => f.rule === rule);

test('two lines making the same point are a high near-duplicate on the later line', () => {
  const f = narrationRepeats([
    { key: 'Open show', kind: 'line', text: 'Show is where builders ship — pick a row with points and discussion.' },
    { key: 'Show HN', kind: 'line', text: 'Show is where builders ship — pick a row with real discussion.' },
  ]);
  const dup = rules(f, 'near-duplicate');
  assert.equal(dup.length, 1);
  assert.equal(dup[0].severity, 'high');
  assert.equal(dup[0].key, 'Show HN');
  assert.deepEqual(dup[0].keys, ['Open show', 'Show HN']);
});

test('a phrase said three times is high and quoted as written, not stemmed', () => {
  const f = narrationRepeats([
    { key: 'a', text: 'Built for founders of startups who ship weekly.' },
    { key: 'b', text: 'Pricing works for founders of startups at any stage.' },
    { key: 'c', text: 'Ask other founders of startups before you launch.' },
  ]);
  const rep = rules(f, 'repeated-phrase');
  assert.equal(rep.length, 1);
  assert.equal(rep[0].severity, 'high');
  assert.equal(rep[0].phrase, 'founders of startups');
  assert.deepEqual(rep[0].keys, ['a', 'b', 'c']);
});

test('a screen name taken from an on-screen title is not a repeat', () => {
  const f = narrationRepeats([
    { key: 'Front page feed', title: 'Front page feed', text: 'The front page feed ranks what the crowd liked today.' },
    { key: 'Go back', title: 'Go back', text: 'Back on the front page feed, the ranking has moved.' },
    { key: 'Again', title: 'Again', text: 'Every visit to the front page feed shows something new.' },
  ]);
  assert.equal(rules(f, 'repeated-phrase').length, 0);
});

test('a two-word noun in two lines is not reported', () => {
  const f = narrationRepeats([
    { key: 'a', text: 'Open the comment thread to read the argument.' },
    { key: 'b', text: 'A long comment thread hides the best answer at the bottom.' },
  ]);
  assert.equal(rules(f, 'repeated-phrase').length, 0);
});

test('intro and outro may echo a short phrase', () => {
  const f = narrationRepeats([
    { key: 'intro', kind: 'intro', text: 'Find the right stories in five minutes a day.' },
    { key: 'Feed', kind: 'line', text: 'The feed ranks by votes and age.' },
    { key: 'outro', kind: 'outro', text: 'Right stories, five minutes, every morning.' },
  ]);
  assert.equal(f.filter((x) => x.severity !== 'low').length, 0);
});

test('reading the on-screen text aloud is flagged; a lowercase start is low', () => {
  const f = narrationRepeats([
    { key: 'Book', text: 'Book a room for the whole team in one click.', onScreen: 'Book a room for the whole team' },
    { key: 'Next', text: 'then pick a slot that suits everyone.' },
  ]);
  assert.equal(rules(f, 'reads-screen')[0]?.key, 'Book');
  assert.equal(rules(f, 'lowercase-start')[0]?.severity, 'low');
});

test('audio tags, emphasis and ellipses are not words', () => {
  const f = narrationRepeats([
    { key: 'a', text: '[warm] Your week... *sorted*.' },
    { key: 'b', text: '[warm] [slightly faster] Pick the project you care about.' },
  ]);
  assert.equal(f.length, 0);
});

test('stopwords stay stopwords after stemming (this/does do not inflate near-dupes)', async () => {
  const { tokens } = await import('./narrationQc.mjs');
  const toks = tokens('this that those these is has does');
  assert.ok(toks.includes('this'));
  assert.ok(toks.includes('does'));
  assert.equal(toks.includes('thi'), false);
  assert.equal(toks.includes('doe'), false);
});

test('scriptSpokenLines keys plates apart from lines and only chapters/says carry screen text', () => {
  const lines = scriptSpokenLines([
    { key: 'open', kind: 'open', narration: 'Hi there.', narrationKind: 'intro', narrationKey: 'intro', title: 'Open', onScreen: 'Open' },
    { key: 'p', kind: 'plate', narration: 'A plate line.', narrationKind: 'plate', narrationKey: 'map', title: 'Map', onScreen: 'Map body' },
    { key: 'c', kind: 'chapter', narration: 'A chapter line.', narrationKind: 'line', narrationKey: 'Feed', title: 'Feed', onScreen: 'Feed body' },
    { key: 'x', kind: 'say', narration: '' },
  ]);
  assert.deepEqual(lines.map((l) => l.key), ['intro', 'plate:map', 'Feed']);
  assert.deepEqual(lines.map((l) => l.onScreen), ['', '', 'Feed body']);
});

test('formatRepeats marks high findings as blocking', () => {
  const out = formatRepeats([
    { severity: 'high', message: 'A' },
    { severity: 'medium', message: 'B' },
  ]);
  assert.equal(out, '✗ A\n⚠ B');
});

const dupScenes = (second) => [
  { key: 's1', kind: 'chapter', narration: 'Show is where builders ship — pick a row with points and discussion.', narrationKind: 'line', narrationKey: 'Open show', title: 'Open show' },
  { key: 's2', kind: 'chapter', narration: second, narrationKind: 'line', narrationKey: 'Show HN', title: 'Show HN' },
];

test('narrationGate sends the agent back on a high repeat, then lets the edit stand', async () => {
  const job = { log: [] };
  const video = { slug: 'demo', dir: '/tmp/demo' };
  const gate = narrationGate(video, job, {
    load: () => video,
    script: async () => ({ scenes: dupScenes('Show is where builders ship — pick a row with real discussion.') }),
  });
  const first = await gate();
  assert.match(first.prompt, /NARRATION CHECK FAILED/);
  assert.match(first.prompt, /Edit only \/tmp\/demo\/narration\.mjs/);
  assert.match(first.prompt, /✗ Says the same as "Open show"/);
  await gate();
  assert.equal(await gate(), null, 'never fails the job after the bounded rewrites');
  assert.equal(job.verifyLabel, 'Checking the narration for repeats…');
});

test('narrationGate passes a script without repeats', async () => {
  const job = { log: [] };
  const video = { slug: 'demo', dir: '/tmp/demo' };
  const gate = narrationGate(video, job, {
    load: () => video,
    script: async () => ({ scenes: dupScenes('Real projects from real makers, with the maker answering in the thread.') }),
  });
  assert.equal(await gate(), null);
  assert.ok(job.log.some((l) => l.line.startsWith('✓ narration')));
});

test('narrationRepairPrompt keeps keys and forbids flow edits', () => {
  const p = narrationRepairPrompt({ slug: 'demo', dir: '/tmp/demo' }, [{ severity: 'high', message: 'X' }], { round: 1, max: 2 });
  assert.match(p, /Keep every key/);
  assert.match(p, /Do not edit flow\.mjs/);
});

test('voice step checks the cut order, including desk rewrites', () => {
  const slots = [
    { key: 'Open show', kind: 'caption', line: { text: 'Show is where builders ship — pick a row with points and discussion.' } },
    { key: 'ch5', kind: 'interstitial', title: 'Show HN', line: { text: 'Real projects from real makers.' } },
  ];
  assert.equal(spokenRepeats(slots).length, 0);
  const edits = new Map([['ch5', { text: 'Show is where builders ship — pick a row with real discussion.' }]]);
  const out = spokenRepeats(slots, edits);
  assert.equal(out.length, 1);
  assert.match(out[0], /^"ch5": Says the same as "Open show"/);
});

test('critic reports non-low repeats against the narration line', () => {
  const out = critiqueRepeats(dupScenes('Show is where builders ship — pick a row with real discussion.'));
  assert.equal(out.length, 1);
  assert.equal(out[0].target, 'narration:Show HN');
  assert.equal(out[0].severity, 'high');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactEdit, normalizeEdit, patchEdit } from '../editDeck.mjs';
import { compactAudio, describeAudio, musicGainExpr, normalizeAudio, resolveMix, resolveVoice, voiceLineSpec, voiceShape } from './desk.mjs';
import { musicLinearAt } from '../../studio/mixMath.js';

test('an untouched desk stores nothing and mastering overrides the brand mix', () => {
  const fresh = normalizeAudio({});
  assert.equal(compactAudio(fresh), undefined);
  assert.equal(compactEdit(normalizeEdit({ audio: { music: { gainDb: 0 } } })), undefined);
  const mixed = resolveMix({ voiceLufs: -16, plateLufs: -20, bedLufs: -31, duck: { ratio: 3, attackMs: 20 } }, normalizeAudio({ master: { voiceLufs: -18, duckRatio: 5 } }));
  assert.equal(mixed.voiceLufs, -18);
  assert.equal(mixed.plateLufs, -20);
  assert.equal(mixed.duck.ratio, 5);
  assert.equal(mixed.duck.attackMs, 20);
  assert.equal(normalizeAudio({ master: { targetLufs: -40 } }).master.targetLufs, -18, 'loudness clamps to the web range');
  assert.throws(() => normalizeAudio({ master: { targetLufs: 'loud' } }), /targetLufs/);
});

test('voice edits nudge and mute; music rides reject overlaps', () => {
  const clips = [
    { key: 'intro', start: 1.1, end: 6, duration: 4.9, file: 'a.wav' },
    { key: 'Meet', start: 8, end: 12, duration: 4, file: 'b.wav' },
  ];
  const desk = normalizeAudio({
    voice: [
      { key: 'intro', nudge: 0.4, gainDb: -3 },
      { key: 'Meet', mute: true },
      { key: 'nope', nudge: 0 },
    ],
    music: { rides: [{ from: 10, to: 14, gainDb: -6 }] },
  });
  assert.equal(desk.voice.length, 2);
  const placed = resolveVoice(clips, desk.voice);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].start, 1.5);
  assert.equal(placed[0].gainDb, -3);
  assert.throws(() => normalizeAudio({ music: { rides: [{ from: 1, to: 4, gainDb: -3 }, { from: 3, to: 6, gainDb: -3 }] } }), /overlap/);
});

test('a line can be trimmed, faded, rewritten, re-sped and re-taken on the desk', () => {
  const desk = normalizeAudio({
    voice: [
      {
        key: 'intro',
        trimStart: 0.4,
        trimEnd: 0.2,
        fadeIn: 0.1,
        fadeOut: 5,
        text: '  Hello   there ',
        speed: 1.1,
        take: 3,
        takes: 2,
        takeSources: { 1: 'eleven', 2: 'upload', 3: 'mic', nope: 'x', 99: 'upload' },
      },
      { key: 'plain', speed: 1, take: 1, text: '', fadeIn: 0 },
    ],
  });
  assert.equal(desk.voice.length, 1, 'defaults store nothing');
  const e = desk.voice[0];
  assert.deepEqual(e, {
    key: 'intro',
    trimStart: 0.4,
    trimEnd: 0.2,
    fadeIn: 0.1,
    fadeOut: 2,
    text: 'Hello there',
    speed: 1.1,
    take: 3,
    takes: 3,
    takeSources: { 1: 'eleven', 2: 'upload', 3: 'mic' },
  });
  const shape = voiceShape(4, e);
  assert.deepEqual(shape, { trimStart: 0.4, trimEnd: 0.2, fadeIn: 0.1, fadeOut: 2, duration: 3.4, full: 4 });
  const tight = voiceShape(1, { trimStart: 0.9, trimEnd: 0.9, fadeIn: 1, fadeOut: 1 });
  assert.equal(tight.duration, 0.3, 'at least 0.3s of speech stays');
  assert.equal(tight.trimStart, 0.7);
  assert.equal(tight.trimEnd, 0);
  assert.equal(tight.fadeIn + tight.fadeOut, 0.3, 'fades fit inside what plays');
  const placed = resolveVoice([{ key: 'intro', start: 1, end: 5, duration: 4, full: 4, file: 'a.wav' }], desk.voice)[0];
  assert.equal(placed.duration, 3.4);
  assert.equal(placed.end, 4.4);
  assert.equal(placed.trimStart, 0.4);
  const placedAt = resolveVoice([{ key: 'intro', start: 1, end: 5, duration: 4, full: 4, file: 'a.wav' }], [{ key: 'intro', at: 0 }])[0];
  assert.equal(placedAt.start, 0, 'an absolute place wins, and the first frame is a real place');
  assert.equal(normalizeAudio({ voice: [{ key: 'intro', at: 12.5 }] }).voice[0].at, 12.5);
  assert.deepEqual(voiceLineSpec({ text: 'Written', speed: 0.95 }, e), { text: 'Hello there', speed: 1.1, take: 3 });
  assert.deepEqual(voiceLineSpec({ text: 'Written' }, { nudge: 1 }), { text: 'Written' });
  assert.match(describeAudio(desk), /1 line regenerated/);
});

test('music can loop to fill a cut that outruns the bed', () => {
  const desk = normalizeAudio({ music: { loop: true, gainDb: -2 } });
  assert.equal(desk.music.loop, true);
  assert.equal(compactAudio(desk).music.loop, true);
  assert.match(describeAudio(desk), /music \(looped\)/);
  assert.equal(normalizeAudio({ music: { loop: false } }).music.loop, false);
  assert.equal(compactAudio(normalizeAudio({ music: { loop: false } })), undefined);
});

test('the live preview follows the bed, a ride and the voice dip', () => {
  const music = { gainDb: 0, fadeIn: 0, fadeOut: 0, offset: 0, rides: [{ from: 20, to: 24, gainDb: -6 }] };
  const levels = { plateLufs: -20, bedLufs: -31, duck: { ratio: 3 } };
  const windows = [{ start: 12, end: 40 }];
  const open = musicLinearAt(2, { music, windows, levels, total: 60 });
  const bed = musicLinearAt(18, { music, windows, levels, total: 60 });
  const ridden = musicLinearAt(22, { music, windows, levels, total: 60 });
  const ducked = musicLinearAt(18, { music, windows, levels, voiceActive: true, total: 60 });
  assert.ok(open > bed * 2, 'plates are louder than the bed');
  assert.ok(ridden < bed, 'a ride pulls the bed down further');
  assert.ok(ducked < bed, 'speech dips the music');
  assert.equal(musicLinearAt(18, { music: { ...music, mute: true }, windows, levels }), 0);
  const expr = musicGainExpr({ bedGain: 0.25, windows, rides: music.rides, gainDb: -3 });
  assert.match(expr, /0\.2500/);
  assert.match(expr, /0\.5012/);
});

test('patchEdit keeps the desk across picture edits and clears it on reset', () => {
  const deck = patchEdit({}, { audio: { music: { gainDb: -4 }, master: { targetLufs: -16 } } });
  const next = patchEdit(deck, { speed: [{ from: 1, to: 3, rate: 2 }] }, { liveDur: 20 });
  assert.equal(next.audio.music.gainDb, -4);
  assert.equal(next.audio.master.targetLufs, -16);
  assert.equal(compactEdit(patchEdit(next, { audio: null }))?.audio, undefined);
});

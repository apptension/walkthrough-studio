import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  deliveryMuxFlags,
  extendCloseForVoice,
  firstShortHold,
  mixEndSec,
  narrationSeconds,
  outroFromNarrationSource,
  shortHoldWarning,
} from './voiceHold.js';

test('a long close line lengthens the hold so the master outlasts the line', () => {
  const line = 'Start with one team this week and retire the spreadsheets before the next quarterly review with the board.';
  const narrationSec = narrationSeconds(line);
  assert.ok(narrationSec > 7, 'the fixture line is longer than a short close plate');
  const plan = {
    segments: [{ id: 'open', dur: 6 }, { id: 'close', dur: 3, padOut: 0, at: 10 }],
    total: 13,
    dClose: 3,
    closeDur: 3,
    closeAt: 10,
  };
  extendCloseForVoice(plan, narrationSec);
  assert.ok(plan.segments[1].dur >= narrationSec);
  assert.ok(plan.dClose >= narrationSec);
  assert.ok(plan.closeDur >= narrationSec);
  assert.ok(plan.total >= plan.closeAt + narrationSec);
  assert.ok(plan.segments[1].padOut > 0, 'the close plate holds its last frame through the line');
});

test('a close plate that already covers the line stays put', () => {
  const plan = {
    segments: [{ id: 'close', dur: 8, padOut: 0 }],
    total: 20,
    dClose: 8,
    closeDur: 8,
  };
  extendCloseForVoice(plan, 4);
  assert.equal(plan.total, 20);
  assert.equal(plan.dClose, 8);
  assert.equal(plan.voiceExtended || 0, 0);
});

test('the mix keeps a last word that runs past the picture estimate', () => {
  assert.equal(mixEndSec(13, [{ start: 10, duration: 8 }]), 18);
  assert.equal(mixEndSec(20, [{ start: 1, duration: 2 }]), 20);
});

test('the mux keeps the longer stream so the last word and the picture both survive', () => {
  const flags = deliveryMuxFlags();
  assert.equal(flags.includes('-shortest'), false);
  assert.equal(flags.includes('-c:v'), true);
  assert.equal(flags[flags.indexOf('-c:v') + 1], 'copy');
});

test('the editor can show the short-hold warning before Render', () => {
  const message = shortHoldWarning(3, 8.4);
  assert.match(message, /8\.4s/);
  assert.match(message, /3\.0s/);
  assert.match(message, /lengthen the hold or shorten the line/);
  assert.equal(shortHoldWarning(8, 3), '');
  const scenes = [
    { kind: 'close', holdSec: 3, narrationSec: 8.4 },
    { kind: 'chapter', holdSec: 6, narrationSec: 2 },
  ];
  assert.equal(firstShortHold(scenes), message);
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const warnAt = html.indexOf('id="voiceHoldWarn"');
  const renderAt = html.indexOf('id="btnActionPrimary"');
  assert.ok(warnAt > 0 && warnAt < renderAt, 'the warning sits above the Render button');
});

test('outro copy is read from a narration module', () => {
  const source = "export default { intro: 'Hello', outro: 'See you next week team' };";
  assert.equal(outroFromNarrationSource(source), 'See you next week team');
  assert.equal(narrationSeconds('one two three'), 3 / 2.4);
});

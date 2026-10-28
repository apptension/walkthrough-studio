import assert from 'node:assert/strict';
import test from 'node:test';
import { narrativeCraftGuide, wordBudgetForSeconds, WORDS_PER_SEC, WORDS_PER_SEC_TAKE } from './narrativeCraft.mjs';
import { storyBrief } from './narrative.mjs';

test('wordBudgetForSeconds scales with rate and caps at 28', () => {
  assert.equal(wordBudgetForSeconds(4), Math.round(4 * WORDS_PER_SEC));
  assert.equal(wordBudgetForSeconds(4, { rate: WORDS_PER_SEC_TAKE }), Math.round(4 * WORDS_PER_SEC_TAKE));
  assert.equal(wordBudgetForSeconds(20), 28);
  assert.equal(wordBudgetForSeconds(0), 0);
});

test('narrativeCraftGuide mentions chapter, caption, and timing mode', () => {
  const script = narrativeCraftGuide({ timing: 'script' });
  assert.match(script, /Chapter card/);
  assert.match(script, /\*\*Caption\*\*/);
  assert.match(script, new RegExp(String(WORDS_PER_SEC)));

  const recorded = narrativeCraftGuide({ timing: 'recorded' });
  assert.match(recorded, /timeline\.json/);
  assert.match(recorded, new RegExp(String(WORDS_PER_SEC_TAKE)));
});

test('storyBrief appends craft guide by default', () => {
  const withCraft = storyBrief('overview');
  assert.match(withCraft, /Screen, voice, and slides/);
  const without = storyBrief('overview', { craft: false });
  assert.doesNotMatch(without, /Screen, voice, and slides/);
});

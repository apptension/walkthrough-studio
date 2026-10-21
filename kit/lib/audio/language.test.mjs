import assert from 'node:assert/strict';
import test from 'node:test';
import { speechBody } from './elevenlabs.mjs';
import { clipKey } from './voice.mjs';

test('eleven_v4 speech requests carry language_code, and multilingual v2 omits it', () => {
  const body = speechBody({
    text: 'Cześć',
    voice: { model: 'eleven_v4', languageCode: 'pl', settings: { stability: 0.5 } },
  });
  assert.equal(body.model_id, 'eleven_v4');
  assert.equal(body.language_code, 'pl');
  assert.equal(body.text, 'Cześć');

  const english = speechBody({ text: 'Hello', voice: { languageCode: 'en', settings: {} } });
  assert.equal(english.model_id, 'eleven_v4');
  assert.equal(english.language_code, 'en');

  const v2 = speechBody({
    text: 'Hi',
    voice: { model: 'eleven_multilingual_v2', languageCode: 'pl', settings: {} },
  });
  assert.equal('language_code' in v2, false);
});

test('the voice cache misses when the language changes and hits when it was never set', () => {
  const voice = { voiceId: 'abcdefghijklmnopqrst', model: 'eleven_v4', settings: { speed: 1 } };
  const line = { text: 'Hello' };
  const en = clipKey({ audio: { voice }, config: { language: 'en' } }, line);
  const pl = clipKey({ audio: { voice }, config: { language: 'pl' } }, line);
  const missing = clipKey({ audio: { voice }, config: {} }, line);
  assert.equal(en.language, 'en');
  assert.equal(pl.language, 'pl');
  assert.notEqual(en.hash, pl.hash);
  assert.equal(en.hash, missing.hash);
});

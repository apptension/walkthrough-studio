import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import {
  DEFAULT_VIDEO_LANGUAGE,
  VIDEO_LANGUAGES,
  modelAcceptsLanguageCode,
  promptLanguageLine,
  requireVideoLanguage,
  resolveVideoLanguage,
  videoLanguage,
} from './languages';

describe('languages', () => {
  test('the list is sorted by name and frozen', () => {
    assert.equal(VIDEO_LANGUAGES.length, 84);
    assert.equal(VIDEO_LANGUAGES[0]!.name, 'Afrikaans');
    assert.equal(VIDEO_LANGUAGES.at(-1)!.name, 'Yoruba');
    const names = VIDEO_LANGUAGES.map((l) => l.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    assert.ok(Object.isFrozen(VIDEO_LANGUAGES) && Object.isFrozen(VIDEO_LANGUAGES[0]));
  });

  test('lookup is case- and space-insensitive; unknown resolves to English', () => {
    assert.equal(DEFAULT_VIDEO_LANGUAGE, 'en');
    assert.equal(videoLanguage(' PL ')?.name, 'Polish');
    assert.equal(videoLanguage('xx'), null);
    assert.equal(resolveVideoLanguage('xx').code, 'en');
    assert.equal(resolveVideoLanguage(undefined).code, 'en');
  });

  test('require rejects a code Eleven v4 does not support', () => {
    assert.equal(requireVideoLanguage('').code, 'en');
    assert.equal(requireVideoLanguage(null).code, 'en');
    assert.equal(requireVideoLanguage('fil').name, 'Filipino');
    assert.throws(() => requireVideoLanguage('xx'), /Choose a video language Eleven v4 supports \("xx" is not one\)/);
  });

  test('models and the prompt line', () => {
    assert.equal(modelAcceptsLanguageCode(undefined), true);
    assert.equal(modelAcceptsLanguageCode('eleven_multilingual_v2'), false);
    assert.match(promptLanguageLine('mi'), /^Video language: Māori \(mi\)\./);
    assert.match(promptLanguageLine('mi'), /as "mi"\.$/);
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VIDEO_LANGUAGES,
  modelAcceptsLanguageCode,
  requireVideoLanguage,
  resolveVideoLanguage,
  videoLanguage,
} from './languages.mjs';

/** Codes from the Eleven v4 "Supported languages" list on the models page. */
const CODES = [
  'af', 'ar', 'hy', 'as', 'ast', 'az', 'be', 'bn', 'bs', 'bg', 'my', 'yue', 'ca', 'ceb', 'hr', 'cs', 'da', 'nl', 'en', 'et',
  'fil', 'fi', 'fr', 'gl', 'ka', 'de', 'el', 'gu', 'ha', 'he', 'hi', 'hu', 'is', 'id', 'ga', 'it', 'ja', 'jv', 'kn', 'kk',
  'ko', 'ky', 'lv', 'ln', 'lt', 'lb', 'mk', 'ms', 'ml', 'mt', 'zh', 'mi', 'mr', 'mn', 'ne', 'no', 'oc', 'or', 'ps', 'fa',
  'pl', 'pt', 'pa', 'ro', 'ru', 'sr', 'sd', 'sk', 'sl', 'so', 'es', 'sw', 'sv', 'tg', 'ta', 'te', 'th', 'tr', 'uk', 'ur',
  'uz', 'vi', 'cy', 'yo',
];

test('the picker lists every Eleven v4 language_code, in name order', () => {
  assert.equal(VIDEO_LANGUAGES.length, 84);
  assert.equal(new Set(VIDEO_LANGUAGES.map((lang) => lang.code)).size, 84);
  assert.deepEqual(
    VIDEO_LANGUAGES.map((lang) => lang.code).slice().sort(),
    CODES.slice().sort(),
  );
  const names = VIDEO_LANGUAGES.map((lang) => lang.name);
  assert.deepEqual(names, names.slice().sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  assert.equal(videoLanguage('en').name, 'English');
  assert.equal(videoLanguage('pl').name, 'Polish');
  assert.equal(videoLanguage('zh').name, 'Mandarin Chinese');
  assert.equal(videoLanguage('yue').name, 'Cantonese');
  assert.equal(videoLanguage('fil').name, 'Filipino');
  assert.equal(videoLanguage('ast').name, 'Asturian');
  assert.equal(videoLanguage('ceb').name, 'Cebuano');
  assert.equal(videoLanguage('mi').name, 'Māori');
});

test('a missing language is English, and a code off the list is rejected on save', () => {
  assert.equal(resolveVideoLanguage('').code, 'en');
  assert.equal(resolveVideoLanguage('nope').code, 'en');
  assert.equal(requireVideoLanguage('').code, 'en');
  assert.equal(requireVideoLanguage('PL').code, 'pl');
  assert.throws(() => requireVideoLanguage('xx'), /Eleven v4/);
});

test('language_code is sent for Eleven v4 and not for multilingual v2', () => {
  assert.equal(modelAcceptsLanguageCode('eleven_v4'), true);
  assert.equal(modelAcceptsLanguageCode('eleven_v4_turbo'), true);
  assert.equal(modelAcceptsLanguageCode(undefined), true);
  assert.equal(modelAcceptsLanguageCode('eleven_multilingual_v2'), false);
  assert.equal(modelAcceptsLanguageCode('eleven_flash_v2'), false);
});

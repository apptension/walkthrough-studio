/**
 * Video languages Eleven v4 accepts as `language_code`.
 * Source: https://elevenlabs.io/docs/overview/models — Eleven v4 "Supported languages".
 * ISO 639-1, except Asturian, Cantonese, Cebuano, and Filipino (ISO 639-3).
 * Names that the Eleven v4 FAQ lists without a code stay off this list.
 */

import { asText } from './text';

export interface VideoLanguage {
  readonly code: string;
  readonly name: string;
}

const SOURCE: VideoLanguage[] = [
  { code: 'af', name: 'Afrikaans' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hy', name: 'Armenian' },
  { code: 'as', name: 'Assamese' },
  { code: 'ast', name: 'Asturian' },
  { code: 'az', name: 'Azerbaijani' },
  { code: 'be', name: 'Belarusian' },
  { code: 'bn', name: 'Bengali' },
  { code: 'bs', name: 'Bosnian' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'my', name: 'Burmese' },
  { code: 'yue', name: 'Cantonese' },
  { code: 'ca', name: 'Catalan' },
  { code: 'ceb', name: 'Cebuano' },
  { code: 'hr', name: 'Croatian' },
  { code: 'cs', name: 'Czech' },
  { code: 'da', name: 'Danish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'en', name: 'English' },
  { code: 'et', name: 'Estonian' },
  { code: 'fil', name: 'Filipino' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fr', name: 'French' },
  { code: 'gl', name: 'Galician' },
  { code: 'ka', name: 'Georgian' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'ha', name: 'Hausa' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'is', name: 'Icelandic' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ga', name: 'Irish' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'jv', name: 'Javanese' },
  { code: 'kn', name: 'Kannada' },
  { code: 'kk', name: 'Kazakh' },
  { code: 'ko', name: 'Korean' },
  { code: 'ky', name: 'Kyrgyz' },
  { code: 'lv', name: 'Latvian' },
  { code: 'ln', name: 'Lingala' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'lb', name: 'Luxembourgish' },
  { code: 'mk', name: 'Macedonian' },
  { code: 'ms', name: 'Malay' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'mt', name: 'Maltese' },
  { code: 'zh', name: 'Mandarin Chinese' },
  { code: 'mi', name: 'Māori' },
  { code: 'mr', name: 'Marathi' },
  { code: 'mn', name: 'Mongolian' },
  { code: 'ne', name: 'Nepali' },
  { code: 'no', name: 'Norwegian' },
  { code: 'oc', name: 'Occitan' },
  { code: 'or', name: 'Odia' },
  { code: 'ps', name: 'Pashto' },
  { code: 'fa', name: 'Persian' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'sr', name: 'Serbian' },
  { code: 'sd', name: 'Sindhi' },
  { code: 'sk', name: 'Slovak' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'so', name: 'Somali' },
  { code: 'es', name: 'Spanish' },
  { code: 'sw', name: 'Swahili' },
  { code: 'sv', name: 'Swedish' },
  { code: 'tg', name: 'Tajik' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'th', name: 'Thai' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ur', name: 'Urdu' },
  { code: 'uz', name: 'Uzbek' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'cy', name: 'Welsh' },
  { code: 'yo', name: 'Yoruba' },
];

export const DEFAULT_VIDEO_LANGUAGE = 'en';

export const VIDEO_LANGUAGES: readonly VideoLanguage[] = Object.freeze(
  SOURCE.slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
    .map((lang) => Object.freeze({ ...lang })),
);

const BY_CODE = new Map(VIDEO_LANGUAGES.map((lang) => [lang.code, lang]));

const ENGLISH = BY_CODE.get(DEFAULT_VIDEO_LANGUAGE) as VideoLanguage;

/** Models that accept `language_code`. `eleven_multilingual_v2` does not. */
const LANGUAGE_CODE_MODELS = new Set(['eleven_v4', 'eleven_v4_turbo', 'eleven_v3', 'eleven_v3_conversational']);

export function videoLanguage(code: unknown): VideoLanguage | null {
  const key = asText(code || '').trim().toLowerCase();
  return BY_CODE.get(key) || null;
}

/** A missing or unknown code is English, so older projects keep working. */
export function resolveVideoLanguage(code: unknown): VideoLanguage {
  return videoLanguage(code) || ENGLISH;
}

/** Empty means English. A code that is not on the Eleven v4 list is an error. */
export function requireVideoLanguage(code: unknown): VideoLanguage {
  if (code == null || asText(code).trim() === '') return ENGLISH;
  const found = videoLanguage(code);
  if (!found) throw new Error(`Choose a video language Eleven v4 supports ("${asText(code)}" is not one)`);
  return found;
}

export function modelAcceptsLanguageCode(model: string | null | undefined): boolean {
  return LANGUAGE_CODE_MODELS.has(model || 'eleven_v4');
}

/** Standing instruction for every agent that writes viewer-facing copy. */
export function promptLanguageLine(code: unknown): string {
  const lang = resolveVideoLanguage(code);
  return `Video language: ${lang.name} (${lang.code}). Write every viewer-facing string in ${lang.name}: plate copy, chapter() and say() titles and bodies, and narration. Keep must-say lines, stats, and quotes verbatim. Leave Playwright selectors on the live app's own labels. Keep the \`language\` field on video.config.json as "${lang.code}".`;
}

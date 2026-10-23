import { VIDEO_LANGUAGES } from '@/logic/languages';

import { setLanguage, setLanguageFilter, useWizard } from './wizard';

/** `filterLanguages()` — the native picker's search box hides options that miss the query. */
function optionHidden(code: string, name: string, query: string, selected: string): boolean {
  if (document.documentElement.classList.contains('has-custom-select')) return false;
  const q = query.trim().toLowerCase();
  return Boolean(q) && code !== selected && !`${name} ${code}`.toLowerCase().includes(q);
}

/**
 * `#languageField` — one control shown on the short brief and on Basics
 * (`placeLanguage()` moved the node; here each slot renders it in turn).
 */
export function LanguageField() {
  const language = useWizard((s) => s.language);
  const filter = useWizard((s) => s.languageFilter);
  // `form.reset()` rewinds the native select; re-rendering re-applies the value.
  useWizard((s) => s.formRev);
  return (
    <div className="wf" id="languageField">
      <label className="field-label" id="languageLabel" htmlFor="wizardLanguage">
        Video language
      </label>
      {' '}
      <input
        type="search"
        id="languageFilter"
        className="lang-filter"
        placeholder="Search languages"
        autoComplete="off"
        spellCheck="false"
        aria-controls="wizardLanguage"
        value={filter}
        onChange={(e) => setLanguageFilter(e.target.value)}
      />
      {' '}
      <select
        name="language"
        id="wizardLanguage"
        aria-labelledby="languageLabel"
        aria-describedby="languageHint"
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
      >
        {VIDEO_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code} title={lang.code} hidden={optionHidden(lang.code, lang.name, filter, language)}>
            {lang.name}
          </option>
        ))}
      </select>
      {' '}
      <small id="languageHint">
        Scripts, on-screen copy, captions, and the voice are created in this language.
      </small>
    </div>
  );
}

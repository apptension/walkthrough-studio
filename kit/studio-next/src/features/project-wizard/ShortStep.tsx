import { LanguageField } from './LanguageField';
import { useWizard } from './wizard';
import { WizardStream } from './WizardStream';

/** The one-description brief the agent turns into the five steps. */
export function ShortStep() {
  const shown = useWizard((s) => s.mode === 'short');
  const drafting = useWizard((s) => s.drafting);
  const title = useWizard((s) => s.shortDraftTitle);
  const line = useWizard((s) => s.shortDraftLine);
  const job = useWizard((s) => s.shortJob);
  return (
    <fieldset data-step="short" hidden={!shown}>
      <div className="wz-head">
        <h3>
          Describe the video
        </h3>
        <p>
          What to show, for whom, and about how long. The draft stays editable. Nothing records until you approve it.
        </p>
      </div>
      <label className="wf">
        <span className="field-label">
          Description{' '}
          <b>
            *
          </b>
        </span>
        <textarea name="description" rows={4} placeholder="Show a new admin how to invite a teammate in about a minute, then the settings that decide who can change it." />
      </label>
      {' '}
      <label className="wf">
        <span className="field-label">
          Start URL{' '}
          <b>
            *
          </b>
        </span>
        <input name="shortStartUrl" type="url" placeholder="https://app.example.com" spellCheck="false" />
      </label>
      <div id="languageSlotShort" className="lang-slot">
        {shown ? <LanguageField /> : null}
      </div>
      <button type="button" className="btn ghost" data-full-brief="">
        Fill each field instead
      </button>
      <section id="shortDraft" className="short-draft" role="status" aria-live="polite" hidden={!drafting}>
        <header className="short-draft-head">
          <span className="spinner" aria-hidden="true" />
          <div>
            <strong id="shortDraftTitle">
              {title}
            </strong>
            {' '}
            <em id="shortDraftLine">
              {line}
            </em>
          </div>
        </header>
        <WizardStream id="shortDraftStream" job={job} label="Live output" />
      </section>
    </fieldset>
  );
}

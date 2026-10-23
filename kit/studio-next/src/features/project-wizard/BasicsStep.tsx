import { HelpTip } from '@/ui/HelpTip';

import { LanguageField } from './LanguageField';
import { useWizard } from './wizard';

/** Step 1 · Basics — what the video is, who it is for, and its brand. */
export function BasicsStep({ hidden, withLanguage }: { hidden: boolean; withLanguage: boolean }) {
  const slugDisabled = useWizard((s) => s.slugDisabled);
  const brandNew = useWizard((s) => s.brandNew);
  const brands = useWizard((s) => s.brands);
  return (
    <fieldset data-step="0" hidden={hidden}>
      <div className="wz-head">
        <h3>
          What is this video?
        </h3>
        <p>
          Audience and outcome steer every line the agent writes.
        </p>
      </div>
      <label className="wf">
        <span className="field-label">
          Video title{' '}
          <b>
            *
          </b>
        </span>
        <input name="title" required placeholder="Invite a teammate" autoComplete="off" />
      </label>
      <div className="wf-row">
        <label className="wf">
          <span className="field-label">
            Product name
          </span>
          <input name="product" placeholder="Acme" autoComplete="off" />
        </label>
        {' '}
        <label className="wf">
          <span className="field-label">
            Slug{' '}
            <i>
              optional
            </i>
          </span>
          <input name="slug" placeholder="auto from title" pattern="[a-z0-9-]+" autoComplete="off" spellCheck="false" disabled={slugDisabled} />
        </label>
      </div>
      <label className="wf">
        <span className="field-label">
          Who watches{' '}
          <b>
            *
          </b>
        </span>
        <input name="audience" required placeholder="New admins setting up their workspace" />
      </label>
      <div id="languageSlotBasics" className="lang-slot">
        {withLanguage ? <LanguageField /> : null}
      </div>
      <label className="wf">
        <span className="field-label">
          After watching, they can…
        </span>
        <input name="outcome" placeholder="Send one invite and see the person land" />
      </label>
      <div className="wf">
        <span id="purposeLabel" data-help="Sets the story spine the agent writes to: Overview is Problem → Promise → Proof → Path → Payoff; Feature is Before → After → Bridge; Onboarding is Goal → Map → Steps → First win; Launch is Shift → What's new → Why now → Try it; Sales is Problem → Agitate → Solve → Prove → Ask. You can change it later in Review." className="field-label has-help">
          What the video is for
          <HelpTip text="Sets the story spine the agent writes to: Overview is Problem → Promise → Proof → Path → Payoff; Feature is Before → After → Bridge; Onboarding is Goal → Map → Steps → First win; Launch is Shift → What's new → Why now → Try it; Sales is Problem → Agitate → Solve → Prove → Ask. You can change it later in Review." label="What the video is for" />
        </span>
        <div className="seg" role="radiogroup" aria-labelledby="purposeLabel">
          <label title="Problem → Promise → Proof → Path → Payoff">
            <input type="radio" name="purpose" value="overview" data-label="Product overview" defaultChecked />
            <span>
              Overview
            </span>
          </label>
          {' '}
          <label title="Before → After → Bridge">
            <input type="radio" name="purpose" value="feature" data-label="Feature spotlight" />
            <span>
              Feature
            </span>
          </label>
          {' '}
          <label title="Goal → Map → Steps → First win">
            <input type="radio" name="purpose" value="onboarding" data-label="Onboarding / how-to" />
            <span>
              Onboarding
            </span>
          </label>
          {' '}
          <label title="Shift → What's new → Why now → Try it">
            <input type="radio" name="purpose" value="launch" data-label="Release / launch" />
            <span>
              Launch
            </span>
          </label>
          {' '}
          <label title="Problem → Agitate → Solve → Prove → Ask">
            <input type="radio" name="purpose" value="sales" data-label="Sales demo" />
            <span>
              Sales demo
            </span>
          </label>
        </div>
      </div>
      <div className="wf-row">
        <div className="wf">
          <span className="field-label" id="lenLabel">
            Length
          </span>
          <div className="seg" role="radiogroup" aria-labelledby="lenLabel">
            <label>
              <input type="radio" name="lengthSec" value="60" />
              <span>
                1 min
              </span>
            </label>
            {' '}
            <label>
              <input type="radio" name="lengthSec" value="90" />
              <span>
                1.5 min
              </span>
            </label>
            {' '}
            <label>
              <input type="radio" name="lengthSec" value="120" defaultChecked />
              <span>
                2 min
              </span>
            </label>
            {' '}
            <label>
              <input type="radio" name="lengthSec" value="180" />
              <span>
                3 min
              </span>
            </label>
          </div>
        </div>
        <label className="wf">
          <span className="field-label">
            Tone
          </span>
          <input name="tone" placeholder="confident, warm, plain-spoken" />
        </label>
      </div>
      <div className="wf">
        <span className="field-label" id="brandLabel">
          Brand pack{' '}
          <b>
            *
          </b>
        </span>
        <div className="choice-grid" role="radiogroup" aria-labelledby="brandLabel">
          <label className="choice">
            <input type="radio" name="brandMode" value="existing" defaultChecked />
            <span className="choice-mark" />
            <strong>
              Use an existing pack
            </strong>
            <em>
              Logo, colors, fonts and voice are ready
            </em>
          </label>
          {' '}
          <label className="choice">
            <input type="radio" name="brandMode" value="new" />
            <span className="choice-mark" />
            <strong>
              Discover a new brand
            </strong>
            <em>
              Harvest logo and colors from the website
            </em>
          </label>
        </div>
      </div>
      <div data-brand="existing" hidden={brandNew}>
        <label className="wf">
          <span className="field-label">
            Brand
          </span>
          <select name="brandId" id="wizardBrand">
            {(brands || []).map((b) => (
              <option key={b.value} value={b.value} disabled={b.disabled}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="wf-row" data-brand="new" hidden={!brandNew}>
        <label className="wf">
          <span className="field-label">
            Brand name
          </span>
          <input name="brandName" placeholder="Acme" />
        </label>
        {' '}
        <label className="wf">
          <span className="field-label">
            Brand website{' '}
            <i>
              optional
            </i>
          </span>
          <input name="brandUrl" type="url" placeholder="https://acme.com" spellCheck="false" />
          <small>
            Discovery opens this site and the app's start URL in a browser to capture logo, colors and type. Leave it empty to read the brand from the app alone.
          </small>
        </label>
      </div>
    </fieldset>
  );
}

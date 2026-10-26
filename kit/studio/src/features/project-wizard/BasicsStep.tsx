import { useEffect, useRef, useState } from 'react';

import { clampLengthSec, LENGTH_MAX_SEC, LENGTH_PRESETS } from '@/logic/length';
import { HelpTip } from '@/ui/HelpTip';
import { Icon } from '@/ui/icons';

import { BrandPicker } from './BrandPicker';
import { PURPOSES } from './briefSignals';
import { LanguageField } from './LanguageField';
import { setLengthSec, useWizard } from './wizard';

const PRESET_LABEL: Record<(typeof LENGTH_PRESETS)[number], string> = { 60: '1 min', 90: '1.5 min', 120: '2 min', 180: '3 min' };

function minutesText(sec: number): string {
  const min = Math.round((sec / 60) * 10) / 10;
  return Number.isInteger(min) ? String(min) : min.toFixed(1);
}

/** Presets plus a minutes field. One checked radio carries the seconds, so the form still submits `lengthSec`. */
function LengthField() {
  const sec = useWizard((s) => s.lengthSec);
  const field = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => minutesText(sec));
  const custom = !(LENGTH_PRESETS as readonly number[]).includes(sec);

  useEffect(() => {
    if (document.activeElement !== field.current) setText(minutesText(sec));
  }, [sec]);

  const write = (next: number) => {
    setLengthSec(next);
    setText(minutesText(clampLengthSec(next)));
    document.getElementById('projectForm')?.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const commit = (raw: string) => {
    const n = Number(raw.trim().replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      setText(minutesText(sec));
      return;
    }
    write(Math.round(n * 60));
  };

  return (
    <div className="wf wz-length-field">
      <span className="field-label" id="lenLabel">
        Length
      </span>
      <div className="wz-length">
        <input type="radio" name="lengthSec" value={String(sec)} checked onChange={() => {}} aria-hidden="true" tabIndex={-1} />
        <div className="seg wz-len" role="group" aria-labelledby="lenLabel">
          {LENGTH_PRESETS.map((preset) => (
            <button key={preset} type="button" className={sec === preset ? 'is-on' : undefined} aria-pressed={sec === preset} onClick={() => write(preset)}>
              {PRESET_LABEL[preset]}
            </button>
          ))}
        </div>
        <label className={`wz-length-any${custom ? ' is-custom' : ''}`}>
          <input
            type="number"
            inputMode="decimal"
            min={0.5}
            max={LENGTH_MAX_SEC / 60}
            step={0.5}
            ref={field}
            aria-label="Length in minutes"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit(e.currentTarget.value);
              }
            }}
          />
          <span>min</span>
        </label>
      </div>
      <small>Any length up to 60 min. A longer video takes longer to render.</small>
    </div>
  );
}

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
        <div className="wz-purpose" role="radiogroup" aria-labelledby="purposeLabel">
          {PURPOSES.map((p) => (
            <label key={p.value} className="wz-pcard" title={p.spine.join(' → ')}>
              <input type="radio" name="purpose" value={p.value} data-label={p.label} defaultChecked={p.value === 'overview'} />
              <span className="wz-pcard-ico">
                <Icon name={p.icon} size={14} />
              </span>
              <strong>{p.name}</strong>
              <em>{p.blurb}</em>
              <span className="wz-spine" aria-hidden="true">
                {p.spine.map((beat) => (
                  <i key={beat}>{beat}</i>
                ))}
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="wf-row">
        <LengthField />
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
        <BrandPicker />
        <label className="wf wz-sr">
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

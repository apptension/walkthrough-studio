import { Icon } from '@/ui/icons';
import { HelpTip } from '@/ui/HelpTip';
import { sizeLine } from '@/logic/captureSize';

import { captureGroups } from './brief';
import { captureFallback, syncCaptureHint, useWizard } from './wizard';

function CaptureSelect() {
  const options = useWizard((s) => s.captureOptions);
  return (
    <select key={options.length} name="capturePreset" id="wizardCapture" defaultValue={captureFallback(options)?.id} onChange={syncCaptureHint}>
      {captureGroups(options).map(([group, list]) => (
        <optgroup key={group} label={group}>
          {list.map((o) => (
            <option key={o.id} value={o.id}>
              {`${o.label.split(' · ')[0]} · ${sizeLine(o)}`}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Step 2 · Access — where the tour runs and how it signs in. */
export function AccessStep({ hidden }: { hidden: boolean }) {
  const login = useWizard((s) => s.login);
  const saved = useWizard((s) => s.login && s.credOnFile);
  const captureHint = useWizard((s) => s.captureHint);
  return (
    <fieldset data-step="1" hidden={hidden}>
      <div className="wz-head">
        <h3>
          Where does the tour run?
        </h3>
        <p>
          The recorder opens the start URL in a real browser and drives the live app.
        </p>
      </div>
      <label className="wf">
        <span className="field-label">
          Start URL{' '}
          <b>
            *
          </b>
        </span>
        <input name="startUrl" type="url" required placeholder="https://app.acme.com/dashboard" spellCheck="false" />
        <small>
          Where the recording opens.
        </small>
      </label>
      <div className="wf-row">
        <label className="wf">
          <span className="field-label">
            App URL
          </span>
          <input name="appUrl" type="url" placeholder="https://app.acme.com" spellCheck="false" />
        </label>
        {' '}
        <label className="wf">
          <span className="field-label">
            Marketing site
          </span>
          <input name="marketingUrl" type="url" placeholder="https://acme.com" spellCheck="false" />
        </label>
      </div>
      <label className="switch-card">
        <span>
          <strong>
            The tour signs in
          </strong>
          <em>
            Use a demo account with demo data.
          </em>
        </span>
        {' '}
        <span className="tog">
          <input type="checkbox" name="loginRequired" />
        </span>
      </label>
      <div className="login-box" data-login="" hidden={!login}>
        <p className="cred-status" id="wizardCredStatus" hidden={!saved}>
          <Icon name="ui-lock" size={12} />
          {' '}
          <span id="wizardCredStatusText">
            {saved ? 'Credentials are saved for this project (in kit/.env). Values are not shown here.' : 'Credentials are saved for this project.'}
          </span>
        </p>
        <div className="wf-row">
          <label className="wf">
            <span className="field-label" id="wizardEmailLabel">
              {saved ? 'New email (optional)' : 'Demo account email'}
            </span>
            <input name="email" type="email" autoComplete="off" spellCheck="false" placeholder={saved ? 'Leave blank to keep the saved email' : 'demo@acme.com'} />
          </label>
          {' '}
          <label className="wf">
            <span className="field-label" id="wizardPasswordLabel">
              {saved ? 'New password (optional)' : 'Password'}
            </span>
            <input name="password" type="password" autoComplete="new-password" placeholder={saved ? 'Leave blank to keep the saved password' : ''} />
          </label>
        </div>
        <p className="wf-note" id="wizardCredNote">
          <Icon name="ui-lock" size={12} />
          <span id="wizardCredNoteText">
            {saved ? (
              <>
                Only fill a field to replace it. Blank keeps the saved secret in <code>kit/.env</code>.
              </>
            ) : (
              <>
                Stored only in <code>kit/.env</code> (gitignored); the project references it as <code>$VAR</code>.
              </>
            )}
          </span>
        </p>
      </div>
      <label className="wf">
        <span className="field-label">
          App source in this workspace
        </span>
        <input name="sourcePath" placeholder="packages/webapp" spellCheck="false" />
        <small>
          Lets the agent read real labels and routes for reliable selectors.
        </small>
      </label>
      {' '}
      <label className="wf">
        <span className="field-label">
          Access notes
        </span>
        <textarea name="notes" rows={2} placeholder="Cookie banner on first load; seed org “Demo Agency”; avoid the billing page" />
      </label>
      <div className="wf-row wf-capture-size">
        <label className="wf">
          <span data-help="The browser size and device the product is recorded at — the layout viewers see. Pick a phone to record the mobile view. Change it later under Direction → Recording size." className="field-label has-help">
            Recording size
            <HelpTip text="The browser size and device the product is recorded at — the layout viewers see. Pick a phone to record the mobile view. Change it later under Direction → Recording size." label="Recording size" />
          </span>
          <CaptureSelect />
          <small id="wizardCaptureHint">
            {captureHint}
          </small>
        </label>
        {' '}
        <label className="wf">
          <span className="field-label">
            Video shape
          </span>
          <select name="outputFormat" id="wizardShape" onChange={(e) => (e.currentTarget.dataset.touched = '1')}>
            <option value="landscape">
              Landscape 16:9
            </option>
            <option value="portrait">
              Vertical 9:16
            </option>
          </select>
        </label>
      </div>
    </fieldset>
  );
}

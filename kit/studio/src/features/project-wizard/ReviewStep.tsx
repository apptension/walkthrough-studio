import type { SummaryGroup } from './brief';
import { useWizard } from './wizard';

function SummaryCard({ group }: { group: SummaryGroup }) {
  return (
    <section className="ws-group">
      <header>
        <h4>{group.title}</h4>
        <button type="button" className="link-btn" data-goto={String(group.step)}>
          Edit
        </button>
      </header>
      {group.rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className={v ? undefined : 'is-empty'}>{v || 'Not set'}</dd>
        </div>
      ))}
    </section>
  );
}

/** Step 5 · Review — the brief as the agent will read it. */
export function ReviewStep({ hidden }: { hidden: boolean }) {
  const summary = useWizard((s) => s.summary);
  const brandNew = useWizard((s) => s.brandNew);
  return (
    <fieldset data-step="4" hidden={hidden}>
      <div className="wz-head">
        <h3>
          Ready to draft
        </h3>
        <p>
          Check the brief. Everything stays editable in the Script sheet.
        </p>
      </div>
      <dl id="wizardSummary" className="wizard-summary">
        {summary.map((g) => (
          <SummaryCard key={g.title} group={g} />
        ))}
      </dl>
      <div className="wz-options">
        <div className="check-inline required" id="wizardDiscoverRow" hidden={!brandNew}>
          <span className="required-check" aria-hidden="true">
            ✓
          </span>
          <span>
            Capture and verify logo, colors and type before drafting{' '}
            <em>
              required
            </em>
          </span>
        </div>
        <label className="check-inline">
          <input type="checkbox" name="runDraft" defaultChecked />
          <span>
            Draft the script with the agent now
          </span>
        </label>
      </div>
    </fieldset>
  );
}

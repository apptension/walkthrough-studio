import { PlateStill } from './PlateStill';

/** Step 4 · Proof — brand plates and the proof they carry. */
export function ProofStep({ hidden }: { hidden: boolean }) {
  return (
    <fieldset data-step="3" hidden={hidden}>
      <div className="wz-head">
        <h3>
          What makes it believable?
        </h3>
        <p>
          Brand plates between chapters carry proof the screen alone can't. Each tile is a still of that plate in the brand you picked — it does not play.
        </p>
      </div>
      <div className="plate-picks" role="group" aria-label="Brand plates">
        <label className="pick">
          <input type="checkbox" name="plates" value="features" defaultChecked />
          <span className="pick-still">
            <PlateStill type="features" />
          </span>
          <span className="pick-copy">
            <strong>
              Features
            </strong>
            <em>
              Capabilities with icons
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="journey" defaultChecked />
          <span className="pick-still">
            <PlateStill type="journey" />
          </span>
          <span className="pick-copy">
            <strong>
              Journey
            </strong>
            <em>
              The path the tour takes
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="stats" />
          <span className="pick-still">
            <PlateStill type="stats" />
          </span>
          <span className="pick-copy">
            <strong>
              Stats
            </strong>
            <em>
              Ratings and numbers — yours only
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="testimonials" />
          <span className="pick-still">
            <PlateStill type="testimonials" />
          </span>
          <span className="pick-copy">
            <strong>
              Testimonials
            </strong>
            <em>
              Real quotes with attribution
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="logos" />
          <span className="pick-still">
            <PlateStill type="logos" />
          </span>
          <span className="pick-copy">
            <strong>
              Logos
            </strong>
            <em>
              Integrations or customers
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="callout" />
          <span className="pick-still">
            <PlateStill type="callout" />
          </span>
          <span className="pick-copy">
            <strong>
              Callout
            </strong>
            <em>
              One big message
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="compare" />
          <span className="pick-still">
            <PlateStill type="compare" />
          </span>
          <span className="pick-copy">
            <strong>
              Compare
            </strong>
            <em>
              Before vs after, side by side
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="quote" />
          <span className="pick-still">
            <PlateStill type="quote" />
          </span>
          <span className="pick-copy">
            <strong>
              Hero quote
            </strong>
            <em>
              One quote, full stage
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="metric" />
          <span className="pick-still">
            <PlateStill type="metric" />
          </span>
          <span className="pick-copy">
            <strong>
              Metric
            </strong>
            <em>
              One number with a ring
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="orbit" />
          <span className="pick-still">
            <PlateStill type="orbit" />
          </span>
          <span className="pick-copy">
            <strong>
              Orbit
            </strong>
            <em>
              Logos circling the product
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="process" />
          <span className="pick-still">
            <PlateStill type="process" />
          </span>
          <span className="pick-copy">
            <strong>
              Process
            </strong>
            <em>
              How it works, in numbered steps
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="timeline" />
          <span className="pick-still">
            <PlateStill type="timeline" />
          </span>
          <span className="pick-copy">
            <strong>
              Timeline
            </strong>
            <em>
              Milestones or a roadmap
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="checklist" />
          <span className="pick-still">
            <PlateStill type="checklist" />
          </span>
          <span className="pick-copy">
            <strong>
              Checklist
            </strong>
            <em>
              Outcomes ticked off one by one
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="kpi" />
          <span className="pick-still">
            <PlateStill type="kpi" />
          </span>
          <span className="pick-copy">
            <strong>
              KPI board
            </strong>
            <em>
              Dashboard tiles with trends
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="statement" />
          <span className="pick-still">
            <PlateStill type="statement" />
          </span>
          <span className="pick-copy">
            <strong>
              Statement
            </strong>
            <em>
              One line of kinetic type
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="faq" />
          <span className="pick-still">
            <PlateStill type="faq" />
          </span>
          <span className="pick-copy">
            <strong>
              FAQ
            </strong>
            <em>
              Objections answered up front
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="pricing" />
          <span className="pick-still">
            <PlateStill type="pricing" />
          </span>
          <span className="pick-copy">
            <strong>
              Pricing
            </strong>
            <em>
              Plans side by side, one featured
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="team" />
          <span className="pick-still">
            <PlateStill type="team" />
          </span>
          <span className="pick-copy">
            <strong>
              People
            </strong>
            <em>
              Roles or personas with avatars
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="showcase" />
          <span className="pick-still">
            <PlateStill type="showcase" />
          </span>
          <span className="pick-copy">
            <strong>
              Showcase
            </strong>
            <em>
              An interface shot in a device, zooming to the detail
            </em>
          </span>
          <span className="pick-check" />
        </label>
        {' '}
        <label className="pick">
          <input type="checkbox" name="plates" value="bento" />
          <span className="pick-still">
            <PlateStill type="bento" />
          </span>
          <span className="pick-copy">
            <strong>
              Bento
            </strong>
            <em>
              Editorial board — the interface, a number, a voice, the stack
            </em>
          </span>
          <span className="pick-check" />
        </label>
      </div>
      <label className="wf">
        <span className="field-label">
          Stats{' '}
          <i>
            one per line, verbatim
          </i>
        </span>
        <textarea name="stats" rows={2} placeholder="4.7 — G2 rating" />
      </label>
      {' '}
      <label className="wf">
        <span className="field-label">
          Quotes{' '}
          <i>
            “quote” — name, company
          </i>
        </span>
        <textarea name="quotes" rows={3} placeholder="“We stopped double-booking people.” — Ana Ruiz, Studio North" />
      </label>
      {' '}
      <label className="wf">
        <span className="field-label">
          Logos / integrations
        </span>
        <textarea name="logos" rows={2} placeholder="Slack, Zapier, Google Calendar" />
      </label>
    </fieldset>
  );
}

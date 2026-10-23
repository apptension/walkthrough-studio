import { HelpTip } from '@/ui/HelpTip';

import { MUST_SHOW_GUIDED_PLACEHOLDER, MUST_SHOW_PLACEHOLDER } from './brief';
import { useWizard } from './wizard';

/** Step 3 · Story — who finds the journey and what it must show. */
export function StoryStep({ hidden }: { hidden: boolean }) {
  const guided = useWizard((s) => s.guided);
  return (
    <fieldset data-step="2" hidden={hidden}>
      <div className="wz-head">
        <h3>
          What should viewers see?
        </h3>
        <p>
          Each line becomes a chapter, in this order. Lead with the screen that proves the promise.
        </p>
      </div>
      <div className="wf">
        <span id="captureModeLabel" data-help="Agent explores: the explore agent walks the live product and decides the journey. I'll show it: a browser opens for you — click, type, drag and scroll through the tour, mark moments on the bar at the bottom, then Finish. Every interaction is captured without the idle time between them; the planner optimises your walk and a bot records it cleanly." className="field-label has-help">
          Who finds the journey
          <HelpTip text="Agent explores: the explore agent walks the live product and decides the journey. I'll show it: a browser opens for you — click, type, drag and scroll through the tour, mark moments on the bar at the bottom, then Finish. Every interaction is captured without the idle time between them; the planner optimises your walk and a bot records it cleanly." label="Who finds the journey" />
        </span>
        <div className="choice-grid" role="radiogroup" aria-labelledby="captureModeLabel">
          <label className="choice">
            <input type="radio" name="captureMode" value="agent" defaultChecked />
            <span className="choice-mark" />
            <strong>
              Agent explores
            </strong>
            <em>
              It walks the live product and picks the route
            </em>
          </label>
          {' '}
          <label className="choice">
            <input type="radio" name="captureMode" value="guided" />
            <span className="choice-mark" />
            <strong>
              I'll show it
            </strong>
            <em>
              A browser opens — you record the tour, then keep it or let a bot redo it
            </em>
          </label>
        </div>
      </div>
      <label className="wf">
        <span className="field-label">
          What to show, in order{' '}
          <b data-must-show-required="" hidden={guided}>
            *
          </b>
          {' '}
          <i>
            one per line
          </i>
        </span>
        <textarea name="mustShow" rows={7} required={!guided} spellCheck="false" placeholder={guided ? MUST_SHOW_GUIDED_PLACEHOLDER : MUST_SHOW_PLACEHOLDER} />
        <small>
          <b>
            Title
          </b>
          {' '}— why it matters ·{' '}
          <b>
            how:
          </b>
          {' '}what to click and where. Title and why are enough: the explore agent walks the live product, decides the order and writes the clicks before the script.
        </small>
      </label>
      {' '}
      <label className="wf">
        <span className="field-label">
          Key messages{' '}
          <i>
            one per line
          </i>
        </span>
        <textarea name="keyMessages" rows={3} placeholder="One invite covers the access they need" />
      </label>
      <div className="wf-row">
        <label className="wf">
          <span className="field-label">
            Must say
          </span>
          <textarea name="mustSay" rows={2} placeholder="Product names, claims legal approved" />
        </label>
        {' '}
        <label className="wf">
          <span className="field-label">
            Avoid
          </span>
          <textarea name="avoid" rows={2} placeholder="Pricing, roadmap promises, competitor names" />
        </label>
      </div>
    </fieldset>
  );
}

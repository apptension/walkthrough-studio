import { NeonButton } from '@/ui/NeonButton';
import { Icon } from '@/ui/icons';

import { approveAndRender, back, editBrief, next, retry, reviewScriptFirst, stop, useWizard } from './wizard';

/** `.wizard-foot` — Back / Next for the brief, then the creation view's own controls. */
export function WizardFooter() {
  const backDisabled = useWizard((s) => s.backDisabled);
  const backLabel = useWizard((s) => s.backLabel);
  const progress = useWizard((s) => s.progress);
  const stepMeta = useWizard((s) => s.stepMeta);
  const nextLabel = useWizard((s) => s.nextLabel);
  const nextDisabled = useWizard((s) => s.nextDisabled);
  const nextBusy = useWizard((s) => s.nextBusy);
  const stopLabel = useWizard((s) => s.stopLabel);
  const stopDisabled = useWizard((s) => s.stopDisabled);
  const retryLabel = useWizard((s) => s.retryLabel);
  const reviewDisabled = useWizard((s) => s.reviewDisabled);
  const renderDisabled = useWizard((s) => s.renderDisabled);
  const renderBusy = useWizard((s) => s.renderBusy);
  return (
    <footer className="sheet-foot wizard-foot">
      <button type="button" id="btnWizardBack" className="btn ghost" disabled={backDisabled} onClick={back}>
        <Icon name="ui-chevron-left" size={13} />
        {backLabel}
      </button>
      {' '}
      <span className="wizard-progress" aria-hidden="true">
        <span id="wizardProgressBar" style={progress ? { width: progress } : undefined} />
      </span>
      {' '}
      <span className="meta" id="wizardStepMeta">
        {stepMeta}
      </span>
      {' '}
      <NeonButton id="btnWizardNext" className={`btn primary${nextBusy ? ' busy' : ''}`} disabled={nextDisabled} onClick={next}>
        {nextLabel}
      </NeonButton>
      {' '}
      <button type="button" id="btnCreationStop" className="btn ghost" data-creating-only="" disabled={stopDisabled} onClick={() => void stop()}>
        {stopLabel}
      </button>
      {' '}
      <button type="button" id="btnCreationEdit" className="btn ghost" data-failed-only="" onClick={editBrief}>
        Edit brief
      </button>
      {' '}
      <NeonButton id="btnCreationRetry" className="btn primary" data-failed-only="" onClick={retry}>
        {retryLabel}
      </NeonButton>
      {' '}
      <button type="button" id="btnCreationReview" className="btn ghost" data-ready-only="" disabled={reviewDisabled} onClick={() => void reviewScriptFirst()}>
        Review script first
      </button>
      {' '}
      <NeonButton
        id="btnCreationRender"
        className={`btn primary${renderBusy ? ' busy' : ''}`}
        data-ready-only=""
        disabled={renderDisabled}
        onClick={() => void approveAndRender()}
      >
        Approve & render
      </NeonButton>
    </footer>
  );
}

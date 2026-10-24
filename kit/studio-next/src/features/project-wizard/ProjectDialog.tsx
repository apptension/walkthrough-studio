import { useEffect, useRef, type FormEvent } from 'react';

import { Icon } from '@/ui/icons';
import { closeSheet, useSheetDialog } from '@/features/stages/sheetDialog';

import { AccessStep } from './AccessStep';
import { BasicsStep } from './BasicsStep';
import { BriefPreview } from './BriefPreview';
import { captureBrief } from './briefSignals';
import { PROJECT_DIALOG_SUB_NEW, PROJECT_DIALOG_SUB_SETTINGS, STEPS } from './brief';
import { useCreation } from './creation';
import { CreationView } from './CreationView';
import { ProofStep } from './ProofStep';
import { ReviewStep } from './ReviewStep';
import { ShortStep } from './ShortStep';
import { StoryStep } from './StoryStep';
import { WizardFooter } from './WizardFooter';
import {
  fillCaptureOptions,
  goTo,
  onDialogClosed,
  onFormClick,
  onFormInput,
  onFormKeyDown,
  syncConditional,
  useWizard,
} from './wizard';

const STEP_LABELS = ['Basics', 'App access', 'Story', 'Proof', 'Review'] as const;
const STEP_SUBS = ['What and for whom', 'Where it runs', 'What to show', 'Numbers and quotes', 'Check and create'] as const;

function WizardSteps() {
  const hidden = useWizard((s) => s.stepsHidden);
  const step = useWizard((s) => s.step);
  return (
    <ol className="wizard-steps" id="wizardSteps" aria-label="Brief steps" hidden={hidden}>
      {STEP_LABELS.map((label, i) => (
        <li key={label} data-step={i} className={i === step ? 'active' : i < step ? 'done' : undefined} onClick={() => goTo(i)}>
          <button type="button" aria-current={i === step ? 'step' : undefined}>
            <span className="ws-dot">
              <b>
                {i + 1}
              </b>
              {i < step ? <Icon name="ui-check" size={11} className="ws-done" /> : null}
            </span>
            <span className="ws-text">
              <span className="ws-label">
                {label}
              </span>
              <span className="ws-sub" aria-hidden="true">
                {STEP_SUBS[i]}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function WizardForm() {
  const ref = useRef<HTMLFormElement>(null);
  const mode = useWizard((s) => s.mode);
  const step = useWizard((s) => s.step);
  const drafting = useWizard((s) => s.drafting);
  const error = useWizard((s) => s.error);
  const formRev = useWizard((s) => s.formRev);
  const creating = useCreation((s) => s.dialogCreating);
  const stepHidden = (n: number) => mode === 'short' || step !== n;

  // Native `change` (React's onChange fires per keystroke): the legacy form re-ran its conditionals on commit only.
  useEffect(() => {
    const form = ref.current;
    if (!form) return;
    form.addEventListener('change', syncConditional);
    return () => form.removeEventListener('change', syncConditional);
  }, [formRev]);

  return (
    <form
      key={formRev}
      ref={ref}
      id="projectForm"
      className={`sheet-body wizard-body${drafting ? ' is-drafting' : ''}`}
      noValidate
      data-mode={mode}
      onInput={(e) => {
        onFormInput(e.target);
        captureBrief();
      }}
      onClick={(e) => onFormClick(e.target as Element)}
      onKeyDown={(e) => onFormKeyDown(e.nativeEvent)}
      onSubmit={(e: FormEvent) => e.preventDefault()}
    >
      <p id="wizardError" className="wf-error" role="alert" hidden={error.hidden}>
        {error.text}
      </p>
      <ShortStep />
      <BasicsStep hidden={stepHidden(0)} withLanguage={mode !== 'short'} />
      <AccessStep hidden={stepHidden(1)} />
      <StoryStep hidden={stepHidden(2)} />
      <ProofStep hidden={stepHidden(3)} />
      <ReviewStep hidden={stepHidden(STEPS - 1)} />
      {mode === 'short' || creating ? null : <BriefPreview />}
      <CreationView />
    </form>
  );
}

/** `#projectDialog` — the new-video wizard and, in settings mode, the brief editor (`projects.js`). */
export function ProjectDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useSheetDialog('project', ref, { onClose: onDialogClosed });
  const title = useWizard((s) => s.dialogTitle);
  const settings = useWizard((s) => s.settings);
  const running = useWizard((s) => s.running);
  const mode = useWizard((s) => s.mode);
  const creating = useCreation((s) => s.dialogCreating);
  const ready = useCreation((s) => s.dialogReady);
  const failed = useCreation((s) => s.dialogFailed);

  useEffect(() => {
    void fillCaptureOptions();
  }, []);

  const cls = [
    'sheet-dialog wizard',
    !creating && (mode === 'short' ? 'is-launch' : 'is-brief'),
    settings && 'is-project-settings',
    running && !failed && 'is-running',
    creating && 'is-creating',
    ready && 'is-ready',
    failed && 'is-failed',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <dialog ref={ref} id="projectDialog" className={cls} aria-labelledby="projectDialogTitle">
      <header className="sheet-head">
        <span className="sheet-icon project-dialog-icon" aria-hidden="true">
          <Icon name="ui-plus" size={20} data-project-icon="add" />
          {' '}
          <Icon name="ui-settings" size={20} data-project-icon="cog" />
        </span>
        <div className="sheet-titles">
          <h2 id="projectDialogTitle">
            {title}
          </h2>
          <p id="projectDialogSub" className="sheet-sub">
            {settings ? PROJECT_DIALOG_SUB_SETTINGS : PROJECT_DIALOG_SUB_NEW}
          </p>
        </div>
        <button type="button" className="sheet-close" data-close="" aria-label="Close" onClick={() => closeSheet('project')}>
          <Icon name="ui-x" size={14} />
        </button>
      </header>
      <WizardSteps />
      <WizardForm />
      <WizardFooter />
    </dialog>
  );
}

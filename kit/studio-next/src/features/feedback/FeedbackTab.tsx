import { Fragment, useCallback } from 'react';

import { desk, IMPROVE_DEFAULT, useDesk } from '@/desk/store';
import { fillNoteFromCritic, runCriticFromStudio } from '@/features/review/critic';
import { clearQcPending } from '@/features/review/qc';
import { useBusy } from '@/features/tools-panel/busy';
import { directorNoteForCritic } from '@/logic/criticFindings';
import { HelpTip } from '@/ui/HelpTip';
import { Icon, SecIcon } from '@/ui/icons';
import { cn } from '@/lib/cn';

import { isCriticFillLabel, noteField, resetImproveTarget, startImprove } from './improve';

const NOTE_HELP =
  'Smart scope picks the smallest safe change. A broad note can coordinate story & script, brand direction, timing, plates, and voice & mix together. Name an exact plate, scene, or line only when you want a surgical edit.';
const SCOPE_HELP =
  'Force a domain only when you know the change must not touch related parts. The main action usually gives a more coherent result.';

const DOMAINS = [
  { goal: 'script', label: 'Script', title: 'Change story structure, captions and matching narration' },
  { goal: 'voice', label: 'Voice', title: 'Change narration delivery and video-local voice settings' },
  { goal: 'plates', label: 'Plates', title: 'Change plate copy and structure only' },
  { goal: 'motion', label: 'Brand & motion', title: 'Change video-local brand direction and motion only' },
] as const;

function QcPendingChips() {
  const pending = useDesk((s) => s.qcPending);
  if (!pending.length) return null;
  return (
    <div className="feedback-qc" id="feedbackQcPending">
      <div className="feedback-qc-head">
        <span className="feedback-qc-label">From quality checks</span>
        <button type="button" className="btn tiny ghost" onClick={() => clearQcPending()}>
          Clear
        </button>
      </div>
      <ul className="feedback-qc-list">
        {pending.map((f, i) => (
          <li key={`${f.code}-${i}`} className={`feedback-qc-chip ${f.severity}`}>
            <span className="tag">{f.severity}</span>
            <span>{f.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DirectorNote() {
  const note = useDesk((s) => s.improve.note);
  const ref = useCallback((el: HTMLTextAreaElement | null) => {
    noteField.el = el;
  }, []);
  return (
    <label className="field feedback-note">
      <span data-ico="note" data-help={NOTE_HELP} className="has-help">
        <SecIcon name="note" />
        Director note
        <HelpTip text={NOTE_HELP} label="Director note" />
      </span>
      <textarea
        ref={ref}
        id="improveNote"
        rows={5}
        placeholder="e.g. Tighten the story, make the pacing calmer, and give the voice more warmth — keep the captured brand intact"
        value={note}
        onChange={(e) => {
          const value = e.target.value;
          desk.set((s) => {
            const improve = { ...s.improve, note: value };
            // Editing a critic-filled note drops the special Apply label.
            if (isCriticFillLabel(s.improve.label)) improve.label = IMPROVE_DEFAULT.label;
            return { improve };
          });
          if (desk.get().qcPending.length) clearQcPending();
          if (!value.trim() && desk.get().improve.plateId) resetImproveTarget();
        }}
      />
    </label>
  );
}

function ImproveButton() {
  const goal = useDesk((s) => s.improve.goal);
  const plateId = useDesk((s) => s.improve.plateId);
  const label = useDesk((s) => s.improve.label);
  const busy = useBusy('btnImprove');
  return (
    <button
      type="button"
      id="btnImprove"
      className={cn('btn primary block feedback-apply', busy && 'busy')}
      disabled={busy}
      data-improve={goal}
      data-plate-id={plateId ?? undefined}
      onClick={() => startImprove('full')}
    >
      {label}
    </button>
  );
}

function ForceDomain() {
  return (
    <div className="field scope-field feedback-scope">
      <span data-ico="target" data-help={SCOPE_HELP} className="has-help">
        <SecIcon name="target" />
        Or force one domain
        <HelpTip text={SCOPE_HELP} label="Or force one domain" />
      </span>
      <div className="tool-grid">
        {DOMAINS.map((d) => (
          <Fragment key={d.goal}>
            <button type="button" data-improve={d.goal} className="btn" title={d.title} onClick={() => startImprove(d.goal)}>
              {d.label}
            </button>{' '}
          </Fragment>
        ))}
        <button
          type="button"
          id="btnCritic"
          className="btn"
          title="An AI reviewer watches the cut and lists issues in Review"
          onClick={() => void runCriticFromStudio({ force: false })}
        >
          Run critic
        </button>
      </div>
    </div>
  );
}

function CriticHint() {
  const url = useDesk((s) => s.video?.criticUrl ?? null);
  const critic = useDesk((s) => s.video?.critic ?? null);
  const canFill = Boolean(directorNoteForCritic(critic));
  const show = Boolean(url || canFill);
  return (
    <div id="criticHint" className="critic-hint" hidden={!show}>
      <button
        type="button"
        id="btnCriticFill"
        className="critic-link critic-link--fill"
        hidden={!canFill}
        title="Paste the critic findings into the director note"
        onClick={() => fillNoteFromCritic()}
      >
        <Icon name="ui-note" size={13} />
        <span>Use critic findings</span>
      </button>
      <a
        id="criticLink"
        className="critic-link"
        href={url ?? '#'}
        target="_blank"
        rel="noopener"
        hidden={!url}
      >
        <Icon name="ui-open" size={13} />
        <span>Open report</span>
      </a>
    </div>
  );
}

/** `#rightFeedback`: director note, QC hand-off chips, and domain shortcuts. */
export function FeedbackTab() {
  return (
    <div id="rightFeedback" className="panel-body feedback-panel">
      <header className="feedback-hero">
        <h2 className="feedback-title">Direct the cut</h2>
        <p className="panel-lede feedback-lede">
          Describe the change in plain language — the agent picks a safe scope and waits for your OK.
        </p>
      </header>
      <QcPendingChips />
      <DirectorNote />
      <ImproveButton />
      <ForceDomain />
      <CriticHint />
    </div>
  );
}

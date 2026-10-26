import { useEffect, useRef } from 'react';

import { NeonButton } from '@/ui/NeonButton';
import { Icon } from '@/ui/icons';
import { closeSheet, useSheetDialog } from '@/features/stages/sheetDialog';

import { briefModeView, createBranch, discover, editDraft, selectIdea, startCustom, useBranchSheet } from './branch';

function BranchIdeas() {
  const ideas = useBranchSheet((s) => s.ideas);
  const selectedId = useBranchSheet((s) => s.selectedId);
  return (
    <ul
      id="branchIdeas"
      className="branch-ideas"
      role="listbox"
      aria-label="Suggested feature videos"
      onClick={(e) => {
        const li = (e.target as Element).closest<HTMLElement>('[data-idea]');
        if (li?.dataset.idea) selectIdea(li.dataset.idea);
      }}
    >
      {ideas.length ? (
        ideas.map((idea) => {
          const on = idea.id === selectedId;
          return (
            <li key={idea.id} className={`branch-idea${on ? ' is-on' : ''}`} data-idea={idea.id} role="option" aria-selected={on}>
              <button type="button" className="branch-idea-btn">
                <strong>{idea.title}</strong>{' '}
                <em>
                  {idea.angle || idea.outcome || 'Feature deep dive'} · ~{idea.lengthSec || 90}s
                </em>{' '}
                <span className="branch-idea-meta">
                  {idea.purpose || 'feature'}
                  {idea.source === 'agent' ? ' · agent' : ''}
                </span>
              </button>
            </li>
          );
        })
      ) : (
        <li className="branch-empty">No suggestions yet — write your own below, or ask the agent for feature deep-dives.</li>
      )}
    </ul>
  );
}

function BranchBrief() {
  const draft = useBranchSheet((s) => s.draft);
  const view = {
    label: useBranchSheet((s) => briefModeView(s).label),
    mode: useBranchSheet((s) => briefModeView(s).mode),
  };
  const focusTitle = useBranchSheet((s) => s.focusTitle);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusTitle) titleRef.current?.focus();
  }, [focusTitle]);
  return (
    <section id="branchBrief" className="branch-brief" aria-labelledby="branchBriefLabel" data-mode={view.mode}>
      <div className="branch-brief-head">
        <h3 id="branchBriefLabel">Branch brief</h3>
        <span id="branchBriefMode" className="branch-brief-mode">
          {view.label}
        </span>
      </div>
      <label className="wf">
        <span className="field-label">
          Title <i>required</i>
        </span>{' '}
        <input
          ref={titleRef}
          id="branchTitle"
          type="text"
          maxLength={80}
          placeholder="e.g. Scheduling on the calendar"
          autoComplete="off"
          value={draft.title}
          onChange={(e) => editDraft({ title: e.target.value })}
        />
      </label>{' '}
      <label className="wf">
        <span className="field-label">
          Angle <i>what to stay on</i>
        </span>
        <textarea
          id="branchAngle"
          rows={2}
          maxLength={280}
          placeholder="e.g. Stay on drag-and-drop until conflicts are clear"
          value={draft.angle}
          onChange={(e) => editDraft({ angle: e.target.value })}
        />
      </label>{' '}
      <label className="wf">
        <span className="field-label">After watching, they can…</span>{' '}
        <input
          id="branchOutcome"
          type="text"
          maxLength={200}
          placeholder="e.g. Schedule a booking without leaving the calendar"
          autoComplete="off"
          value={draft.outcome}
          onChange={(e) => editDraft({ outcome: e.target.value })}
        />
      </label>
    </section>
  );
}

/** `#branchDialog` — spin focused feature videos from the open overview. */
export function BranchDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useSheetDialog('branch', ref);
  const source = useBranchSheet((s) => s.source);
  const status = useBranchSheet((s) => s.status);
  const discovering = useBranchSheet((s) => s.discovering);
  const creating = useBranchSheet((s) => s.creating);
  const custom = useBranchSheet((s) => briefModeView(s).mode === 'custom');

  return (
    <dialog ref={ref} id="branchDialog" className="sheet-dialog narrow branch-sheet" aria-labelledby="branchDialogTitle">
      <header className="sheet-head">
        <span className="sheet-icon" aria-hidden="true">
          <Icon name="ui-branch" size={16} />
        </span>
        <div className="sheet-titles">
          <h2 id="branchDialogTitle">Branch</h2>
          <p className="sheet-sub">
            Spin focused feature videos from <strong id="branchSource">{source}</strong>. Same product, narrower story.
          </p>
        </div>
        <button type="button" className="sheet-close" data-close="" aria-label="Close" onClick={() => closeSheet('branch')}>
          <Icon name="ui-x" size={14} />
        </button>
      </header>
      <div className="sheet-body branch-body">
        <div className="branch-toolbar">
          <p id="branchStatus" className="branch-status">
            {status}
          </p>
          <div className="branch-toolbar-actions">
            <button type="button" id="btnBranchCustom" className={`btn compact${custom ? ' is-on' : ''}`} onClick={() => startCustom()}>
              Write your own
            </button>{' '}
            <button type="button" id="btnBranchDiscover" className="btn compact" disabled={discovering} onClick={() => void discover()}>
              Ask agent for more
            </button>
          </div>
        </div>
        <BranchIdeas />
        <BranchBrief />
        <p className="ins-note subtle">
          Creates a copy in the same project folder, then the agent rewrites flow, narration and plates for the new angle. Record and Mix stay
          yours to approve.
        </p>
      </div>
      <footer className="sheet-foot">
        <button type="button" className="btn ghost" data-close="" onClick={() => closeSheet('branch')}>
          Cancel
        </button>{' '}
        <NeonButton id="btnBranchCreate" className="btn primary" disabled={creating} onClick={() => void createBranch()}>
          Create branch
        </NeonButton>
      </footer>
    </dialog>
  );
}

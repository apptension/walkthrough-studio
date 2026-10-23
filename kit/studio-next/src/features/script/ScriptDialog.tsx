import { Fragment, useLayoutEffect, useMemo, useRef } from 'react';

import { useDesk } from '@/desk/store';
import { Icon } from '@/ui/icons';
import { scriptApproveLabel } from '@/logic/scriptApproval';
import { SCENARIO_EDITABLE_NOTE } from '@/logic/scriptSections';
import { paintAgentStream } from '@/features/project-panel/agentStream';
import { reviewPill, stageWhen } from '@/features/stages/model';
import { closeSheet, useSheetDialog } from '@/features/stages/sheetDialog';

import { approvedMeta, briefDetail, globalLint, sceneListItems, sceneVisibility, totalsLength, totalsText, type SectionId } from './model';
import { ScriptScenes } from './ScriptScenes';
import { approveScript, jumpToSection, requestChanges, setOnlyIssues, setScriptNote, useScriptSheet } from './sheet';

const JUMPS: ReadonlyArray<{ id: SectionId; label: string }> = [
  { id: 'opening', label: 'Opening' },
  { id: 'story', label: 'Story' },
  { id: 'closing', label: 'Closing' },
];

/** The review leg the sheet paints: the one the script came with, else the summary's. */
function useScriptReview() {
  const sheetReview = useScriptSheet((s) => s.review?.script);
  const videoReview = useDesk((s) => s.video?.review?.script);
  return sheetReview || videoReview || { effective: 'draft' as const, approvedAt: null, approvedBy: null };
}

function useDrafting(): boolean {
  return useScriptSheet((s) => Boolean(s.draftJob));
}

function ScriptHead() {
  const script = useScriptSheet((s) => s.script);
  const onlyIssues = useScriptSheet((s) => s.onlyIssues);
  const drafting = useDrafting();
  const r = useScriptReview();
  const pill = script ? reviewPill(drafting ? 'draft' : r.effective) : null;
  return (
    <header className="sheet-head script-head">
      <span className="sheet-icon" aria-hidden="true">
        <Icon name="ui-checklist-done" size={16} />
      </span>
      <div className="sheet-titles">
        <div className="sheet-title-row">
          <h2 id="scriptDialogTitle">Scenario</h2>{' '}
          <span id="scriptStatus" className="review-pill" data-tone={pill?.tone}>
            {pill ? (drafting ? 'Drafting…' : pill.text) : 'Draft'}
          </span>
        </div>
        <p id="scriptTotals" className="sheet-sub">
          {script ? totalsText(script, drafting) : 'Walk the story top to bottom — what appears, how long it holds, what is said.'}
        </p>
        <p id="scriptEditableNote" className="sheet-sub">
          {script && (drafting || script.scaffold) ? '' : SCENARIO_EDITABLE_NOTE}
        </p>
      </div>
      <div className="sheet-tools">
        <label className="tog">
          <input type="checkbox" id="scriptOnlyIssues" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
          <span>Issues only</span>
        </label>{' '}
        <button type="button" className="sheet-close" data-close="" aria-label="Close" onClick={() => closeSheet('script')}>
          <Icon name="ui-x" size={14} />
        </button>
      </div>
    </header>
  );
}

/** `#scriptJump` — `syncScriptJump()` + the jump buttons `applyIssueFilter()` hides. */
function ScriptJump() {
  const script = useScriptSheet((s) => s.script);
  const drafting = useDrafting();
  const collapsed = useScriptSheet((s) => s.collapsed);
  const onlyIssues = useScriptSheet((s) => s.onlyIssues);
  const active = useScriptSheet((s) => s.activeJump);
  const items = useMemo(() => (script ? sceneListItems(script.scenes) : []), [script]);
  const sections = new Set(items.flatMap((i) => (i.type === 'section' ? [i.id] : [])));
  const waiting = drafting && Boolean(script?.scaffold);
  const vis = script ? sceneVisibility(items, collapsed, onlyIssues, script.scaffold) : null;
  const hidden = !script || drafting || Boolean(script.scaffold) || waiting || sections.size === 0;
  return (
    <nav id="scriptJump" className="script-jump" aria-label="Jump in scenario" hidden={hidden}>
      {JUMPS.map((j) => (
        <Fragment key={j.id}>
          <button
            type="button"
            className={`script-jump-btn${active === j.id ? ' is-active' : ''}`}
            data-jump={j.id}
            hidden={!sections.has(j.id) || Boolean(vis?.sectionHidden.get(j.id))}
            onClick={() => jumpToSection(j.id)}
          >
            {j.label}
          </button>{' '}
        </Fragment>
      ))}
      <span className="script-jump-hint">Collapse sections · drag grips to reorder · auto-scrolls while dragging</span>
    </nav>
  );
}

function DraftBanner() {
  const job = useScriptSheet((s) => s.draftJob);
  const title = useScriptSheet((s) => s.draftTitle);
  const streamRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (job) paintAgentStream(streamRef.current, job, { variant: 'banner' });
  }, [job]);
  return (
    <div id="scriptDraftBanner" className="draft-banner" hidden={!job}>
      <span className="activity-spinner" />
      <div className="draft-banner-body">
        <strong id="scriptDraftTitle">{job ? title : 'Agent is drafting the first script…'}</strong>{' '}
        <span className="draft-hint">Stay here — the storyboard refreshes when the draft lands. Nothing is recorded yet.</span>
        <div ref={streamRef} id="scriptDraftStream" className="agent-stream agent-stream--banner is-empty" aria-label="Agent output" />
      </div>
    </div>
  );
}

function ScriptGuide() {
  const loaded = useScriptSheet((s) => Boolean(s.script));
  const drafting = useDrafting();
  return (
    <div id="scriptGuide" className="script-guide" hidden={!loaded || drafting}>
      <details className="script-guide-more">
        <summary>How editing works · structure, timing, voice</summary>
        <div className="script-guide-grid">
          <div>
            <strong>Structure</strong>{' '}
            <span>
              Collapse Opening, Story or Closing to focus. Drag the grip to reorder — the list scrolls when you hit the edges. Plates sit
              before the chapter they introduce.
            </span>
          </div>
          <div>
            <strong>Timing</strong>{' '}
            <span>Card hold is how long overlays stay up. Lengthen when voice runs long; Default clears a custom hold.</span>
          </div>
          <div>
            <strong>Voice</strong>{' '}
            <span>Empty carries the previous line. Re-run audio after pace changes; re-render plates after plate copy edits.</span>
          </div>
        </div>
      </details>
    </div>
  );
}

function ScriptStats() {
  const script = useScriptSheet((s) => s.script);
  const drafting = useDrafting();
  const show = Boolean(script) && !drafting && !script?.scaffold;
  const t = script?.totals;
  return (
    <div id="scriptStats" className="script-stats" hidden={!show}>
      {show && t ? (
        <>
          <div className="script-stat">
            <strong>{t.chapters}</strong>
            <span>Chapters</span>
          </div>
          <div className="script-stat">
            <strong>{t.plates}</strong>
            <span>Plates</span>
          </div>
          <div className="script-stat">
            <strong>{t.words}</strong>
            <span>Words</span>
          </div>
          <div className="script-stat">
            <strong>~{totalsLength(t.estSec)}</strong>
            <span>Length</span>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ScriptLint() {
  const script = useScriptSheet((s) => s.script);
  const drafting = useDrafting();
  const brief = useDesk((s) => s.video?.brief);
  const story = useDesk((s) => s.video?.story);
  const notes = script && !drafting && !script.scaffold ? globalLint(script) : [];
  return (
    <ul id="scriptLint" className="script-lint">
      {script && brief && !drafting ? (
        <li className="lint-brief">
          <details>
            <summary>Brief · {brief.audience || brief.title || 'Pinned'}</summary>
            <p>{briefDetail(brief, story)}</p>
          </details>
        </li>
      ) : null}
      {notes.map((l, i) => (
        <li key={i} className={`lvl-${l.level}`}>
          {l.message}
        </li>
      ))}
    </ul>
  );
}

function ScriptFoot() {
  const script = useScriptSheet((s) => s.script);
  const note = useScriptSheet((s) => s.note);
  const proof = useScriptSheet((s) => s.approvedProof);
  const drafting = useDrafting();
  const r = useScriptReview();
  const meta = proof ?? (script ? approvedMeta(r, script.totals.errors, drafting, (iso) => stageWhen(iso)) : '');
  return (
    <footer className="sheet-foot script-foot">
      <details className="script-revise">
        <summary>
          <span>Ask AI to revise</span> <i>optional</i>
        </summary>
        <label className="note-field">
          <span className="sr-only">Revision note</span>
          <textarea
            id="scriptNote"
            rows={2}
            placeholder="e.g. Lead with the calendar, cut settings to two steps, mention Slack earlier."
            value={note}
            onChange={(e) => setScriptNote(e.target.value)}
          />
        </label>
        <div className="script-revise-actions">
          <button type="button" id="btnScriptRequest" className="btn" disabled={Boolean(script) && drafting} onClick={() => void requestChanges()}>
            Revise with AI
          </button>
        </div>
      </details>
      <div className="sheet-actions script-foot-actions">
        <span id="scriptApprovedMeta" className="meta">
          {meta}
        </span>{' '}
        <span className="kbd-hint">
          <kbd>⌘</kbd>
          <kbd>↵</kbd> saves line
        </span>{' '}
        <button
          type="button"
          id="btnScriptApprove"
          className="btn primary"
          disabled={Boolean(script) && (drafting || r.effective === 'approved')}
          onClick={() => void approveScript()}
        >
          {script ? scriptApproveLabel(r.effective) : 'Approve and close'}
        </button>
      </div>
    </footer>
  );
}

/** `#scriptDialog` — the scenario sheet. */
export function ScriptDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useSheetDialog('script', ref);
  const script = useScriptSheet((s) => s.script);
  const drafting = useDrafting();
  const cls = script ? `${drafting ? ' is-drafting' : ''}${script.scaffold && !drafting ? ' is-scaffold' : ''}` : '';
  return (
    <dialog ref={ref} id="scriptDialog" className={`sheet-dialog wide script-sheet${cls}`} aria-labelledby="scriptDialogTitle">
      <ScriptHead />
      <ScriptJump />
      <div className="sheet-body script-body">
        <DraftBanner />
        <ScriptGuide />
        <div id="scriptScaffoldNote" className="script-scaffold" hidden={!script?.scaffold || drafting}>
          <strong>Starter template</strong>{' '}
          <span>Placeholder storyboard — wait for the agent draft, or shape structure and narration here.</span>
        </div>
        <ScriptStats />
        <ScriptLint />
        <ScriptScenes />
      </div>
      <ScriptFoot />
    </dialog>
  );
}

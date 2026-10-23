/**
 * Pipeline step status marks, failure actions, and resume helpers.
 * Pure — safe for unit tests without the Studio DOM.
 */
import { icon } from './icons.js';

/** Filled success badge with a crisp check. */
const MARK_DONE = `<span class="pip-badge pip-badge-done" aria-hidden="true">${icon('pip-done', { size: 14 })}</span>`;

/** Filled failure badge with a crisp X. */
const MARK_FAIL = `<span class="pip-badge pip-badge-fail" aria-hidden="true">${icon('pip-fail', { size: 13 })}</span>`;

/**
 * Running loader: the whole badge rotates so SVG transform attrs never fight CSS.
 * Inner arc is static; outer track is quiet.
 */
const MARK_RUN = `<span class="pip-badge pip-badge-run" aria-hidden="true">${icon('pip-run', { size: 22 })}</span>`;

/** Pending empty ring. */
const MARK_TODO = `<span class="pip-badge pip-badge-todo" aria-hidden="true">${icon('pip-todo', { size: 18 })}</span>`;

export function statusMark(status) {
  const st = status || 'todo';
  if (st === 'done') return MARK_DONE;
  if (st === 'fail') return MARK_FAIL;
  if (st === 'run') return MARK_RUN;
  return MARK_TODO;
}

export function statusAria(status) {
  const st = status || 'todo';
  if (st === 'done') return 'Done';
  if (st === 'fail') return 'Failed';
  if (st === 'run') return 'Running';
  return 'Pending';
}

export function statusCaption(status) {
  const st = status || 'todo';
  if (st === 'run') return 'Working…';
  if (st === 'fail') return 'Failed';
  if (st === 'done') return 'Done';
  return '';
}

/** Map a failed kit step to the improve goal that can repair it. */
export function improveGoalForStep(stepId) {
  if (stepId === 'audio' || stepId === 'voice' || stepId === 'music' || stepId === 'mix') return 'voice';
  if (stepId === 'plates') return 'plates';
  if (stepId === 'record') return 'full';
  return 'full';
}

/**
 * When plates run beside record/produce, a plates failure must resume the host step.
 * @param {string} fromStep
 * @param {string[]} stepIds
 */
export function effectiveResumeStep(fromStep, stepIds = []) {
  const ids = stepIds || [];
  if (fromStep === 'plates' && ids.includes('record')) return 'record';
  if (fromStep === 'plates' && ids.includes('produce')) return 'produce';
  return fromStep || ids[0] || null;
}

/**
 * Build statuses for a resume: keep earlier steps done, reset from the resume point.
 * @param {{ id: string, label: string, status?: string }[]} steps
 * @param {string|null} fromStep
 */
export function statusesForResume(steps, fromStep) {
  const ids = (steps || []).map((s) => s.id);
  const resume = effectiveResumeStep(fromStep, ids);
  const idx = resume ? ids.indexOf(resume) : 0;
  const start = idx < 0 ? 0 : idx;
  return (steps || []).map((s, i) => ({
    ...s,
    status: i < start ? 'done' : 'todo',
  }));
}

const GUIDED_TAIL = [
  { id: 'produce', label: 'Produce master video' },
  { id: 'audio', label: 'Add voice & music' },
  { id: 'deliver', label: 'Export handoff pack' },
  { id: 'preview', label: 'Show in player' },
];

/**
 * A "record it yourself" run: the reviewer records, chooses a take, then either their own
 * recording becomes the take ('own') or the bot re-records the captured steps ('bot').
 * @param {'own'|'bot'} branch
 */
export function guidedSteps(branch = 'own') {
  const head = [
    { id: 'guide', label: 'You record the tour' },
    { id: 'decide', label: 'Choose your take' },
  ];
  const middle =
    branch === 'bot'
      ? [
          { id: 'retake', label: 'Script your steps' },
          { id: 'record', label: 'Bot re-records your steps' },
          { id: 'plates', label: 'Render brand plates' },
          { id: 'recraft', label: 'Recraft around the take' },
        ]
      : [
          { id: 'adopt', label: 'Keep your recording' },
          { id: 'own-script', label: 'Write around your recording' },
          { id: 'plates', label: 'Render brand plates' },
        ];
  return [...head, ...middle, ...GUIDED_TAIL];
}

/** Which branch a guided run resumes on: the step names it, else the last choice. */
export function guidedBranchFor(fromStep, remembered = null) {
  if (fromStep === 'adopt' || fromStep === 'own-script') return 'own';
  if (fromStep === 'retake' || fromStep === 'record' || fromStep === 'recraft') return 'bot';
  return remembered === 'bot' ? 'bot' : 'own';
}

/** Whether the pipeline loop should execute this step when resuming. */
export function shouldRunStep(stepId, stepIds, fromStep) {
  if (!fromStep) return true;
  const resume = effectiveResumeStep(fromStep, stepIds);
  const ids = stepIds || [];
  const start = ids.indexOf(resume);
  const at = ids.indexOf(stepId);
  if (start < 0 || at < 0) return true;
  return at >= start;
}

/**
 * Compact a job log into a director-note excerpt.
 * @param {Array<string|{line?: string}>|string|null|undefined} log
 * @param {number} [maxChars]
 */
export function logExcerpt(log, maxChars = 2400) {
  let text = '';
  if (typeof log === 'string') text = log;
  else if (Array.isArray(log)) {
    text = log
      .map((row) => (typeof row === 'string' ? row : row?.line || ''))
      .filter(Boolean)
      .join('\n');
  }
  text = text.replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `…\n${text.slice(-maxChars)}`;
}

/**
 * Director note that seeds Fix-with-AI from a pipeline failure.
 * @param {{ label?: string, stepId?: string, error?: string, log?: unknown }} failure
 */
export function pipelineFixNote(failure = {}) {
  const label = failure.label || failure.stepId || 'pipeline step';
  const err = String(failure.error || '').trim();
  const log = logExcerpt(failure.log);
  const lines = [
    `The pipeline failed at “${label}”. Diagnose the error, apply the smallest safe fix in the sources, and leave the project ready to re-run that step.`,
  ];
  if (err) lines.push('', 'Error:', err);
  if (log) lines.push('', 'Recent log:', log);
  return lines.join('\n');
}

/**
 * Markup for one pipeline row.
 * @param {{ id: string, label: string, status?: string }} step
 * @param {{ icon?: string, actions?: boolean }} [opts]
 */
export function stepRowHtml(step, { icon = '', actions = false } = {}) {
  const st = step.status || 'todo';
  const id = String(step.id || '');
  const label = String(step.label || id);
  const caption = statusCaption(st);
  const showActions = actions && st === 'fail';
  const captionHtml = caption ? `<span class="pip-cap">${escapeHtml(caption)}</span>` : '';
  const actionsHtml = showActions
    ? `<div class="pip-actions">
        <button type="button" class="pip-act" data-pipe-retry="${escapeAttr(id)}" title="Retry this step and continue the pipeline">Retry</button>
        <button type="button" class="pip-act primary" data-pipe-fix="${escapeAttr(id)}" title="Send the failure log to the Director and fix with AI">Fix</button>
      </div>`
    : '';
  return `<li class="${st}" data-step-id="${escapeAttr(id)}">
      <span class="pip-ico">${icon}</span>
      <div class="pip-main">
        <span class="pip-label">${escapeHtml(label)}</span>
        ${captionHtml}
        ${actionsHtml}
      </div>
      <span class="pip-mark" aria-label="${statusAria(st)}">${statusMark(st)}</span>
    </li>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

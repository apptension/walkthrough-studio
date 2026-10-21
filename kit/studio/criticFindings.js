/** Critic finding markup. Fix with AI sits in the header so it is visible without the body. */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export { directorNoteForFinding } from './frameCheck.js';

export function criticFindingMarkup(f, i) {
  const frame =
    f.frame?.path || f.frame?.at != null
      ? `<p class="critic-frame">Sampled ${esc(f.frame.path || 'frame')}${f.frame.at != null ? ` at ${Number(f.frame.at).toFixed(1)}s` : ''}</p>`
      : '';
  return `<div class="critic-item ${esc(f.severity)}">
        <div class="critic-item-head"><span class="tag">${esc(f.severity)}</span><span class="critic-target">${esc(f.target)}</span><span class="critic-persona">${esc(f.persona)}</span><button type="button" class="btn primary critic-fix" data-critic-fix="${i}" title="Send this finding to the agent as a director note">Fix with AI</button></div>
        <p class="critic-issue">${esc(f.issue)}</p>
        <p class="critic-suggest">${esc(f.suggestion)}</p>
        ${frame}
      </div>`;
}

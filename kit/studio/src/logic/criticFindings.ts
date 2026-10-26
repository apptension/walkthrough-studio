/** Critic finding markup. Fix with AI sits in the header so it is visible without the body. */

import type { Critic, CriticFinding } from '@/api/types';
import { neonFxHtml } from '@/ui/neonFx';

import { asText } from './text';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: unknown): string => asText(s ?? '').replace(/[&<>"]/g, (c) => ESC[c] ?? c);

export { directorNoteForFinding } from './frameCheck';

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, fail: 0, warn: 1, info: 2 };

/** Highest-severity findings first, capped so the director note stays scannable. */
export function listedCriticFindings(findings: CriticFinding[] | null | undefined, limit = 8): CriticFinding[] {
  return [...(findings || [])]
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
    .slice(0, limit);
}

/**
 * Build a director note from the critic report: agent summary (if any) plus the
 * top findings as actionable bullets the improve agent can follow.
 */
export function directorNoteForCritic(critic: Pick<Critic, 'findings' | 'agent'> | null | undefined): string {
  if (!critic) return '';
  const findings = listedCriticFindings(critic.findings);
  const summary = asText(critic.agent?.summary || '').trim();
  if (!findings.length && !summary) return '';

  const lines: string[] = [];
  if (summary) {
    lines.push(summary, '');
  }
  if (findings.length) {
    lines.push(
      findings.length === 1
        ? 'Address this critic finding. Prefer the smallest safe change; keep brand and captured footage intact unless it requires otherwise.'
        : `Address these ${findings.length} critic findings. Prefer the smallest safe change for each; keep brand and captured footage intact unless a finding requires otherwise.`,
      '',
    );
    for (const f of findings) {
      const who = f.persona ? ` · ${f.persona}` : '';
      const where = f.target ? ` (${f.target})` : '';
      const issue = asText(f.issue || f.message || f.title || 'Finding').trim();
      const fix = f.suggestion ? ` — ${asText(f.suggestion).trim()}` : '';
      lines.push(`- [${f.severity}${who}] ${issue}${where}${fix}`);
    }
  }
  return lines.join('\n').trim();
}

export interface CriticFindingView {
  severity?: string;
  target?: string;
  persona?: string;
  issue?: string;
  suggestion?: string;
  frame?: { at?: number | null; path?: string | null } | null;
}

export function criticFindingMarkup(f: CriticFindingView, i: number | string): string {
  const frame =
    f.frame?.path || f.frame?.at != null
      ? `<p class="critic-frame">Sampled ${esc(f.frame.path || 'frame')}${f.frame.at != null ? ` at ${Number(f.frame.at).toFixed(1)}s` : ''}</p>`
      : '';
  return `<div class="critic-item ${esc(f.severity)}">
        <div class="critic-item-head"><span class="tag">${esc(f.severity)}</span><span class="critic-target">${esc(f.target)}</span><span class="critic-persona">${esc(f.persona)}</span><button type="button" class="btn primary critic-fix" data-critic-fix="${i}" title="Send this finding to the agent as a director note">${neonFxHtml()}Fix with AI</button></div>
        <p class="critic-issue">${esc(f.issue)}</p>
        <p class="critic-suggest">${esc(f.suggestion)}</p>
        ${frame}
      </div>`;
}

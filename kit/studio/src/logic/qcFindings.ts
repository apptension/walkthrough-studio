/**
 * Turn automatic quality-check findings into a director note the improve agent can act on.
 */

import type { QcFinding } from '@/api/types';

/** Stable key for a finding in the selection set (code + message + index). */
export function qcFindingKey(f: QcFinding, index: number): string {
  return `${f.code || 'qc'}:${index}:${f.message.slice(0, 48)}`;
}

/** Findings shown in Review — warn/fail first, then info; cap so the list stays scannable. */
export function listedQcFindings(findings: QcFinding[] | null | undefined, limit = 12): QcFinding[] {
  const list = findings || [];
  const rank = (s: string) => (s === 'fail' ? 0 : s === 'warn' ? 1 : 2);
  return [...list].sort((a, b) => rank(a.severity) - rank(b.severity)).slice(0, limit);
}

/** Keys for every listed finding (default: all selected when opening from a version card). */
export function allQcKeys(findings: QcFinding[]): string[] {
  return findings.map((f, i) => qcFindingKey(f, i));
}

export function selectedQcFindings(findings: QcFinding[], keys: Iterable<string>): QcFinding[] {
  const want = new Set(keys);
  return findings.filter((f, i) => want.has(qcFindingKey(f, i)));
}

/** One director note that lists the chosen findings for the improve agent. */
export function directorNoteForQc(findings: QcFinding[]): string {
  if (!findings.length) return '';
  const lines = findings.map((f) => {
    const tag = f.severity === 'fail' ? 'Must fix' : f.severity === 'warn' ? 'Warning' : 'Note';
    return `- [${tag}] ${f.message}${f.code ? ` (${f.code})` : ''}`;
  });
  return [
    'Fix the following quality-check findings from the last render. Prefer the smallest safe change for each item; keep brand, pacing intent, and captured product footage intact unless a finding requires otherwise.',
    '',
    ...lines,
  ].join('\n');
}

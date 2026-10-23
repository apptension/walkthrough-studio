import { describe, expect, it } from 'vitest';

import type { QcFinding } from '@/api/types';

import { allQcKeys, directorNoteForQc, listedQcFindings, qcFindingKey, selectedQcFindings } from './qcFindings';

const f = (partial: Partial<QcFinding> & Pick<QcFinding, 'severity' | 'message'>): QcFinding => ({
  code: 'x',
  ...partial,
});

describe('listedQcFindings', () => {
  it('puts fail and warn ahead of info and caps the list', () => {
    const findings = [
      f({ severity: 'info', code: 'i', message: 'Info' }),
      f({ severity: 'fail', code: 'f', message: 'Fail' }),
      f({ severity: 'warn', code: 'w', message: 'Warn' }),
      ...Array.from({ length: 12 }, (_, i) => f({ severity: 'info', code: `n${i}`, message: `N${i}` })),
    ];
    const listed = listedQcFindings(findings, 4);
    expect(listed.map((x) => x.code)).toEqual(['f', 'w', 'i', 'n0']);
  });
});

describe('selection keys', () => {
  it('picks the findings whose keys are selected', () => {
    const findings = [
      f({ severity: 'warn', code: 'a', message: 'One' }),
      f({ severity: 'warn', code: 'b', message: 'Two' }),
    ];
    const keys = [qcFindingKey(findings[1]!, 1)];
    expect(selectedQcFindings(findings, keys).map((x) => x.code)).toEqual(['b']);
    expect(allQcKeys(findings)).toHaveLength(2);
  });
});

describe('directorNoteForQc', () => {
  it('builds an actionable note from the chosen findings', () => {
    const note = directorNoteForQc([
      f({ severity: 'fail', code: 'pace', message: 'Narration too fast' }),
      f({ severity: 'warn', code: 'hold', message: 'Long hold on title' }),
    ]);
    expect(note).toMatch(/smallest safe change/i);
    expect(note).toContain('[Must fix] Narration too fast (pace)');
    expect(note).toContain('[Warning] Long hold on title (hold)');
  });

  it('returns empty when nothing is selected', () => {
    expect(directorNoteForQc([])).toBe('');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desk } from '@/desk/store';
import { makeVideo } from '@/test/factories';

import { applyQcWithAi, openQcReview, setAllQcKeys, toggleQcKey } from './qc';

const improve = vi.hoisted(() => ({ startImprove: vi.fn() }));
vi.mock('@/features/feedback/improve', () => improve);

beforeEach(() => {
  desk.reset();
  improve.startImprove.mockClear();
});

const findings = [
  { severity: 'warn' as const, code: 'pace', message: 'Too fast' },
  { severity: 'info' as const, code: 'cap', message: 'Caption tip' },
];

describe('openQcReview', () => {
  it('opens Review and selects every listed finding', () => {
    desk.set({ video: makeVideo({ qc: { status: 'warn', summary: { fail: 0, warn: 1, info: 1 }, findings, url: '' } }) });
    openQcReview();
    expect(desk.get().rightTab).toBe('review');
    expect(desk.get().qcKeys).toHaveLength(2);
    expect(desk.get().qcFocus).toBeGreaterThan(0);
  });
});

describe('applyQcWithAi', () => {
  it('hands selected findings to Feedback and starts improve', () => {
    desk.set({
      video: makeVideo({ qc: { status: 'warn', summary: { fail: 0, warn: 1, info: 1 }, findings, url: '' } }),
    });
    openQcReview();
    toggleQcKey(desk.get().qcKeys[1]!, false);
    applyQcWithAi('selected');
    expect(desk.get().rightTab).toBe('feedback');
    expect(desk.get().improve.note).toMatch(/Too fast/);
    expect(desk.get().improve.note).not.toMatch(/Caption tip/);
    expect(desk.get().qcPending).toHaveLength(1);
    expect(improve.startImprove).toHaveBeenCalledWith('full');
  });

  it('apply all ignores a partial selection', () => {
    desk.set({
      video: makeVideo({ qc: { status: 'warn', summary: { fail: 0, warn: 1, info: 1 }, findings, url: '' } }),
    });
    setAllQcKeys(false);
    applyQcWithAi('all');
    expect(desk.get().qcPending).toHaveLength(2);
    expect(improve.startImprove).toHaveBeenCalled();
  });

  it('warns when nothing is selected', () => {
    desk.set({
      video: makeVideo({ qc: { status: 'warn', summary: { fail: 0, warn: 1, info: 0 }, findings: [findings[0]!], url: '' } }),
      qcKeys: [],
    });
    applyQcWithAi('selected');
    expect(improve.startImprove).not.toHaveBeenCalled();
    expect(desk.get().toasts.at(-1)?.title).toMatch(/Pick at least one/i);
  });
});

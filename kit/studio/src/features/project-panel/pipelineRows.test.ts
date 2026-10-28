import { describe, expect, it } from 'vitest';

import type { PipelineStep } from '@/desk/store';

import { patchRows, pipelineRows } from './pipelineRows';

const steps: PipelineStep[] = [
  { id: 'record', label: 'Record walkthrough', status: 'done' },
  { id: 'produce', label: 'Produce master video', status: 'fail' },
  { id: 'decide', label: 'Choose your take', status: 'todo' },
];

describe('pipeline rows', () => {
  it('renders the legacy row markup with Retry / Fix on a failure', () => {
    const rows = pipelineRows(steps, { busy: false, failure: true, failureError: '' });
    expect(rows.map((r) => r.key)).toEqual(['record', 'produce', 'decide']);
    expect(rows[1]?.html).toContain('data-pipe-retry="produce"');
    expect(rows[1]?.html).toContain('data-pipe-fix="produce"');
    expect(rows[0]?.html).not.toContain('pip-actions');
  });

  it('disables the row buttons while a job runs', () => {
    const rows = pipelineRows(steps, { busy: true, failure: true, failureError: '' });
    expect(rows[1]?.html).toContain('<button disabled type="button" class="pip-act"');
  });

  it('borrows the produce icon for steps without one', () => {
    const rows = pipelineRows(steps, { busy: false, failure: false, failureError: '' });
    const ico = (html: string) => /<span class="pip-ico">([\s\S]*?)<\/span>\s*<div/.exec(html)?.[1];
    expect(ico(rows[2]?.html ?? '')).toBe(ico(rows[1]?.html ?? ''));
  });

  it('patches only changed rows and keeps unchanged nodes', () => {
    const ol = document.createElement('ol');
    patchRows(ol, pipelineRows(steps, { busy: false, failure: false, failureError: '' }));
    expect(ol.children).toHaveLength(3);
    const first = ol.children[0];
    expect((first as HTMLElement).dataset['rowKey']).toBe('record');
    expect((first as HTMLElement).dataset['rowHtml']).toContain('data-step-id="record"');
    const second = ol.children[1];
    const next = steps.map((s) => (s.id === 'produce' ? { ...s, status: 'run' as const } : s));
    patchRows(ol, pipelineRows(next.slice(0, 2), { busy: false, failure: false, failureError: '' }));
    expect(ol.children).toHaveLength(2);
    expect(ol.children[0]).toBe(first);
    expect(ol.children[1]).not.toBe(second);
    expect(ol.children[1]).toHaveClass('run');
  });
});

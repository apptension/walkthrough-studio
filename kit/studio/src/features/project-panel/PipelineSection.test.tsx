import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as JobsModule from '@/desk/jobs';
import { fixPipelineStep, retryPipelineFrom } from '@/desk/jobs';
import { desk, type PipelineStep } from '@/desk/store';

import { PipelineSection } from './PipelineSection';

vi.mock('@/desk/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof JobsModule>()),
  retryPipelineFrom: vi.fn(),
  fixPipelineStep: vi.fn(),
}));

const ol = () => document.getElementById('actionSteps') as HTMLOListElement;
const idle = () => document.getElementById('pipelineIdle') as HTMLElement;

const steps: PipelineStep[] = [
  { id: 'record', label: 'Record walkthrough', status: 'done' },
  { id: 'produce', label: 'Produce master video', status: 'run' },
];

beforeEach(() => {
  vi.clearAllMocks();
  desk.reset();
});

describe('PipelineSection', () => {
  it('renders the section label and hides both list and idle hint at first', () => {
    render(<PipelineSection />);
    expect(document.querySelector('.render-pipeline-block [data-ico="pipeline"]')).toHaveTextContent('Pipeline');
    expect(document.querySelector('.render-pipeline-block .sec-ico')).not.toBeNull();
    expect(ol()).toHaveClass('render-pipeline');
    expect(ol().hidden).toBe(true);
    expect(idle().hidden).toBe(true);
  });

  it('paints step rows and patches them in place', () => {
    render(<PipelineSection />);
    act(() => desk.set({ pipeline: steps }));
    expect(ol().hidden).toBe(false);
    const rows = ol().querySelectorAll('li');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveClass('done');
    expect(rows[0]).toHaveAttribute('data-step-id', 'record');
    expect(rows[1]?.querySelector('.pip-cap')).toHaveTextContent('Working…');
    expect(rows[1]?.querySelector('.pip-mark')).toHaveAttribute('aria-label', 'Running');
    const first = rows[0];
    act(() => desk.set({ pipeline: steps.map((s) => (s.id === 'produce' ? { ...s, status: 'done' } : s)) }));
    expect(ol().querySelectorAll('li')[0]).toBe(first);
    expect(ol().querySelectorAll('li')[1]).toHaveClass('done');
  });

  it('offers Retry and Fix on a failed step, disabled while busy', () => {
    render(<PipelineSection />);
    act(() =>
      desk.set({
        pipeline: [{ id: 'produce', label: 'Produce master video', status: 'fail' }],
        pipelineFailure: { mode: 'quick', slug: 'demo', stepId: 'produce', label: 'Produce', error: 'x', log: '' },
      }),
    );
    fireEvent.click(ol().querySelector('[data-pipe-retry]') as HTMLElement);
    fireEvent.click(ol().querySelector('[data-pipe-fix]') as HTMLElement);
    expect(retryPipelineFrom).toHaveBeenCalledWith('produce');
    expect(fixPipelineStep).toHaveBeenCalledWith('produce');
    act(() => desk.set({ jobBusy: true }));
    expect(ol().querySelector('[data-pipe-retry]')).toBeDisabled();
  });

  it('shows the idle hint once a pipeline is cleared', () => {
    render(<PipelineSection />);
    act(() => desk.set({ pipeline: steps }));
    act(() => desk.set({ pipeline: null }));
    expect(ol().hidden).toBe(true);
    expect(ol().children).toHaveLength(0);
    expect(idle().hidden).toBe(false);
  });
});

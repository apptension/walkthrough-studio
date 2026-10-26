import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decideAction } from '@/desk/action';
import { requestMake } from '@/desk/jobs';
import { showRightTab } from '@/desk/panels';
import { desk, setStatus } from '@/desk/store';
import { makeVideo } from '@/test/factories';

import { RenderCluster } from './RenderCluster';
import { NOTICE_MS } from './renderStatus';

vi.mock('@/desk/jobs', () => ({ requestMake: vi.fn(), stopAllWork: vi.fn() }));
vi.mock('@/desk/panels', () => ({ showRightTab: vi.fn() }));

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const cluster = () => $('renderCluster');
const label = () => document.querySelector('.render-fresh-label')?.textContent;
const chip = () => document.querySelector('.render-fresh-chip') as HTMLElement;

const stale = makeVideo({
  hasDelivery: true,
  freshness: {
    stale: true,
    sources: [{ key: 'narration', mtime: Date.now() - 60_000, newerThanDelivery: true, newerThanLive: true }],
  },
});
const fresh = makeVideo();

function load(video: typeof stale, extra: Partial<ReturnType<typeof desk.get>> = {}) {
  act(() => desk.set({ video, action: decideAction(video), ...extra }));
}

beforeEach(() => {
  desk.reset();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('RenderCluster', () => {
  it('stays folded behind Render while Program is current', () => {
    load(fresh);
    render(<RenderCluster />);
    expect(cluster()).toHaveAttribute('data-kind', 'idle');
    expect($('btnMake')).toHaveAttribute('title', 'Render / rebuild delivery');
    expect($('btnMake')).not.toHaveAttribute('aria-describedby');
    expect($('renderTip')).toBeEmptyDOMElement();
    expect($('renderStatus')).toHaveTextContent('');
  });

  it('folds out Out of date and explains why on hover', () => {
    load(stale);
    render(<RenderCluster />);
    expect(cluster()).toHaveAttribute('data-kind', 'render');
    expect(cluster()).toHaveAttribute('data-attention');
    expect(label()).toBe('Out of date');
    expect($('renderStatus')).toHaveTextContent('Out of date');
    expect($('btnMake')).toHaveAttribute('aria-describedby', 'renderTip');

    fireEvent.pointerOver($('btnMake'));
    expect($('renderTip')).toHaveAttribute('data-open');
    expect($('renderTip')).toHaveTextContent('Narration');
    expect($('renderTip')).toHaveTextContent('Click Render to catch up');
    fireEvent.pointerOut($('btnMake'), { relatedTarget: document.body });
    expect($('renderTip')).not.toHaveAttribute('data-open');
  });

  it('runs the fix from the chip: Render when behind, Feedback when a review waits', () => {
    load(stale);
    render(<RenderCluster />);
    fireEvent.click(chip());
    expect(requestMake).toHaveBeenCalledTimes(1);

    act(() => desk.set({ proposalOpen: true }));
    expect(label()).toBe('Review changes');
    fireEvent.click(chip());
    expect(showRightTab).toHaveBeenCalledWith('feedback');
    expect(requestMake).toHaveBeenCalledTimes(1);
  });

  it('morphs Out of date → running step → Up to date → folded', () => {
    vi.useFakeTimers();
    load(stale);
    render(<RenderCluster />);
    act(() =>
      desk.set({
        jobBusy: true,
        status: { kind: 'run', text: 'Rendering…' },
        pipeline: [{ id: 'produce', label: 'Produce master video', status: 'run' }],
      }),
    );
    expect(cluster()).toHaveAttribute('data-kind', 'busy');
    expect(label()).toBe('Produce master video');
    fireEvent.pointerOver($('btnMake'));
    expect($('renderTip')).toHaveTextContent('Catching up');

    load(fresh);
    act(() => desk.set({ jobBusy: false, pipeline: null, status: { kind: '', text: '' } }));
    expect(cluster()).toHaveAttribute('data-kind', 'notice');
    expect(label()).toBe('Up to date');

    act(() => {
      vi.advanceTimersByTime(NOTICE_MS.ok);
    });
    expect(cluster()).toHaveAttribute('data-kind', 'idle');
    expect(label()).toBe('Up to date');
  });

  it('flashes a notice, then falls back to what the cut needs', () => {
    vi.useFakeTimers();
    load(stale);
    render(<RenderCluster />);
    act(() => setStatus('warn', 'Job failed'));
    expect(cluster()).toHaveAttribute('data-kind', 'notice');
    expect(label()).toBe('Job failed');
    act(() => {
      vi.advanceTimersByTime(NOTICE_MS.warn);
    });
    expect(label()).toBe('Out of date');
  });

  it('never repeats the render state as a notice, and ignores running activity', () => {
    load(stale);
    render(<RenderCluster />);
    act(() => setStatus('run', 'Rebuilding plate HTML…'));
    expect(cluster()).toHaveAttribute('data-kind', 'render');
  });

  it('does not claim a catch-up for a job that started current', () => {
    load(fresh);
    render(<RenderCluster />);
    act(() => desk.set({ jobBusy: true }));
    act(() => desk.set({ jobBusy: false }));
    expect(cluster()).toHaveAttribute('data-kind', 'idle');
  });

  it('does not flash Up to date when switching to a current sequence', () => {
    load(stale, { slug: 'a' });
    render(<RenderCluster />);
    load(fresh, { slug: 'b' });
    expect(cluster()).toHaveAttribute('data-kind', 'idle');
  });
});

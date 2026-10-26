import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as JobsModule from '@/desk/jobs';
import { stopAllWork } from '@/desk/jobs';
import { desk } from '@/desk/store';
import { describeJob } from '@/logic/progress';
import { makeJob } from '@/test/factories';

import { ActivitySection } from './ActivityCard';

vi.mock('@/desk/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof JobsModule>()),
  stopAllWork: vi.fn(() => Promise.resolve()),
}));

const $ = (id: string) => document.getElementById(id) as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  desk.reset();
});

describe('ActivitySection', () => {
  it('shows the idle card', () => {
    render(<ActivitySection />);
    expect(document.querySelector('[data-ico="activity"]')).toHaveTextContent('Activity');
    expect($('renderLiveCard')).toHaveAttribute('class', 'render-live-card is-idle');
    expect($('renderSpinner').hidden).toBe(true);
    expect($('renderLiveElapsed').hidden).toBe(true);
    expect($('renderLivePhase').hidden).toBe(true);
    expect($('renderLiveArt').hidden).toBe(false);
    expect($('renderLiveArt')).toHaveAttribute('data-art', 'tumbleweed');
    expect($('activityLive').hidden).toBe(true);
    expect($('renderLiveTitle')).toHaveTextContent('All quiet on set');
    expect($('renderLiveMeta')).toHaveTextContent('Render above, or queue a single step below.');
    expect($('renderLiveBar').hidden).toBe(true);
    expect($('renderLiveNow').hidden).toBe(true);
    expect($('renderStages').hidden).toBe(true);
    expect($('renderLiveStream')).toHaveClass('agent-stream', 'agent-stream--bay', 'is-empty');
    expect($('renderLiveLog').hidden).toBe(true);
    expect($('btnStopRender').hidden).toBe(true);
    expect($('btnRenderLogToggle').hidden).toBe(true);
    expect($('btnRenderLogToggle')).toHaveTextContent('Expand log');
  });

  it('paints a running job from describeJob', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T09:00:31.000Z'));
    const job = makeJob();
    const view = describeJob(job);
    render(<ActivitySection />);
    act(() => desk.set({ renderJob: job, jobBusy: true }));
    expect($('renderLiveCard')).toHaveAttribute('class', 'render-live-card');
    expect($('renderSpinner').hidden).toBe(false);
    expect($('renderLiveElapsed')).toHaveTextContent('0:30');
    expect($('renderLivePhase')).toHaveTextContent(view.statusLabel);
    expect($('renderLivePhase')).toHaveAttribute('class', `badge ${view.badge}`.trim());
    expect($('renderLiveArt').hidden).toBe(true);
    expect($('renderLiveTitle')).toHaveTextContent(view.title);
    expect($('renderLiveMeta')).toHaveTextContent(view.summary);
    expect($('btnStopRender').hidden).toBe(false);
    if (view.stages.length) {
      expect($('renderLiveBar').hidden).toBe(false);
      expect($('renderLiveBar')).toHaveAttribute('aria-valuenow', String(Math.round(view.progress * 100)));
      expect($('renderStages').querySelectorAll('li')).toHaveLength(view.stages.length);
    }
    fireEvent.click($('btnStopRender'));
    expect(stopAllWork).toHaveBeenCalledWith({ reason: 'Stopped' });
  });

  it('shows the live thumb while a job and a frame exist', () => {
    render(<ActivitySection />);
    act(() => desk.set({ live: { ...desk.get().live, thumb: true, src: 'blob:frame', recording: true }, liveWarmingUp: true }));
    expect($('activityLive').hidden).toBe(true);
    act(() => desk.set({ renderJob: makeJob() }));
    expect($('activityLive').hidden).toBe(false);
    expect($('activityLive')).toHaveAttribute('src', 'blob:frame');
    expect($('activityLive')).toHaveAttribute('class', 'activity-live is-warming');
  });

  it('toggles the log with the legacy copy', () => {
    const job = makeJob({ log: [{ t: 1, line: 'one' }, { t: 2, line: 'two' }] });
    render(<ActivitySection />);
    act(() => desk.set({ renderJob: job }));
    const toggle = $('btnRenderLogToggle');
    expect(toggle.hidden).toBe(false);
    expect(toggle).toHaveTextContent('Show log');
    fireEvent.click(toggle);
    expect(desk.get().renderLogExpanded).toBe(true);
    expect(toggle).toHaveTextContent('Collapse log');
    expect($('renderLiveLog').hidden).toBe(false);
    expect($('renderLiveLog').textContent).toBe('one\ntwo');
    act(() => desk.set({ renderJob: { ...job } }));
    expect(toggle).toHaveTextContent('Hide log');
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent('Expand log');
    expect($('renderLiveLog').hidden).toBe(true);
  });

  it('keeps the last 8000 characters of the log', () => {
    render(<ActivitySection />);
    act(() => desk.set({ renderJob: makeJob({ log: [{ t: 1, line: 'a'.repeat(9000) }, { t: 2, line: 'tail' }] }), renderLogExpanded: true }));
    const text = $('renderLiveLog').textContent ?? '';
    expect(text).toHaveLength(8000);
    expect(text.endsWith('\ntail')).toBe(true);
  });

  it('paints the agent stream for improve jobs', () => {
    render(<ActivitySection />);
    act(() =>
      desk.set({
        renderJob: makeJob({ kind: 'improve', status: 'done', stream: { rev: 1, entries: [{ id: 1, kind: 'say', text: 'Looking at scene 2', done: true }] } }),
      }),
    );
    expect($('renderLiveStream')).not.toHaveClass('is-empty');
    expect($('renderLiveStream')).toHaveTextContent('Looking at scene 2');
    expect($('renderLiveNow').hidden).toBe(true);
  });
});

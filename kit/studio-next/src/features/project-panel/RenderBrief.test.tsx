import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decideAction } from '@/desk/action';
import type * as JobsModule from '@/desk/jobs';
import { requestMake } from '@/desk/jobs';
import { desk } from '@/desk/store';
import { makeFreshness, makeVideo } from '@/test/factories';

import { RenderBrief, RenderElapsed } from './RenderBrief';

vi.mock('@/desk/jobs', async (importOriginal) => ({ ...(await importOriginal<typeof JobsModule>()), requestMake: vi.fn() }));

const $ = (id: string) => document.getElementById(id);

function load(v = makeVideo()) {
  act(() => desk.set({ slug: v.slug, video: v, action: decideAction(v) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  desk.reset();
});

describe('RenderBrief', () => {
  it('renders the legacy markup before a sequence loads', () => {
    render(<RenderBrief />);
    expect($('renderBrief')).toHaveClass('render-brief');
    expect($('renderStatusPill')).toHaveClass('render-pill', 'warn');
    expect($('renderStatusPill')).toHaveTextContent('Needs attention');
    expect($('renderHeadline')?.tagName).toBe('H2');
    expect($('renderHeadline')).toHaveTextContent('Select a sequence');
    expect($('renderReason')).toHaveTextContent('Choose a video, then render or queue jobs from here.');
    expect($('renderReason')).not.toHaveAttribute('title');
    expect($('renderElapsed')).toHaveTextContent('0:00');
    expect($('renderElapsed')?.hidden).toBe(true);
    expect($('voiceHoldWarn')?.hidden).toBe(true);
    expect($('captureBar')?.hidden).toBe(true);
    expect($('btnActionPrimary')).toHaveClass('render-cta', 'primary');
    expect($('btnActionPrimary')?.querySelector('.cta-label')).toHaveTextContent('Render');
    expect($('btnActionPrimary')?.querySelector('svg')).not.toBeNull();
    expect($('btnActionPrimary')).not.toHaveAttribute('data-mode');
    expect($('btnActionSecondary')?.hidden).toBe(true);
    expect($('recordChoice')?.hidden).toBe(true);
    expect($('bayGuide')?.hidden).toBe(true);
    expect($('bayTake')?.hidden).toBe(true);
    expect($('plateQcBanner')?.hidden).toBe(true);
  });

  it('paints the action and starts the chosen render', () => {
    render(<RenderBrief />);
    load(makeVideo({ freshness: makeFreshness({ stale: true, reason: 'flow changed' }) }));
    expect($('renderStatusPill')).toHaveAttribute('class', 'render-pill warn');
    expect($('renderStatusPill')).toHaveTextContent('Out of date');
    expect($('renderHeadline')).toHaveTextContent('Render to see your changes');
    expect($('renderReason')).toHaveAttribute('title', 'flow changed');
    expect($('btnActionPrimary')).toHaveAttribute('data-mode', 'quick');
    expect($('btnActionSecondary')?.hidden).toBe(false);
    expect($('btnActionSecondary')).toHaveAttribute('data-mode', 'full');
    expect($('btnActionSecondary')).toHaveTextContent('Re-record first');
    fireEvent.click($('btnActionPrimary') as HTMLElement);
    fireEvent.click($('btnActionSecondary') as HTMLElement);
    expect(vi.mocked(requestMake).mock.calls).toEqual([['quick'], ['full']]);
  });

  it('keeps the pipeline headline and greys the CTAs while busy', () => {
    render(<RenderBrief />);
    load();
    act(() =>
      desk.set({
        jobBusy: true,
        bay: { pillClass: 'render-pill run', pillText: 'Rendering', headline: 'Rendering sequence', reason: 'Live log…' },
        busy: { btnActionPrimary: true },
      }),
    );
    expect($('renderStatusPill')).toHaveAttribute('class', 'render-pill run');
    expect($('renderHeadline')).toHaveTextContent('Rendering sequence');
    expect($('renderReason')).toHaveTextContent('Live log…');
    expect($('btnActionPrimary')).toHaveAttribute('class', 'render-cta primary busy');
    expect($('btnActionPrimary')).toBeDisabled();
    expect($('recordChoice')?.hidden).toBe(true);
  });

  it('warns when a line outlasts its hold', () => {
    render(<RenderBrief />);
    load(makeVideo({ script: { scenes: [{ holdSec: 2, narrationSec: 4 }] } }));
    expect($('voiceHoldWarn')?.hidden).toBe(false);
    expect($('voiceHoldWarn')).toHaveTextContent('Voice needs ~4.0s but the card holds 2.0s — lengthen the hold or shorten the line');
  });

  it('hosts the guide and take cards', () => {
    render(<RenderBrief />);
    expect(screen.getByLabelText('Choose your take')).toHaveAttribute('id', 'bayTake');
    expect($('bayGuide')).toHaveClass('guide-card', 'guide-card--bay');
  });
});

describe('RenderElapsed', () => {
  it('appears with the pipeline, ticks, keeps its reading and hides on Stop', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T09:00:00Z'));
    render(<RenderElapsed />);
    expect($('renderElapsed')?.hidden).toBe(true);
    act(() => desk.set({ pipelineStartedAt: Date.now() }));
    expect($('renderElapsed')?.hidden).toBe(false);
    expect($('renderElapsed')).toHaveTextContent('00:00:00');
    act(() => void vi.advanceTimersByTime(3000));
    expect($('renderElapsed')).toHaveTextContent('00:00:03');
    act(() => desk.set({ pipelineStartedAt: null }));
    act(() => void vi.advanceTimersByTime(3000));
    expect($('renderElapsed')).toHaveTextContent('00:00:03');
    expect($('renderElapsed')?.hidden).toBe(false);
    act(() => desk.set({ stopRequested: true }));
    expect($('renderElapsed')?.hidden).toBe(true);
  });
});

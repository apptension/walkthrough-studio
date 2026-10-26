import { act, fireEvent, render } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bridges } from '@/desk/bridge';
import { showRightTab } from '@/desk/panels';
import { desk } from '@/desk/store';
import { session } from '@/features/feedback/session';
import { directionView } from '@/features/direction/view';
import { server } from '@/test/msw/server';

import { PANEL_MS, swapPanelBodies } from './panelSwap';
import { ToolsPanel } from './ToolsPanel';

vi.mock('@/features/editor/InspectorTab', () => ({
  InspectorTab: () => <div id="rightInspector" className="panel-body inspector" hidden />,
}));

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

const tab = (id: string) => {
  const el = document.querySelector<HTMLButtonElement>(`.tools-panel .ptab[data-right="${id}"]`);
  if (!el) throw new Error(`tab ${id} missing`);
  return el;
};

beforeEach(() => {
  desk.reset();
  session.reset();
  directionView.reset();
  server.use(http.get('/api/video/:slug/capture', () => HttpResponse.json({}, { status: 404 })));
});

afterEach(() => {
  bridges.feedback = null;
});

describe('ToolsPanel markup', () => {
  it('renders the legacy aside, tabs, bodies, dock and rail in order', () => {
    render(<ToolsPanel />);
    const aside = $('toolsPanel');
    expect(aside.tagName).toBe('ASIDE');
    expect(aside).toHaveClass('panel', 'tools-panel');
    expect(aside).toHaveAttribute('aria-label', 'Tools');
    expect(aside).not.toHaveAttribute('data-tab');

    const tabs = [...aside.querySelectorAll<HTMLButtonElement>('.panel-tabs .ptab')];
    expect(tabs.map((t) => t.dataset.right)).toEqual(['feedback', 'inspector', 'motion', 'review']);
    expect(tabs.map((t) => t.textContent)).toEqual(['Feedback', 'Inspector', 'Direction', 'Review']);
    expect(tabs[0]).toHaveClass('active');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('title', 'Edit the selected clip');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');

    const bodies = [...aside.querySelectorAll('.tools-scroll > .panel-body')].map((el) => el.id);
    expect(bodies).toEqual(['rightFeedback', 'rightInspector', 'rightMotion', 'rightReview']);
    expect($('rightFeedback')).not.toHaveAttribute('hidden');
    expect($('rightMotion')).toHaveAttribute('hidden');

    const dock = aside.querySelector('.direction-actions.direction-dock');
    expect(dock).toHaveAttribute('aria-label', 'Direction actions');
    expect([...(dock?.querySelectorAll('button') ?? [])].map((b) => b.id)).toEqual([
      'btnMotion',
      'btnPreviewPlates',
      'btnApproveDirection',
      'btnApproveMotion',
    ]);
    expect($('btnApproveMotion')).toHaveAttribute('hidden');
    expect(aside.lastElementChild?.id).toBe('sessionRail');
  });
});

describe('tab switching', () => {
  it('marks the picked tab and stamps data-tab', () => {
    render(<ToolsPanel />);
    fireEvent.click(tab('review'));
    expect(desk.get().rightTab).toBe('review');
    expect($('toolsPanel')).toHaveAttribute('data-tab', 'review');
    expect(tab('review')).toHaveClass('active');
    expect(tab('review')).toHaveAttribute('aria-selected', 'true');
    expect(tab('feedback')).not.toHaveClass('active');
    expect(tab('feedback')).toHaveAttribute('aria-selected', 'false');
  });

  it('crossfades the bodies with legacy timing', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    render(<ToolsPanel />);
    act(() => showRightTab('review'));
    const feedback = $('rightFeedback');
    const review = $('rightReview');
    expect(review.hidden).toBe(false);
    expect(review).toHaveClass('is-panel-enter');
    expect(feedback.hidden).toBe(false);
    expect(feedback).toHaveClass('is-panel-leave');

    act(() => void vi.advanceTimersToNextFrame());
    act(() => void vi.advanceTimersToNextFrame());
    expect(review).toHaveClass('is-panel-ready');

    act(() => void vi.advanceTimersByTime(PANEL_MS));
    expect(feedback.hidden).toBe(true);
    expect(feedback.className).toBe('panel-body feedback-panel');
    expect(review).not.toHaveClass('is-panel-enter');
    expect(review).toHaveClass('is-panel-ready');

    act(() => void vi.advanceTimersByTime(420));
    expect(review.className).toBe('panel-body');
  });

  it('swaps at once when nothing else is visible or motion is reduced', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    a.hidden = true;
    b.hidden = true;
    swapPanelBodies(b, [a, b], { current: 0 });
    expect(b.hidden).toBe(false);
    expect(b.className).toBe('');
  });
});

describe('feedback bridge', () => {
  it('registers on mount and clears on unmount', () => {
    const { unmount } = render(<ToolsPanel />);
    expect(bridges.feedback?.runImproveJob).toBeTypeOf('function');
    expect(bridges.feedback?.startImprove).toBeTypeOf('function');
    unmount();
    expect(bridges.feedback).toBeNull();
  });
});

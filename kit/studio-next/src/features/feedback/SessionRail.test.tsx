import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, fireEvent, render } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bridges, type PlateBridge } from '@/desk/bridge';
import { requestMake, stopAllWork } from '@/desk/jobs';
import { runtime } from '@/desk/runtime';
import { desk } from '@/desk/store';
import { makeJob, makeVideo } from '@/test/factories';
import { server } from '@/test/msw/server';

import type * as JobsModule from '@/desk/jobs';

import { approveMotion, reviewProposal } from './proposal';
import { hideProposal, paintSession, session, setApprovePlateVisible, setThinkStep, showProposal } from './session';
import { SessionRail } from './SessionRail';

vi.mock('@/desk/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof JobsModule>()),
  stopAllWork: vi.fn(() => Promise.resolve()),
  requestMake: vi.fn(),
}));

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

beforeEach(() => {
  desk.reset();
  session.reset();
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  if (runtime.elapsedTimer) clearInterval(runtime.elapsedTimer);
  runtime.elapsedTimer = null;
  bridges.plate = null;
  bridges.feedback = null;
});

describe('SessionRail markup', () => {
  it('matches the legacy idle rail', () => {
    render(<SessionRail />);
    const rail = $('sessionRail');
    expect(rail.className).toBe('session-rail');
    expect(rail).toHaveAttribute('aria-live', 'polite');

    const decide = $('sessionDecide');
    expect(decide).toHaveAttribute('hidden');
    expect(decide).toHaveAttribute('tabindex', '-1');
    expect(decide).not.toHaveAttribute('aria-live');
    expect($('proposalTitle')).toHaveTextContent('Ready to decide');
    expect($('proposalReason')).toHaveTextContent('Review the live plate in Program, then choose one path.');
    expect($('proposalSteps')).toHaveAttribute('hidden');
    expect($('btnApprovePlate')).toHaveAttribute('hidden');
    expect($('btnProposalWork')).toHaveAttribute('aria-expanded', 'false');
    expect($('btnProposalWork')).toHaveTextContent('View agent work');

    const progress = $('sessionProgress');
    expect(progress.className).toBe('session-progress is-idle');
    expect($('sessionSpinner')).toHaveAttribute('hidden');
    expect($('sessionElapsed')).toHaveTextContent('0:00');
    expect($('sessionPhase')).toHaveTextContent('—');
    expect($('sessionPhase').className).toBe('badge');
    expect($('btnStopSession')).toHaveAttribute('hidden');
    expect($('btnSessionLog')).toHaveAttribute('hidden');
    expect($('sessionArt')).toHaveAttribute('data-art', 'sleep');
    expect($('sessionArt')).not.toHaveAttribute('hidden');
    expect($('sessionTitle')).toHaveTextContent('Agent’s off the clock 💤');
    expect($('sessionMeta')).toHaveTextContent('Apply a note and its progress shows here.');
    expect($('sessionBar')).toHaveAttribute('hidden');
    expect($('sessionNow')).toHaveAttribute('hidden');
    expect($('sessionStages')).toHaveAttribute('hidden');
    expect([...$('sessionPipe').querySelectorAll('li')].map((li) => [li.dataset.step, li.textContent])).toEqual([
      ['think', 'Think'],
      ['edit', 'Edit'],
      ['html', 'HTML'],
      ['preview', 'Preview'],
      ['approve', 'Decide'],
    ]);
    expect($('sessionStream')).toHaveClass('agent-stream', 'agent-stream--rail', 'is-empty');
    expect($('sessionStream')).toHaveAttribute('aria-label', 'Agent output');
    expect($('sessionLog')).toHaveAttribute('hidden');
  });
});

describe('session painting', () => {
  it('paints a running job and its stages', () => {
    render(<SessionRail />);
    act(() =>
      paintSession(
        makeJob({
          kind: 'improve',
          status: 'running',
          log: [{ t: 0, line: 'one' }],
        }),
      ),
    );
    expect($('sessionRail')).toHaveClass('is-running');
    expect($('sessionProgress')).not.toHaveClass('is-idle');
    expect($('sessionSpinner')).not.toHaveAttribute('hidden');
    expect($('sessionArt')).toHaveAttribute('hidden');
    expect($('sessionElapsed')).not.toHaveAttribute('hidden');
    expect($('sessionPhase')).not.toHaveAttribute('hidden');
    expect($('btnSessionLog')).not.toHaveAttribute('hidden');
    expect($('btnSessionLog')).toHaveTextContent('Log');

    fireEvent.click($('btnSessionLog'));
    expect(desk.get().activityExpanded).toBe(true);
    expect($('btnSessionLog')).toHaveTextContent('Hide log');
    expect($('sessionLog')).not.toHaveAttribute('hidden');
    expect($('sessionLog')).toHaveTextContent('one');
  });

  it('advances the think pipe', () => {
    render(<SessionRail />);
    act(() => setThinkStep('html'));
    const cls = [...$('sessionPipe').querySelectorAll('li')].map((li) => li.className);
    expect(cls).toEqual(['done', 'done', 'run', '', '']);
  });

  it('shows Stop while work runs and stops everything', () => {
    render(<SessionRail />);
    act(() => desk.set({ jobBusy: true }));
    expect($('btnStopSession')).not.toHaveAttribute('hidden');
    fireEvent.click($('btnStopSession'));
    expect(stopAllWork).toHaveBeenCalledWith({ reason: 'Stopped' });
  });
});

describe('proposal', () => {
  it('opens the decision, focuses it and switches to Feedback', async () => {
    render(<SessionRail />);
    desk.set({ rightTab: 'review' });
    act(() =>
      showProposal({
        title: 'Review “Intro”',
        reason: 'Intro changed.',
        steps: [
          { label: 'Intro', status: 'done' },
          { label: 'Awaiting your decision', status: 'run' },
        ],
      }),
    );
    expect(desk.get().proposalOpen).toBe(true);
    expect(desk.get().rightTab).toBe('feedback');
    const decide = $('sessionDecide');
    expect(decide).not.toHaveAttribute('hidden');
    expect(decide).toHaveAttribute('aria-live', 'assertive');
    expect($('sessionRail')).toHaveClass('is-done', 'decision-mode');
    expect($('proposalTitle')).toHaveTextContent('Review “Intro”');
    expect([...$('proposalSteps').querySelectorAll('li')].map((li) => [li.className, li.textContent])).toEqual([
      ['done', 'Intro'],
      ['run', 'Awaiting your decision'],
    ]);
    expect($('btnReviewProposal')).toHaveAttribute('data-review', 'preview');
    await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(document.activeElement).toBe(decide);

    act(() => setApprovePlateVisible(true));
    expect($('btnApprovePlate')).not.toHaveAttribute('hidden');

    fireEvent.click($('btnProposalWork'));
    expect($('sessionRail')).toHaveClass('show-work');
    expect($('btnProposalWork')).toHaveTextContent('Hide agent work');

    act(() => hideProposal());
    expect($('sessionDecide')).toHaveAttribute('hidden');
    expect($('sessionRail')).not.toHaveClass('decision-mode');
    expect(desk.get().proposalOpen).toBe(false);
  });

  it('approves the draft and renders', async () => {
    let approved = false;
    server.use(
      http.post('/api/video/:slug/draft/approve', () => {
        approved = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    desk.set({ slug: 'demo', video: makeVideo() });
    render(<SessionRail />);
    act(() => showProposal({}));
    await act(async () => {
      fireEvent.click($('btnApproveDraft'));
      await Promise.resolve();
    });
    expect(approved).toBe(true);
    expect(requestMake).toHaveBeenCalledWith('quick');
    expect(desk.get().proposalOpen).toBe(false);
  });

  it('Approve motion is a no-op while the draft approval is busy', () => {
    desk.set({ busy: { btnApproveDraft: true } });
    approveMotion();
    expect(requestMake).not.toHaveBeenCalled();
  });

  it('reviews a plate preview in the Plate pane', () => {
    const showPlateHtml = vi.fn();
    bridges.plate = { showPlateHtml, ensureFhdFitObserver: vi.fn(), fitFhdPreview: vi.fn() } as unknown as PlateBridge;
    desk.set({ htmlPlates: [{ id: 'intro', label: 'Intro' } as never] });
    reviewProposal();
    expect(showPlateHtml).toHaveBeenCalledWith('intro');
    expect(desk.get().toasts.at(-1)?.title).toBe('Preview in focus');
  });
});

describe('collapse', () => {
  it('folds the status card but keeps the kicker and log reachable, and remembers the choice', () => {
    const { unmount } = render(<SessionRail />);
    act(() =>
      paintSession(
        makeJob({
          kind: 'improve',
          status: 'failed',
          log: [{ t: 0, line: 'Plate HTML failed' }],
        }),
      ),
    );

    expect($('sessionRail')).not.toHaveClass('is-collapsed');
    const toggle = $('btnSessionCollapse');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Our `plus` icon — CSS clips it to a minus while expanded; never a typed "+"/−.
    expect(toggle.querySelector('svg')).toBeTruthy();
    expect(toggle.textContent?.trim()).toBe('');

    fireEvent.click(toggle);
    expect($('sessionRail')).toHaveClass('is-collapsed');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(localStorage.getItem('wt-studio-session-rail-collapsed')).toBe('1');
    // Title stays in the chrome strip while the fold slides shut.
    expect($('sessionTitle')).toBeTruthy();

    // The kicker (Stop/Log) and the log it reveals stay reachable while collapsed.
    expect($('btnSessionLog')).not.toHaveAttribute('hidden');
    fireEvent.click($('btnSessionLog'));
    expect($('sessionLog')).not.toHaveAttribute('hidden');
    expect($('sessionLog')).toHaveTextContent('Plate HTML failed');

    unmount();
    render(<SessionRail />);
    expect($('sessionRail')).toHaveClass('is-collapsed');
    expect($('btnSessionCollapse')).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps the title in the chrome strip while collapsed, idle or not', () => {
    render(<SessionRail />);
    fireEvent.click($('btnSessionCollapse'));
    expect($('sessionRail')).toHaveClass('is-collapsed');
    expect($('sessionTitle')).not.toHaveAttribute('hidden');
    expect($('sessionTitle')).toHaveTextContent('Agent’s off the clock 💤');
    expect($('sessionTitle').closest('.session-rail-chrome')).toBeTruthy();

    act(() => paintSession(makeJob({ kind: 'improve', status: 'running' })));
    expect($('sessionTitle')).not.toHaveAttribute('hidden');
  });

  it('slides the fold with grid rows and morphs plus → minus via clip-path', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/studio.css'), 'utf8');
    expect(css).toMatch(/\.session-rail-fold\s*\{[\s\S]*?grid-template-rows:\s*1fr/);
    expect(css).toMatch(/\.session-rail\.is-collapsed \.session-rail-fold\s*\{\s*grid-template-rows:\s*0fr/);
    expect(css).toMatch(/\.session-rail-collapse\[aria-expanded="true"\] svg\s*\{[\s\S]*?clip-path:\s*inset/);
    // Absolute pin + typed ± are gone — overlap with Stop/Log can't come back that way.
    expect(css).not.toMatch(/\.session-rail-collapse\s*\{[^}]*position:\s*absolute/);
  });
});

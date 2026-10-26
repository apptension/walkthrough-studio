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
    expect(document.getElementById('btnProposalWork')).toBeNull();

    const progress = $('sessionProgress');
    expect(progress.className).toBe('session-progress is-idle');
    expect($('sessionSpinner')).toHaveAttribute('hidden');
    expect($('sessionElapsed')).toHaveTextContent('0:00');
    expect($('sessionPhase')).not.toHaveAttribute('hidden');
    expect($('sessionPhase')).toHaveTextContent('Idle');
    expect($('sessionPhase')).toHaveAttribute('data-tone', 'idle');
    expect($('btnStopSession')).toHaveAttribute('hidden');
    expect(document.getElementById('btnSessionLog')).toBeNull();
    expect($('sessionTicker')).toHaveAttribute('hidden');
    expect($('sessionArt')).toHaveAttribute('data-art', 'sleep');
    expect($('sessionArt')).not.toHaveAttribute('hidden');
    expect($('sessionTitle')).toHaveTextContent('Waiting for a note');
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
  it('shows the loader alone while working, then morphs it into the result label', () => {
    vi.useFakeTimers();
    try {
      render(<SessionRail />);
      act(() => paintSession(makeJob({ kind: 'improve', status: 'running', log: [{ t: 0, line: 'one' }] })));
      expect($('sessionRail')).toHaveClass('is-running');
      expect($('sessionProgress')).not.toHaveClass('is-idle');
      expect($('sessionSpinner')).not.toHaveAttribute('hidden');
      expect($('sessionPhase')).toHaveAttribute('hidden');
      expect($('sessionArt')).toHaveAttribute('hidden');
      expect($('sessionElapsed')).not.toHaveAttribute('hidden');

      act(() => paintSession(makeJob({ kind: 'improve', status: 'done' })));
      expect($('sessionPhase')).not.toHaveAttribute('hidden');
      expect($('sessionPhase')).toHaveTextContent('Done');
      expect($('sessionPhase')).toHaveAttribute('data-tone', 'ok');
      // The loader shrinks away before it unmounts.
      expect($('sessionSpinner')).not.toHaveAttribute('hidden');
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect($('sessionSpinner')).toHaveAttribute('hidden');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rolls the header barrel through live activity and where the run is', () => {
    vi.useFakeTimers();
    try {
      render(<SessionRail />);
      act(() => setThinkStep('edit'));
      act(() =>
        paintSession(
          makeJob({
            kind: 'improve',
            status: 'running',
            stream: { entries: [{ id: 1, kind: 'tool', title: 'Edit file', text: 'plates/intro.html', done: false }] },
          }),
        ),
      );
      const face = () => $('sessionTicker').querySelector('.barrel-face.is-in');
      expect(face()).toHaveTextContent('Edit file · plates/intro.html');
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(face()).toHaveTextContent('Editing the sources');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the raw log out of the way when the stream tells the story', () => {
    render(<SessionRail />);
    act(() =>
      paintSession(
        makeJob({
          kind: 'improve',
          status: 'running',
          log: [{ t: 0, line: 'one' }],
          stream: { entries: [{ id: 1, kind: 'say', text: 'Reading the note', done: true }] },
        }),
      ),
    );
    expect($('sessionLog')).toHaveAttribute('hidden');
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

    // The run folds under the header chevron — closed while deciding, one click to replay it.
    expect($('sessionRail')).toHaveClass('is-collapsed');
    expect($('btnSessionCollapse')).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click($('btnSessionCollapse'));
    expect($('sessionRail')).toHaveClass('show-work');
    expect($('sessionRail')).not.toHaveClass('is-collapsed');
    expect($('btnSessionCollapse')).toHaveAttribute('aria-expanded', 'true');
    // Deciding never touches the remembered collapse.
    expect(localStorage.getItem('wt-studio-session-rail-collapsed')).toBeNull();

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
  it('folds the run under the chevron, keeps Stop in the header, and remembers the choice', () => {
    const { unmount } = render(<SessionRail />);
    act(() => desk.set({ jobBusy: true }));
    act(() => paintSession(makeJob({ kind: 'improve', status: 'running' })));

    expect($('sessionRail')).not.toHaveClass('is-collapsed');
    const toggle = $('btnSessionCollapse');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle.querySelector('svg[data-sprite="ui-chevron"]')).toBeTruthy();
    expect(toggle.textContent?.trim()).toBe('');

    // Header order: status · title · elapsed · Stop · chevron.
    const chrome = $('sessionTitle').closest('.session-rail-chrome');
    const order = [...(chrome?.querySelectorAll('#sessionSpinner, #sessionTitle, #sessionElapsed, #btnStopSession, #btnSessionCollapse') ?? [])].map((el) => el.id);
    expect(order).toEqual(['sessionSpinner', 'sessionTitle', 'sessionElapsed', 'btnStopSession', 'btnSessionCollapse']);

    fireEvent.click(toggle);
    expect($('sessionRail')).toHaveClass('is-collapsed');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(localStorage.getItem('wt-studio-session-rail-collapsed')).toBe('1');
    expect($('btnStopSession')).not.toHaveAttribute('hidden');

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
    expect($('sessionTitle')).toHaveTextContent('Waiting for a note');
    expect($('sessionPhase')).toHaveTextContent('Idle');
    expect($('sessionTitle').closest('.session-rail-chrome')).toBeTruthy();

    act(() => paintSession(makeJob({ kind: 'improve', status: 'running' })));
    expect($('sessionTitle')).not.toHaveAttribute('hidden');
  });

  it('slides the fold with grid rows, flips the chevron, and keeps the decision in flow', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/studio.css'), 'utf8');
    expect(css).toMatch(/\.session-rail-fold\s*\{[\s\S]*?grid-template-rows:\s*1fr/);
    expect(css).toMatch(/\.session-rail\.is-collapsed \.session-rail-fold\s*\{\s*grid-template-rows:\s*0fr/);
    expect(css).toMatch(/\.session-rail-collapse\[aria-expanded="true"\] svg\s*\{\s*transform:\s*rotate\(180deg\)/);
    expect(css).not.toMatch(/\.session-rail-collapse\s*\{[^}]*position:\s*absolute/);
    // A sticky decision card slid over the header chevron.
    expect(css).not.toMatch(/\.session-decide\s*\{[^}]*position:\s*sticky/);
  });
});

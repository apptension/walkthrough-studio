import { act, fireEvent, render } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bridges, type PlateBridge } from '@/desk/bridge';
import { enqueueJob, watchJob } from '@/desk/jobs';
import { desk, IMPROVE_DEFAULT, type QueueItem } from '@/desk/store';
import { runCriticFromStudio } from '@/features/review/critic';
import { makeJob, makeScene, makeVideo } from '@/test/factories';
import { server } from '@/test/msw/server';

import type * as JobsModule from '@/desk/jobs';

import { FeedbackTab } from './FeedbackTab';
import { inferPlateIdFromFeedback, runImproveJob, startImprove } from './improve';
import { session } from './session';

vi.mock('@/desk/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof JobsModule>()),
  enqueueJob: vi.fn(),
  watchJob: vi.fn(),
  showActivityDock: vi.fn(),
}));

vi.mock('@/features/review/critic', () => ({ runCriticFromStudio: vi.fn(() => Promise.resolve()) }));

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

const lastToast = () => desk.get().toasts.at(-1);

beforeEach(() => {
  desk.reset();
  session.reset();
  vi.clearAllMocks();
  bridges.plate = null;
});

describe('FeedbackTab markup', () => {
  it('matches the legacy Feedback body', () => {
    render(<FeedbackTab />);
    const body = $('rightFeedback');
    expect(body).toHaveClass('panel-body');
    expect(body).not.toHaveAttribute('hidden');
    expect($('improveNote')).toHaveAttribute('rows', '5');
    expect(body.querySelector('.feedback-title')).toHaveTextContent('Direct the cut');
    expect($('btnImprove')).toHaveAttribute('data-improve', 'full');
    expect($('btnImprove')).not.toHaveAttribute('data-plate-id');
    expect($('btnImprove')).toHaveTextContent('Apply with smart scope');
    const domains = [...body.querySelectorAll<HTMLButtonElement>('.tool-grid [data-improve]')].map((b) => b.dataset.improve);
    expect(domains).toEqual(['script', 'voice', 'plates', 'motion']);
    expect($('btnCritic')).toHaveTextContent('Run critic');
    expect($('criticHint')).toHaveAttribute('hidden');
    expect($('criticLink')).toHaveAttribute('href', '#');
  });

  it('shows the critic link once a report exists', () => {
    desk.set({ video: makeVideo({ criticUrl: '/media/demo/critic.html' }) });
    render(<FeedbackTab />);
    expect($('criticHint')).not.toHaveAttribute('hidden');
    expect($('criticLink')).toHaveAttribute('href', '/media/demo/critic.html');
  });
});

describe('director note', () => {
  it('asks for a note before Apply and focuses the field', () => {
    render(<FeedbackTab />);
    fireEvent.click($('btnImprove'));
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(lastToast()).toMatchObject({ title: 'Add a director note', kind: 'warn' });
    expect(document.activeElement).toBe($('improveNote'));
  });

  it('queues an agent pass with the note and resets a pinned plate', () => {
    desk.set({ improve: { note: '', goal: 'plates', plateId: 'intro', label: 'Ask AI · Intro' } });
    render(<FeedbackTab />);
    expect($('btnImprove')).toHaveAttribute('data-plate-id', 'intro');
    fireEvent.change($('improveNote'), { target: { value: 'Calmer pacing' } });
    fireEvent.click($('btnImprove'));
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'improve', goal: 'full', note: 'Calmer pacing', plateId: 'intro', label: 'AI · intro' }),
    );
    expect(desk.get().improve).toEqual({ ...IMPROVE_DEFAULT, note: 'Calmer pacing' });
  });

  it('drops a pinned plate when the note is cleared', () => {
    desk.set({ improve: { note: 'x', goal: 'plates', plateId: 'intro', label: 'Ask AI · Intro' } });
    render(<FeedbackTab />);
    fireEvent.change($('improveNote'), { target: { value: '' } });
    expect(desk.get().improve.plateId).toBeNull();
    expect($('btnImprove')).toHaveAttribute('data-improve', 'full');
  });

  it('forces a domain and runs the critic', () => {
    desk.set({ improve: { ...IMPROVE_DEFAULT, note: 'Warmer voice' } });
    render(<FeedbackTab />);
    fireEvent.click(document.querySelector<HTMLButtonElement>('.tool-grid [data-improve="voice"]')!);
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ goal: 'voice', plateId: null, label: 'AI · voice' }));
    fireEvent.click($('btnCritic'));
    expect(runCriticFromStudio).toHaveBeenCalledWith({ force: false });
  });

  it('infers a plate only when the note names one', () => {
    desk.set({ scenes: [makeScene({ plateId: 'pricing', id: 'pricing', title: 'Pricing', editable: true })] });
    expect(inferPlateIdFromFeedback('tighten the pricing plate')).toBe('pricing');
    expect(inferPlateIdFromFeedback('make the intro calmer')).toBe('open');
    expect(inferPlateIdFromFeedback('more warmth overall')).toBeNull();
    startImprove('full');
  });
});

describe('runImproveJob', () => {
  const item = (over: Partial<QueueItem> = {}): QueueItem => ({
    qid: 'q1',
    slug: 'demo',
    label: 'AI · full',
    kind: 'improve',
    goal: 'full',
    note: 'Tighten',
    plateId: null,
    fromStep: null,
    resumePipeline: null,
    ...over,
  });

  it('opens a proposal for a plate edit with the live preview', async () => {
    desk.set({ slug: 'demo', video: makeVideo() });
    server.use(
      http.post('/api/video/:slug/improve', () => HttpResponse.json({ job: makeJob({ id: 'j9', kind: 'improve' }) })),
      http.get('/api/video/:slug/draft/changes', () =>
        HttpResponse.json({ files: ['plates.json'], domains: ['plates'], labels: ['Intro copy'] }),
      ),
    );
    vi.mocked(watchJob).mockResolvedValue(makeJob({ id: 'j9', status: 'done' }));
    const previewPlateAfterEdit = vi.fn(() => Promise.resolve({ id: 'intro', label: 'Intro' }));
    bridges.plate = { previewPlateAfterEdit } as unknown as PlateBridge;

    await act(() => runImproveJob(item(), { signal: new AbortController().signal }));

    expect(watchJob).toHaveBeenCalledWith('j9', expect.objectContaining({ surface: 'session' }));
    expect(previewPlateAfterEdit).toHaveBeenCalledWith('');
    expect(desk.get().proposalOpen).toBe(true);
    const view = session.get();
    expect(view.proposalTitle).toBe('Review “Intro”');
    expect(view.proposalReason).toBe('Intro copy changed. The live plate is replaying in Program.');
    expect(view.proposalSteps).toEqual([
      { label: 'Intro copy', status: 'done' },
      { label: 'Live preview rebuilt', status: 'done' },
      { label: 'Awaiting your decision', status: 'run' },
    ]);
    expect(view.thinkStep).toBe('approve');
    expect(desk.get().platesPreviewed).toBe(true);
    expect(lastToast()?.title).toBe('Changes ready to review');
  });

  it('stops at agent sign-in', async () => {
    desk.set({ slug: 'demo', video: makeVideo() });
    server.use(
      http.post('/api/video/:slug/improve', () =>
        HttpResponse.json({ job: makeJob({ id: 'j1', status: 'needs-agent', provider: 'claude' }) }),
      ),
    );
    await runImproveJob(item());
    expect(watchJob).not.toHaveBeenCalled();
    expect(lastToast()).toMatchObject({ title: 'Sign in to Claude Code', kind: 'warn' });
  });
});

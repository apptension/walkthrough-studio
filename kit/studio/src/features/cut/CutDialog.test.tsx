import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { desk, openDialog } from '@/desk/store';
import { makeVideo } from '@/test/factories';

const api = vi.hoisted(() => ({ api: vi.fn(), enc: encodeURIComponent }));
const toastMod = vi.hoisted(() => ({ toast: vi.fn() }));
const video = vi.hoisted(() => ({ refreshSummary: vi.fn(() => Promise.resolve()) }));
const actions = vi.hoisted(() => ({ onStageAction: vi.fn(() => Promise.resolve()) }));
vi.mock('@/desk/api', () => api);
vi.mock('@/desk/toast', () => toastMod);
vi.mock('@/desk/video', () => video);
vi.mock('@/features/stages/actions', () => actions);

import { cutView, openCut, useCutSheet } from './cut';
import { CutDialog } from './CutDialog';

const NOW = Date.parse('2026-10-23T12:00:00.000Z');
const dialog = () => document.getElementById('cutDialog') as HTMLDialogElement;
const btn = (id: string) => document.getElementById(id) as HTMLButtonElement;

beforeEach(() => {
  useCutSheet.setState({ note: '', pending: null, focusNote: 0 });
  desk.set({ slug: 'demo', video: makeVideo({ hasDelivery: true }) });
});
afterEach(() => {
  act(() => openDialog('cut', false));
});

describe('cutView', () => {
  it('lists the facts, warnings and newest-first history', () => {
    const v = makeVideo({
      durationSec: 125,
      freshness: { stale: true, reason: 'the script changed' },
      review: {
        script: { effective: 'draft' },
        cut: {
          effective: 'changes-requested',
          history: [
            { status: 'approved', action: 'approved', at: new Date(NOW - 120 * 60_000).toISOString(), note: '' },
            { status: 'changes-requested', action: 'changes-requested', at: new Date(NOW - 5 * 60_000).toISOString(), note: 'Shorter intro' },
          ],
        },
      },
    });
    const view = cutView(v, NOW);
    expect(view.facts[0]).toEqual(['Duration', '2:05']);
    expect(view.warn).toEqual([
      'The script is not approved — approving the cut also signs off its copy.',
      'Delivery is out of date: the script changed.',
    ]);
    expect(view.history.map((h) => [h.action, h.when, h.note])).toEqual([
      ['changes-requested', '5 min ago', 'Shorter intro'],
      ['approved', '2 h ago', ''],
    ]);
  });
});

describe('CutDialog', () => {
  it('will not open without a delivery', () => {
    desk.set({ video: makeVideo({ hasDelivery: false }) });
    render(<CutDialog />);
    act(() => openCut());
    expect(dialog().open).toBe(false);
    expect(toastMod.toast).toHaveBeenCalledWith('Nothing to review yet', 'Render the video first', 'warn');
  });

  it('opens with the legacy sheet and an empty history', () => {
    render(<CutDialog />);
    act(() => openCut());
    expect(dialog().open).toBe(true);
    expect(document.getElementById('cutDialogTitle')).toHaveTextContent('Review cut');
    expect(document.querySelectorAll('#cutFacts > div').length).toBeGreaterThan(0);
  });

  it('needs a note before requesting changes', () => {
    render(<CutDialog />);
    act(() => openCut());
    fireEvent.click(btn('btnCutRequest'));
    expect(api.api).not.toHaveBeenCalled();
    expect(toastMod.toast).toHaveBeenCalledWith('Add a note', 'What should change before approval?', 'warn');
    expect(document.activeElement).toBe(document.getElementById('cutNote'));
  });

  it('requests changes, hands the note to Feedback and closes', async () => {
    api.api.mockResolvedValue({ ok: true });
    render(<CutDialog />);
    act(() => openCut());
    fireEvent.change(document.getElementById('cutNote') as HTMLTextAreaElement, { target: { value: 'Trim the outro' } });
    fireEvent.click(btn('btnCutRequest'));
    await waitFor(() => expect(desk.get().dialogs.cut).toBe(false));
    expect(api.api).toHaveBeenCalledWith('/api/video/demo/cut/review', { method: 'POST', body: { status: 'changes-requested', note: 'Trim the outro' } });
    expect(actions.onStageAction).toHaveBeenCalledWith('feedback', { note: 'Trim the outro' });
    expect(video.refreshSummary).toHaveBeenCalled();
  });

  it('disables Approve once the cut is approved', () => {
    desk.set({ video: makeVideo({ hasDelivery: true, review: { cut: { effective: 'approved', history: [] } } }) });
    render(<CutDialog />);
    act(() => openCut());
    expect(btn('btnCutApprove')).toBeDisabled();
  });
});

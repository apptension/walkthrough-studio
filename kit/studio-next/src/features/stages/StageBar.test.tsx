import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bridges } from '@/desk/bridge';
import { desk } from '@/desk/store';
import { makeVideo } from '@/test/factories';

const jobs = vi.hoisted(() => ({ requestMake: vi.fn(), exportPack: vi.fn() }));
const panels = vi.hoisted(() => ({ showRightTab: vi.fn() }));
const askMod = vi.hoisted(() => ({ ask: vi.fn() }));
const sheet = vi.hoisted(() => ({ openScript: vi.fn(() => Promise.resolve()), followAgentJob: vi.fn() }));
const cut = vi.hoisted(() => ({ openCut: vi.fn() }));
vi.mock('@/desk/jobs', () => jobs);
vi.mock('@/desk/panels', () => panels);
vi.mock('@/desk/ask', () => askMod);
vi.mock('@/features/script/sheet', () => sheet);
vi.mock('@/features/cut/cut', () => cut);

import { onStageAction } from './actions';
import { STAGE_ORDER } from './model';
import { StageBar } from './StageBar';

const stageBtn = (key: string) => document.querySelector<HTMLButtonElement>(`#stageBar .pstage[data-stage="${key}"]`) as HTMLButtonElement;

beforeEach(() => {
  desk.set({ video: null });
});
afterEach(() => {
  act(() => desk.set({ video: null }));
});

describe('StageBar', () => {
  it('renders every stage with placeholders before a video loads', () => {
    render(<StageBar />);
    const nav = document.getElementById('stageBar');
    expect(nav).toHaveClass('stage-bar');
    expect(nav).toHaveAttribute('aria-label', 'Production stages');
    expect(nav).toHaveAttribute('hidden');
    expect([...document.querySelectorAll('.pstage')].map((b) => (b as HTMLElement).dataset.stage)).toEqual([...STAGE_ORDER]);
    for (const key of STAGE_ORDER) expect(document.querySelector(`[data-stage-meta="${key}"]`)).toHaveTextContent('—');
    expect(stageBtn('brief')).not.toHaveAttribute('aria-current');
  });

  it('paints tones and the current stage from the video', () => {
    act(() => desk.set({ video: makeVideo() }));
    render(<StageBar />);
    const current = document.querySelectorAll('.pstage.current');
    expect(current.length).toBeLessThanOrEqual(1);
    for (const key of STAGE_ORDER) {
      expect(stageBtn(key)).toHaveAttribute('data-tone');
      expect(stageBtn(key)).toHaveAttribute('aria-current', stageBtn(key).classList.contains('current') ? 'step' : 'false');
    }
    expect(document.getElementById('stageHint')).toHaveClass('stage-hint');
  });

  it('shows the Out of date badge beside the stage hint copy', () => {
    act(() => desk.set({ video: makeVideo({ freshness: { stale: true }, hasDelivery: true }) }));
    render(<StageBar />);
    const hint = document.getElementById('stageHint');
    expect(hint).not.toHaveAttribute('hidden');
    expect(hint?.querySelector('.stage-hint-text')).toHaveTextContent(
      'Sources changed since the last render. Use Render to catch up.',
    );
    const badge = hint?.querySelector('.stage-status-badge');
    expect(badge).toHaveAttribute('data-kind', 'warn');
    expect(badge).toHaveTextContent('Out of date');
  });

  it('opens the sheets a stage owns', () => {
    render(<StageBar />);
    fireEvent.click(stageBtn('script'));
    fireEvent.click(stageBtn('brief'));
    expect(sheet.openScript).toHaveBeenCalledTimes(2);
    fireEvent.click(stageBtn('cut'));
    expect(cut.openCut).toHaveBeenCalled();
    fireEvent.click(stageBtn('direction'));
    expect(panels.showRightTab).toHaveBeenCalledWith('motion');
  });

  it('registers bridges.workflow while mounted', () => {
    const { unmount } = render(<StageBar />);
    expect(typeof bridges.workflow?.openStage).toBe('function');
    unmount();
    expect(bridges.workflow).toBeNull();
  });
});

describe('onStageAction', () => {
  it('asks before recording an unapproved script and stops on cancel', async () => {
    desk.set({ video: makeVideo({ review: { script: { effective: 'draft' } } }) });
    askMod.ask.mockResolvedValueOnce(false);
    await onStageAction('record');
    expect(askMod.ask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Record before the script is approved?' }));
    expect(jobs.requestMake).not.toHaveBeenCalled();
  });

  it('exports after confirming an unapproved cut', async () => {
    desk.set({ video: makeVideo() });
    askMod.ask.mockResolvedValue(true);
    await onStageAction('deliver');
    expect(jobs.exportPack).toHaveBeenCalled();
  });

  it('carries a feedback note into the improve draft', async () => {
    await onStageAction('feedback', { note: 'Tighten chapter 2' });
    expect(panels.showRightTab).toHaveBeenCalledWith('feedback');
    expect(desk.get().improve.note).toBe('Tighten chapter 2');
  });
});

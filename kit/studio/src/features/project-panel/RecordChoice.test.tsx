import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as JobsModule from '@/desk/jobs';
import { requestMake } from '@/desk/jobs';
import { desk } from '@/desk/store';
import { makeFreshness, makeVideo } from '@/test/factories';

import { RecordChoice } from './RecordChoice';

vi.mock('@/desk/jobs', async (importOriginal) => ({ ...(await importOriginal<typeof JobsModule>()), requestMake: vi.fn() }));

const host = () => document.getElementById('recordChoice') as HTMLElement;
const btn = (mode: string) => host().querySelector<HTMLButtonElement>(`[data-record-choice="${mode}"]`) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  desk.reset();
});

describe('RecordChoice', () => {
  it('renders the legacy group, hidden until a sequence can record', () => {
    render(<RecordChoice />);
    expect(host()).toHaveAttribute('role', 'group');
    expect(host()).toHaveAttribute('aria-labelledby', 'recordChoiceLabel');
    expect(host().hidden).toBe(true);
    expect(document.getElementById('recordChoiceLabel')).toHaveClass('record-choice-label', 'has-help');
    expect(btn('full')).toHaveClass('record-choice-btn', 'rc-opt--agent');
    expect(btn('guided')).toHaveClass('record-choice-btn', 'rc-opt--self');
    expect(btn('full').querySelector('strong')).toHaveTextContent('Agent records');
    expect(btn('guided').querySelector('em')).toHaveTextContent('Keep your take or hand it to the bot');
  });

  it('marks the preferred mode and describes the last guided take', () => {
    render(<RecordChoice />);
    act(() => desk.set({ video: makeVideo({ captureMode: 'guided', guidedTour: { steps: 4, marks: 1 } }) }));
    expect(host().hidden).toBe(false);
    expect(btn('guided')).toHaveClass('is-preferred');
    expect(btn('full')).not.toHaveClass('is-preferred');
    expect(btn('guided').querySelector('em')).toHaveTextContent('Last time: 4 steps · 1 chapter');
    expect(btn('full').querySelector('em')).toHaveTextContent('The bot replays the current script');
  });

  it('follows the brief without a flow, and hides while a job runs', () => {
    render(<RecordChoice />);
    act(() => desk.set({ video: makeVideo({ hasFlow: false }) }));
    expect(btn('full')).toHaveClass('is-preferred');
    expect(btn('full').querySelector('em')).toHaveTextContent('The bot follows the brief');
    act(() => desk.set({ video: makeVideo({ hasFlow: false, freshness: makeFreshness({ startUrl: '' }) }) }));
    expect(host().hidden).toBe(true);
    act(() => desk.set({ video: makeVideo(), jobBusy: true }));
    expect(host().hidden).toBe(true);
  });

  it('starts the picked recording', () => {
    render(<RecordChoice />);
    act(() => desk.set({ video: makeVideo() }));
    fireEvent.click(btn('guided'));
    fireEvent.click(btn('full'));
    expect(vi.mocked(requestMake).mock.calls).toEqual([['guided'], ['full']]);
  });
});

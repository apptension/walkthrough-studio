import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desk } from '@/desk/store';
import { dismissBoot, setBootStatus, setBusy } from '@/desk/video';

import { BootLoader } from './BootLoader';
import { BusyOverlay } from './BusyOverlay';

beforeEach(() => desk.reset());

describe('BootLoader', () => {
  it('shows the boot status, then leaves and unmounts after 520 ms', () => {
    vi.useFakeTimers();
    render(<BootLoader />);
    act(() => setBootStatus('Loading projects…'));
    expect(document.getElementById('bootStatus')).toHaveTextContent('Loading projects…');
    act(() => dismissBoot());
    const el = document.getElementById('bootLoader');
    expect(el).toHaveClass('boot-loader', 'is-leaving');
    expect(el).toHaveAttribute('aria-busy', 'false');
    act(() => void vi.advanceTimersByTime(520));
    expect(document.getElementById('bootLoader')).toBeNull();
  });
});

describe('BusyOverlay', () => {
  it('shows after a 160 ms grace and leaves over 220 ms once boot is done', () => {
    vi.useFakeTimers();
    act(() => dismissBoot());
    render(<BusyOverlay />);
    const el = () => document.getElementById('busyOverlay') as HTMLElement;
    expect(el().hidden).toBe(true);
    act(() => setBusy(true, 'Opening sequence', 'demo'));
    expect(document.getElementById('busyDetail')).toHaveTextContent('demo');
    act(() => void vi.advanceTimersByTime(159));
    expect(el().hidden).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(el().hidden).toBe(false);
    act(() => setBusy(false));
    expect(el()).toHaveClass('is-leaving');
    act(() => void vi.advanceTimersByTime(220));
    expect(el().hidden).toBe(true);
    expect(el()).not.toHaveClass('is-leaving');
  });
});

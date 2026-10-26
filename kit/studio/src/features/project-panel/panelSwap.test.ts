import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PANEL_MS, usePanelSwap } from './panelSwap';

const IDS = ['a', 'b', 'c'] as const;
type Id = (typeof IDS)[number];

function setup(start: Id = 'a') {
  return renderHook(({ active }: { active: Id }) => usePanelSwap(active, IDS), { initialProps: { active: start } });
}

afterEach(() => vi.unstubAllGlobals());

describe('usePanelSwap', () => {
  it('shows only the active body at first', () => {
    const { result } = setup();
    expect(result.current).toEqual({
      a: { hidden: false, phase: '' },
      b: { hidden: true, phase: '' },
      c: { hidden: true, phase: '' },
    });
  });

  it('crossfades with the legacy timings', () => {
    vi.useFakeTimers();
    const { result, rerender } = setup();
    rerender({ active: 'b' });
    expect(result.current.a).toEqual({ hidden: false, phase: 'is-panel-leave' });
    expect(result.current.b).toEqual({ hidden: false, phase: 'is-panel-enter' });
    act(() => void vi.advanceTimersByTime(40));
    expect(result.current.b.phase).toBe('is-panel-enter is-panel-ready');
    act(() => void vi.advanceTimersByTime(PANEL_MS - 40));
    expect(result.current.a).toEqual({ hidden: true, phase: '' });
    expect(result.current.b).toEqual({ hidden: false, phase: 'is-panel-ready' });
    act(() => void vi.advanceTimersByTime(419));
    expect(result.current.b.phase).toBe('is-panel-ready');
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.b).toEqual({ hidden: false, phase: '' });
  });

  it('leaves from the entering body on a fast re-click', () => {
    vi.useFakeTimers();
    const { result, rerender } = setup();
    rerender({ active: 'b' });
    act(() => void vi.advanceTimersByTime(50));
    rerender({ active: 'c' });
    expect(result.current.a).toEqual({ hidden: true, phase: '' });
    expect(result.current.b.phase).toBe('is-panel-leave');
    expect(result.current.c.phase).toBe('is-panel-enter');
    act(() => void vi.advanceTimersByTime(PANEL_MS + 420));
    expect(result.current).toEqual({
      a: { hidden: true, phase: '' },
      b: { hidden: true, phase: '' },
      c: { hidden: false, phase: '' },
    });
  });

  it('swaps at once under reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
    const { result, rerender } = setup();
    rerender({ active: 'c' });
    expect(result.current.a).toEqual({ hidden: true, phase: '' });
    expect(result.current.c).toEqual({ hidden: false, phase: '' });
  });
});

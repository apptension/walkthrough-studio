import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { desk } from '@/desk/store';
import { toast } from '@/desk/toast';

import { Toasts } from './Toasts';

beforeEach(() => {
  vi.useFakeTimers();
  desk.reset();
});
afterEach(() => vi.useRealTimers());

describe('Toasts', () => {
  it('shows a toast, slides it out after 3.2 s and removes it 260 ms later', () => {
    render(<Toasts />);
    act(() => toast('Saved', 'All good'));
    const el = document.querySelector('#toasts .toast');
    expect(el).not.toBeNull();
    expect(el?.querySelector('b')).toHaveTextContent('Saved');
    expect(el?.querySelector('span')).toHaveTextContent('All good');
    expect(el).not.toHaveClass('err');
    act(() => void vi.advanceTimersByTime(3200));
    expect(document.querySelector('#toasts .toast')).toHaveClass('out');
    act(() => void vi.advanceTimersByTime(260));
    expect(document.querySelector('#toasts .toast')).toBeNull();
  });

  it('marks error and warning toasts and drops an empty detail', () => {
    render(<Toasts />);
    act(() => {
      toast('Broke', '', 'err');
      toast('Careful', 'x', 'warn');
    });
    const [err, warn] = document.querySelectorAll('#toasts .toast');
    expect(err).toHaveClass('err');
    expect(err?.querySelector('span')).toBeNull();
    expect(warn).toHaveClass('warn');
  });
});

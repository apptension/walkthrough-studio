import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HtmlPlate } from '@/api/types';
import type * as JobsModule from '@/desk/jobs';
import { requestMake } from '@/desk/jobs';
import { desk } from '@/desk/store';

import { plateQcView } from './plateQc';
import { PlateQcBanner } from './PlateQcBanner';

vi.mock('@/desk/jobs', async (importOriginal) => ({ ...(await importOriginal<typeof JobsModule>()), requestMake: vi.fn() }));

function plate(id: string, encode: Partial<NonNullable<HtmlPlate['encode']>> | null): HtmlPlate {
  return {
    id,
    label: id.toUpperCase(),
    type: 'open',
    htmlUrl: '',
    path: '',
    mp4Url: null,
    encode: encode ? { ok: true, status: 'ok', warnings: [], notes: [], ...encode } : null,
  };
}

const banner = () => document.getElementById('plateQcBanner') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  desk.reset();
});

describe('PlateQcBanner', () => {
  it('prefers failed encodes over clipped copy', () => {
    expect(plateQcView([])).toEqual({ kind: 'none' });
    expect(plateQcView([plate('a', { notes: ['Copy clips at 32px'] })])).toEqual({ kind: 'clipped', names: 'A' });
    expect(plateQcView([plate('a', { notes: ['Copy clips'] }), plate('b', { ok: false })])).toEqual({ kind: 'bad', names: 'B' });
  });

  it('warns about clipped copy', () => {
    render(<PlateQcBanner />);
    expect(banner().hidden).toBe(true);
    act(() => desk.set({ htmlPlates: [plate('open', { notes: ['Copy clips even at 28px'] })] }));
    expect(banner().hidden).toBe(false);
    expect(banner().querySelector('strong')).toHaveTextContent('Copy too long');
    expect(banner()).toHaveTextContent(
      'Copy too long — OPEN: text clips even at the smallest size. Shorten the copy on the plate (click text to edit).',
    );
  });

  it('offers a one-shot plate re-render for a failed encode', () => {
    render(<PlateQcBanner />);
    act(() => desk.set({ leftTab: 'versions', htmlPlates: [plate('open', { ok: false }), plate('close', { ok: false })] }));
    expect(banner()).toHaveTextContent('Plate encode QC — OPEN, CLOSE need a clean re-render (hold/frame gate). Re-render plates');
    const fix = document.getElementById('btnPlateQcFix') as HTMLElement;
    expect(fix).toHaveClass('btn', 'tiny');
    fireEvent.click(fix);
    fireEvent.click(fix);
    expect(requestMake).toHaveBeenCalledTimes(1);
    expect(requestMake).toHaveBeenCalledWith('plates');
    expect(desk.get().leftTab).toBe('render');
  });
});

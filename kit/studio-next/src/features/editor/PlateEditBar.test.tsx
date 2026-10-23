import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desk } from '@/desk/store';
import { makeVideo } from '@/test/factories';
import { server } from '@/test/msw/server';

import type * as VideoModule from '@/desk/video';

import { chrome } from './engine/chrome';
import { resetPlateForTests, updatePlateEditChrome } from './engine/plate';
import { resetEdForTests } from './engine/state';
import { PlateEditBar } from './PlateEditBar';
import { PlatePicker } from './PlatePicker';

vi.mock('@/desk/video', async (importOriginal) => ({
  ...(await importOriginal<typeof VideoModule>()),
  loadVideo: vi.fn(() => Promise.resolve()),
}));

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

const options = (id: string) => [...$(id).querySelectorAll('option')].map((o) => [o.value, o.textContent]);

beforeEach(() => {
  desk.reset();
  chrome.reset();
  resetEdForTests();
  resetPlateForTests();
  desk.set({ slug: 'demo', video: makeVideo({ slug: 'demo' }), activePlateId: 'open' });
});

describe('PlateEditBar edit state', () => {
  it('swaps the hint and enables Save / Discard while dirty', () => {
    render(<PlateEditBar />);
    act(() => updatePlateEditChrome());
    expect($('plateEditHint').innerHTML).toBe('Click text to edit · Replay previews motion · <kbd>*</kbd>word<kbd>*</kbd> for accent');
    expect($('plateEditBar')).not.toHaveClass('is-dirty');

    act(() => desk.set({ plateDirty: true }));
    expect($('plateEditBar')).toHaveClass('is-dirty');
    expect($('plateEditHint').innerHTML).toBe('<strong>Unsaved changes</strong> · Replay to preview · Save writes to video.config.json');
    expect($('btnPlateSaveCopy')).toBeEnabled();
    expect($('btnPlateDiscardEdits')).toBeEnabled();
  });

  it('shows Replay busy from the desk busy map', () => {
    render(<PlateEditBar />);
    act(() => desk.set({ busy: { btnPlateReplay: true } }));
    expect($('btnPlateReplay')).toHaveClass('busy');
    expect($('btnPlateReplay')).toBeDisabled();
  });

  it('Program clicks #modeProgram', () => {
    const modeProgram = document.createElement('button');
    modeProgram.id = 'modeProgram';
    const onClick = vi.fn();
    modeProgram.addEventListener('click', onClick);
    document.body.append(modeProgram);
    render(<PlateEditBar />);
    fireEvent.click($('btnPlateExit'));
    expect(onClick).toHaveBeenCalledTimes(1);
    modeProgram.remove();
  });
});

describe('plate accent popover', () => {
  it('opens with the video options and the plate config values', async () => {
    server.use(
      http.get('/api/video/:slug/config', () =>
        HttpResponse.json({ config: { open: { motion: { atmosphere: 'aurora', sheen: false } } } }),
      ),
    );
    render(<PlateEditBar />);
    fireEvent.click($('btnPlateAccent'));
    expect($('btnPlateAccent')).toHaveAttribute('aria-expanded', 'true');
    expect($('plateAccentPop')).not.toHaveAttribute('hidden');
    await waitFor(() => expect($('plateAccentState')).toHaveTextContent('2 overrides on this plate'));
    expect(options('accentAtmosphere')).toEqual([
      ['', 'Video default'],
      ['none', 'None'],
      ['aurora', 'Aurora'],
    ]);
    expect(options('accentReveal').map(([v]) => v)).toEqual(['', 'rise', 'cascade', 'wipe']);
    expect($('accentAtmosphere')).toHaveValue('aurora');
    expect($('accentSheen')).toHaveValue('off');
    expect($('btnPlateAccent')).toHaveClass('is-on');
    expect($('btnAccentReset')).toBeEnabled();

    fireEvent.click($('btnAccentClose'));
    expect($('plateAccentPop')).toHaveAttribute('hidden');
  });

  it('closes on a pointerdown outside #plateAccent', () => {
    server.use(http.get('/api/video/:slug/config', () => HttpResponse.json({ config: {} })));
    render(<PlateEditBar />);
    act(() => chrome.set({ accentOpen: true }));
    fireEvent.pointerDown($('btnPlateAccent'));
    expect(chrome.get().accentOpen).toBe(true);
    fireEvent.pointerDown(document.body);
    expect(chrome.get().accentOpen).toBe(false);
  });

  it('posts a changed accent for the active plate', async () => {
    const posted: unknown[] = [];
    server.use(
      http.post('/api/video/:slug/plates/:id/motion', async ({ request, params }) => {
        posted.push({ id: params['id'], body: await request.json() });
        return HttpResponse.json({ motion: { depth: 'deep' } });
      }),
      http.post('/api/video/:slug/plates/rebuild-html', () => HttpResponse.json({ plates: [] })),
    );
    render(<PlateEditBar />);
    fireEvent.change($('accentSheen'), { target: { value: 'on' } });
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ id: 'open', body: { sheen: true } });
    await waitFor(() => expect(desk.get().toasts.at(-1)?.title).toBe('Plate accent saved'));
    expect(chrome.get().accentKeys).toEqual(['depth']);
  });

  it('resets the plate to follow the video', async () => {
    const posted: unknown[] = [];
    server.use(
      http.post('/api/video/:slug/plates/:id/motion', async ({ request }) => {
        posted.push(await request.json());
        return HttpResponse.json({ motion: {} });
      }),
      http.post('/api/video/:slug/plates/rebuild-html', () => HttpResponse.json({ plates: [] })),
    );
    render(<PlateEditBar />);
    act(() => chrome.set({ accentKeys: ['depth'] }));
    fireEvent.click($('btnAccentReset'));
    await waitFor(() => expect(posted).toEqual([{ reset: true }]));
    await waitFor(() => expect(desk.get().toasts.at(-1)?.title).toBe('Plate follows the video'));
  });
});

describe('PlatePicker', () => {
  it('ignores live buttons and unknown plates', () => {
    render(<PlatePicker />);
    $('platePickerList').innerHTML = '<button data-plate-id="x" data-kind="live">Live</button><button data-plate-id="nope">?</button>';
    fireEvent.click($('platePickerList').querySelector('[data-kind="live"]') as HTMLElement);
    fireEvent.click($('platePickerList').querySelector('[data-plate-id="nope"]') as HTMLElement);
    expect(desk.get().monitorMode).not.toBe('plate');
  });
});

import { fireEvent, render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LayoutOption } from '@/api/types';
import { bridges, type PlateBridge } from '@/desk/bridge';
import { desk } from '@/desk/store';
import { makeVideo } from '@/test/factories';
import { server } from '@/test/msw/server';

import { PlateLayoutsField } from './PlateLayoutsField';

const OPEN: LayoutOption[] = [
  { id: 'classic', label: 'Classic', hint: 'Lockup builds, lifts' },
  { id: 'split', label: 'Split hero', hint: 'Lockup on a panel' },
  { id: 'kinetic', label: 'Kinetic type', hint: 'Huge words slam in' },
];
const CLOSE: LayoutOption[] = [
  { id: 'classic', label: 'Classic', hint: 'Steps on a rail' },
  { id: 'cards', label: 'Dealt cards', hint: 'A fanned hand' },
];

const base = makeVideo();
const video = (plateLayouts = { open: 'classic', close: 'cards' }) =>
  makeVideo({ plateLayouts, motionOptions: { ...base.motionOptions, layouts: { open: OPEN, close: CLOSE } } });

const radios = (group: string) => [...document.querySelectorAll<HTMLElement>(`#${group} [data-plate-layout]`)];

let show = vi.fn();
let reload = vi.fn(() => Promise.resolve({}));

beforeEach(() => {
  desk.reset();
  show = vi.fn();
  reload = vi.fn(() => Promise.resolve({}));
  bridges.plate = { showPlateHtml: show, loadPlateFrame: reload, rebuildPlateHtmlPreview: vi.fn() } as unknown as PlateBridge;
});

afterEach(() => {
  bridges.plate = null;
});

describe('PlateLayoutsField', () => {
  it('renders nothing until the summary carries layout options', () => {
    const { container } = render(<PlateLayoutsField />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows opener and closer layout tiles with the current pick checked', () => {
    desk.set({ slug: 'demo', video: video() });
    render(<PlateLayoutsField />);
    const open = radios('openLayoutGrid');
    expect(open.map((b) => b.dataset.plateLayout)).toEqual(['classic', 'split', 'kinetic']);
    expect(open.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(open[0]).toHaveClass('on');
    const close = radios('closeLayoutGrid');
    expect(close.find((b) => b.classList.contains('on'))?.dataset.plateLayout).toBe('cards');
    expect(open[1]).toHaveTextContent('Split hero');
    expect(open[1]).toHaveAttribute('title', 'Lockup on a panel');
  });

  it('posts the pick, updates the summary and shows the rebuilt plate', async () => {
    let body: unknown = null;
    server.use(
      http.post('/api/video/:slug/plates/:id/layout', async ({ request, params }) => {
        body = { id: params['id'], ...((await request.json()) as object) };
        return HttpResponse.json({ ok: true, layout: 'kinetic', plates: [] });
      }),
    );
    desk.set({ slug: 'demo', video: video() });
    render(<PlateLayoutsField />);
    fireEvent.click(radios('openLayoutGrid')[2]!);
    await waitFor(() => expect(desk.get().video?.plateLayouts?.open).toBe('kinetic'));
    expect(body).toEqual({ id: 'open', layout: 'kinetic' });
    expect(show).toHaveBeenCalledWith('open');
    expect(radios('openLayoutGrid')[2]).toHaveClass('on');
    expect(desk.get().toasts.at(-1)?.title).toBe('Layout set');
  });

  it('reloads the plate in place when it is already on stage', async () => {
    server.use(http.post('/api/video/:slug/plates/:id/layout', () => HttpResponse.json({ ok: true, layout: 'classic' })));
    desk.set({ slug: 'demo', video: video(), activePlateId: 'close' });
    render(<PlateLayoutsField />);
    fireEvent.click(radios('closeLayoutGrid')[0]!);
    await waitFor(() => expect(reload).toHaveBeenCalledWith('close', { force: true }));
    expect(show).not.toHaveBeenCalled();
  });

  it('ignores a click on the active layout and toasts a server error', async () => {
    const hit = vi.fn();
    server.use(
      http.post('/api/video/:slug/plates/:id/layout', () => {
        hit();
        return HttpResponse.json({ error: 'close layout must be one of classic, cards' }, { status: 400 });
      }),
    );
    desk.set({ slug: 'demo', video: video() });
    render(<PlateLayoutsField />);
    fireEvent.click(radios('closeLayoutGrid')[1]!);
    expect(hit).not.toHaveBeenCalled();
    fireEvent.click(radios('closeLayoutGrid')[0]!);
    await waitFor(() => expect(desk.get().toasts.at(-1)?.title).toBe('Layout not saved'));
    expect(desk.get().video?.plateLayouts?.close).toBe('cards');
  });
});

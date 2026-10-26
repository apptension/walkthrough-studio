import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { desk } from '@/desk/store';
import { makeVideo } from '@/test/factories';
import { server } from '@/test/msw/server';

import { inspectorStaysPut, renderLook } from './inspector';
import { plateApi } from './look';
import { ed, resetEdForTests } from './state';
import type { DeckPlate } from './types';

const base = makeVideo();
const LAYOUTS = {
  open: [
    { id: 'classic', label: 'Classic', hint: 'Lockup lifts' },
    { id: 'mesh', label: 'Gradient mesh', hint: 'Mesh irises open' },
  ],
  features: [
    { id: 'grid', label: 'Grid', hint: 'Card grid' },
    { id: 'bento', label: 'Bento', hint: 'Hero tile' },
  ],
};

const tiles = (html: string) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return [...host.querySelectorAll<HTMLButtonElement>('button[data-plate-layout]')];
};
const picked = (list: HTMLButtonElement[]) => list.find((b) => b.classList.contains('on'))?.dataset['plateLayout'];

beforeEach(() => {
  desk.reset();
  resetEdForTests();
  desk.set({ slug: 'demo', video: makeVideo({ motionOptions: { ...base.motionOptions, layouts: LAYOUTS } }) });
});

describe('inspector Layout row', () => {
  it('offers the layouts of the plate kind as tiles with the current one picked', () => {
    const list = tiles(renderLook({ id: 'modes', type: 'features', layout: 'bento' }));
    expect(list.map((b) => b.dataset['plateLayout'])).toEqual(['grid', 'bento']);
    expect(picked(list)).toBe('bento');
    expect(list[0]!.querySelector('svg.lk-wire')).not.toBeNull();
  });

  it('keys open/close plates by id and falls back to the default layout', () => {
    const list = tiles(renderLook({ id: 'open', type: 'open' }));
    expect(picked(list)).toBe('classic');
    expect(list[1]).toHaveAttribute('title', 'Mesh irises open');
  });

  it('is absent for kinds with one composition', () => {
    expect(tiles(renderLook({ id: 'q', type: 'quote' }))).toEqual([]);
    expect(tiles(renderLook(null))).toEqual([]);
  });

  it('draws every look option as a tile, with the video default first', () => {
    const host = document.createElement('div');
    host.innerHTML = renderLook({ id: 'modes', type: 'features', motion: { energy: 'punchy' } });
    const energy = [...host.querySelectorAll<HTMLButtonElement>('[data-look-key="energy"]')];
    expect(energy[0]!.dataset['look']).toBe('');
    expect(energy.find((b) => b.classList.contains('on'))?.dataset['look']).toBe('punchy');
    const reveal = host.querySelectorAll('[data-look-key="titleReveal"] .lk-rv');
    expect(reveal.length).toBeGreaterThan(1);
  });

  it('plateApi stores the saved layout on the deck plate', async () => {
    const plate: DeckPlate = { id: 'modes', type: 'features', layout: 'grid', style: { '--x': '1' } };
    ed.deck = { plates: [plate] };
    let posted: unknown = null;
    server.use(
      http.post('/api/video/:slug/plates/:id/layout', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ ok: true, layout: 'bento', style: { '--x': '1' } });
      }),
    );
    const r = await plateApi('modes', 'layout', { layout: 'bento' }, null, { reload: false });
    expect(r?.layout).toBe('bento');
    expect(posted).toEqual({ layout: 'bento' });
    expect(plate.layout).toBe('bento');
    expect(plate.style).toEqual({ '--x': '1' });
  });
});

describe('inspectorStaysPut', () => {
  it('keeps the open inspector still when the same slide repaints', () => {
    expect(inspectorStaysPut('clip:open:', 'clip:open:', true)).toBe(true);
  });

  it('animates in when the selection changes or the pane was empty', () => {
    expect(inspectorStaysPut('clip:open:', 'clip:close:', true)).toBe(false);
    expect(inspectorStaysPut('', 'clip:open:', true)).toBe(false);
    expect(inspectorStaysPut('clip:open:', 'clip:open:', false)).toBe(false);
  });
});

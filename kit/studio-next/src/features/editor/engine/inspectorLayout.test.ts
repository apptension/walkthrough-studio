import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { desk } from '@/desk/store';
import { makeVideo } from '@/test/factories';
import { server } from '@/test/msw/server';

import { renderLook } from './inspector';
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

const select = (html: string) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.querySelector<HTMLSelectElement>('select[data-plate-layout]');
};

beforeEach(() => {
  desk.reset();
  resetEdForTests();
  desk.set({ slug: 'demo', video: makeVideo({ motionOptions: { ...base.motionOptions, layouts: LAYOUTS } }) });
});

describe('inspector Layout row', () => {
  it('offers the layouts of the plate kind with the current one selected', () => {
    const sel = select(renderLook({ id: 'modes', type: 'features', layout: 'bento' }));
    expect(sel).not.toBeNull();
    expect([...sel!.options].map((o) => o.value)).toEqual(['grid', 'bento']);
    expect(sel!.value).toBe('bento');
  });

  it('keys open/close plates by id and falls back to the default layout', () => {
    const sel = select(renderLook({ id: 'open', type: 'open' }));
    expect(sel!.value).toBe('classic');
    expect(sel!.options[1]).toHaveAttribute('title', 'Mesh irises open');
  });

  it('is absent for kinds with one composition', () => {
    expect(select(renderLook({ id: 'q', type: 'quote' }))).toBeNull();
    expect(select(renderLook(null))).toBeNull();
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

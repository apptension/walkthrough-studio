import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desk } from '@/desk/store';
import { makeVideo } from '@/test/factories';

import { DeliverBody } from './MediaTab';
import type * as PosterModule from './poster';
import { setPosterFromCurrentFrame } from './poster';

vi.mock('./poster', async (importOriginal) => ({ ...(await importOriginal<typeof PosterModule>()), setPosterFromCurrentFrame: vi.fn() }));

const $ = (id: string) => document.getElementById(id) as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  desk.reset();
});

describe('DeliverBody', () => {
  it('shows the markup defaults with no sequence', () => {
    render(<DeliverBody />);
    expect($('metaBits')).toHaveClass('meta-stack');
    expect($('metaBits')).toBeEmptyDOMElement();
    expect($('posterImg').hidden).toBe(true);
    expect($('posterEmpty').hidden).toBe(false);
    expect($('posterEmpty')).toHaveTextContent('No poster yet 🖼️');
    expect($('posterMetaLine').hidden).toBe(true);
    expect($('btnSetPoster')).toHaveAttribute('class', 'btn block');
    expect($('btnSetPoster')).toBeEnabled();
    expect($('btnSetPoster')).toHaveTextContent('Use current frame');
    expect($('title').tagName).toBe('H1');
    expect($('title')).toHaveTextContent('Select a video');
    expect($('subtitle')).toHaveTextContent('Delivery master');
  });

  it('paints the sequence chips, poster and title', () => {
    render(<DeliverBody />);
    act(() =>
      desk.set({
        video: makeVideo({ title: 'Demo tour', audience: 'Ops leads', durationSec: 95, sizeMB: 12.5, brand: 'acme', posterMeta: { atSec: 3, source: 'manual', setAt: '' } }),
      }),
    );
    expect([...$('metaBits').querySelectorAll('.chip')].map((c) => c.textContent)).toEqual(['1:35', '12.5 MB', 'acme']);
    expect($('posterImg').hidden).toBe(false);
    expect($('posterImg').getAttribute('src')).toMatch(/^\/media\/demo\/poster\.jpg\?t=\d+$/);
    expect($('posterEmpty').hidden).toBe(true);
    expect($('posterMetaLine')).toHaveTextContent('Frame 0:03 · set in Studio');
    expect($('title')).toHaveTextContent('Demo tour');
    expect($('subtitle')).toHaveTextContent('Ops leads');
    fireEvent.click($('btnSetPoster'));
    expect(setPosterFromCurrentFrame).toHaveBeenCalled();
  });

  it('falls back to the slug and disables the poster without a delivery', () => {
    render(<DeliverBody />);
    act(() => desk.set({ video: makeVideo({ title: '', audience: '', hasDelivery: false }) }));
    expect($('title')).toHaveTextContent('demo');
    expect($('subtitle')).toHaveTextContent('Delivery preview');
    expect($('btnSetPoster')).toBeDisabled();
    act(() => desk.set({ video: makeVideo(), busy: { btnSetPoster: true } }));
    expect($('btnSetPoster')).toHaveAttribute('class', 'btn block busy');
    expect($('btnSetPoster')).toBeDisabled();
  });
});

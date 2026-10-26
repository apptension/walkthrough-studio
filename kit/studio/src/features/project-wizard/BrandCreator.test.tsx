import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeBrandDraft, makeJob, READY_BRAND_DRAFT } from '@/test/factories';
import { endpoints } from '@/test/msw/endpoints';
import { server } from '@/test/msw/server';

const wizardMod = vi.hoisted(() => ({ retry: vi.fn() }));
vi.mock('./wizard', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), retry: wizardMod.retry }));

import { BrandCreator } from './BrandCreator';
import { brandStudio, type BrandDraft } from './brandStudio';

let draft: BrandDraft;
let posts: Array<Record<string, unknown>>;

beforeEach(() => {
  draft = makeBrandDraft();
  posts = [];
  server.use(
    http.get(endpoints.brandDraft('demo'), () => HttpResponse.json(draft)),
    http.post(endpoints.brandDraft('demo'), async ({ request }) => {
      const body = (await request.json()) as { logo?: string; colors?: BrandDraft['choices']['colors'] };
      posts.push(body);
      draft = {
        ...draft,
        choices: {
          colors: body.colors ? { ...draft.choices.colors, ...body.colors } : draft.choices.colors,
          logo: body.logo ? (body.logo === 'logo.html' ? 'logo.html' : `candidates/${body.logo}`) : draft.choices.logo,
        },
      };
      return HttpResponse.json({ ok: true, applied: false, state: draft });
    }),
  );
});
afterEach(() => {
  act(() => brandStudio.reset());
});

async function startDiscovery() {
  render(<BrandCreator />);
  act(() => brandStudio.start('demo'));
  await screen.findByRole('radiogroup', { name: 'Pick the logo' });
}

const stageState = (id: string) => document.querySelector(`[data-bc-stage="${id}"]`)?.className;

describe('BrandCreator', () => {
  it('renders nothing until a discovery session starts', () => {
    const { container } = render(<BrandCreator />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows harvest stages, candidates on light and dark, and skeleton swatches', async () => {
    await startDiscovery();
    act(() =>
      brandStudio.fromJob(
        makeJob({ stream: { entries: [{ id: 1, kind: 'line', text: '› Read the website — headline “Ship faster”\n› Wrote harvest stub · 2 candidate files' }] } }),
      ),
    );
    expect(screen.getByRole('heading', { name: 'Building the Acme brand' })).toBeInTheDocument();
    expect(stageState('site')).toBe('is-done');
    expect(stageState('candidates')).toBe('is-done');
    expect(stageState('lockup')).toBe('is-active');
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('data-bc-tile'))).toEqual(['candidates/00-img.svg', 'candidates/01-icon.png']);
    expect(radios[0]?.querySelectorAll('img')).toHaveLength(2);
    expect(radios[0]?.querySelector('img')?.getAttribute('src')).toBe('/api/video/demo/brand-candidate/00-img.svg');
    expect(screen.getByRole('progressbar', { name: 'Brand discovery' })).toHaveAttribute('aria-valuenow', '2');
    expect(document.querySelectorAll('.bc-swatch.is-skeleton')).toHaveLength(5);
  });

  it('saves a logo pick and previews it on every brand background', async () => {
    await startDiscovery();
    fireEvent.click(screen.getAllByRole('radio')[1]!);
    expect(screen.getAllByRole('radio')[1]).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(posts).toEqual([{ logo: '01-icon.png' }]));
    const tiles = document.querySelectorAll('.bc-lockup-tile img');
    expect(tiles).toHaveLength(4);
    expect(tiles[0]?.getAttribute('src')).toBe('/api/video/demo/brand-candidate/01-icon.png');
    expect(stageState('lockup')).toBe('is-active');
    expect(document.querySelector('[data-bc-stage="lockup"] em')).toHaveTextContent('Your pick: 01-icon.png');
  });

  it('tweaks a swatch with the colour input and applies a site hint to the focused role', async () => {
    draft = makeBrandDraft({ colors: READY_BRAND_DRAFT.colors });
    await startDiscovery();
    await screen.findByText('#0a0a0a');
    fireEvent.change(screen.getByLabelText('Ink colour'), { target: { value: '#222222' } });
    expect(screen.getByText('#222222')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset Ink' })).toBeInTheDocument();
    expect((document.querySelector('.bc-lockup-tile') as HTMLElement).style.background).toBe('rgb(34, 34, 34)');
    await waitFor(() => expect(posts).toEqual([{ colors: { ink: '#222222' } }]));

    fireEvent.click(screen.getByRole('button', { name: 'Use #2244aa for Ink' }));
    await waitFor(() => expect(posts.at(-1)).toEqual({ colors: { ink: '#2244aa' } }));
  });

  it('announces stages as they complete', async () => {
    await startDiscovery();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Harvesting the site ready. Candidate logos ready');
    draft = makeBrandDraft({ lockup: { rev: 2, svg: true } });
    await act(() => brandStudio.refresh());
    expect(status).toHaveTextContent('Official lockup ready');
    expect(screen.getByRole('radio', { name: /Studio lockup/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps partial results on failure and offers a retry', async () => {
    await startDiscovery();
    act(() => brandStudio.fail('Agent timed out'));
    expect(screen.getByRole('heading', { name: 'Brand discovery stopped' })).toBeInTheDocument();
    expect(within(screen.getByRole('alert')).getByText('Agent timed out')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Retry discovery' }));
    expect(wizardMod.retry).toHaveBeenCalled();
  });

  it('lands on a compact ready summary with a plate in the brand, expandable to adjust', async () => {
    draft = makeBrandDraft(READY_BRAND_DRAFT);
    await startDiscovery();
    await act(() => brandStudio.finish());
    expect(screen.getByRole('heading', { name: 'Acme brand ready' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(document.querySelector('.bc-plate img')?.getAttribute('src')).toMatch(/^\/api\/plate-stills\/acme\/statement\.jpg\?v=7-/);
    expect(document.querySelector('.bc-summary-lockup img')?.getAttribute('src')).toBe('/api/video/demo/brand-lockup?v=7');
    expect(document.querySelector('link[data-brand-font]')?.getAttribute('href')).toBe(READY_BRAND_DRAFT.font?.css);
    fireEvent.click(screen.getByRole('button', { name: 'Adjust' }));
    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('radiogroup', { name: 'Pick the logo' })).toBeInTheDocument();
    expect(screen.getByLabelText('Accent colour')).toHaveValue('#ff5500');
  });
});

import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeBrandDraft, makeJob, READY_BRAND_DRAFT } from '@/test/factories';
import { endpoints } from '@/test/msw/endpoints';
import { server } from '@/test/msw/server';

import {
  brandStudio,
  discoveryProgress,
  discoveryStages,
  effectiveLogo,
  emptySignals,
  harvestSignals,
  logoUrl,
  paletteView,
  readableOn,
  useBrandStudio,
} from './brandStudio';

const makeDraft = makeBrandDraft;
const READY = READY_BRAND_DRAFT;

const line = (id: number, text: string, kind = 'line') => ({ id, kind, text });

afterEach(() => {
  brandStudio.reset();
});

describe('harvest signals', () => {
  it('reads the harvest progress lines and hand-off', () => {
    const s = harvestSignals([
      line(1, 'Harvesting brand signals from the live site…', 'system'),
      line(2, '› Opening https://acme.test'),
      line(3, '› Read the website — headline “Ship faster” · 14 media hints'),
      line(4, '› Collected 9 unique media candidates · saving up to 30'),
      line(5, '› Saved candidates/00-img.svg (img)\n› Saved candidates/01-icon.png (icon)'),
      line(6, '› Wrote harvest stub · 2 candidate files in candidates/'),
      line(7, 'Handing off to agent to author the brand pack…', 'system'),
      { id: 8, kind: 'tool', title: 'Write', text: 'kit/brands/acme/brand.json' },
    ]);
    expect(s).toEqual({
      ...emptySignals(),
      opening: 'https://acme.test',
      siteRead: true,
      headline: 'Ship faster',
      collected: 9,
      saved: 2,
      stubWritten: true,
      handedOff: true,
    });
    expect(harvestSignals([line(1, '✗ net::ERR_NAME_NOT_RESOLVED', 'error')]).error).toBe('net::ERR_NAME_NOT_RESOLVED');
    expect(harvestSignals([line(1, '✓ brand pack ready · Acme', 'system')]).packReady).toBe(true);
  });
});

describe('discovery stages', () => {
  const states = (stages: ReturnType<typeof discoveryStages>) => stages.map((s) => `${s.id}:${s.state}`);

  it('starts on the site and says what it is reading', () => {
    const stages = discoveryStages({ ...emptySignals(), opening: 'https://acme.test/x' }, null, 'discovering');
    expect(states(stages)).toEqual(['site:active', 'candidates:pending', 'lockup:pending', 'palette:pending', 'type:pending', 'motion:pending', 'validate:pending']);
    expect(stages[0]?.note).toBe('Reading acme.test');
    expect(discoveryProgress(stages)).toBe(0);
  });

  it('counts candidates while they save', () => {
    const stages = discoveryStages({ ...emptySignals(), siteRead: true, headline: 'Ship faster', collected: 9, saved: 3 }, null, 'discovering');
    expect(stages[0]).toMatchObject({ state: 'done', note: '“Ship faster”' });
    expect(stages[1]).toMatchObject({ state: 'active', note: 'Saved 3 of up to 9 media hints' });
  });

  it('marks agent work done as each file or field lands', () => {
    const draft = makeDraft({ colors: { ink: '#000000', surface: '#111111', gold: '#ff5500' }, lockup: { rev: 1, svg: true } });
    const stages = discoveryStages({ ...emptySignals(), siteRead: true, stubWritten: true }, draft, 'discovering');
    expect(states(stages)).toEqual(['site:done', 'candidates:done', 'lockup:done', 'palette:active', 'type:pending', 'motion:pending', 'validate:pending']);
    expect(stages[1]?.note).toBe('2 candidates saved — pick one below');
    expect(stages[3]?.note).toBe('3 of 5 roles set');
    expect(discoveryProgress(stages)).toBeCloseTo(3 / 7);
  });

  it('validates only when the pack is ready and the job confirmed it', () => {
    const draft = makeDraft(READY);
    const waiting = discoveryStages({ ...emptySignals(), stubWritten: true }, draft, 'discovering');
    expect(waiting.at(-1)?.state).toBe('active');
    const done = discoveryStages({ ...emptySignals(), stubWritten: true, packReady: true }, draft, 'discovering');
    expect(discoveryProgress(done)).toBe(1);
    expect(done.find((s) => s.id === 'lockup')?.note).toBe('Sourced from acme.test');
    expect(done.find((s) => s.id === 'type')?.note).toBe('Inter');
  });

  it('fails the stage it stopped on, with the reason', () => {
    const stages = discoveryStages({ ...emptySignals(), siteRead: true, stubWritten: true }, makeDraft(), 'failed', { message: 'Agent timed out' });
    expect(stages.find((s) => s.state === 'failed')).toMatchObject({ id: 'lockup', note: 'Agent timed out' });
    expect(stages.filter((s) => s.state === 'active')).toEqual([]);
  });

  it('names the reviewer pick on the lockup row', () => {
    const stages = discoveryStages(emptySignals(), makeDraft(), 'discovering', { logoPick: 'candidates/01-icon.png' });
    expect(stages.find((s) => s.id === 'lockup')?.note).toBe('Your pick: 01-icon.png');
  });
});

describe('palette, contrast and logo choice', () => {
  it('layers edits over saved choices over the agent palette', () => {
    const draft = makeDraft({ colors: { ink: '#000000', gold: '#ff5500' }, choices: { colors: { gold: '#00ff00' }, logo: null } });
    expect(paletteView(draft, { ink: '#222222' }).map((p) => [p.role, p.hex, p.source])).toEqual([
      ['ink', '#222222', 'edit'],
      ['surface', null, 'none'],
      ['gold', '#00ff00', 'edit'],
      ['amber', null, 'none'],
      ['teal', null, 'none'],
    ]);
  });

  it('picks readable text for a swatch', () => {
    expect(readableOn('#ffffff')).toBe('#000000');
    expect(readableOn('#0a100c')).toBe('#ffffff');
    expect(readableOn('#ffcc00')).toBe('#000000');
  });

  it('prefers the pick, then the saved choice, then the authored lockup, then the agent source', () => {
    const draft = makeDraft({ logoSource: 'https://acme.test/logo.svg' });
    expect(effectiveLogo(draft, null)).toBe('candidates/00-img.svg');
    expect(effectiveLogo({ ...draft, lockup: { rev: 3, svg: true } }, null)).toBe('logo.html');
    expect(effectiveLogo({ ...draft, choices: { colors: {}, logo: 'candidates/01-icon.png' } }, null)).toBe('candidates/01-icon.png');
    expect(effectiveLogo(draft, 'logo.html')).toBe('logo.html');
    expect(logoUrl('my video', 'candidates/00-img.svg', draft)).toBe('/api/video/my%20video/brand-candidate/00-img.svg');
    expect(logoUrl('demo', 'logo.html', { ...draft, lockup: { rev: 3, svg: true } })).toBe('/api/video/demo/brand-lockup?v=3');
    expect(logoUrl('demo', 'logo.html', draft)).toBe('');
  });
});

describe('brand studio controller', () => {
  it('polls the draft, follows the job and saves picks', async () => {
    const posts: unknown[] = [];
    server.use(
      http.get(endpoints.brandDraft('demo'), () => HttpResponse.json(makeDraft())),
      http.post(endpoints.brandDraft('demo'), async ({ request }) => {
        const body = (await request.json()) as { logo?: string; colors?: Record<string, string> };
        posts.push(body);
        return HttpResponse.json({ ok: true, applied: false, state: makeDraft({ choices: { colors: body.colors || {}, logo: body.logo ? `candidates/${body.logo}` : null } }) });
      }),
    );
    brandStudio.start('demo');
    expect(useBrandStudio.getState()).toMatchObject({ slug: 'demo', phase: 'discovering' });
    expect(brandStudio.polling).toBe(true);
    await vi.waitFor(() => expect(useBrandStudio.getState().draft?.candidates).toHaveLength(2));

    brandStudio.fromJob(makeJob({ stream: { entries: [line(1, '› Read the website — headline “Ship faster”')] } }));
    expect(useBrandStudio.getState().signals.siteRead).toBe(true);

    brandStudio.pickLogo('candidates/01-icon.png');
    expect(useBrandStudio.getState().logoPick).toBe('candidates/01-icon.png');
    await vi.waitFor(() => expect(posts).toEqual([{ logo: '01-icon.png' }]));

    brandStudio.setColor('gold', '#ABCDEF');
    brandStudio.setColor('gold', '#123456');
    expect(useBrandStudio.getState().edits).toEqual({ gold: '#123456' });
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toEqual({ colors: { gold: '#123456' } });
  });

  it('folds picks in on finish and lands on ready', async () => {
    const posts: unknown[] = [];
    server.use(
      http.get(endpoints.brandDraft('demo'), () => HttpResponse.json(makeDraft({ ...READY, choices: { colors: { gold: '#00ff00' }, logo: null } }))),
      http.post(endpoints.brandDraft('demo'), async ({ request }) => {
        posts.push(await request.json());
        return HttpResponse.json({ ok: true, applied: true, state: makeDraft(READY) });
      }),
    );
    brandStudio.start('demo');
    await vi.waitFor(() => expect(useBrandStudio.getState().draft?.ready).toBe(true));
    await brandStudio.finish();
    expect(posts).toEqual([{}]);
    expect(useBrandStudio.getState().phase).toBe('ready');
    expect(brandStudio.polling).toBe(false);
  });

  it('reverts an optimistic pick the server rejects', async () => {
    server.use(
      http.get(endpoints.brandDraft('demo'), () => HttpResponse.json(makeDraft())),
      http.post(endpoints.brandDraft('demo'), () => HttpResponse.json({ error: 'Logo candidate not found' }, { status: 400 })),
    );
    brandStudio.start('demo');
    brandStudio.pickLogo('candidates/zz.svg');
    await vi.waitFor(() => expect(useBrandStudio.getState().saveError).toBe('Logo candidate not found'));
    expect(useBrandStudio.getState().logoPick).toBeNull();
  });

  it('fails only while discovering and keeps partial results; keepFor resets other projects', async () => {
    server.use(http.get(endpoints.brandDraft('demo'), () => HttpResponse.json(makeDraft())));
    brandStudio.start('demo');
    await vi.waitFor(() => expect(useBrandStudio.getState().draft).not.toBeNull());
    brandStudio.fail('Agent timed out');
    expect(useBrandStudio.getState()).toMatchObject({ phase: 'failed', message: 'Agent timed out' });
    expect(useBrandStudio.getState().draft?.candidates).toHaveLength(2);
    brandStudio.fail('again');
    expect(useBrandStudio.getState().message).toBe('Agent timed out');
    brandStudio.keepFor('demo');
    expect(useBrandStudio.getState().slug).toBe('demo');
    brandStudio.keepFor('other');
    expect(useBrandStudio.getState()).toMatchObject({ slug: '', phase: 'idle', draft: null });
  });
});

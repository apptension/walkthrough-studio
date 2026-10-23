import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Direction, VideoSummary } from '@/api/types';
import { bridges, type EditorBridge, type PlateBridge } from '@/desk/bridge';
import { playPlatePreview } from '@/desk/monitor';
import { desk } from '@/desk/store';
import { session } from '@/features/feedback/session';
import { makeDirection, makeMotion, makeVideo } from '@/test/factories';
import { server } from '@/test/msw/server';

import type * as MonitorModule from '@/desk/monitor';

import { DirectionDock } from './DirectionDock';
import { DirectionTab } from './DirectionTab';
import { paceNote } from './model';
import { directionView } from './view';

vi.mock('@/desk/monitor', async (importOriginal) => ({
  ...(await importOriginal<typeof MonitorModule>()),
  playPlatePreview: vi.fn(),
}));

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const lastToast = () => desk.get().toasts.at(-1);

const CAPTURE = {
  current: { id: 'laptop', label: 'Laptop', width: 1440, height: 900, dpr: 2 },
  suggested: { id: 'desktop' },
  options: [
    { id: 'desktop', label: 'Desktop · big screens', group: 'desktop', width: 1920, height: 1080, dpr: 2 },
    { id: 'laptop', label: 'Laptop', group: 'laptop', width: 1440, height: 900, dpr: 2 },
  ],
  output: { format: 'landscape', width: 1920, height: 1080 },
  outputs: [
    { format: 'landscape', width: 1920, height: 1080 },
    { format: 'portrait', width: 1080, height: 1920 },
  ],
  space: {
    plannedStage: { mode: 'window', x: 96, y: 54, w: 1728, h: 972, radius: 18 },
    output: { format: 'landscape', width: 1920, height: 1080 },
    capture: { width: 1440, height: 900 },
    take: null,
    takeMatches: true,
  },
};

const direction = (over: Partial<Direction> = {}) =>
  makeDirection({
    scale: 'signature',
    scales: [
      { id: 'signature', label: 'Signature', hint: 'House', recommended: true, colors: { ink: '#000', gold: '#42f272' }, swatches: [] },
      { id: 'night', label: 'Night', hint: '', recommended: false, colors: { ink: '#111', gold: '#f00' }, swatches: [] },
    ],
    roles: [
      { id: 'ink', label: 'Ink' },
      { id: 'gold', label: 'Accent' },
    ],
    colors: { ink: '#000000', gold: '#42f272', surface: '#ffffff', amber: '#ffaa00' },
    lockups: [
      { file: 'logo.svg', label: 'Primary' },
      { file: 'logo.html', label: 'Plate lockup', kind: 'html' },
    ],
    logo: 'logo.svg',
    looks: { studio: { label: 'Studio', hint: 'Inset', camera: {}, cursor: {}, keys: true } },
    look: 'studio',
    camera: { zoom: 'subtle', frame: 'inset', background: 'ink', padding: 'tight', corners: 'soft', shadow: 'deep', curve: 'snappy', motion: 'swift' },
    cursor: { style: 'classic', size: 'm', glide: true, hideIdle: false, hand: false, loop: true },
    keys: true,
    paces: { steady: { label: 'Steady', hint: 'Default', tempo: 1 }, brisk: { label: 'Brisk', hint: 'Faster', tempo: 1.25 } },
    pace: { id: 'brisk', tempo: 1.25, label: 'Brisk', hint: 'Faster' },
    ...over,
  });

function video(over: Partial<VideoSummary> = {}): VideoSummary {
  return makeVideo({ direction: direction(), ...over });
}

let rebuild = vi.fn(() => Promise.resolve({}));

beforeEach(() => {
  desk.reset();
  session.reset();
  directionView.reset();
  vi.clearAllMocks();
  rebuild = vi.fn(() => Promise.resolve({}));
  bridges.plate = { rebuildPlateHtmlPreview: rebuild, showPlateHtml: vi.fn(), fitFhdPreview: vi.fn() } as unknown as PlateBridge;
  server.use(http.get('/api/video/:slug/capture', () => HttpResponse.json(CAPTURE)));
});

afterEach(() => {
  bridges.plate = null;
  bridges.editor = null;
});

describe('DirectionTab markup before a video', () => {
  it('keeps the static aria state legacy shipped', () => {
    render(<DirectionTab />);
    expect($('rightMotion')).toHaveAttribute('hidden');
    expect($('directionStatus')).toHaveTextContent('Needs approval');
    expect($('directionStatus')).not.toHaveAttribute('data-tone');
    expect($('directionBrandName')).toHaveTextContent('Brand pack');

    const energy = $$('#energyGrid .energy');
    expect(energy.map((b) => b.getAttribute('aria-checked'))).toEqual([null, 'true', null]);
    expect(energy[1]).toHaveClass('active');

    const atm = $$('#atmosphereGrid [data-atmosphere]');
    expect(atm.map((b) => b.dataset.atmosphere)).toEqual(['none', 'schedule', 'aurora', 'mesh', 'particles', 'grid', 'waves']);
    expect(atm.filter((b) => b.hasAttribute('aria-checked')).map((b) => b.dataset.atmosphere)).toEqual(['aurora']);

    const focus = $$('#focusGrid [data-focus]');
    expect(focus.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', null, null]);

    const transitions = $$('#transitionGrid [data-transition]');
    expect(transitions).toHaveLength(11);
    expect(transitions[0]).toHaveClass('active');
    expect(transitions.some((b) => b.hasAttribute('aria-checked'))).toBe(false);

    expect($$('[data-camera] [data-value]').some((b) => b.hasAttribute('aria-checked') || b.classList.contains('active'))).toBe(false);
    expect($('backgroundRow')).not.toHaveAttribute('hidden');

    expect($('paceMeta').querySelector('.help-tip')).not.toBeNull();
    expect($('sizeMeta').querySelector('.help-tip')).not.toBeNull();
    expect($('overlayChapterBackdrop').querySelector('.help-tip')).not.toBeNull();
    expect(($('atmosphereOpacity') as HTMLInputElement).value).toBe('0.6');
    expect($('atmosphereOpacityOut')).toHaveTextContent('0.60');
    expect($('transitionDurationOut')).toHaveTextContent('0.6s');
    expect($('sheenToggle')).toBeChecked();
    expect($('plateBin')).toBeEmptyDOMElement();
  });
});

describe('when a summary lands', () => {
  it('paints direction, effects, transitions, pace, size and plates', async () => {
    desk.set({ slug: 'demo' });
    render(<DirectionTab />);
    act(() =>
      desk.set({
        video: video({
          motion: makeMotion({ energy: 'punchy', atmosphere: 'none', atmosphereOpacity: 0.8, depth: 'deep', sheen: false }),
          livePace: { id: 'steady', tempo: 1, override: false, narrationHoldSec: 6, narrationHoldShare: 0.25 },
          assets: [{ name: 'intro.mp4', url: '/media/intro.mp4', sizeMB: 1.2, kind: 'plate' }],
        }),
      }),
    );

    expect($('directionStatus')).toHaveAttribute('data-tone', 'warn');
    expect($('directionBrandName')).toHaveTextContent('Walkthrough Studio');
    expect($('directionBrandMeta')).toHaveTextContent('Plus Jakarta Sans · base colors · logo chosen below');
    expect($('directionBrandAccent').style.getPropertyValue('--brand-accent')).toBe('#42f272');

    const scales = $$('#paletteGrid [data-palette]');
    expect(scales.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(scales[0]?.querySelector('em')).toHaveTextContent('Best match');
    expect(scales[0]?.querySelectorAll('.scale-swatches i')).toHaveLength(2);
    expect(($('scaleEditor').querySelector('input[data-role="gold"]') as HTMLInputElement).value).toBe('#42f272');
    expect($('logoGrid').querySelector('img')).toHaveAttribute('src', '/api/video/demo/brand-file/logo.svg');
    expect($('logoGrid').querySelector('.logo-fallback')).toHaveTextContent('Plate');

    expect($$('#focusGrid [data-focus]').map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);

    expect($$('#energyGrid .energy').map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    const atm = $$('#atmosphereGrid [data-atmosphere]');
    expect(atm.map((b) => [b.dataset.atmosphere, b.getAttribute('aria-checked')])).toEqual([
      ['none', 'true'],
      ['aurora', 'false'],
    ]);
    expect(document.querySelector('.atmosphere-sliders')).toHaveClass('hidden');
    expect($('atmosphereOpacityOut')).toHaveTextContent('0.80');
    expect(($('cardDepth') as HTMLSelectElement).value).toBe('deep');
    expect($('sheenToggle')).not.toBeChecked();

    const transitions = $$('#transitionGrid [data-transition]');
    expect(transitions.find((b) => b.classList.contains('active'))?.dataset.transition).toBe('dissolve');
    expect(transitions.every((b) => b.hasAttribute('aria-checked'))).toBe(true);
    expect($('transitionDurationOut')).toHaveTextContent('0.4s');

    expect($('paceMeta').textContent).toBe('1.25×');
    expect($('paceMeta').querySelector('.help-tip')).toBeNull();
    expect($('paceHint')).toHaveTextContent('Faster · re-record to apply');
    expect([...$('paceSeg').querySelectorAll('input')].map((i) => i.checked)).toEqual([false, true]);
    expect($('paceNote')).not.toHaveAttribute('hidden');
    expect($('paceNote')).toHaveAttribute('data-tone', 'warn');

    expect($('lookPreview').dataset).toMatchObject({ frame: 'inset', cursor: 'classic', keys: 'on', shadow: 'deep' });
    expect($('lookPresets').querySelector('[data-look="studio"]')).toHaveClass('active');
    expect(document.querySelector('[data-camera="curve"] .active')).toHaveAttribute('data-value', 'snappy');
    expect($('backgroundRow')).not.toHaveAttribute('hidden');
    expect($('cursorSizeRow')).toHaveAttribute('hidden');
    expect($$('.cursorDetailRow').every((r) => r.hidden)).toBe(true);
    expect($('glideToggle')).toBeChecked();
    expect($('loopToggle')).toBeChecked();
    expect($('keysToggle')).toBeChecked();

    await waitFor(() => expect($('sizeMeta').textContent).toBe('1440×900 @2x'));
    const sizes = $$('#sizeOptions .size-option');
    expect(sizes.map((b) => [b.dataset.size, b.getAttribute('aria-checked')])).toEqual([
      ['desktop', 'false'],
      ['laptop', 'true'],
      ['custom-open', 'false'],
    ]);
    expect(sizes[0]?.querySelector('.size-badge')).toHaveTextContent('Suggested');
    expect($('sizeHint').textContent).toBe('Centred as a window on the 1920×1080 video — other aspect ratios leave a margin.');
    expect([...$('shapeSeg').querySelectorAll('input')].map((i) => i.checked)).toEqual([true, false]);
    expect($('sizePreview').dataset.mode).toBe('window');
    expect(($('sizeW') as HTMLInputElement).value).toBe('1440');

    expect($('plateCount')).toHaveTextContent('1');
    const li = $('plateBin').querySelector('li');
    expect(li?.querySelector('.who')?.textContent).toBe('intro.mp4 1.2 MB · plate');
    fireEvent.click(li!.querySelector('[data-act="preview"]')!);
    expect(playPlatePreview).toHaveBeenCalledWith('/media/intro.mp4', 'intro.mp4');
  });

  it('hides the size section when capture settings fail', async () => {
    server.use(http.get('/api/video/:slug/capture', () => HttpResponse.json({ error: 'nope' }, { status: 500 })));
    desk.set({ slug: 'demo' });
    render(<DirectionTab />);
    act(() => desk.set({ video: video() }));
    await waitFor(() => expect($('sizeSection')).toHaveAttribute('hidden'));
  });

  it('says when no plate renders exist', () => {
    desk.set({ video: video() });
    render(<DirectionTab />);
    expect($('plateBin').innerHTML).toBe('<li class="hint">No plate renders yet — Preview plates.</li>');
  });
});

describe('motion live loop', () => {
  it('paints at once and saves 320 ms after the last pick', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post('/api/video/:slug/motion', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ motion: makeMotion({ energy: 'calm', atmosphere: 'aurora' }) });
      }),
    );
    const paintLookVars = vi.fn();
    bridges.editor = { active: false, paintLookVars } as unknown as EditorBridge;
    desk.set({
      slug: 'demo',
      motionApplied: true,
      platesPreviewed: true,
      video: video({ motionOptions: { ...makeVideo().motionOptions, lookVars: { energy: { calm: { '--enter': '700ms' } } } } }),
    });
    render(<DirectionTab />);
    fireEvent.click(document.querySelector('[data-energy="calm"]')!);
    expect(desk.get().motionApplied).toBe(false);
    expect(paintLookVars).toHaveBeenCalledWith({ '--enter': '700ms' }, 'rise');
    expect(document.querySelector('[data-energy="calm"]')).toHaveClass('active');
    fireEvent.click(document.querySelector('[data-title-reveal="wipe"]')!);

    await waitFor(() => expect(desk.get().platesPreviewed).toBe(true), { timeout: 1500 });
    expect(bodies).toEqual([
      { energy: 'calm', atmosphere: 'aurora', atmosphereOpacity: 0.6, atmosphereSpeed: 1, titleReveal: 'wipe', depth: 'soft', sheen: true },
    ]);
    expect(desk.get().motionApplied).toBe(true);
    expect(rebuild).toHaveBeenCalledWith({ selectFirst: false, plateId: null });
  });
});

describe('transitions', () => {
  it('marks the pick at once and saves it after 250 ms', async () => {
    let put: unknown;
    server.use(
      http.put('/api/video/:slug/transitions', async ({ request }) => {
        put = await request.json();
        return HttpResponse.json({ transitions: { style: 'iris', duration: 0.4, xfade: 'circleopen' } });
      }),
      http.get('/api/video/:slug', () => HttpResponse.json(video({ transitions: { style: 'iris', duration: 0.4, xfade: 'circleopen' } }))),
    );
    desk.set({ slug: 'demo', video: video() });
    render(<DirectionTab />);
    fireEvent.click(document.querySelector('[data-transition="iris"]')!);
    expect(document.querySelector('[data-transition="iris"]')).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(lastToast()?.title).toBe('Transitions updated'));
    expect(put).toEqual({ style: 'iris' });
    expect(lastToast()?.detail).toBe('iris · 0.4s · live on the stage');
  });

  it('shows the length while dragging and saves it on change', async () => {
    let put: unknown;
    server.use(
      http.put('/api/video/:slug/transitions', async ({ request }) => {
        put = await request.json();
        return HttpResponse.json({ transitions: { style: 'dissolve', duration: 0.9, xfade: 'fade' } });
      }),
    );
    desk.set({ slug: 'demo', video: video() });
    render(<DirectionTab />);
    const range = $('transitionDuration') as HTMLInputElement;
    fireEvent.input(range, { target: { value: '0.9' } });
    expect($('transitionDurationOut')).toHaveTextContent('0.9s');
    expect(put).toBeUndefined();
    fireEvent(range, new Event('change', { bubbles: true }));
    await waitFor(() => expect(put).toEqual({ duration: 0.9 }));
  });
});

describe('direction picks', () => {
  it('picks a focus optimistically and saves it', async () => {
    let put: unknown;
    server.use(
      http.put('/api/video/:slug/direction', async ({ request }) => {
        put = await request.json();
        const d = direction({ focus: 'ring' });
        return HttpResponse.json({ direction: d, motion: d.motion, transitions: makeVideo().transitions });
      }),
    );
    desk.set({ slug: 'demo', video: video({ direction: direction({ approvedAt: '2026-10-20T09:00:00.000Z' }) }) });
    render(<DirectionTab />);
    expect($('directionStatus')).toHaveTextContent('Approved');
    fireEvent.click(document.querySelector('[data-focus="ring"]')!);
    expect(document.querySelector('[data-focus="ring"]')).toHaveAttribute('aria-checked', 'true');
    expect($('directionStatus')).toHaveTextContent('Needs approval');
    await waitFor(() => expect(lastToast()?.title).toBe('Direction updated'));
    expect(put).toEqual({ focus: 'ring' });
  });

  it('saves a cursor toggle and keeps it on screen', async () => {
    server.use(
      http.put('/api/video/:slug/direction', () => HttpResponse.json({ error: 'locked' }, { status: 409 })),
    );
    desk.set({ slug: 'demo', video: video() });
    render(<DirectionTab />);
    fireEvent.click($('keysToggle'));
    expect($('keysToggle')).not.toBeChecked();
    await waitFor(() => expect(lastToast()?.title).toBe('Direction failed'));
    expect($('keysToggle')).not.toBeChecked();
  });

  it('opens the custom size form and validates it', () => {
    desk.set({ slug: 'demo' });
    directionView.set({ capture: CAPTURE });
    render(<DirectionTab />);
    fireEvent.click(document.querySelector('[data-size="custom-open"]')!);
    expect($('sizeCustom')).not.toHaveAttribute('hidden');
    expect(document.querySelector('[data-size="custom-open"]')).toHaveAttribute('aria-checked', 'true');
    fireEvent.change($('sizeW'), { target: { value: '333' } });
    fireEvent.submit($('sizeCustom'));
    expect($('sizeError')).not.toHaveAttribute('hidden');
    expect($('sizeError')).toHaveTextContent('Width must be even.');
  });

  it('fills the live-card selects from the catalog and saves the look', async () => {
    let body: unknown;
    server.use(
      http.post('/api/video/:slug/overlays', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ overlays: { preset: 'punchy', chapter: {}, caption: {}, chapters: {} }, plates: [] });
      }),
    );
    const overlays = {
      preset: 'editorial',
      paper: '#ffffff',
      chapter: { atmosphere: 'mesh', backdrop: '#123456' },
      caption: { atmosphere: 'waves', backdrop: 'none', seat: 'bottom-left', align: 'center' },
      chapters: {},
      catalog: {
        presets: [],
        atmospheres: [
          { id: 'waves', label: 'Waves' },
          { id: 'mesh', label: 'Mesh' },
        ],
        seats: [],
        aligns: [],
        energies: [],
        backdrops: [
          { id: 'auto', label: 'Auto' },
          { id: 'none', label: 'None' },
          { id: 'custom', label: 'Custom' },
        ],
      },
    };
    desk.set({ slug: 'demo', video: video({ overlays }) });
    render(<DirectionTab />);
    const chapterBackdrop = $('overlayChapterBackdrop') as HTMLSelectElement;
    expect([...chapterBackdrop.options].map((o) => o.textContent)).toEqual(['Auto · white', 'None', 'Custom #123456']);
    expect(chapterBackdrop.value).toBe('#123456');
    expect(chapterBackdrop.querySelector('.help-tip')).toBeNull();
    expect(($('overlayChapterAtm') as HTMLSelectElement).value).toBe('mesh');
    expect(($('overlayPreset') as HTMLSelectElement).value).toBe('editorial');
    expect(($('overlayCaptionSeat') as HTMLSelectElement).value).toBe('bottom-left');

    fireEvent.click($('btnOverlaysApply'));
    await waitFor(() => expect(lastToast()?.title).toBe('Live cards updated'));
    expect(body).toEqual({
      preset: 'editorial',
      chapter: { atmosphere: 'mesh', backdrop: '#123456' },
      caption: { atmosphere: 'waves', backdrop: 'none', seat: 'bottom-left', align: 'center' },
    });
  });

  it('words the pace note', () => {
    const pace = { id: 'brisk', tempo: 1.25, label: 'Brisk' };
    expect(paceNote(pace, { id: 'brisk', tempo: 1.25, override: false, narrationHoldSec: 2 })).toBeNull();
    expect(paceNote(pace, { id: 'steady', tempo: 1, override: false, narrationHoldSec: 4, narrationHoldShare: 0.1 })).toEqual({
      text: 'Last take: narration held the tour 4s (10%) at pace steady.',
      tone: '',
    });
  });
});

describe('DirectionDock', () => {
  it('applies the motion template and opens a proposal', async () => {
    server.use(
      http.post('/api/video/:slug/draft/snapshot', () => HttpResponse.json({ ok: true })),
      http.post('/api/video/:slug/motion', () => HttpResponse.json({ motion: makeMotion({ energy: 'clear' }) })),
    );
    desk.set({ slug: 'demo', video: video() });
    render(<DirectionDock />);
    expect($('btnApproveMotion')).toBeDisabled();
    await act(async () => {
      fireEvent.click($('btnMotion'));
      await Promise.resolve();
    });
    await waitFor(() => expect(desk.get().proposalOpen).toBe(true));
    expect(session.get().proposalTitle).toBe('Motion template applied');
    expect(session.get().proposalReason).toBe('clear on all plates — review live HTML, then Approve & Render.');
    expect(desk.get().motionApplied && desk.get().platesPreviewed).toBe(true);
    expect($('btnApproveMotion')).toBeEnabled();
    expect($('btnMotion')).toBeEnabled();
  });

  it('approves direction and ends enabled until the next repaint', async () => {
    const approved = direction({ approvedAt: '2026-10-20T09:00:00.000Z' });
    server.use(
      http.put('/api/video/:slug/direction', () =>
        HttpResponse.json({ direction: approved, motion: approved.motion, transitions: makeVideo().transitions }),
      ),
      http.get('/api/video/:slug', () => HttpResponse.json(video({ direction: approved }))),
    );
    desk.set({ slug: 'demo', video: video() });
    render(
      <>
        <DirectionTab />
        <DirectionDock />
      </>,
    );
    expect($('btnApproveDirection')).toHaveTextContent('Approve direction');
    fireEvent.click($('btnApproveDirection'));
    expect($('btnApproveDirection')).toBeDisabled();
    await waitFor(() => expect(lastToast()?.title).toBe('Direction approved'));
    await waitFor(() => expect(desk.get().busy.btnApproveDirection).toBe(false));
    expect($('btnApproveDirection')).toHaveTextContent('Direction approved');
    await waitFor(() => expect($('btnApproveDirection')).toBeEnabled());
    act(() => desk.set((s) => ({ video: s.video ? { ...s.video, direction: { ...approved } } : null })));
    expect($('btnApproveDirection')).toBeDisabled();
  });
});

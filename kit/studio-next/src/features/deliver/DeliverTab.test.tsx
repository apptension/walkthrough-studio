import { act, fireEvent, render } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Deliver } from '@/api/types';
import { enqueueJob } from '@/desk/jobs';
import { desk } from '@/desk/store';
import { makeVideo } from '@/test/factories';
import { server } from '@/test/msw/server';

import type * as JobsModule from '@/desk/jobs';

import { DeliverSections } from './DeliverTab';
import { downloadHandoffZip, handoffZipLink } from './handoff';

vi.mock('@/desk/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof JobsModule>()),
  enqueueJob: vi.fn(),
}));

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

const lastToast = () => desk.get().toasts.at(-1);

const deliver = (over: Partial<Deliver> = {}): Deliver => ({
  slug: 'demo',
  title: 'Demo',
  generatedAt: '2026-10-20T09:00:00.000Z',
  durationSec: 92,
  sizeMB: 18.4,
  posterAtSec: 3,
  posterSource: 'manual',
  qcStatus: 'ok',
  captionCues: 24,
  chapterCount: 2,
  stills: ['a.jpg', 'b.jpg'],
  files: [],
  dirUrl: null,
  readmeUrl: '/media/demo/README.md',
  ...over,
});

const presets = {
  square: { label: 'Square 1:1', hint: 'LinkedIn, X', width: 1080, height: 1080, kind: 'mp4' },
  vertical: { label: 'Vertical 9:16', hint: 'Reels', width: 1080, height: 1920, kind: 'mp4' },
  light: { label: 'Light 720p', hint: 'Email', width: 1280, height: 720, kind: 'mp4' },
};

beforeEach(() => {
  desk.reset();
  vi.clearAllMocks();
});

describe('Deliver sections', () => {
  it('renders the handoff and formats before a video loads', () => {
    render(<DeliverSections />);
    expect($('handoffBadge')).toHaveAttribute('hidden');
    expect($('handoffBox').querySelector('.zen')).toHaveAttribute('data-zen', 'box');
    expect($('btnCopyYt')).toBeDisabled();
    expect($('linkReadme')).toHaveAttribute('hidden');
    expect($('linkHandoffZip')).toHaveAttribute('hidden');
    expect($('linkHandoffZip')).toHaveAttribute('href', '#');
    expect($('linkHandoffZip')).toHaveAttribute('download', '');
    expect($('exportCount')).toBeEmptyDOMElement();
    expect($('reelToggle')).not.toBeChecked();
    expect($('exportPresets')).toBeEmptyDOMElement();
    expect($('btnExportFormats')).toBeEnabled();
    expect($('exportList')).toBeEmptyDOMElement();
  });
});

describe('handoff pack', () => {
  it('summarises the pack and wires the links', () => {
    desk.set({
      video: makeVideo({ deliver: deliver(), handoffZipUrl: '/media/demo/handoff.zip', youtubeChaptersUrl: '/media/demo/yt.txt' }),
    });
    render(<DeliverSections />);
    expect($('handoffBadge')).not.toHaveAttribute('hidden');
    expect($('handoffBadge').className).toBe('badge ok');
    expect($('handoffBox').innerHTML).toBe('<div><strong>1:32</strong> · 18.4 MB · 2 chapters · 2 stills · poster set in Studio</div>');
    expect($('btnCopyYt')).toBeEnabled();
    expect($('linkReadme')).not.toHaveAttribute('hidden');
    expect($('linkReadme')).toHaveAttribute('href', '/media/demo/README.md');
    const zip = $('linkHandoffZip');
    expect(zip).not.toHaveAttribute('hidden');
    expect(zip.getAttribute('href')).toMatch(/^\/media\/demo\/handoff\.zip\?t=\d+&download=1$/);
    expect(zip).toHaveAttribute('download', 'demo-handoff.zip');
  });

  it('drops the zip href when there is no zip, and builds on click', () => {
    desk.set({ slug: 'demo', video: makeVideo() });
    render(<DeliverSections />);
    expect($('linkHandoffZip')).not.toHaveAttribute('href');
    expect($('btnCopyYt')).toBeDisabled();
    fireEvent.click($('linkHandoffZip'));
    expect(enqueueJob).toHaveBeenCalledWith({ kind: 'step', step: 'deliver', force: false, label: 'Export handoff pack' });
    expect(lastToast()?.title).toBe('Building handoff…');
  });

  it('builds the zip and downloads it', async () => {
    server.use(
      http.post('/api/video/:slug/deliverables/zip', () => HttpResponse.json({ zipUrl: '/media/demo/handoff.zip', sizeMB: 21 })),
    );
    desk.set({ slug: 'demo', video: makeVideo({ deliver: deliver() }) });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await downloadHandoffZip();
    expect(click).toHaveBeenCalled();
    expect(desk.get().video?.handoffZipUrl).toBe('/media/demo/handoff.zip');
    expect(lastToast()).toMatchObject({ title: 'Downloading zip', detail: '21 MB' });
    expect(desk.get().busy).toMatchObject({ btnBuildHandoffZip: false, btnExportMedia: false });
    click.mockRestore();
  });

  it('copies the YouTube chapters', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    desk.set({ video: makeVideo({ youtubeChaptersUrl: '/yt.txt' }), ytText: '0:00 Open\n' });
    render(<DeliverSections />);
    await act(async () => {
      fireEvent.click($('btnCopyYt'));
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith('0:00 Open\n');
    expect(lastToast()).toMatchObject({ title: 'Copied', detail: 'YouTube chapters' });
  });

  it('builds the zip link with a cache-busting stamp', () => {
    expect(handoffZipLink('/z.zip', 'demo', 5)).toEqual({ href: '/z.zip?t=5&download=1', download: 'demo-handoff.zip' });
  });
});

describe('formats', () => {
  it('lists presets with the default picks and exports them', () => {
    desk.set({
      video: makeVideo({
        exportPresets: presets,
        exports: [{ id: 'square', label: 'Square 1:1', sizeMB: 4.2, url: '/media/demo/square.mp4', stale: true }],
      }),
    });
    render(<DeliverSections />);
    const labels = [...$('exportPresets').querySelectorAll('label')];
    expect(labels.map((l) => l.className)).toEqual(['export-preset active', 'export-preset active', 'export-preset']);
    expect(labels[0]?.querySelector('.export-shape')).toHaveAttribute('data-shape', 'square');
    expect($('exportCount')).toHaveTextContent('1 ready');
    const li = $('exportList').querySelector('li');
    expect(li?.querySelector('a')).toHaveAttribute('href', '/media/demo/square.mp4');
    expect(li?.querySelector('.meta')).toHaveTextContent('4.2 MB · older than master');

    fireEvent.click($('btnExportFormats'));
    expect(enqueueJob).toHaveBeenLastCalledWith({ kind: 'step', step: 'export', presets: ['square', 'vertical', 'gif'], label: 'Export 3 formats' });

    fireEvent.click(labels[1]!.querySelector('input')!);
    fireEvent.click(labels[2]!.querySelector('input')!);
    expect(labels[1]).not.toHaveClass('active');
    expect(labels[2]).toHaveClass('active');
    fireEvent.click($('btnExportFormats'));
    expect(enqueueJob).toHaveBeenLastCalledWith({ kind: 'step', step: 'export', presets: ['square', 'light'], label: 'Export 2 formats' });

    fireEvent.click(labels[0]!.querySelector('input')!);
    fireEvent.click(labels[2]!.querySelector('input')!);
    fireEvent.click($('btnExportFormats'));
    expect(lastToast()).toMatchObject({ title: 'Pick a format', kind: 'warn' });
  });

  it('disables export without a master', () => {
    desk.set({ video: makeVideo({ deliveryUrl: null }) });
    render(<DeliverSections />);
    expect($('btnExportFormats')).toBeDisabled();
  });

  it('toggles the reel safe area', () => {
    render(<DeliverSections />);
    fireEvent.click($('reelToggle'));
    expect(desk.get().reelSafeArea).toBe(true);
    expect(lastToast()).toMatchObject({ title: 'Reel safe area', detail: 'Vertical interface overlap shown on Program' });
    fireEvent.click($('reelToggle'));
    expect(desk.get().reelSafeArea).toBe(false);
    expect(lastToast()?.detail).toBe('Preview hidden');
  });
});

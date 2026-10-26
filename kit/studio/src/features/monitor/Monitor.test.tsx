import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decideAction } from '@/desk/action';
import { bridges, type FeedbackBridge, type PlateBridge } from '@/desk/bridge';
import { ensureProgramMaster, paintSignInWait, seekTo, setCompare, setMonitorMode, startPlayback, syncCompare, updateTransport } from '@/desk/monitor';
import { requestMake } from '@/desk/jobs';
import { runtime } from '@/desk/runtime';
import { desk, initialLive } from '@/desk/store';
import { makeVersion, makeVideo } from '@/test/factories';
import { server } from '@/test/msw/server';

import type * as JobsModule from '@/desk/jobs';
import type * as MonitorModule from '@/desk/monitor';

import { Monitor } from './Monitor';

vi.mock('@/desk/monitor', async (importOriginal) => ({
  ...(await importOriginal<typeof MonitorModule>()),
  setMonitorMode: vi.fn(),
  ensureProgramMaster: vi.fn(() => false),
  setCompare: vi.fn(),
  seekTo: vi.fn(),
  startPlayback: vi.fn(),
  updateTransport: vi.fn(),
  syncCompare: vi.fn(),
  paintSignInWait: vi.fn(),
}));

vi.mock('@/desk/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof JobsModule>()),
  requestMake: vi.fn(),
  stopAllWork: vi.fn(),
}));

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

function loadVideo(over: Parameters<typeof makeVideo>[0] = {}) {
  const video = makeVideo(over);
  desk.set({ slug: video.slug, video, action: decideAction(video) });
  return video;
}

const lastToast = () => desk.get().toasts.at(-1);

beforeEach(() => {
  desk.reset();
  vi.clearAllMocks();
});

afterEach(() => {
  bridges.plate = null;
  bridges.feedback = null;
  bridges.editor = null;
});

describe('Monitor markup', () => {
  it('renders the legacy ids, tabs and transport', () => {
    render(<Monitor />);
    const section = document.querySelector('section.monitor');
    expect(section).toHaveAttribute('aria-label', 'Program monitor');
    expect(section).toHaveAttribute('data-mode', 'program');
    for (const id of [
      'modeProgram', 'modeLive', 'modePlate', 'monitorLabel', 'monitorModeHint', 'togCaptions', 'togCompare', 'stage',
      'livePreview', 'liveBadge', 'liveWarmup', 'signInWait', 'signInContinue', 'recordFailure', 'recordFailureFix',
      'recordFailureDismiss', 'programBuild', 'playerSingle', 'player', 'playerCompare', 'playerA', 'playerB', 'compareSelect',
      'captionOverlay', 'chapterToast', 'noVideo', 'btnNoVideoPrimary', 'btnNoVideoSecondary', 'btnSkipBack', 'btnPlay',
      'btnSkipFwd', 'rateSelect', 'btnMute', 'btnFs',
    ]) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
    expect($('modeProgram')).toHaveClass('mode-tab', 'active');
    expect($('modeLive')).toHaveAttribute('hidden');
    expect($('modeLive')).toHaveAttribute('aria-hidden', 'true');
    expect($('monitorLabel')).toHaveAttribute('hidden');
    expect($('monitorModeHint')).toHaveTextContent('The rendered master');
    expect(($('rateSelect') as HTMLSelectElement).value).toBe('1');
    expect($('playerB')).toHaveAttribute('muted');
    expect($('player')).not.toHaveClass('hidden');
    expect($('noVideo')).not.toHaveClass('show');
    expect($('noVideoTitle')).toHaveTextContent('Nothing to play yet');
    expect($('btnPlay')).toHaveAttribute('aria-label', 'Play');
  });

  it('registers the media elements and the stage into runtime, and clears them on unmount', () => {
    const { unmount } = render(<Monitor />);
    expect(runtime.player).toBe($('player'));
    expect(runtime.playerA).toBe($('playerA'));
    expect(runtime.playerB).toBe($('playerB'));
    expect(runtime.stage).toBe($('stage'));
    unmount();
    expect(runtime.player).toBeNull();
    expect(runtime.stage).toBeNull();
  });
});

describe('mode tabs', () => {
  it('Program re-asserts the master', async () => {
    desk.set({ previewingPlate: '/media/demo/plate.mp4' });
    render(<Monitor />);
    await userEvent.click($('modeProgram'));
    expect(desk.get().previewingPlate).toBeNull();
    expect(setMonitorMode).toHaveBeenCalledWith('program');
    expect(ensureProgramMaster).toHaveBeenCalledWith({ force: true });
  });

  it('Program and Live refuse while plate edits are unsaved', async () => {
    desk.set({ plateDirty: true });
    render(<Monitor />);
    await userEvent.click($('modeProgram'));
    expect(setMonitorMode).not.toHaveBeenCalled();
    expect(lastToast()).toMatchObject({ title: 'Unsaved plate edits', detail: 'Save or Discard first', kind: 'warn' });
  });

  it('Editor builds the plate preview first when there is nothing to edit', async () => {
    const rebuild = vi.fn(() => Promise.resolve());
    render(<Monitor />);
    // PlatePane registers the real plate bridge on mount; swap in the fake afterwards.
    bridges.plate = { rebuildPlateHtmlPreview: rebuild } as unknown as PlateBridge;
    bridges.editor = null;
    await userEvent.click($('modePlate'));
    expect(rebuild).toHaveBeenCalledWith({ selectFirst: false });
    expect(setMonitorMode).toHaveBeenCalledWith('plate');
  });

  it('Editor stays put and warns when the preview cannot be built', async () => {
    render(<Monitor />);
    bridges.plate = { rebuildPlateHtmlPreview: () => Promise.reject(new Error('No plates')) } as unknown as PlateBridge;
    bridges.editor = null;
    await userEvent.click($('modePlate'));
    expect(setMonitorMode).not.toHaveBeenCalled();
    expect(lastToast()).toMatchObject({ title: 'Nothing to edit yet', detail: 'No plates', kind: 'warn' });
  });

  it('a [data-open-editor] control anywhere opens the Editor', async () => {
    desk.set({ htmlPlates: [{ id: 'open', label: 'Open', type: 'open', htmlUrl: '/x.html', path: '', mp4Url: null, encode: null }] });
    render(
      <>
        <Monitor />
        <button type="button" data-open-editor>
          Edit
        </button>
      </>,
    );
    await userEvent.click(screen.getByText('Edit'));
    await waitFor(() => expect(setMonitorMode).toHaveBeenCalledWith('plate'));
  });

  it('marks Program active in compare and names the mode in the label', () => {
    render(<Monitor />);
    act(() => desk.set({ monitorMode: 'compare', monitorLabel: { text: 'Compare', hint: 'A/B against a saved version' } }));
    expect($('modeProgram')).toHaveClass('active');
    expect(document.querySelector('section.monitor')).toHaveAttribute('data-mode', 'compare');
    expect($('monitorLabel')).not.toHaveAttribute('hidden');
    expect($('monitorLabel')).toHaveTextContent('Compare');
    expect($('playerCompare')).not.toHaveAttribute('hidden');
    expect($('playerSingle')).toHaveAttribute('hidden');
  });

  it('slides the Live tab in while a capture runs and out after it ends', async () => {
    render(<Monitor />);
    act(() => desk.set({ live: { ...initialLive, tab: true, onAir: true, recording: true } }));
    expect($('modeLive')).not.toHaveAttribute('hidden');
    expect($('modeLive')).toHaveAttribute('aria-hidden', 'false');
    expect($('modeLive')).toHaveClass('is-on-air');
    await waitFor(() => expect($('modeLive')).toHaveClass('is-in'));
    vi.useFakeTimers();
    act(() => desk.set({ live: initialLive }));
    expect($('modeLive')).not.toHaveClass('is-in');
    expect($('modeLive')).not.toHaveClass('is-on-air');
    expect($('modeLive')).toHaveAttribute('aria-hidden', 'true');
    expect($('modeLive')).not.toHaveAttribute('hidden');
    act(() => {
      vi.advanceTimersByTime(420);
    });
    expect($('modeLive')).toHaveAttribute('hidden');
  });

  it('Live click enters the Live pane', async () => {
    render(<Monitor />);
    act(() => desk.set({ live: { ...initialLive, tab: true, repairing: true } }));
    expect($('modeLive')).toHaveClass('is-repairing');
    await userEvent.click($('modeLive'));
    expect(setMonitorMode).toHaveBeenCalledWith('live');
  });
});

describe('toggles', () => {
  it('CC flips captions and repaints the transport', async () => {
    render(<Monitor />);
    await userEvent.click($('togCaptions'));
    expect(desk.get().captionsOn).toBe(true);
    expect(updateTransport).toHaveBeenCalled();
  });

  it('Compare asks the engine and is disabled without versions', async () => {
    loadVideo();
    render(<Monitor />);
    await userEvent.click($('togCompare'));
    expect(setCompare).toHaveBeenCalledWith(true);
    act(() => {
      loadVideo({ versions: [] });
    });
    expect($('togCompare')).toBeDisabled();
  });
});

describe('stage overlays', () => {
  it('paints the live frame, badge and warm-up on the Live pane', async () => {
    render(<Monitor />);
    act(() =>
      desk.set({
        monitorMode: 'live',
        live: { ...initialLive, src: '/media/demo/live-preview.jpg?t=1', url: '/media/demo/live-preview.jpg', recording: true, warming: true, badge: 'Live', tab: true, onAir: true },
      }),
    );
    expect($('livePreview')).not.toHaveAttribute('hidden');
    expect($('livePreview')).toHaveAttribute('src', '/media/demo/live-preview.jpg?t=1');
    expect($('livePreview')).toHaveClass('is-warming');
    expect($('liveBadge')).not.toHaveAttribute('hidden');
    expect($('liveBadge')).toHaveClass('is-live');
    expect($('liveBadgeText')).toHaveTextContent('Live');
    expect($('liveWarmup')).not.toHaveAttribute('hidden');
    await waitFor(() => expect($('liveWarmup')).toHaveClass('is-on'));
    expect($('player')).toHaveClass('is-live-covered');
    expect($('captionOverlay')).toHaveAttribute('hidden');
  });

  it('shows the sign-in wait and continues the job', async () => {
    let posted = '';
    server.use(
      http.post('/api/video/:slug/sign-in-continue', ({ params }) => {
        posted = String(params['slug']);
        return HttpResponse.json({ ok: true });
      }),
    );
    desk.set({ slug: 'demo' });
    render(<Monitor />);
    expect($('signInWait')).toHaveAttribute('hidden');
    act(() => desk.set({ signInWait: { title: 'Sign in to Acme', next: 'Then press Continue' } }));
    expect($('signInWait')).not.toHaveAttribute('hidden');
    expect($('signInWaitTitle')).toHaveTextContent('Sign in to Acme');
    expect($('signInWaitNext')).toHaveTextContent('Then press Continue');
    await userEvent.click($('signInContinue'));
    await waitFor(() => expect(paintSignInWait).toHaveBeenCalledWith(null));
    expect(posted).toBe('demo');
  });

  it('toasts when continuing sign-in fails', async () => {
    server.use(http.post('/api/video/:slug/sign-in-continue', () => HttpResponse.json({ error: 'No job waiting' }, { status: 409 })));
    desk.set({ slug: 'demo', signInWait: { title: 'Wait', next: '' } });
    render(<Monitor />);
    await userEvent.click($('signInContinue'));
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Could not continue', detail: 'No job waiting', kind: 'err' }));
  });

  it('paints a record failure, dismisses it, and hands it to the agent', async () => {
    const startImprove = vi.fn();
    bridges.feedback = { startImprove } as unknown as FeedbackBridge;
    loadVideo({
      recordFailure: {
        reason: 'net::ERR_CONNECTION_REFUSED at http://localhost:3000',
        url: '',
        next: '',
        technical: '',
        message: '',
        screenshot: '/media/demo/error.png',
      },
    });
    render(<Monitor />);
    expect($('recordFailure')).not.toHaveAttribute('hidden');
    expect($('recordFailureShot')).toHaveAttribute('src', '/media/demo/error.png');
    expect($('recordFailureReason')).toHaveTextContent('The browser could not open the start URL.');
    expect($('recordFailureUrl')).toHaveTextContent('http://localhost:3000');
    expect($('recordFailureNext')).toHaveTextContent('Start the app, confirm the URL, then re-record.');

    await userEvent.click($('recordFailureFix'));
    expect(desk.get().improve.note).toBe('net::ERR_CONNECTION_REFUSED at http://localhost:3000');
    expect(desk.get().rightTab).toBe('feedback');
    expect(startImprove).toHaveBeenCalledWith('full');

    await userEvent.click($('recordFailureDismiss'));
    expect($('recordFailure')).toHaveAttribute('hidden');
    expect(desk.get().recordFailureDismissed).toBe('demo|/media/demo/error.png|The browser could not open the start URL.');
  });

  it('paints the pipeline overlay and its actions', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<Monitor />);
    act(() =>
      desk.set({ programBuild: { show: true, tone: 'fail', title: 'Render failed', detail: 'Produce · exit 1', screenshot: '/media/demo/error.png', log: 'activity' } }),
    );
    expect($('programBuild')).not.toHaveAttribute('hidden');
    expect($('programBuild')).toHaveClass('program-build', 'is-fail');
    expect($('programBuildTitle')).toHaveTextContent('Render failed');
    expect($('programBuildDetail')).toHaveTextContent('Produce · exit 1');
    await userEvent.click($('programBuildShot'));
    expect(open).toHaveBeenCalledWith('/media/demo/error.png', '_blank');
    desk.set({ leftTab: 'deliver' });
    await userEvent.click($('programBuildLog'));
    expect(desk.get().leftTab).toBe('render');
    act(() => desk.set({ programBuild: null }));
    expect($('programBuild')).toHaveAttribute('hidden');
    expect($('programBuildTitle')).toHaveTextContent('Render failed');
    open.mockRestore();
  });

  it('closes the pipeline overlay from its close button', async () => {
    render(<Monitor />);
    act(() =>
      desk.set({ programBuild: { show: true, tone: 'fail', title: 'record failed (exit 1)', detail: 'Record walkthrough', log: 'activity' } }),
    );
    await userEvent.click($('programBuildClose'));
    expect(desk.get().programBuild).toBeNull();
    expect($('programBuild')).toHaveAttribute('hidden');
  });
});

describe('players and Program overlays', () => {
  it('hides the player and shows the empty state when the sequence has no master', () => {
    loadVideo({ freshness: { liveAt: null, deliveryAt: null }, hasDelivery: false });
    render(<Monitor />);
    expect($('player')).toHaveClass('hidden');
    expect($('noVideo')).toHaveClass('show');
    expect($('noVideo')).toHaveAttribute('data-tone', 'ready');
    expect($('noVideoKicker')).toHaveTextContent('Ready to render');
    expect($('noVideoTitle')).toHaveTextContent('Render your first sequence');
    expect($('btnNoVideoPrimary')).toHaveAttribute('data-mode', 'full');
    expect($('btnNoVideoSecondary')).toHaveAttribute('hidden');
    act(() => desk.set({ programLoaded: true }));
    expect($('player')).not.toHaveClass('hidden');
    expect($('noVideo')).not.toHaveClass('show');
  });

  it('the empty-state CTAs request a make in their mode and show busy', async () => {
    loadVideo({ freshness: { stale: true } });
    render(<Monitor />);
    expect($('btnNoVideoSecondary')).not.toHaveAttribute('hidden');
    expect(document.querySelector('[data-icon="empty-stale"]')).not.toHaveAttribute('hidden');
    expect(document.querySelector('[data-icon="empty-play"]')).toHaveAttribute('hidden');
    await userEvent.click($('btnNoVideoSecondary'));
    expect(requestMake).toHaveBeenCalledWith('full');
    act(() => desk.set({ busy: { btnNoVideoPrimary: true } }));
    expect($('btnNoVideoPrimary')).not.toBeDisabled();
    expect($('btnNoVideoPrimary')).toHaveClass('is-stop');
    expect($('btnNoVideoPrimary')?.querySelector('.cta-label')).toHaveTextContent('Stop');
  });

  it('shows the cue under the playhead when CC is on', () => {
    desk.set({ cues: [{ start: 1, end: 3, text: 'Hello there' }] });
    render(<Monitor />);
    act(() => desk.set({ captionsOn: true, transport: { t: 2, d: 10, playing: true, buffered: 0 } }));
    expect($('captionOverlay')).toHaveClass('on');
    expect($('captionOverlay')).toHaveTextContent('Hello there');
    act(() => desk.set({ transport: { t: 5, d: 10, playing: true, buffered: 0 } }));
    expect($('captionOverlay')).not.toHaveClass('on');
    expect($('captionOverlay')).toHaveTextContent('Hello there');
  });

  it('flashes the chapter toast', () => {
    render(<Monitor />);
    act(() => desk.set({ chapterToast: { title: 'Start from a URL', on: true } }));
    expect($('chapterToast')).toHaveClass('chapter-toast', 'on');
    expect($('chapterToast')).toHaveTextContent('Start from a URL');
  });

  it('feeds metadata into the duration and the transport', () => {
    render(<Monitor />);
    Object.defineProperty($('player'), 'duration', { configurable: true, value: 42 });
    fireEvent.loadedMetadata($('player'));
    expect(desk.get().duration).toBe(42);
    expect(updateTransport).toHaveBeenCalled();
    fireEvent.timeUpdate($('playerA'));
    fireEvent.ended($('playerB'));
    expect(updateTransport).toHaveBeenCalledTimes(3);
  });

  it('lists versions to compare against and syncs on change', async () => {
    loadVideo({ versions: [makeVersion({ id: 'v1', displayName: 'v1 · First' }), makeVersion({ id: 'v2', displayName: 'v2 · Mix', kind: 'checkpoint' })] });
    desk.set({ compareId: 'v1' });
    render(<Monitor />);
    const select = $('compareSelect') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['v1 · First', 'v2 · Mix · checkpoint']);
    await userEvent.selectOptions(select, 'v2');
    expect(desk.get().compareId).toBe('v2');
    expect(syncCompare).toHaveBeenCalled();
  });

  it('shows "No version" in compare without a snapshot', () => {
    loadVideo({ versions: [] });
    render(<Monitor />);
    expect($('compareSelect')).toHaveTextContent('No versions');
    act(() => desk.set({ compare: true, monitorMode: 'compare', compareId: '' }));
    expect($('compareEmpty')).not.toHaveAttribute('hidden');
    expect($('playerB')).toHaveAttribute('hidden');
  });
});

describe('transport', () => {
  it('Play starts the active player, and pauses it when playing', async () => {
    render(<Monitor />);
    const player = $('player') as HTMLVideoElement;
    await userEvent.click($('btnPlay'));
    expect(startPlayback).toHaveBeenCalledWith(player);
    Object.defineProperty(player, 'paused', { configurable: true, value: false });
    const pause = vi.spyOn(player, 'pause').mockImplementation(() => {});
    await userEvent.click($('btnPlay'));
    expect(pause).toHaveBeenCalled();
    expect(updateTransport).toHaveBeenCalled();
  });

  it('Play restores the master when a plate preview is loaded', async () => {
    loadVideo();
    desk.set({ previewingPlate: '/media/demo/plate.mp4' });
    render(<Monitor />);
    $('player').setAttribute('src', '/media/demo/plate.mp4?t=1');
    await userEvent.click($('btnPlay'));
    expect(ensureProgramMaster).toHaveBeenCalledWith({ play: true, preserveTime: false });
    expect(startPlayback).not.toHaveBeenCalled();
  });

  it('marks Play as playing from the transport state', () => {
    render(<Monitor />);
    act(() => desk.set({ transport: { t: 1, d: 10, playing: true, buffered: 0 } }));
    expect($('btnPlay')).toHaveClass('play-btn', 'is-playing');
  });

  it('skips ±5 s, and refuses in the Editor', async () => {
    render(<Monitor />);
    Object.defineProperty($('player'), 'currentTime', { configurable: true, value: 12, writable: true });
    await userEvent.click($('btnSkipBack'));
    expect(seekTo).toHaveBeenLastCalledWith(7);
    await userEvent.click($('btnSkipFwd'));
    expect(seekTo).toHaveBeenLastCalledWith(17);
    act(() => desk.set({ monitorMode: 'plate' }));
    await userEvent.click($('btnSkipFwd'));
    expect(seekTo).toHaveBeenCalledTimes(2);
    expect(lastToast()).toMatchObject({ title: 'Timeline locked', detail: 'Exit to Program to scrub' });
  });

  it('sets the rate on every player', async () => {
    render(<Monitor />);
    await userEvent.selectOptions($('rateSelect'), '1.5');
    for (const id of ['player', 'playerA', 'playerB']) expect(($(id) as HTMLVideoElement).playbackRate).toBe(1.5);
  });

  it('mutes the active player', async () => {
    render(<Monitor />);
    await userEvent.click($('btnMute'));
    expect(($('player') as HTMLVideoElement).muted).toBe(true);
    expect($('btnMute')).toHaveClass('is-muted');
    expect($('btnMute')).toHaveAttribute('aria-label', 'Unmute');
    expect($('btnMute')).toHaveAttribute('title', 'Unmute');
  });

  it('warns when fullscreen is unavailable', async () => {
    render(<Monitor />);
    $('stage').requestFullscreen = () => Promise.reject(new Error('denied'));
    await userEvent.click($('btnFs'));
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Fullscreen unavailable', kind: 'warn' }));
  });
});

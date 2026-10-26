import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { server } from '@/test/msw/server';

import { askTake, resetBayCards, useBayCards } from './bayCards';
import { TakeChoiceCard } from './TakeChoiceCard';
import type { GuidedTour } from '@/logic/takeChoice';

const host = () => document.getElementById('bayTake') as HTMLElement;
const take = { url: '/media/demo/take.mp4', poster: '/media/demo/take.jpg', seconds: 72, chapters: [{ t: 0, title: 'Open' }, { t: 31, title: 'Plan' }], cuts: 1, cutSec: 4.2 };

function open(tour: GuidedTour | null) {
  act(() => useBayCards.setState({ take: { slug: 'demo', tour } }));
}

let pause: ReturnType<typeof vi.fn>;
let play: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pause = vi.fn();
  play = vi.fn(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
});
afterEach(() => {
  cleanup();
  resetBayCards();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('TakeChoiceCard', () => {
  it('is hidden until asked', () => {
    render(<TakeChoiceCard />);
    expect(host()).toHaveClass('take-choice');
    expect(host()).toHaveAttribute('aria-label', 'Choose your take');
    expect(host().hidden).toBe(true);
  });

  it('offers the recording, preferring it, with seekable chapters', () => {
    render(<TakeChoiceCard />);
    open({ steps: 5, take });
    expect(host().hidden).toBe(false);
    expect(host().querySelector('.take-choice-head strong')).toHaveTextContent('Your recording is ready');
    const video = host().querySelector('video') as HTMLVideoElement;
    expect(video).toHaveAttribute('src', take.url);
    expect(video).toHaveAttribute('poster', take.poster);
    expect(host().querySelector('.take-choice-facts b')).toHaveTextContent('1:12 · 2 chapters · 5 steps · 1 pause cut (4s)');
    const own = host().querySelector('[data-take-choice="own"]') as HTMLButtonElement;
    expect(own).toHaveClass('take-opt', 'take-opt--own', 'is-preferred');
    expect(document.activeElement).toBe(own);
    expect(own.querySelector('.take-opt-tag')).toHaveTextContent('Your take');
    expect(host().querySelector('[data-take-choice="bot"] .take-opt-tag')).toBeNull();
    fireEvent.click(host().querySelector('[data-take-seek="31"]') as HTMLElement);
    expect(video.currentTime).toBe(31);
    expect(play).toHaveBeenCalled();
  });

  it('suggests the bot when there is no recording, and disables it without steps', () => {
    render(<TakeChoiceCard />);
    open({ steps: 2, take: null });
    expect(host().querySelector('.take-choice-head strong')).toHaveTextContent('Your steps are saved');
    expect(host().querySelector('video')).toBeNull();
    expect(host().querySelector('[data-take-choice="own"]')).toBeNull();
    expect(host().querySelector('[data-take-choice="bot"]')).toHaveClass('is-preferred');
    expect(host().querySelector('[data-take-choice="bot"] .take-opt-tag')).toHaveTextContent('Suggested');
    open({ steps: 0, take });
    const bot = host().querySelector('[data-take-choice="bot"]') as HTMLButtonElement;
    expect(bot).toBeDisabled();
    expect(bot).toHaveAttribute('aria-disabled', 'true');
    expect(bot).toHaveTextContent('Not available — no clicks or typing were captured.');
  });

  it('settles askTake with the pick and pauses the preview', async () => {
    server.use(http.get('/api/video/:slug/guide', () => HttpResponse.json({ tour: { steps: 1, take } })));
    render(<TakeChoiceCard />);
    let pending!: Promise<string>;
    act(() => {
      pending = askTake('demo');
    });
    await screen.findByRole('button', { name: /Use my recording/ });
    fireEvent.click(screen.getByRole('button', { name: 'Record again' }));
    await expect(pending).resolves.toBe('again');
    expect(host().hidden).toBe(true);
    expect(pause).toHaveBeenCalled();
  });
});

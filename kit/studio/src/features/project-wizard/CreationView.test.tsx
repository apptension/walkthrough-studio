import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import type { ExploreFeed } from '@/api/types';
import { makeJob, makeScript, makeScriptScene } from '@/test/factories';
import { endpoints } from '@/test/msw/endpoints';
import { server } from '@/test/msw/server';

import { creation } from './creation';
import { creationFeed } from './creationFeed';
import { CreationView } from './CreationView';
import { useWizard } from './wizard';

const FEED: ExploreFeed = {
  startedAt: '2026-10-24T08:17:00.000Z',
  signedIn: false,
  current: 'S2',
  screens: [
    { id: 'S1', label: 'Home', title: 'Home | Acme', url: 'https://acme.test/', path: '/', dialog: null, heading: 'Plan your team', reachedBy: null, controls: 9, tried: 1, shot: '/media/demo/browse/shots/001-S1.jpg' },
    {
      id: 'S2',
      label: 'Scheduling',
      title: 'Scheduling | Acme',
      url: 'https://acme.test/scheduling',
      path: '/scheduling',
      dialog: null,
      heading: '',
      reachedBy: { from: 'S1', action: 'click', label: 'Features' },
      controls: 4,
      tried: 0,
      shot: '/media/demo/browse/shots/002-S2.jpg',
    },
  ],
  moves: [{ at: null, from: 'S1', action: 'click', label: 'Features' }],
  notes: [{ screen: 'S2', text: 'Strongest product promise' }],
  shots: 2,
  preview: null,
};

const running = () =>
  makeJob({
    kind: 'improve',
    stream: {
      entries: [
        { kind: 'think', text: 'The resource scheduling page looks strong.' },
        { kind: 'tool', id: 1, title: 'Shell', text: 'cli.mjs browse demo click 2', done: true },
      ],
    },
  });

function boot() {
  act(() => {
    creation.start();
    creation.subject('Acme in ninety seconds');
    creation.brand('demo', { name: 'Acme', logo: 'logo.html', font: 'Inter', colors: { ink: '#0a0a0a', surface: '#141414', gold: '#ffcc00' } });
    creationFeed.bind('demo', 'acme');
  });
}

afterEach(() => {
  act(() => {
    creation.reset();
    creationFeed.reset();
    useWizard.setState({ streamJob: null });
  });
});

describe('CreationView', () => {
  it('reveals the brand once the foundation is verified', () => {
    boot();
    act(() => creation.stage('brand', 'Reusing the acme brand pack'));
    render(<CreationView />);
    const view = document.getElementById('wizardCreation');
    expect(view?.dataset.ctStage).toBe('brand');
    expect(view?.classList.contains('is-branded')).toBe(true);
    expect(view?.style.getPropertyValue('--ct-accent')).toBe('#ffcc00');
    expect(screen.getByText('Acme in ninety seconds')).toBeTruthy();
    expect(within(screen.getByLabelText('Brand palette')).getByText('#ffcc00')).toBeTruthy();
    expect(screen.getAllByAltText('Acme lockup')[0]?.getAttribute('src')).toMatch(/^\/api\/video\/demo\/brand-lockup\?t=/);
  });

  it('shows the screens the explore agent reaches, its thoughts and moves', async () => {
    server.use(http.get(endpoints.exploreFeed('demo'), () => HttpResponse.json(FEED)));
    boot();
    act(() => {
      creation.stage('analyze', 'Exploring');
      useWizard.setState({ streamJob: running() });
    });
    render(<CreationView />);
    await screen.findByAltText('Screen S2: Scheduling');
    expect(screen.getByText('Strongest product promise')).toBeTruthy();
    expect(screen.getByText('via “Features”')).toBeTruthy();
    expect(screen.getByLabelText('The resource scheduling page looks strong.')).toBeTruthy();
    expect(within(screen.getByLabelText('What the agent is doing')).getByText('Clicked')).toBeTruthy();

    const film = screen.getByLabelText('Screens reached');
    fireEvent.click(within(film).getByTitle('Home | Acme'));
    expect(screen.getByAltText('Screen S1: Home')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Follow live' }));
    expect(screen.getByAltText('Screen S2: Scheduling')).toBeTruthy();
  });

  it('builds the storyboard while the script is written, then shows it as the result', async () => {
    server.use(
      http.get(endpoints.exploreFeed('demo'), () => HttpResponse.json(FEED)),
      http.get('/api/video/demo/script', () =>
        HttpResponse.json(
          makeScript({
            script: {
              scenes: [
                makeScriptScene({ kind: 'open', key: 'open', title: 'Plan your team' }),
                makeScriptScene({ key: 'c1', title: 'Scheduling made simple' }),
                makeScriptScene({ kind: 'plate', key: 'p1', title: '3× faster', plateType: 'stat' }),
              ],
            },
          }),
        ),
      ),
    );
    boot();
    act(() => {
      creation.stage('draft', 'Writing');
      useWizard.setState({ streamJob: running() });
    });
    render(<CreationView />);
    const board = await screen.findByLabelText('Storyboard');
    await waitFor(() => expect(within(board).getByText('Scheduling made simple')).toBeTruthy());
    expect(within(board).getByText('Chapter 1')).toBeTruthy();
    expect(board.querySelectorAll('.ct-card.is-ghost')).toHaveLength(1);

    act(() => {
      creation.stage('ready', 'Approve');
      creation.script(makeScript().script, { brandName: 'Acme' });
    });
    expect(document.querySelector('.ct-main')).toBeNull();
    const result = document.getElementById('wizardScriptScenes');
    expect(result?.classList.contains('ct-board')).toBe(true);
    expect(result?.querySelectorAll('.ct-card.is-ghost')).toHaveLength(0);
  });

  it('keeps the raw agent log folded away', () => {
    boot();
    render(<CreationView />);
    const log = document.querySelector('details.ct-log');
    expect(log?.hasAttribute('open')).toBe(false);
    expect(log?.querySelector('#wizardStream')).toBeTruthy();
  });
});

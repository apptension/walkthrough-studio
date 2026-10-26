import { describe, expect, it } from 'vitest';

import type { AgentRunner } from '@/api/types';
import { makeVideo } from '@/test/factories';

import { agentButtonView, agentTip, type AgentAuthView } from './agentView';
import { optionLabel, slugGroups } from '@/logic/slugOptions';

const runner = (over: Partial<AgentRunner> = {}): AgentRunner => ({
  provider: 'cursor',
  label: 'Cursor agent',
  bin: '/bin/agent',
  available: true,
  authenticated: true,
  via: 'agent-login',
  soft: false,
  message: 'Logged in via agent login',
  ...over,
});

describe('optionLabel', () => {
  it('names setup errors, branches and plain videos', () => {
    expect(optionLabel({ slug: 'broken', title: 'broken', error: 'No brand pack' })).toBe('broken (needs setup)');
    expect(optionLabel(makeVideo({ slug: 'b', title: 'Desk home', lineage: { role: 'branch' } }))).toBe('  ↳ Desk home');
    expect(optionLabel(makeVideo({ slug: 'demo', title: '' }))).toBe('demo');
  });

  it('treats the `error: null` the server sends on healthy videos as no error', () => {
    const v = { ...makeVideo({ slug: 'ok', title: 'Fine' }), error: null };
    expect(optionLabel(v as unknown as Parameters<typeof optionLabel>[0])).toBe('Fine');
  });
});

describe('slugGroups', () => {
  const a = makeVideo({ slug: 'a', title: 'A' });
  const b = makeVideo({ slug: 'b', title: 'B' });

  it('puts every video under "Videos" when there are no folders', () => {
    expect(slugGroups({ videos: [a, b], folders: [], loose: [] })).toEqual([
      { label: 'Videos', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
    ]);
  });

  it('groups folders first, then the loose videos as "Other videos"', () => {
    const groups = slugGroups({
      videos: [a, b],
      folders: [
        { id: 'f1', title: 'Teamdeck', slugs: ['a'], videos: [a] },
        { id: 'f2', title: '', slugs: [], videos: [] },
      ],
      loose: [b],
    });
    expect(groups).toEqual([
      { label: 'Teamdeck', options: [{ value: 'a', label: 'A' }] },
      { label: 'Other videos', options: [{ value: 'b', label: 'B' }] },
    ]);
  });

  it('is empty when there is nothing to pick', () => {
    expect(slugGroups({ videos: [], folders: [], loose: [] })).toEqual([]);
  });
});

describe('agent chrome', () => {
  const auth: AgentAuthView = {
    provider: 'cursor',
    preference: 'cursor',
    switchable: true,
    runners: {
      cursor: runner(),
      claude: runner({ provider: 'claude', label: 'Claude Code', authenticated: false, via: null, message: '' }),
    },
  };

  it('describes each runner in plain next steps', () => {
    expect(agentTip(auth, 'cursor')).toBe('Cursor · in use\nReady\nSigned in via Cursor login');
    expect(agentTip(auth, 'claude')).toBe(
      'Claude Code\nNeeds sign-in before Improve can run\nIn a terminal run: claude /login\nOr add ANTHROPIC_API_KEY to kit/.env',
    );
    expect(agentTip({}, 'cursor')).toBe('Cursor\nNot installed\nInstall the Cursor CLI, then run: agent login');
    expect(agentTip({ ...auth, provider: 'claude', preference: 'claude' }, 'cursor')).toBe(
      'Cursor\nReady\nClick to use this agent for Improve',
    );
    expect(agentTip({ ...auth, provider: 'claude', switchable: false }, 'cursor')).toBe(
      'Cursor\nReady\nClick to use for Improve\nThe other agent isn’t available',
    );
    expect(agentTip({ runners: { cursor: runner({ soft: true, message: '' }) } }, 'cursor')).toBe(
      'Cursor\nSigned in, but not verified yet\nRun agent login again, then retry Improve',
    );
  });

  it('paints state, live and labels like renderAgentChrome', () => {
    expect(agentButtonView(auth, 'cursor')).toMatchObject({
      state: 'ready',
      live: true,
      pressed: true,
      available: true,
      ariaLabel: 'Cursor, in use, ready',
    });
    expect(agentButtonView(auth, 'claude')).toMatchObject({
      state: 'needs-auth',
      live: false,
      pressed: false,
      ariaLabel: 'Claude Code, needs sign-in',
    });
    expect(agentButtonView({}, 'claude')).toMatchObject({
      state: 'missing',
      available: false,
      ariaLabel: 'Claude Code, not installed',
    });
    expect(agentButtonView({ provider: null, preference: 'auto', runners: auth.runners }, 'cursor').pressed).toBe(false);
  });
});

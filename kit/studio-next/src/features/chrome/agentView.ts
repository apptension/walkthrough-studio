import type { AgentAuth, AgentRunner } from '@/api/types';

export type AgentId = 'cursor' | 'claude';
export type AgentState = 'ready' | 'needs-auth' | 'missing';

/** What the header reads from `agentAuth`; every field is optional so `{}` paints "not installed". */
export type AgentAuthView = Partial<Omit<AgentAuth, 'runners' | 'preference'>> & {
  /** `auto` lets the server pick a runner. */
  preference?: string | null;
  runners?: Partial<Record<string, Partial<AgentRunner>>>;
};

/** `agentTip(auth, id)` — the three-line setup / status tip under a runner logo. */
export function agentTip(auth: AgentAuthView, id: AgentId): string {
  const runner = auth.runners?.[id];
  const label = runner?.label || (id === 'claude' ? 'Claude Code' : 'Cursor agent');
  const active = (auth.provider || auth.preference) === id;
  if (!runner?.available) {
    return `${label}\nNot installed\n${
      runner?.message ||
      (id === 'claude' ? 'Install from claude.ai/code, then run claude → /login.' : 'Install Cursor CLI, then run agent login.')
    }`;
  }
  if (!runner.authenticated) {
    return `${label}${active ? ' · selected' : ''}\nNeeds sign-in\n${
      runner.message ||
      (id === 'claude' ? 'Run claude → /login, or set ANTHROPIC_API_KEY in kit/.env.' : 'Run agent login, or set CURSOR_API_KEY in kit/.env.')
    }`;
  }
  if (runner.soft) {
    return `${label}${active ? ' · selected' : ''}\nSigned in (unverified)\n${runner.message || 'Retry Improve after agent login refreshes.'}`;
  }
  if (active) {
    return `${label}\nActive · ready for Improve${runner.via ? `\nvia ${runner.via}` : ''}`;
  }
  return `${label}\nReady — click to use for Improve${auth.switchable ? '' : '\n(other runner unavailable)'}`;
}

export interface AgentButtonView {
  state: AgentState;
  live: boolean;
  pressed: boolean;
  available: boolean;
  tip: string;
  ariaLabel: string;
}

/** One runner logo as `renderAgentChrome(auth)` paints it. */
export function agentButtonView(auth: AgentAuthView, id: AgentId): AgentButtonView {
  const active = auth.provider || (auth.preference !== 'auto' ? auth.preference : null);
  const runner = auth.runners?.[id];
  const isActive = Boolean(active && active === id);
  const available = Boolean(runner?.available);
  const ready = available && Boolean(runner?.authenticated) && !runner?.soft;
  const state: AgentState = ready ? 'ready' : available ? 'needs-auth' : 'missing';
  return {
    state,
    live: isActive && state !== 'missing',
    pressed: isActive,
    available,
    tip: agentTip(auth, id),
    ariaLabel: `${runner?.label || id}${isActive ? ', active' : ''}${
      state === 'ready' ? ', ready' : state === 'needs-auth' ? ', needs sign-in' : ', not installed'
    }`,
  };
}

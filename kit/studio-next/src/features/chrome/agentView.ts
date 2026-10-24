import type { AgentAuth, AgentRunner } from '@/api/types';

export type AgentId = 'cursor' | 'claude';
export type AgentState = 'ready' | 'needs-auth' | 'missing';

/** What the header reads from `agentAuth`; every field is optional so `{}` paints "not installed". */
export type AgentAuthView = Partial<Omit<AgentAuth, 'runners' | 'preference'>> & {
  /** `auto` lets the server pick a runner. */
  preference?: string | null;
  runners?: Partial<Record<string, Partial<AgentRunner>>>;
};

export interface AgentTipView {
  /** Agent name, with “in use” when selected. */
  title: string;
  /** One-line state a person can act on. */
  status: string;
  /** Concrete next step(s). */
  detail: string;
}

function agentLabel(_auth: AgentAuthView, id: AgentId): string {
  // Stable product names in the tip — server labels vary ("Cursor agent", etc.).
  return id === 'claude' ? 'Claude Code' : 'Cursor';
}

function signInDetail(id: AgentId): string {
  return id === 'claude'
    ? 'In a terminal run: claude /login\nOr add ANTHROPIC_API_KEY to kit/.env'
    : 'In a terminal run: agent login\nOr add CURSOR_API_KEY to kit/.env';
}

function installDetail(id: AgentId): string {
  return id === 'claude'
    ? 'Install from claude.ai/code, then run: claude /login'
    : 'Install the Cursor CLI, then run: agent login';
}

function prettyVia(via: string | null | undefined): string {
  if (!via) return '';
  if (via === 'agent-login') return 'Cursor login';
  if (/api[_-]?key/i.test(via) || via === 'env') return 'API key in kit/.env';
  return via;
}

/** Structured tip under a runner logo — title, status, what to do next. */
export function agentTipView(auth: AgentAuthView, id: AgentId): AgentTipView {
  const runner = auth.runners?.[id];
  const label = agentLabel(auth, id);
  const active = (auth.provider || auth.preference) === id;
  const title = active ? `${label} · in use` : label;

  if (!runner?.available) {
    return {
      title,
      status: 'Not installed',
      detail: installDetail(id),
    };
  }
  if (!runner.authenticated) {
    return {
      title,
      status: 'Needs sign-in before Improve can run',
      detail: signInDetail(id),
    };
  }
  if (runner.soft) {
    return {
      title,
      status: 'Signed in, but not verified yet',
      detail: id === 'claude'
        ? 'Run claude /login again, then retry Improve'
        : 'Run agent login again, then retry Improve',
    };
  }
  if (active) {
    const via = prettyVia(runner.via);
    return {
      title,
      status: 'Ready',
      detail: via ? `Signed in via ${via}` : 'This agent will handle Improve requests',
    };
  }
  return {
    title,
    status: 'Ready',
    detail: auth.switchable === false
      ? 'Click to use for Improve\nThe other agent isn’t available'
      : 'Click to use this agent for Improve',
  };
}

/** Flat tip text (tests + `data-tip`). */
export function agentTip(auth: AgentAuthView, id: AgentId): string {
  const tip = agentTipView(auth, id);
  return [tip.title, tip.status, tip.detail].filter(Boolean).join('\n');
}

export interface AgentButtonView {
  state: AgentState;
  live: boolean;
  pressed: boolean;
  available: boolean;
  tip: string;
  tipView: AgentTipView;
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
  const tipView = agentTipView(auth, id);
  return {
    state,
    live: isActive && state !== 'missing',
    pressed: isActive,
    available,
    tip: agentTip(auth, id),
    tipView,
    ariaLabel: `${agentLabel(auth, id)}${isActive ? ', in use' : ''}${
      state === 'ready' ? ', ready' : state === 'needs-auth' ? ', needs sign-in' : ', not installed'
    }`,
  };
}

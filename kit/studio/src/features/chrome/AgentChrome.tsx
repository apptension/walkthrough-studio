import { Fragment, useCallback, useEffect, useRef, useState, type FocusEvent, type PointerEvent } from 'react';

import { useDesk } from '@/desk/store';
import { Icon } from '@/ui/icons';

import { AgentModelMenu } from './AgentModelMenu';
import { cachedModels, modelChipLabel } from './agentModels';
import { agentButtonView, type AgentAuthView, type AgentId, type AgentTipView } from './agentView';

const AGENTS: AgentId[] = ['cursor', 'claude'];

const EMPTY: AgentAuthView = {};
const EMPTY_TIP: AgentTipView = { title: '', status: '', detail: '' };

/** Leaving the host (not moving between its children) hides the tip. */
function leftHost(e: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>): boolean {
  const next = e.relatedTarget as Node | null;
  return !next || !e.currentTarget.contains(next);
}

/**
 * `#agentChrome` — the runner logos with the shared `#agentTip`. Clicking an installed runner
 * opens its model picker; picking a model there also makes that runner the active one.
 */
export function AgentChrome() {
  const auth = useDesk((s) => s.agentAuth) ?? EMPTY;
  const [tip, setTip] = useState({ ...EMPTY_TIP, shown: false, tone: '' as '' | 'ok' | 'warn' });
  const [menu, setMenu] = useState<AgentId | null>(null);
  const buttons = useRef<Partial<Record<AgentId, HTMLButtonElement | null>>>({});
  const views = AGENTS.map((id) => ({ id, view: agentButtonView(auth, id) }));
  const models = auth.models ?? {};
  const openRef = useRef<AgentId | null>(null);
  useEffect(() => {
    openRef.current = menu;
  }, [menu]);

  const showTip = (target: EventTarget) => {
    if (menu) return;
    const btn = (target as Element).closest?.<HTMLElement>('[data-agent]');
    const id = btn?.dataset['agent'] as AgentId | undefined;
    const view = views.find((v) => v.id === id)?.view;
    if (!view) return;
    const tone = view.state === 'ready' ? 'ok' : view.state === 'needs-auth' || view.state === 'missing' ? 'warn' : '';
    setTip({ ...view.tipView, shown: true, tone });
  };
  const hideTip = () => setTip((t) => (t.shown ? { ...t, shown: false } : t));

  const closeMenu = useCallback((opts?: { focusAnchor?: boolean }) => {
    const open = openRef.current;
    setMenu(null);
    if (open && opts?.focusAnchor) buttons.current[open]?.focus({ preventScroll: true });
  }, []);

  const toggle = (id: AgentId) => {
    const view = views.find((v) => v.id === id)?.view;
    if (!view?.available || view.state === 'missing') return;
    hideTip();
    setMenu((open) => (open === id ? null : id));
  };

  const open = menu ? views.find((v) => v.id === menu) : null;

  return (
    <div
      id="agentChrome"
      className="chrome-agent-host"
      role="group"
      aria-label="Agent runner"
      onPointerOver={(e) => showTip(e.target)}
      onPointerOut={(e) => {
        if (leftHost(e)) hideTip();
      }}
      onFocus={(e) => showTip(e.target)}
      onBlur={(e) => {
        if (leftHost(e)) hideTip();
      }}
    >
      {views.map(({ id, view }, i) => (
        <Fragment key={id}>
          {i > 0 ? ' ' : null}
          <button
            ref={(el) => {
              buttons.current[id] = el;
            }}
            type="button"
            className={view.live ? 'agent-logo-btn is-live' : 'agent-logo-btn'}
            data-agent={id}
            data-state={view.state}
            data-tip={view.tip}
            aria-pressed={view.pressed ? 'true' : 'false'}
            aria-disabled={!view.available ? 'true' : 'false'}
            aria-haspopup="dialog"
            aria-expanded={menu === id ? 'true' : 'false'}
            aria-label={`${view.ariaLabel}${view.pressed ? `, model ${modelChipLabel(id, models[id], cachedModels(id))}` : ''}`}
            onClick={() => toggle(id)}
          >
            <span className="agent-pulse" aria-hidden="true" />
            {' '}
            <span data-icon={`agent-${id}`} data-size="15" data-icon-class="agent-logo">
              <Icon name={`agent-${id}`} size={15} className="agent-logo" />
            </span>
            {view.live ? (
              <span className="agent-model-chip" data-agent-model={id}>
                {modelChipLabel(id, models[id], cachedModels(id))}
                <Icon name="chevron" size={10} className="agent-model-caret" />
              </span>
            ) : null}
          </button>
        </Fragment>
      ))}
      <div
        id="agentTip"
        className={`agent-tip${tip.tone === 'ok' ? ' is-ok' : tip.tone === 'warn' ? ' is-warn' : ''}`}
        role="tooltip"
        hidden={!tip.shown}
      >
        {tip.title ? <strong className="agent-tip-title">{tip.title}</strong> : null}
        {tip.status ? <span className="agent-tip-status">{tip.status}</span> : null}
        {tip.detail
          ? tip.detail.split('\n').map((line) => (
              <span key={line} className="agent-tip-detail">
                {line}
              </span>
            ))
          : null}
      </div>
      {open ? (
        <AgentModelMenu
          key={open.id}
          provider={open.id}
          view={open.view}
          active={open.view.pressed}
          current={models[open.id] ?? null}
          anchor={buttons.current[open.id] ?? null}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}

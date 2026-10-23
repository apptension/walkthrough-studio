import { Fragment, useState, type FocusEvent, type PointerEvent } from 'react';

import { chooseAgent } from '@/desk/boot';
import { useDesk } from '@/desk/store';
import { Icon } from '@/ui/icons';

import { agentButtonView, type AgentAuthView, type AgentId } from './agentView';

const AGENTS: AgentId[] = ['cursor', 'claude'];

const EMPTY: AgentAuthView = {};

/** Leaving the host (not moving between its children) hides the tip. */
function leftHost(e: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>): boolean {
  const next = e.relatedTarget as Node | null;
  return !next || !e.currentTarget.contains(next);
}

/**
 * `#agentChrome` — the runner logos: `renderAgentChrome`, the shared
 * `#agentTip` (`showAgentTip` / `hideAgentTip`) and the switch from `wireAgentSwitch`.
 */
export function AgentChrome() {
  const auth = useDesk((s) => s.agentAuth) ?? EMPTY;
  const [tip, setTip] = useState({ text: '', shown: false });
  const [switching, setSwitching] = useState(false);
  const views = AGENTS.map((id) => ({ id, view: agentButtonView(auth, id) }));

  const showTip = (target: EventTarget) => {
    const btn = (target as Element).closest?.<HTMLElement>('[data-agent]');
    const text = btn?.dataset['tip'];
    if (text) setTip({ text, shown: true });
  };
  const hideTip = () => setTip((t) => (t.shown ? { ...t, shown: false } : t));

  const choose = async (id: AgentId) => {
    const view = views.find((v) => v.id === id)?.view;
    if (!view || switching || !view.available || view.pressed || view.state === 'missing') return;
    setSwitching(true);
    try {
      await chooseAgent(id);
    } finally {
      setSwitching(false);
      hideTip();
    }
  };

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
            type="button"
            className={view.live ? 'agent-logo-btn is-live' : 'agent-logo-btn'}
            data-agent={id}
            data-state={view.state}
            data-tip={view.tip}
            aria-pressed={view.pressed ? 'true' : 'false'}
            aria-disabled={switching || !view.available ? 'true' : 'false'}
            aria-label={view.ariaLabel}
            onClick={() => void choose(id)}
          >
            <span className="agent-pulse" aria-hidden="true" />
            {' '}
            <span data-icon={`agent-${id}`} data-size="15" data-icon-class="agent-logo">
              <Icon name={`agent-${id}`} size={15} className="agent-logo" />
            </span>
          </button>
        </Fragment>
      ))}
      <div id="agentTip" className="agent-tip" role="tooltip" hidden={!tip.shown}>
        {tip.text}
      </div>
    </div>
  );
}

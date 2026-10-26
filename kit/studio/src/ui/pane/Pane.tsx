import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { HelpTip } from '@/ui/HelpTip';
import { Icon } from '@/ui/icons';

import { panePaneId, paneTabId } from './ids';

/**
 * The slide inspector's face as React: a sticky chrome (head + tabs), panes, `ins-sec`
 * sections. The engine draws the same classes as strings; both read `slide-inspector.css`.
 */

export function PaneChrome({ children }: { children: ReactNode }) {
  return <div className="sl-chrome">{children}</div>;
}

export interface PaneHeadProps {
  /** An icon name, or a node (a brand mark). */
  icon: ReactNode;
  kind: string;
  title: string;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function PaneHead({ icon, kind, title, actions, meta, className, style }: PaneHeadProps) {
  return (
    <div className={cn('sl-head', className)} style={style}>
      <div className="sl-head-row">
        <span className="sl-ico" aria-hidden="true">
          {typeof icon === 'string' ? <Icon name={icon} size={16} /> : icon}
        </span>
        <div className="sl-title">
          <span className="sl-kind">{kind}</span>
          <strong title={title}>{title}</strong>
        </div>
        {actions ? <div className="sl-acts">{actions}</div> : null}
      </div>
      {meta ? <div className="sl-meta">{meta}</div> : null}
    </div>
  );
}

export interface PaneTab<T extends string> {
  id: T;
  label: string;
  icon: string;
  title?: string;
  /** A small dot on the tab: something in it wants attention. */
  dot?: 'warn' | 'ok' | null;
}


/** A tablist with roving focus: arrows, Home and End move and select. */
export function PaneTabs<T extends string>({
  tabs,
  active,
  onSelect,
  label,
  base,
}: {
  tabs: ReadonlyArray<PaneTab<T>>;
  active: T;
  onSelect: (id: T) => void;
  label: string;
  base: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((t) => t.id === active);
    const next =
      e.key === 'ArrowRight' ? (at + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? tabs.length - 1
      : -1;
    const tab = tabs[next];
    if (!tab) return;
    e.preventDefault();
    onSelect(tab.id);
    refs.current[next]?.focus();
  };
  return (
    <div className="sl-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t, i) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={paneTabId(base, t.id)}
            aria-controls={panePaneId(base, t.id)}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            className={cn('sl-tab', on && 'on')}
            data-tab={t.id}
            title={t.title}
            onClick={() => onSelect(t.id)}
          >
            <Icon name={t.icon} size={13} />
            <span>{t.label}</span>
            {t.dot ? <i className="sl-tab-dot" data-tone={t.dot} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** One tab's body. Every pane stays mounted so ids and drafts survive a tab switch. */
export function PaneBody({ base, id, active, children }: { base: string; id: string; active: boolean; children: ReactNode }) {
  return (
    <div
      className="sl-pane"
      role="tabpanel"
      id={panePaneId(base, id)}
      aria-labelledby={paneTabId(base, id)}
      data-pane={id}
      hidden={!active}
    >
      {children}
    </div>
  );
}

export interface PaneSectionProps {
  icon: string;
  title: string;
  help?: string;
  /** Right side of the header: a value, a link, a badge. */
  extra?: ReactNode;
  id?: string;
  className?: string;
  hidden?: boolean;
  children: ReactNode;
}

/** `section(icon, title, body, extra)` from the engine's inspector. */
export function PaneSection({ icon, title, help, extra, id, className, hidden, children }: PaneSectionProps) {
  return (
    <section className={cn('ins-sec', className)} id={id} hidden={hidden} aria-label={title}>
      <header>
        <Icon name={icon} size={13} />
        <strong>{title}</strong>
        {help ? <HelpTip text={help} label={title} /> : null}
        {extra}
      </header>
      <div className="ins-body">{children}</div>
    </section>
  );
}

/** A labelled group inside a section (`.lk-sub`), with an optional control on the right. */
export function PaneSub({ label, aside, id, className, hidden, children }: { label: ReactNode; aside?: ReactNode; id?: string; className?: string; hidden?: boolean; children?: ReactNode }) {
  return (
    <div className={cn('lk-sub', className)} id={id} hidden={hidden}>
      <div className="lk-sub-h">
        <span>{label}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function PaneNote({ children, tone, icon, id, hidden, className }: { children: ReactNode; tone?: 'warn' | 'subtle' | undefined; icon?: string; id?: string; hidden?: boolean; className?: string }) {
  return (
    <p className={cn('ins-note', tone === 'subtle' && 'subtle', className)} id={id} hidden={hidden} data-tone={tone === 'warn' ? 'warn' : undefined}>
      {icon ? <Icon name={icon} size={13} /> : null}
      <span>{children}</span>
    </p>
  );
}

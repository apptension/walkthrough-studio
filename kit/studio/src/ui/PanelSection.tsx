import { forwardRef, useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { HelpTip } from '@/ui/HelpTip';
import { Icon, SecIcon } from '@/ui/icons';

const STORE = 'wt-studio-panel-sec';

function readOpen(id: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return fallback;
    const map = JSON.parse(raw) as Record<string, boolean>;
    return typeof map[id] === 'boolean' ? map[id] : fallback;
  } catch {
    return fallback;
  }
}

function writeOpen(id: string, open: boolean): void {
  try {
    const map = (() => {
      try {
        return JSON.parse(localStorage.getItem(STORE) || '{}') as Record<string, boolean>;
      } catch {
        return {};
      }
    })();
    map[id] = open;
    localStorage.setItem(STORE, JSON.stringify(map));
  } catch {
    /* private mode */
  }
}

export interface PanelSectionProps extends Omit<HTMLAttributes<HTMLDetailsElement>, 'title' | 'id'> {
  /** Stable storage key — open/closed is remembered per desk. */
  id: string;
  /** Optional DOM id (defaults to none; use when something scrolls to the section). */
  htmlId?: string;
  icon: string;
  title: string;
  help?: string;
  badge?: ReactNode;
  /** Extra class on the `<details>` (e.g. legacy `story-section`). */
  className?: string;
  defaultOpen?: boolean;
  /** When this flips true (e.g. QC focus), force the section open. */
  preferOpen?: boolean;
  children: ReactNode;
}

/**
 * A collapsible right-rail section: summary row with icon, title, optional help and badge,
 * hairline divider into the body. Open state is remembered in localStorage.
 */
export const PanelSection = forwardRef<HTMLDetailsElement, PanelSectionProps>(function PanelSection(
  { id, htmlId, icon, title, help, badge, className, defaultOpen = true, preferOpen, children, onToggle, ...rest },
  ref,
) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  useEffect(() => {
    if (!preferOpen) return;
    setOpen(true);
    writeOpen(id, true);
  }, [preferOpen, id]);

  const setOpenRemembered = (next: boolean) => {
    setOpen(next);
    writeOpen(id, next);
  };

  return (
    <details
      {...rest}
      ref={ref}
      id={htmlId}
      className={cn('panel-sec', className)}
      data-sec={id}
      open={open}
      onToggle={onToggle}
    >
      <summary
        className="panel-sec-head"
        onClick={(e) => {
          // Controlled <details>: own the toggle so React state and localStorage stay in sync.
          e.preventDefault();
          setOpenRemembered(!open);
        }}
      >
        <span className={cn('panel-sec-title', help && 'has-help')} data-ico={icon} data-help={help || undefined}>
          <SecIcon name={icon} />
          {title}
          {help ? <HelpTip text={help} label={title} /> : null}
        </span>
        {badge ? <span className="panel-sec-badge">{badge}</span> : null}
        <span className="panel-sec-chevron" aria-hidden="true">
          <Icon name="chevron" size={14} />
        </span>
      </summary>
      <div className="panel-sec-body">{children}</div>
    </details>
  );
});

import type { ReactNode } from 'react';

import { ZenArt } from './icons';

export interface ZenProps {
  art: string;
  title: string;
  sub?: ReactNode;
  mini?: boolean;
  className?: string;
  id?: string;
  hidden?: boolean;
  /** The action buttons a `data-zen` placeholder carried inside it. */
  children?: ReactNode;
}

/** The legacy `zen()` empty state: one quiet illustration, a big line, a small one. */
export function Zen({ art, title, sub, mini, className, id, hidden, children }: ZenProps) {
  const cls = ['zen', mini ? 'mini' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={cls} id={id} hidden={hidden} data-zen={art}>
      <ZenArt art={art} />
      <div className="zen-copy">
        <strong className="zen-title">{title}</strong>
        {sub ? <p className="zen-sub">{sub}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** `.zen-slot[data-art]` — the idle art inside an activity card. */
export function ZenSlot({ art, id, className }: { art: string; id?: string; className?: string }) {
  return (
    <div id={id} className={['zen-slot', className].filter(Boolean).join(' ')} data-art={art} aria-hidden="true">
      <ZenArt art={art} />
    </div>
  );
}

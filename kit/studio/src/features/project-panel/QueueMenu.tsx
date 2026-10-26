import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { placeQueueMenuRect, queueIconSvg, queueMenuGroups } from '@/logic/queueUx';
import { FloatingCard } from '@/ui/FloatingCard';

import { enqueueFromMenu } from './queueActions';

const GROUPS = queueMenuGroups();

/**
 * `#queueMenu` — the Add-step popover (`paintQueueMenu`, `mountQueueMenuHost`,
 * `placeQueueMenu`, `setQueueMenuOpen`). While open it is portalled to
 * `document.body`: `.panel-body` `will-change` makes a fixed containing block,
 * so viewport coordinates would otherwise land in the wrong place inside the rail.
 */
export function QueueMenu({
  open,
  onClose,
  buttonRef,
}: {
  open: boolean;
  onClose: (opts?: { focusButton?: boolean }) => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const menu = menuRef.current;
    const btn = buttonRef.current;
    if (!menu || !btn || menu.hidden) return;
    const rect = btn.getBoundingClientRect();
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
    // Measure natural height after a paint-friendly maxHeight, then lock placement.
    menu.style.maxHeight = 'none';
    menu.style.width = '272px';
    const naturalH = Math.max(menu.scrollHeight || 0, menu.offsetHeight || 0, 240);
    const spot = placeQueueMenuRect(rect, { vw: window.innerWidth, vh: window.innerHeight, menuHeight: naturalH });
    menu.dataset['openUp'] = spot.openUp ? '1' : '0';
    menu.style.width = `${Math.round(spot.width)}px`;
    menu.style.maxHeight = `${Math.round(spot.maxHeight)}px`;
    menu.style.left = `${Math.round(spot.left)}px`;
    menu.style.top = `${Math.round(spot.top)}px`;
  };
  const placeRef = useRef(place);
  useEffect(() => {
    placeRef.current = place;
  });

  useLayoutEffect(() => {
    if (!open) return;
    placeRef.current();
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[data-enqueue]');
    const frame = requestAnimationFrame(() => {
      placeRef.current();
      first?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('#queueMenu') || target?.closest('#btnQueueAdd') || target?.closest('.queue-add-wrap')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onClose({ focusButton: true });
    };
    const onMove = () => placeRef.current();
    const bay = document.getElementById('leftRender');
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    bay?.addEventListener('scroll', onMove, { passive: true });
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      bay?.removeEventListener('scroll', onMove);
    };
  }, [open, onClose]);

  const menu = (
    <FloatingCard
      ref={menuRef}
      id="queueMenu"
      className="queue-menu"
      size="lg"
      hidden={!open}
      role="menu"
      aria-label="Add a job to the queue"
      data-ready="1"
      onClick={(e) => {
        const target = e.target instanceof Element ? e.target : null;
        const btn = target?.closest<HTMLElement>('[data-enqueue]');
        if (!btn) return;
        e.preventDefault();
        onClose();
        enqueueFromMenu(btn.dataset['enqueue'] ?? '');
      }}
    >
      {GROUPS.map((group) => (
        <div key={group.group} className="queue-menu-group" role="group" aria-label={group.group}>
          <span className="queue-menu-label">{group.group}</span>{' '}
          {group.items.map((item) => (
            <button key={item.id} type="button" className="queue-menu-item" role="menuitem" data-enqueue={item.id}>
              <span className="queue-menu-ico" dangerouslySetInnerHTML={{ __html: queueIconSvg(item.icon) }} />{' '}
              <span className="queue-menu-copy">
                <strong>{item.label}</strong>
                <span>{item.hint}</span>
              </span>
            </button>
          ))}
        </div>
      ))}
    </FloatingCard>
  );
  return open ? createPortal(menu, document.body) : menu;
}

import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * `tile()` and `tileGrid()` from `ui/look/previews` as components: a live preview over a
 * caption. In a radio group a tile is a radio; on its own it is a toggle (`aria-pressed`).
 */
export interface LookTileProps {
  /** A preview string from `ui/look/previews`, or a node. */
  preview: string | ReactNode;
  label: string;
  on: boolean;
  /** Data attributes the click handler reads (`{ 'data-energy': 'calm' }`). */
  data?: Record<`data-${string}`, string | number | undefined>;
  hint?: string | undefined;
  /** A second caption line (dimensions, a tempo). */
  detail?: string | undefined;
  badge?: string | undefined;
  /** `radio` inside a `TileGrid`; `toggle` (aria-pressed) for a lone tile. */
  role?: 'radio' | 'toggle';
  id?: string;
  className?: string;
  disabled?: boolean;
  onSelect?: () => void;
}

export function LookTile({ preview, label, on, data, hint, detail, badge, role = 'radio', id, className, disabled, onSelect }: LookTileProps) {
  // Catalogue labels read "Aurora · colour ribbons": the name fits the tile, the gloss goes to the tooltip.
  const [name, gloss] = label.split(' · ');
  const title = hint || (gloss ? `${name} — ${gloss}` : label);
  return (
    <button
      type="button"
      className={cn('lk-tile', on && 'on', className)}
      id={id}
      {...data}
      {...(role === 'radio' ? { role: 'radio', 'aria-checked': on, tabIndex: on ? 0 : -1 } : { 'aria-pressed': on })}
      title={title}
      disabled={disabled}
      onClick={onSelect}
    >
      {typeof preview === 'string' ? (
        <span className="lk-prev" dangerouslySetInnerHTML={{ __html: preview }} />
      ) : (
        <span className="lk-prev">{preview}</span>
      )}
      <span className="lk-name">{name}</span>
      {detail ? <span className="lk-detail">{detail}</span> : null}
      {badge ? <em className="lk-badge">{badge.split(' · ')[0]}</em> : null}
    </button>
  );
}

const TILE = '.lk-tile:not(:disabled)';

/** Arrow keys walk the tiles in reading order; Up and Down jump a row. Enter or Space picks. */
function onGridKey(e: KeyboardEvent<HTMLDivElement>) {
  const tiles = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(TILE)].filter((t) => t.closest('.lk-grid') === e.currentTarget);
  const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  const cols = getComputedStyle(e.currentTarget).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? tiles.length - 1 : step != null ? at + step : -1;
  const tile = tiles[Math.min(tiles.length - 1, Math.max(0, next))];
  if (next < 0 || !tile) return;
  e.preventDefault();
  for (const t of tiles) t.tabIndex = t === tile ? 0 : -1;
  tile.focus();
}

export function TileGrid({
  label,
  id,
  cols,
  className,
  data,
  children,
}: {
  label: string;
  id?: string;
  /** Data attributes for a click delegate (`{ 'data-camera': 'zoom' }`). */
  data?: Record<`data-${string}`, string | undefined>;
  /** Columns: 2, 3 (default) or 4. */
  cols?: 2 | 3 | 4;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // A group with nothing picked still needs one tile in the tab order.
  useLayoutEffect(() => {
    const tiles = [...(ref.current?.querySelectorAll<HTMLButtonElement>(TILE) ?? [])];
    if (tiles.length && !tiles.some((t) => t.tabIndex === 0)) tiles[0]!.tabIndex = 0;
  });
  return (
    <div
      ref={ref}
      className={cn('lk-grid', cols === 2 && 'lk-2', cols === 4 && 'lk-4', className)}
      id={id}
      {...data}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onGridKey}
    >
      {children}
    </div>
  );
}

/** `details.lk-more`: the long tail of a catalogue, folded under its count. */
export function MoreTiles({ label, count, open, children }: { label: string; count: number; open?: boolean; children: ReactNode }) {
  return (
    <details className="lk-more" open={open}>
      <summary>
        {label} <em>{count}</em>
      </summary>
      {children}
    </details>
  );
}

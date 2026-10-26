/**
 * Drag math for the desk's three splitters (left panel, right panel, editor timeline).
 *
 * Between `min` and `max` the panel follows the pointer. Below `min` it keeps following
 * so it visibly slides shut under the hand; past `collapseAt` the close is armed and a
 * release folds the panel to `closed`. Releasing between `collapseAt` and `min` springs
 * back to `min`, so a panel never rests at a size too narrow to use.
 */

export interface PanelRange {
  min: number;
  max: number;
  collapseAt: number;
  /** Size of the folded panel: 0 for the side panels, the toolbar strip for the timeline. */
  closed: number;
}

/** The monitor keeps at least this width however wide the side panels get. */
const MONITOR_MIN_W = 360;
/** The two 5px splitter columns. */
const SPLITTERS_W = 10;
/** Header + stage bar + the shortest usable stage above the editor timeline. */
const STAGE_MIN_H = 300;

const SIDE_MIN = { left: 180, right: 220 } as const;

export const TL_MIN = 180;
export const TL_CLOSED = 42;

export function sideRange(side: 'left' | 'right', { workspace, other }: { workspace: number; other: number }): PanelRange {
  const min = SIDE_MIN[side];
  return {
    min,
    max: Math.max(min, Math.round(workspace - other - MONITOR_MIN_W - SPLITTERS_W)),
    collapseAt: Math.round(min * 0.55),
    closed: 0,
  };
}

export function timelineRange(viewportHeight: number): PanelRange {
  return {
    min: TL_MIN,
    max: Math.max(TL_MIN, Math.round(viewportHeight - STAGE_MIN_H)),
    collapseAt: 120,
    closed: TL_CLOSED,
  };
}

/** What to paint for a pointer at `raw` px mid-drag. */
export function dragFrame(raw: number, r: PanelRange): { size: number; armed: boolean } {
  const size = Math.round(Math.min(r.max, Math.max(r.closed, raw)));
  return { size, armed: raw < r.collapseAt };
}

/** Where the panel settles when the pointer lets go at `raw` px. */
export function releaseDrag(raw: number, r: PanelRange): { collapse: boolean; size: number | null } {
  if (raw < r.collapseAt) return { collapse: true, size: null };
  return { collapse: false, size: Math.round(Math.min(r.max, Math.max(r.min, raw))) };
}

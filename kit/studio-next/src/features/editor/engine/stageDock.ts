import { TB_MAGNET, TB_MARGIN, TB_SNAP, clampCentre, freeFromCentre, parsePlacement, serializePlacement, snapZoneFor, type TbDock, type TbPlacement, type TbSize } from './textBarPlace';

/**
 * Where every stage panel sits — the copy bar, the zoom bar and the magnifier bar share one host
 * (the monitor area) and one set of rules, so any number of them on a slide line up instead of
 * stacking on top of each other. Pure geometry: no DOM.
 *
 * A panel is either docked to the top or bottom rail (panels on one rail sit side by side and
 * wrap inward), placed free (stored as shares of the host so resizes keep it in place), or
 * attached to the thing it edits — it then picks the best of the spots its owner offers, steering
 * clear of every panel already placed and of the owner itself.
 */

export type PanelPlace = TbPlacement | { dock: 'attach' };
export type PanelMode = 'top' | 'bottom' | 'free' | 'attach';

/** A candidate centre for an attached panel, in host px. `hold` pins it (it rides a drag). */
export interface Spot {
  cx: number;
  cy: number;
  weight?: number;
  hold?: boolean;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanelInput {
  id: string;
  size: TbSize;
  place: PanelPlace;
  /** Left-to-right order on a shared rail, and placement priority. */
  order: number;
  spots?: Spot[] | undefined;
  /** Boxes an attached panel must not cover (the ring it edits). */
  avoid?: Box[] | undefined;
}

export interface PanelOut extends Box {
  mode: PanelMode;
}

/** Space between panels sharing a rail, and between a free panel and the one it was pushed off. */
export const DOCK_GAP = 8;
/** How close (px) a dragged panel's centre must come to one of its owner's spots to attach. */
export const ATTACH_SNAP = 72;

export function parsePanelPlace(raw: string | null | undefined): PanelPlace | null {
  if (!raw) return null;
  try {
    if ((JSON.parse(raw) as { dock?: unknown } | null)?.dock === 'attach') return { dock: 'attach' };
  } catch {
    return null;
  }
  return parsePlacement(raw);
}

export function serializePanelPlace(p: PanelPlace): string {
  return p.dock === 'attach' ? JSON.stringify({ dock: 'attach' }) : serializePlacement(p);
}

export const modeOf = (p: PanelPlace): PanelMode => (p.dock === 'free' ? 'free' : p.dock);

const overlap = (a: Box, b: Box): number => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const boxAt = (cx: number, cy: number, size: TbSize): Box => ({ x: cx - size.w / 2, y: cy - size.h / 2, w: size.w, h: size.h });

function clampBox(cx: number, cy: number, host: TbSize, size: TbSize, margin: number): Box {
  const c = clampCentre(cx, cy, host, size, margin);
  return boxAt(c.cx, c.cy, size);
}

/** Panels on one rail: side by side from the centre, wrapping into rows that stack inward. */
function layoutRail(edge: TbDock, items: PanelInput[], host: TbSize, margin: number, out: Record<string, PanelOut>): void {
  const room = Math.max(0, host.w - 2 * margin);
  const rows: PanelInput[][] = [];
  let row: PanelInput[] = [];
  let width = 0;
  for (const it of items) {
    const add = (row.length ? DOCK_GAP : 0) + it.size.w;
    if (row.length && width + add > room) {
      rows.push(row);
      row = [];
      width = 0;
    }
    row.push(it);
    width += row.length > 1 ? add : it.size.w;
  }
  if (row.length) rows.push(row);
  let inset = margin;
  for (const r of rows) {
    const total = r.reduce((s, it) => s + it.size.w, 0) + DOCK_GAP * (r.length - 1);
    const tall = Math.max(...r.map((it) => it.size.h));
    let x = Math.max(margin, (host.w - total) / 2);
    for (const it of r) {
      const y = edge === 'top' ? inset : host.h - inset - it.size.h;
      out[it.id] = { x, y, w: it.size.w, h: it.size.h, mode: edge };
      x += it.size.w + DOCK_GAP;
    }
    inset += tall + DOCK_GAP;
  }
}

/** Push a free panel off whatever it lands on, by the shortest way that stays inside the host. */
function settleFree(box: Box, placed: Box[], host: TbSize, margin: number): Box {
  let b = box;
  for (let pass = 0; pass < 6; pass++) {
    const hit = placed.find((p) => overlap(b, p) > 0);
    if (!hit) return b;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const tries = [
      { cx, cy: hit.y - DOCK_GAP - b.h / 2 },
      { cx, cy: hit.y + hit.h + DOCK_GAP + b.h / 2 },
      { cx: hit.x - DOCK_GAP - b.w / 2, cy },
      { cx: hit.x + hit.w + DOCK_GAP + b.w / 2, cy },
    ]
      .map((t) => clampBox(t.cx, t.cy, host, b, margin))
      .filter((t) => overlap(t, hit) === 0)
      .sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y));
    if (!tries.length) return b;
    b = tries[0]!;
  }
  return b;
}

/** Best spot for an attached panel: inside the host, off the owner, off every placed panel. */
function pickSpot(it: PanelInput, placed: Box[], host: TbSize, margin: number): Box {
  const spots = it.spots || [];
  const held = spots.find((s) => s.hold);
  if (held) return clampBox(held.cx, held.cy, host, it.size, margin);
  const area = Math.max(1, it.size.w * it.size.h);
  let best: { box: Box; score: number } | null = null;
  for (const s of spots) {
    const box = clampBox(s.cx, s.cy, host, it.size, margin);
    const shove = Math.hypot(box.x + box.w / 2 - s.cx, box.y + box.h / 2 - s.cy);
    const covered = [...placed, ...(it.avoid || [])].reduce((sum, p) => sum + overlap(box, p), 0) / area;
    const score = (s.weight ?? 0) - covered * 100 - shove * 0.5;
    if (!best || score > best.score) best = { box, score };
  }
  return best?.box ?? clampBox(host.w / 2, host.h - margin - it.size.h / 2, host, it.size, margin);
}

/**
 * Lay out every visible panel. Rails go first (they own the edges), free panels next (the user
 * put them there), attached panels last — they are the ones that can move out of the way.
 */
export function layoutStagePanels(host: TbSize, panels: PanelInput[], margin = TB_MARGIN): Record<string, PanelOut> {
  const out: Record<string, PanelOut> = {};
  const list = [...panels]
    .map((p) => (p.place.dock === 'attach' && !p.spots?.length ? { ...p, place: { dock: 'bottom' } } : p))
    .sort((a, b) => a.order - b.order);
  for (const edge of ['top', 'bottom'] as const) {
    const rail = list.filter((p) => p.place.dock === edge);
    if (rail.length) layoutRail(edge, rail, host, margin, out);
  }
  const placed = (): Box[] => Object.values(out);
  for (const it of list) {
    const p = it.place;
    if (p.dock !== 'free') continue;
    const box = settleFree(clampBox(p.fx * host.w, p.fy * host.h, host, it.size, margin), placed(), host, margin);
    out[it.id] = { ...box, mode: 'free' };
  }
  for (const it of list) {
    if (it.place.dock !== 'attach') continue;
    out[it.id] = { ...pickSpot(it, placed(), host, margin), mode: 'attach' };
  }
  return out;
}

export type DragZone = TbDock | 'attach' | null;

function nearestSpot(cx: number, cy: number, spots: Spot[] | undefined): { spot: Spot; d: number } | null {
  let best: { spot: Spot; d: number } | null = null;
  for (const spot of spots || []) {
    const d = Math.hypot(spot.cx - cx, spot.cy - cy);
    if (!best || d < best.d) best = { spot, d };
  }
  return best;
}

/**
 * One drag frame: the zone under the panel and the centre to draw. A rail pulls the panel toward
 * its edge, an owner's spot pulls it toward that spot — the same magnet the copy bar always had.
 */
export function panelDragFrame(
  cx: number,
  cy: number,
  host: TbSize,
  size: TbSize,
  spots?: Spot[],
  { margin = TB_MARGIN, threshold = TB_SNAP, magnet = TB_MAGNET } = {},
): { zone: DragZone; cx: number; cy: number; raw: { cx: number; cy: number }; spot: Spot | null } {
  const raw = clampCentre(cx, cy, host, size, margin);
  const edge = snapZoneFor(raw.cy, host, size, { margin, threshold });
  if (edge) {
    const slotY = edge === 'top' ? margin + size.h / 2 : host.h - margin - size.h / 2;
    return { zone: edge, cx: raw.cx, cy: raw.cy + (slotY - raw.cy) * magnet, raw, spot: null };
  }
  const near = nearestSpot(raw.cx, raw.cy, spots);
  if (near && near.d <= ATTACH_SNAP) {
    const k = magnet * 0.5;
    return { zone: 'attach', cx: raw.cx + (near.spot.cx - raw.cx) * k, cy: raw.cy + (near.spot.cy - raw.cy) * k, raw, spot: near.spot };
  }
  return { zone: null, cx: raw.cx, cy: raw.cy, raw, spot: null };
}

/** Where a drag lands: a rail, back onto its owner, or a free spot kept relative to the host. */
export function dropPanelPlace(cx: number, cy: number, host: TbSize, size: TbSize, spots?: Spot[], margin = TB_MARGIN): PanelPlace {
  const f = panelDragFrame(cx, cy, host, size, spots, { margin });
  if (f.zone === 'attach') return { dock: 'attach' };
  if (f.zone) return { dock: f.zone };
  return freeFromCentre(f.raw.cx, f.raw.cy, host, size, margin);
}

/**
 * Keyboard nudge from where the panel is drawn now. Sideways on a rail or off an owner frees it;
 * pushing into an edge docks there, the keyboard path to the same magnet.
 */
export function nudgePanelPlace(p: PanelPlace, centre: { cx: number; cy: number }, dx: number, dy: number, host: TbSize, size: TbSize, margin = TB_MARGIN): PanelPlace {
  if (p.dock === 'top' && dy < 0) return p;
  if (p.dock === 'bottom' && dy > 0) return p;
  const next = clampCentre(centre.cx + dx, centre.cy + dy, host, size, margin);
  if (dy < 0 && next.cy - size.h / 2 <= margin + 0.5) return { dock: 'top' };
  if (dy > 0 && next.cy + size.h / 2 >= host.h - margin - 0.5) return { dock: 'bottom' };
  return freeFromCentre(next.cx, next.cy, host, size, margin);
}

import { clamp } from './util';

/**
 * Where the stage text bar (#edTextBar) sits inside its host — the whole monitor area, not just
 * the video. Pure geometry so docking, snapping and resize survival are testable without a DOM.
 *
 * Free positions are stored as the bar centre's share of the host (0…1), so a window or panel
 * resize keeps the bar in the same relative spot instead of drifting off the edge.
 */
export type TbDock = 'top' | 'bottom';
export type TbPlacement = { dock: TbDock } | { dock: 'free'; fx: number; fy: number };
export type TbSize = { w: number; h: number };
/** Anchor point in host px plus which point of the bar sits on it (shares of the bar's box). */
export type TbCoords = { x: number; y: number; ax: number; ay: number };

export const TB_MARGIN = 10;
/** How close (px) the bar's edge must come to a dock edge before it is pulled in. */
export const TB_SNAP = 48;
/** Share of the remaining distance the bar is pulled toward the slot while hovering a zone. */
export const TB_MAGNET = 0.6;

export function parsePlacement(raw: string | null | undefined): TbPlacement | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { dock?: unknown; fx?: unknown; fy?: unknown } | null;
    if (p?.dock === 'top' || p?.dock === 'bottom') return { dock: p.dock };
    if (p?.dock === 'free' && Number.isFinite(p.fx) && Number.isFinite(p.fy)) {
      return { dock: 'free', fx: clamp(p.fx as number, 0, 1), fy: clamp(p.fy as number, 0, 1) };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function serializePlacement(p: TbPlacement): string {
  return JSON.stringify(p.dock === 'free' ? { dock: 'free', fx: round4(p.fx), fy: round4(p.fy) } : { dock: p.dock });
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** No saved choice → bottom-centre, or top-centre while a caption owns the lower third. */
export function effectivePlacement(saved: TbPlacement | null, preferTop = false): TbPlacement {
  return saved || { dock: preferTop ? 'top' : 'bottom' };
}

/** Keep a centre point far enough from the host edges that the whole bar stays inside. */
export function clampCentre(cx: number, cy: number, host: TbSize, bar: TbSize, margin = TB_MARGIN): { cx: number; cy: number } {
  const loX = margin + bar.w / 2;
  const loY = margin + bar.h / 2;
  const hiX = host.w - margin - bar.w / 2;
  const hiY = host.h - margin - bar.h / 2;
  return {
    cx: hiX < loX ? host.w / 2 : clamp(cx, loX, hiX),
    cy: hiY < loY ? host.h / 2 : clamp(cy, loY, hiY),
  };
}

export function placementCoords(p: TbPlacement, host: TbSize, bar: TbSize, margin = TB_MARGIN): TbCoords {
  if (p.dock !== 'free') {
    return p.dock === 'top' ? { x: host.w / 2, y: margin, ax: 0.5, ay: 0 } : { x: host.w / 2, y: host.h - margin, ax: 0.5, ay: 1 };
  }
  const { cx, cy } = clampCentre(p.fx * host.w, p.fy * host.h, host, bar, margin);
  return { x: cx, y: cy, ax: 0.5, ay: 0.5 };
}

/** Centre of the bar for any placement — where a drag picks it up from. */
export function placementCentre(p: TbPlacement, host: TbSize, bar: TbSize, margin = TB_MARGIN): { cx: number; cy: number } {
  const c = placementCoords(p, host, bar, margin);
  return { cx: c.x + (0.5 - c.ax) * bar.w, cy: c.y + (0.5 - c.ay) * bar.h };
}

export function freeFromCentre(cx: number, cy: number, host: TbSize, bar: TbSize, margin = TB_MARGIN): TbPlacement {
  const c = clampCentre(cx, cy, host, bar, margin);
  return { dock: 'free', fx: host.w > 0 ? c.cx / host.w : 0.5, fy: host.h > 0 ? c.cy / host.h : 0.5 };
}

/** The dock edge a bar centred at `cy` is close enough to snap into, if any. */
export function snapZoneFor(cy: number, host: TbSize, bar: TbSize, { margin = TB_MARGIN, threshold = TB_SNAP } = {}): TbDock | null {
  const top = cy - bar.h / 2;
  const bottom = cy + bar.h / 2;
  const nearTop = top <= margin + threshold;
  const nearBottom = bottom >= host.h - margin - threshold;
  if (nearTop && nearBottom) return cy < host.h / 2 ? 'top' : 'bottom';
  if (nearTop) return 'top';
  if (nearBottom) return 'bottom';
  return null;
}

/**
 * One drag frame: the clamped centre under the pointer, the zone it hovers, and the centre to
 * draw — pulled part of the way toward the docked slot so the edge feels magnetic.
 */
export function dragFrame(
  cx: number,
  cy: number,
  host: TbSize,
  bar: TbSize,
  { margin = TB_MARGIN, threshold = TB_SNAP, magnet = TB_MAGNET } = {},
): { zone: TbDock | null; cx: number; cy: number; raw: { cx: number; cy: number } } {
  const raw = clampCentre(cx, cy, host, bar, margin);
  const zone = snapZoneFor(raw.cy, host, bar, { margin, threshold });
  if (!zone) return { zone, cx: raw.cx, cy: raw.cy, raw };
  const slot = placementCentre({ dock: zone }, host, bar, margin);
  return {
    zone,
    cx: raw.cx + (slot.cx - raw.cx) * magnet * 0.5,
    cy: raw.cy + (slot.cy - raw.cy) * magnet,
    raw,
  };
}

/** Where a drag lands: the hovered dock, or a free spot stored relative to the host. */
export function dropPlacement(cx: number, cy: number, host: TbSize, bar: TbSize, opts: { margin?: number; threshold?: number } = {}): TbPlacement {
  const margin = opts.margin ?? TB_MARGIN;
  const raw = clampCentre(cx, cy, host, bar, margin);
  const zone = snapZoneFor(raw.cy, host, bar, { margin, threshold: opts.threshold ?? TB_SNAP });
  return zone ? { dock: zone } : freeFromCentre(raw.cx, raw.cy, host, bar, margin);
}

/** Keyboard nudge: moves a (possibly docked) bar by px and keeps it free unless it lands in a zone. */
export function nudgePlacement(p: TbPlacement, dx: number, dy: number, host: TbSize, bar: TbSize, margin = TB_MARGIN): TbPlacement {
  const { cx, cy } = placementCentre(p, host, bar, margin);
  if (p.dock !== 'free' && dy === 0) return freeFromCentre(cx + dx, cy, host, bar, margin);
  if (p.dock === 'top' && dy < 0) return p;
  if (p.dock === 'bottom' && dy > 0) return p;
  const next = clampCentre(cx + dx, cy + dy, host, bar, margin);
  // Pushing against an edge docks there — the keyboard path to the same magnet.
  if (dy < 0 && next.cy - bar.h / 2 <= margin + 0.5) return { dock: 'top' };
  if (dy > 0 && next.cy + bar.h / 2 >= host.h - margin - 0.5) return { dock: 'bottom' };
  return freeFromCentre(next.cx, next.cy, host, bar, margin);
}

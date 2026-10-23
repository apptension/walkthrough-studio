/**
 * Replay targeting for flows written from a guided tour. The tour is shown at the recording
 * viewport in CSS px, so a captured click point lands on the same element in the take: these
 * helpers pick that element among duplicates and place clicks and drags inside it.
 */

/** Distance from a point to a box (0 inside). */
export function boxDistance(b, x, y) {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.width));
  const dy = Math.max(b.y - y, 0, y - (b.y + b.height));
  return Math.hypot(dx, dy);
}

/** Index of the box nearest the point, ties to the smaller box (the more specific target). */
export function pickNearest(boxes, x, y) {
  let best = -1;
  let bestD = Infinity;
  let bestA = Infinity;
  boxes.forEach((b, i) => {
    if (!b || b.width < 1 || b.height < 1) return;
    const d = boxDistance(b, x, y);
    const a = b.width * b.height;
    if (d < bestD - 0.5 || (Math.abs(d - bestD) <= 0.5 && a < bestA)) {
      best = i;
      bestD = d;
      bestA = a;
    }
  });
  return best;
}

/**
 * Where inside the live box to act. Same size as captured → the captured pixel offset (calendars,
 * timelines and boards keep a fixed scale); a different size → the captured fraction.
 */
export function spot(box, captured = {}, rel = {}) {
  const fx = rel.fx ?? 0.5;
  const fy = rel.fy ?? 0.5;
  const same = captured.w && captured.h && Math.abs(box.width - captured.w) <= 2 && Math.abs(box.height - captured.h) <= 2;
  const x = same ? captured.w * fx : box.width * fx;
  const y = same ? captured.h * fy : box.height * fy;
  return {
    x: Math.min(Math.max(1, x), box.width - 1),
    y: Math.min(Math.max(1, y), box.height - 1),
    k: same || !captured.w ? 1 : box.width / captured.w,
  };
}

/**
 * Stand-in for a locator, driving the mouse over the rectangle the reviewer touched.
 *
 * Tooltips, popovers and other transient nodes have no handle that survives to replay, so
 * the pixels the tour recorded are the only ground truth. Exposes the slice of the locator
 * API the pointer steps use, so generated flows work the same either way.
 */
export function pointHandle(page, { box, point } = {}) {
  const b = {
    x: box?.x ?? (point?.x ?? 0),
    y: box?.y ?? (point?.y ?? 0),
    width: box?.width ?? box?.w ?? 1,
    height: box?.height ?? box?.h ?? 1,
  };
  const inside = (position) =>
    position
      ? { x: b.x + position.x, y: b.y + position.y }
      : { x: point?.x ?? b.x + b.width / 2, y: point?.y ?? b.y + b.height / 2 };
  return {
    isPoint: true,
    async boundingBox() {
      return { ...b };
    },
    async click({ position, button = 'left', clickCount = 1 } = {}) {
      const p = inside(position);
      await page.mouse.click(p.x, p.y, { button, clickCount });
    },
    async dblclick({ position } = {}) {
      const p = inside(position);
      await page.mouse.dblclick(p.x, p.y);
    },
    async hover({ position } = {}) {
      const p = inside(position);
      await page.mouse.move(p.x, p.y);
    },
    async scrollIntoViewIfNeeded() {},
    evaluate() {
      throw new Error('the captured point is a position, not an element — this step needs a real handle');
    },
    toString: () => `point(${Math.round(inside().x)}, ${Math.round(inside().y)})`,
  };
}

/**
 * A `near` that knows the tour, so the pixels a step was captured at are available even when the
 * flow does not pass them. Flows are written by hand and by the planner; the geometry that finds
 * a handle-less target again belongs to the recording, not to whoever typed the call.
 *
 * @param {Map<string, {box?: object, point?: object}>} fallbacks step id → captured geometry
 */
export function makeNear(fallbacks) {
  return function near(locator, opts = {}) {
    const known = opts.fallback ? null : fallbacks?.find?.(opts) || null;
    if (!known) return nearLocator(locator, opts);
    // A guess that will not resolve should not cost the full wait before the pixels are used.
    return nearLocator(locator, { timeout: 4000, ...opts, fallback: known });
  };
}

/**
 * The match of `locator` the reviewer acted on: nearest the captured point, else the captured
 * duplicate index. Waits for a visible match; with no match it falls back to the rectangle the
 * reviewer touched when the caller passed one, and otherwise throws, so a guided step can never
 * be skipped silently.
 */
export async function near(locator, opts = {}) {
  return nearLocator(locator, opts);
}

async function nearLocator(locator, { x, y, nth, timeout = 10000, step = '', fallback = null } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const n = await locator.count().catch(() => 0);
    if (n) {
      const boxes = [];
      for (let i = 0; i < n; i++) boxes.push(await locator.nth(i).boundingBox().catch(() => null));
      const visible = boxes.map((b, i) => (b && b.width >= 1 && b.height >= 1 ? i : -1)).filter((i) => i >= 0);
      if (visible.length) {
        if (Number.isFinite(x) && Number.isFinite(y)) return locator.nth(pickNearest(boxes, x, y));
        if (Number.isInteger(nth) && boxes[nth]) return locator.nth(nth);
        return locator.nth(visible[0]);
      }
    }
    if (Date.now() > until) {
      const where = `${step ? `Guided step ${step}: ` : ''}no visible match for ${locator}`;
      if (fallback && (fallback.box || fallback.point)) {
        const page = typeof locator?.page === 'function' ? locator.page() : locator?._page;
        if (page) {
          const handle = pointHandle(page, fallback);
          console.warn(`⚠ ${where} — acting on the pixel the reviewer touched, ${handle}`);
          return handle;
        }
      }
      throw new Error(`${where} — the screen differs from the tour`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

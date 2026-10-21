/**
 * Overlay layer for captions and chapter cards, drawn into the page inside a shadow root.
 *
 * Playwright's screencast.showOverlay re-injects its overlays into every new document, so each
 * navigation replays their entrance animations from zero. Here every overlay carries its start time
 * (t0); its CSS delays are written as `calc(Xs - var(--el))`, and each mount sets --el to the time
 * already elapsed, so after a navigation the overlay resumes mid-animation instead of restarting.
 * A new document picks the live overlays up from an init script, before its first paint.
 * The shadow root is closed so the flow's own locators never resolve to overlay text.
 */

/** In-page runtime, installed once per page as an init script (and evaluated into the current document). */
function runtime() {
  if (window.top !== window || window.__wtOverlays) return;
  let host = null;
  let shadow = null;
  const timers = new Map();
  const root = () => {
    if (host?.isConnected) return shadow;
    const doc = document.documentElement;
    if (!doc) return null;
    host = document.createElement('wt-overlays');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;';
    // Closed: the flow's locators (getByText, getByRole) must never match a caption or chapter card
    shadow = host.attachShadow({ mode: 'closed' });
    doc.appendChild(host);
    return shadow;
  };
  const sync = (list) => {
    const sr = root();
    if (!sr) {
      new MutationObserver((_, obs) => {
        if (document.documentElement) {
          obs.disconnect();
          sync(list);
        }
      }).observe(document, { childList: true });
      return;
    }
    const now = Date.now();
    const live = list.filter((o) => o.t0 + o.ms > now);
    const ids = new Set(live.map((o) => o.id));
    for (const el of [...sr.children]) {
      if (!ids.has(el.dataset.id)) el.remove();
    }
    for (const o of live) {
      let el = sr.querySelector(`[data-id="${o.id}"]`);
      if (!el) {
        el = document.createElement('div');
        el.dataset.id = o.id;
        el.style.setProperty('--el', `${(now - o.t0) / 1000}s`);
        el.innerHTML = o.html;
        sr.appendChild(el);
        // innerHTML does not run scripts. The plate-field runtime has to start inside this
        // shadow tree so the canvas it queries is the one on this card.
        for (const old of el.querySelectorAll('script')) {
          const next = document.createElement('script');
          next.textContent = old.textContent;
          old.replaceWith(next);
        }
      }
      if (o.exitAt) el.style.setProperty('--x', `${(o.exitAt - o.t0) / 1000}s`);
      clearTimeout(timers.get(o.id));
      timers.set(o.id, setTimeout(() => el.remove(), o.t0 + o.ms - now));
    }
  };
  window.__wtOverlays = { sync, state: [] };
}

export function createOverlays(page) {
  const list = new Map();
  let seq = 0;
  let installed = false;

  const live = () => {
    const now = Date.now();
    for (const [id, o] of list) if (o.t0 + o.ms <= now) list.delete(id);
    return [...list.values()];
  };

  async function push() {
    const state = live();
    if (!installed) {
      installed = true;
      await page.addInitScript(runtime);
    }
    // Init scripts run in order on every new document, so the latest state wins there
    await page.addInitScript((s) => window.__wtOverlays?.sync(s), state);
    // The current document (it may be mid-navigation; the init script covers the next one)
    await page.evaluate(runtime).catch(() => {});
    await page.evaluate((s) => window.__wtOverlays?.sync(s), state).catch(() => {});
  }

  return {
    /**
     * Show an overlay for ms. `exitAfter` is the default exit time (seconds from start) that the
     * overlay's own CSS uses through var(--x); `retire(kind)` moves it earlier.
     * `delayMs` starts it a little later (its entrance waits, as if --el were negative).
     */
    async show(kind, html, ms, { delayMs = 0 } = {}) {
      const id = `wt${++seq}`;
      list.set(id, { id, kind, html, t0: Date.now() + delayMs, ms: ms + delayMs });
      await push();
      return id;
    },
    /** Starts the exit of every live overlay of these kinds now; returns how many it retired. */
    async retire(kinds, exitMs = 500) {
      const now = Date.now();
      let n = 0;
      for (const o of live()) {
        if (!kinds.includes(o.kind) || o.exitAt) continue;
        if (o.t0 + o.ms - now <= exitMs) continue;
        o.exitAt = now;
        o.ms = now - o.t0 + exitMs;
        n += 1;
      }
      if (n) await push();
      return n;
    },
  };
}

/**
 * Frames at the stage size. Chromium's screencast is capped at CSS px, so a capture smaller than
 * its place in the video (a laptop or a phone) is grabbed as scaled screenshots instead — sharp
 * text from the device pixel ratio, ~30 fps while the flow drives the page.
 *
 * A grab issued across a navigation (the comments click, a new route) can sit forever on the CDP
 * session: the call neither resolves nor rejects, so the loop never takes another frame and the
 * preview — and the recording, which repeats the last frame — freeze on the click. A grab that
 * outlives the timeout is abandoned with its session, and the next frame comes from a new one.
 */
const SHOT_TIMEOUT_MS = 800;

function sessionDead(err) {
  return /closed|detached|target/i.test(err?.message || "");
}

function takeShot(session, params, shotTimeoutMs) {
  let timer;
  const shot = session.send("Page.captureScreenshot", params);
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error("screenshot timed out");
      err.timeout = true;
      reject(err);
    }, shotTimeoutMs);
  });
  return Promise.race([shot, timeout]).finally(() => {
    clearTimeout(timer);
    // The loser of the race may still settle. Swallow it so an abandoned grab
    // cannot surface as an unhandled rejection after the loop has moved on.
    shot.catch(() => {});
  });
}

export async function startRasterCapture(
  page,
  { css, raster, quality = 95, onFrame, shotTimeoutMs = SHOT_TIMEOUT_MS, sleep, openSession },
) {
  const pause = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const connect = openSession ?? (() => page.context().newCDPSession(page));
  const params = {
    format: "jpeg",
    quality,
    clip: {
      x: 0,
      y: 0,
      width: css.width,
      height: css.height,
      scale: raster.width / css.width,
    },
    optimizeForSpeed: true,
    captureBeyondViewport: false,
  };
  let running = true;
  let cdp = await connect();
  const loop = (async () => {
    while (running) {
      if (!cdp) {
        try {
          cdp = await connect();
        } catch {
          if (!running || page.isClosed()) break;
          await pause(30);
          continue;
        }
      }
      try {
        const at = Date.now();
        const { data } = await takeShot(cdp, params, shotTimeoutMs);
        // Epoch ms of the moment the frame shows — the recorder places frames on that clock.
        if (running)
          onFrame({ data: Buffer.from(data, "base64"), timestamp: at });
        // Yield a turn so a grab that resolves immediately cannot starve the flow,
        // or stop(), of the event loop.
        await new Promise((r) => setImmediate(r));
      } catch (err) {
        const wedged = err?.timeout || sessionDead(err);
        if (wedged) {
          if (err?.timeout) console.log("» capture · frame grab stalled — restarting the preview");
          const dead = cdp;
          cdp = null;
          await dead?.detach?.().catch(() => {});
        }
        if (!running || page.isClosed()) break;
        await pause(30);
      }
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      await cdp?.detach?.().catch(() => {});
    },
  };
}

/** Width × height of a baseline/progressive JPEG (SOF marker). */
export function jpegSize(buf) {
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xc2)
      return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    i += 2 + len;
  }
  return null;
}

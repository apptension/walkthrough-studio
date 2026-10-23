/**
 * Frames at the stage size. Chromium's screencast is capped at CSS px, so a capture smaller than
 * its place in the video (a laptop or a phone) is grabbed as scaled screenshots instead — sharp
 * text from the device pixel ratio, ~30 fps while the flow drives the page.
 */
export async function startRasterCapture(
  page,
  { css, raster, quality = 95, onFrame },
) {
  const cdp = await page.context().newCDPSession(page);
  const clip = {
    x: 0,
    y: 0,
    width: css.width,
    height: css.height,
    scale: raster.width / css.width,
  };
  let running = true;
  const loop = (async () => {
    while (running) {
      try {
        const at = Date.now();
        const { data } = await cdp.send("Page.captureScreenshot", {
          format: "jpeg",
          quality,
          clip,
          optimizeForSpeed: true,
          captureBeyondViewport: false,
        });
        // Epoch ms of the moment the frame shows — the recorder places frames on that clock.
        if (running)
          onFrame({ data: Buffer.from(data, "base64"), timestamp: at });
      } catch {
        if (page.isClosed()) break;
        await new Promise((r) => setTimeout(r, 30));
      }
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      await cdp.detach().catch(() => {});
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

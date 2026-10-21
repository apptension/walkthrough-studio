/** A click that lands on an open dialog is dismissed once, then the original target is pressed. */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function isPointerIntercept(err) {
  return /intercepts pointer|intercepted|element is not receiving pointer/i.test(`${err?.message || ''} ${err?.name || ''}`);
}

export async function dismissCoveringDialog(page) {
  await page
    .evaluate(() => {
      for (const dialog of document.querySelectorAll('dialog[open], #scriptDialog')) {
        if (typeof dialog.close === 'function') dialog.close();
        dialog.removeAttribute('open');
      }
    })
    .catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
}

/**
 * Retry one click after the overlay is gone. The second attempt only runs when the
 * original locator is still visible.
 */
export async function clickThroughOverlay(locator, click, page) {
  try {
    return await click();
  } catch (err) {
    if (!isPointerIntercept(err)) throw err;
    console.log('» revalidate · A dialog is covering the target. Dismissing it and retrying the same control.');
    await dismissCoveringDialog(page);
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      const failed = new Error('The original target is not visible after the dialog closed. Screenshot: error.png');
      failed.overlayRetry = true;
      failed.cause = err;
      throw failed;
    }
    try {
      return await click();
    } catch (retryErr) {
      const failed = new Error(`The dialog still covers the target. Screenshot: error.png`);
      failed.overlayRetry = true;
      failed.cause = retryErr;
      throw failed;
    }
  }
}

export function installOverlayRetry(page) {
  const proto = Object.getPrototypeOf(page.locator('body'));
  if (proto.__wtOverlay) return page;
  const orig = proto.click;
  proto.click = function overlayClick(...args) {
    const owner = typeof this.page === 'function' ? this.page() : page;
    return clickThroughOverlay(this, () => orig.apply(this, args), owner);
  };
  proto.__wtOverlay = true;
  return page;
}

export function overlayReport(err) {
  return {
    summary: 'A dialog covered the click target.',
    detail: String(err?.message || err || ''),
    next: 'The capture-repair pass will read the page and try the flow once more.',
    screenshot: 'error.png',
  };
}

export function writeOverlayReport(video, err) {
  writeFileSync(join(video.out, 'overlay-block.json'), JSON.stringify(overlayReport(err), null, 2) + '\n');
}

export function readOverlayReport(video) {
  const file = join(video.out, 'overlay-block.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function clearOverlayReport(video) {
  rmSync(join(video.out, 'overlay-block.json'), { force: true });
}

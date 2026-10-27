/**
 * Round README / marketing still corners → PNG with alpha (Playwright OffscreenCanvas).
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

/** ~12px at 1×; scales with image size. Pass 0 to use auto from width. */
export function radiusForWidth(widthPx, cssRadius = 12, refWidth = 800) {
  return Math.max(8, Math.round((widthPx * cssRadius) / refWidth));
}

export async function roundToPng(page, inFile, outFile, radiusPx) {
  const ext = path.extname(inFile).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  const b64 = readFileSync(inFile).toString('base64');
  const dataUrl = `data:${mime};base64,${b64}`;

  const outB64 = await page.evaluate(
    async ({ dataUrl, radiusPx }) => {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const img = await createImageBitmap(blob);
      const w = img.width;
      const h = img.height;
      const r =
        radiusPx > 0 ? Math.min(radiusPx, w / 2, h / 2) : Math.min(w, h) * 0.014;
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, r);
      ctx.clip();
      ctx.drawImage(img, 0, 0);
      const png = await canvas.convertToBlob({ type: 'image/png' });
      const ab = await png.arrayBuffer();
      const u8 = new Uint8Array(ab);
      let s = '';
      for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
      return btoa(s);
    },
    { dataUrl, radiusPx: radiusPx ?? 0 },
  );

  writeFileSync(outFile, Buffer.from(outB64, 'base64'));
}

/** Replace JPEG/PNG with rounded PNG at the same path (jpeg → .png basename). */
export async function roundInPlace(page, file, radiusPx = 0) {
  const ext = path.extname(file).toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(ext)) return file;
  const out =
    ext === '.png' ? file : file.replace(/\.jpe?g$/i, '.png');
  const tmp = `${out}.round-tmp.png`;
  await roundToPng(page, file, tmp, radiusPx);
  writeFileSync(out, readFileSync(tmp));
  unlinkSync(tmp);
  if (out !== file && ext !== '.png') {
    try {
      unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
  return out;
}

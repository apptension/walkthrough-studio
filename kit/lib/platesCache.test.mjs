import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { plateCacheFresh, PLATE_RENDER_PIPELINE } from './plates.mjs';

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

test('plate cache stays fresh when video.config is newer than the mp4', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-plate-cache-'));
  const html = join(dir, 'open.html');
  const mp4 = join(dir, 'brand-open.mp4');
  const body = '<html>open plate</html>';
  const css = 'body{color:#fff}';
  writeFileSync(mp4, 'mp4');
  writeFileSync(html, body);
  utimesSync(html, new Date(), new Date(Date.now() + 60_000));
  writeFileSync(
    mp4.replace(/\.mp4$/, '.render.json'),
    JSON.stringify({
      pipeline: PLATE_RENDER_PIPELINE,
      htmlHash: hash(body),
      cssHash: hash(css),
      jpegQ: 95,
      raster: 'GPU raster (Metal)',
      qc: { ok: true },
    })
  );
  try {
    assert.equal(
      plateCacheFresh(mp4, html, { cssHash: hash(css), raster: 'GPU raster (Metal)', jpegQ: 95 }),
      true
    );
    assert.equal(plateCacheFresh(mp4, html, { cssHash: hash('other'), raster: 'GPU raster (Metal)', jpegQ: 95 }), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

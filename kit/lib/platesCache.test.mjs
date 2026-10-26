import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { mp4Complete, plateCacheFresh, PLATE_RENDER_PIPELINE } from './plates.mjs';

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);
const box = (type, size = 8, declared = size) => {
  const b = Buffer.alloc(size);
  b.writeUInt32BE(declared, 0);
  b.write(type, 4, 'latin1');
  return b;
};
const wholeMp4 = () => Buffer.concat([box('ftyp', 16), box('mdat', 24), box('moov', 12)]);

test('plate cache stays fresh when video.config is newer than the mp4', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-plate-cache-'));
  const html = join(dir, 'open.html');
  const mp4 = join(dir, 'brand-open.mp4');
  const body = '<html>open plate</html>';
  const css = 'body{color:#fff}';
  writeFileSync(mp4, wholeMp4());
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

test('an mp4 cut short is not whole, so its plate renders again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-plate-mp4-'));
  const file = (name, buf) => {
    const p = join(dir, name);
    writeFileSync(p, buf);
    return p;
  };
  try {
    assert.equal(mp4Complete(file('ok.mp4', wholeMp4())), true);
    // Encoder died before writing the index: mdat open-ended, no moov.
    assert.equal(mp4Complete(file('stub.mp4', Buffer.concat([box('ftyp', 32), box('free'), box('mdat', 8, 0)]))), false);
    // Copy truncated mid-file: the mdat claims more bytes than exist.
    assert.equal(mp4Complete(file('cut.mp4', Buffer.concat([box('ftyp', 16), box('mdat', 24, 4096)]))), false);
    assert.equal(mp4Complete(join(dir, 'missing.mp4')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

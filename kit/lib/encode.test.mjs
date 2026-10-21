import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  BT709_TAGS,
  QUALITY,
  QUALITY_ID,
  STILL_JPEG_ARGS,
  assertVideoCopied,
  assertX264Args,
  losslessX264,
  lossyX264,
  masterQualityError,
  plateJpegQ,
  toBt709,
} from './encode.mjs';

const tagged = (args) => [...args, ...BT709_TAGS];

test('the quality floor stays at the measured settings', () => {
  assert.equal(QUALITY.delivery.crf, 12);
  assert.equal(QUALITY.delivery.preset, 'medium');
  assert.equal(QUALITY.plate.crf, 4);
  assert.equal(QUALITY.plate.jpegQ, 95);
  assert.equal(QUALITY.recorder.qp, 0);
  assert.equal(QUALITY.clean.qp, 0);
  assert.equal(QUALITY.recorder.preset, 'ultrafast');
  assert.ok(STILL_JPEG_ARGS.includes('1'));
  assert.ok(STILL_JPEG_ARGS.some((a) => String(a).includes('yuv444p')));
});

test('a softer encode is refused before ffmpeg runs', () => {
  assert.doesNotThrow(() => assertX264Args('recorder', tagged(losslessX264(QUALITY.recorder.preset))));
  assert.doesNotThrow(() => assertX264Args('clean', tagged(losslessX264(QUALITY.clean.preset))));
  assert.doesNotThrow(() => assertX264Args('plate', tagged(lossyX264(QUALITY.plate))));
  // A JPEG pipe names mjpeg on the input and libx264 on the output. The floor judges the output.
  assert.doesNotThrow(() =>
    assertX264Args('plate', ['-c:v', 'mjpeg', '-i', 'pipe:0', ...lossyX264(QUALITY.plate), ...BT709_TAGS, 'out.mp4'])
  );
  assert.throws(
    () => assertX264Args('plate', ['-c:v', 'mjpeg', '-i', 'pipe:0', '-c:v', 'mjpeg', 'out.mp4']),
    /libx264/
  );
  assert.doesNotThrow(() => assertX264Args('delivery', tagged(lossyX264(QUALITY.delivery))));
  assert.throws(() => assertX264Args('clean', tagged(lossyX264({ preset: 'veryfast', crf: 12 }))), /lossless/);
  assert.throws(() => assertX264Args('delivery', tagged(lossyX264({ preset: 'medium', crf: 14 }))), /softer/);
  assert.throws(() => assertX264Args('delivery', tagged(lossyX264({ preset: 'veryfast', crf: 12 }))), /preset/);
  assert.throws(() => assertX264Args('plate', tagged([...lossyX264(QUALITY.plate), '-tune', 'animation'])), /animation/);
  assert.throws(() => assertVideoCopied(['-c:v', 'libx264']), /copied/);
  assert.doesNotThrow(() => assertVideoCopied(['-c:v', 'copy']));
});

test('every picture is converted and tagged BT.709 limited range', () => {
  // Chromium JPEGs are BT.601 full range; tagging without converting shifts colours green.
  assert.throws(() => assertX264Args('plate', lossyX264(QUALITY.plate)), /BT\.709/);
  assert.throws(
    () => assertX264Args('recorder', [...losslessX264('ultrafast'), '-colorspace', 'bt709', '-color_range', 'pc']),
    /BT\.709/
  );
  const vf = toBt709(1920, 1080);
  assert.match(vf, /out_color_matrix=bt709/);
  assert.match(vf, /out_range=limited/);
  assert.match(vf, /setparams=colorspace=bt709/);
  assert.doesNotMatch(vf, /in_color_matrix/, 'the input matrix must come from the frame tags');
});

test('plate JPEG cannot be lowered, and an old master fails QC', () => {
  assert.equal(plateJpegQ(undefined), 95);
  assert.equal(plateJpegQ('100'), 100);
  assert.throws(() => plateJpegQ('80'), /floor/);
  assert.equal(masterQualityError({ quality: { id: QUALITY_ID } }), null);
  assert.match(masterQualityError({ encode: 'x264 slow crf 14' }), /Produce the video again/);
});

test('every picture encode goes through the floor', () => {
  const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
  const produce = read('./produce.mjs');
  const motion = read('./motion.mjs');
  const plates = read('./plates.mjs');
  const mix = read('./audio/mix.mjs');
  assert.match(produce, /assertX264Args\('clean'/);
  assert.match(produce, /assertX264Args\('delivery'/);
  assert.match(motion, /assertX264Args\('recorder'/);
  assert.match(plates, /assertX264Args\('plate'/);
  assert.match(mix, /assertVideoCopied\(/);
  for (const src of [produce, motion, plates]) {
    assert.doesNotMatch(src, /'-crf', '\d+'/);
    assert.doesNotMatch(src, /'-qp', '0'/);
    assert.doesNotMatch(src, /flags=lanczos,setsar=1,format=yuv420p/, 'convert with toBt709, not a bare format=yuv420p');
  }
});

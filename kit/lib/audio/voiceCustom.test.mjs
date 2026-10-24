import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addAdlibLine, cachedTakes, customTakePaths, duplicateVoiceLine, hasCustomTake } from './voice.mjs';

function fakeVideo() {
  const root = mkdtempSync(join(tmpdir(), 'wt-voice-'));
  const out = join(root, 'out');
  mkdirSync(out, { recursive: true });
  return {
    root,
    dir: root,
    out,
    audio: { mix: { voiceLufs: -16, sampleRate: 48000 } },
    config: {},
  };
}

test('ad-lib lines land in voice.json with an absolute start', async () => {
  const video = fakeVideo();
  try {
    const created = await addAdlibLine(video, { text: 'Hello from the cut', at: 12.5 });
    assert.match(created.key, /^adlib-/);
    assert.equal(created.start, 12.5);
    assert.equal(created.text, 'Hello from the cut');
    const meta = JSON.parse(readFileSync(join(video.out, 'voice', 'voice.json'), 'utf8'));
    assert.equal(meta.clips.length, 1);
    assert.equal(meta.clips[0].kind, 'adlib');
    assert.equal(meta.clips[0].start, 12.5);
    assert.equal(meta.clips[0].duration, 0);
  } finally {
    rmSync(video.root, { recursive: true, force: true });
  }
});

test('a duplicated line is its own ad-lib that plays the source audio at the new time', async () => {
  const video = fakeVideo();
  try {
    mkdirSync(join(video.out, 'voice'), { recursive: true });
    const metaPath = join(video.out, 'voice', 'voice.json');
    writeFileSync(
      metaPath,
      JSON.stringify({
        clips: [{ key: 'intro', kind: 'intro', start: 1, end: 4, duration: 3, full: 3.4, speed: 1.05, take: 2, text: 'Meet the feed', file: '/cache/abc.wav', source: 'eleven' }],
      })
    );
    const created = await duplicateVoiceLine(video, 'intro', { at: 9 });
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    const copy = meta.clips.find((c) => c.key === created.key);
    assert.equal(meta.clips.length, 2);
    assert.match(created.key, /^adlib-/);
    assert.deepEqual(
      { kind: copy.kind, start: copy.start, end: copy.end, duration: copy.duration, full: copy.full, file: copy.file, text: copy.text, copyOf: copy.copyOf },
      { kind: 'adlib', start: 9, end: 12, duration: 3, full: 3.4, file: '/cache/abc.wav', text: 'Meet the feed', copyOf: 'intro' }
    );
    await assert.rejects(duplicateVoiceLine(video, 'missing', { at: 1 }), /No voice line/);
  } finally {
    rmSync(video.root, { recursive: true, force: true });
  }
});

test('cachedTakes includes custom upload/mic files without a narration line', () => {
  const video = fakeVideo();
  try {
    const key = 'intro';
    const paths = customTakePaths(video, key, 2);
    writeFileSync(paths.mp3, Buffer.from('fake'));
    assert.equal(hasCustomTake(video, key, 2), true);
    assert.equal(hasCustomTake(video, key, 1), false);
    assert.deepEqual(cachedTakes(video, null, {}, 3, key), [2]);
  } finally {
    rmSync(video.root, { recursive: true, force: true });
  }
});

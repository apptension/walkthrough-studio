import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addAdlibLine, cachedTakes, customTakePaths, hasCustomTake } from './voice.mjs';

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

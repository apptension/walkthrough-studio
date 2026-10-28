import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const here = fileURLToPath(import.meta.url);
import {
  analyzeVoicePictureGap,
  autoRefitVoiceEdits,
  isVoicePictureOverrunError,
  voicePictureManualFixNote,
} from './voicePictureFix.mjs';

describe('voicePictureFix', () => {
  test('detects the mix failure wording', () => {
    assert.ok(isVoicePictureOverrunError('narration runs 24.0s past the picture — too long to freeze automatically.'));
    assert.ok(!isVoicePictureOverrunError('produce-meta.json missing'));
  });

  test('auto refit clears stale at positions past the picture', () => {
    const voiceClips = [
      { key: 'outro', start: 120, duration: 5, full: 5, file: '/tmp/x.wav' },
      { key: 'intro', start: 1, duration: 4, full: 4, file: '/tmp/y.wav' },
    ];
    const voiceEdits = [
      { key: 'outro', at: 144.7 },
      { key: 'intro', at: 1.1 },
    ];
    const { voice, cleared, changed } = autoRefitVoiceEdits(voiceEdits, voiceClips, 125.8);
    assert.equal(changed, true);
    assert.deepEqual(cleared, ['outro']);
    assert.equal(voice.find((v) => v.key === 'outro').at, undefined);
    assert.equal(voice.find((v) => v.key === 'intro').at, 1.1);
  });

  test('manual fix note lists offenders', () => {
    const note = voicePictureManualFixNote({
      pictureSec: 125.8,
      voiceEndSec: 149.8,
      overrunSec: 24,
      offenders: [{ key: 'outro', reason: 'moved to 144.7s on the timeline — the cut is only 125.8s' }],
    });
    assert.match(note, /outro/);
    assert.match(note, /24\.0s/);
  });

  test('analyze marks stale-at offenders as auto-refitable', () => {
    const gap = analyzeVoicePictureGap(
      { out: '/tmp', slug: 'demo', config: { edit: { audio: { voice: [{ key: 'a', at: 50 }] } } } },
      {
        pictureSec: 40,
        voiceMeta: { clips: [{ key: 'a', start: 10, duration: 5, full: 5, file: here }] },
        voiceEdits: [{ key: 'a', at: 50 }],
      },
    );
    assert.ok(gap.overrunSec > 0);
    assert.equal(gap.canAutoRefit, true);
    assert.deepEqual(gap.staleAtKeys, ['a']);
  });
});

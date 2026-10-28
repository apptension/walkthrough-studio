import assert from 'node:assert/strict';
import { describe, test } from 'vitest';

import { isVoicePictureOverrunError, voicePictureOverrunSec } from './voicePictureFix';

describe('voicePictureFix', () => {
  test('detects mix overrun errors', () => {
    const err = 'narration runs 24.0s past the picture — too long to freeze automatically.';
    assert.equal(isVoicePictureOverrunError(err), true);
    assert.equal(voicePictureOverrunSec(err), 24);
  });
});

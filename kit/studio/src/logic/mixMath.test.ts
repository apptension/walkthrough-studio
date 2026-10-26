import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { dbToLin, musicLinearAt, musicVolumeExpr, voiceLinear } from './mixMath';

describe('mixMath', () => {
  test('plate music is trimmed 12 dB and eases down to the bed inside a window', () => {
    const music = { fadeIn: 0, fadeOut: 0 };
    const windows = [{ start: 2, end: 8 }];
    assert.equal(musicLinearAt(1, { music, windows }), dbToLin(-12));
    assert.ok(Math.abs(musicLinearAt(5, { music, windows }) - dbToLin(-12) * dbToLin(-11)) < 1e-12);
    assert.equal(musicLinearAt(5, { music: { mute: true }, windows }), 0);
    assert.equal(musicLinearAt(5, {}), 0);
  });

  test('fades and the voice duck shape the gain', () => {
    const music = { fadeIn: 2, fadeOut: 2 };
    assert.equal(musicLinearAt(1, { music, total: 10 }), dbToLin(-12) * 0.5);
    assert.equal(musicLinearAt(9, { music, total: 10 }), dbToLin(-12) * 0.5);
    assert.equal(musicLinearAt(5, { music, total: 10, voiceActive: true }), dbToLin(-12) * dbToLin(-6));
  });

  test('volume expression nests windows and multiplies rides', () => {
    assert.equal(musicVolumeExpr({ bedGain: 0.5 }), '1.0000');
    assert.equal(
      musicVolumeExpr({ bedGain: 0.5, windows: [{ from: 2, to: 6 }], gainLin: 2 }),
      '(if(lt(t,2.000),1,if(lt(t,3.000),1-(t-2.000)*(1-0.5000)/1.000,if(lt(t,5.000),0.5000,if(lt(t,6.000),0.5000+(t-5.000)*(1-0.5000)/1.000,1)))))*(1)*2.0000',
    );
    assert.match(musicVolumeExpr({ bedGain: 0.5, rides: [{ from: 1, to: 3, gainDb: 6 }, { from: 4, to: 5, gainDb: 0 }] }), /^\(1\)\*\(if\(lt\(t,1\.000\)/);
  });

  test('voice gain follows the voice loudness target', () => {
    assert.equal(voiceLinear(), 1);
    assert.equal(voiceLinear(0, -10), dbToLin(6));
  });
});

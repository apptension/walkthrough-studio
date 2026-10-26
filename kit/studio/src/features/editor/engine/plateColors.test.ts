import { describe, expect, it } from 'vitest';

import {
  contrast,
  contrastLabel,
  matchingPreset,
  mergePlateColors,
  normalizePlateColor,
  patchPlateColors,
  presetPlateColors,
  resolvePlateColors,
  swatchHex,
} from './plateColors';

const BRAND = { ink: '#0a1f0a', surface: '#0f2a0f', gold: '#0ca300', amber: '#7ac943', teal: '#2dd4bf', text: '#f8fafc', muted: '#94a3b8' };
const PRESETS = [
  { id: 'brand', colors: {} },
  { id: 'midnight', colors: { background: '#070b14', accent: 'gold', accent2: 'teal' } },
  { id: 'paper', colors: { background: '#f5f1e8', accent: 'gold', accent2: 'amber' } },
];

// The same cases kit/lib/plateColors.test.mjs pins on the pipeline side.
describe('plate colours (Studio mirror of kit/lib/plateColors.mjs)', () => {
  it('normalises values and patches', () => {
    expect(normalizePlateColor('#ABC')).toBe('#aabbcc');
    expect(normalizePlateColor('GOLD')).toBe('gold');
    expect(normalizePlateColor('auto')).toBeNull();
    expect(patchPlateColors({ background: '#000000' }, { accent: 'teal' })).toEqual({ background: '#000000', accent: 'teal' });
    expect(patchPlateColors({ background: '#000000' }, { background: null })).toEqual({});
    expect(patchPlateColors({}, { background: 'brand' }, false)).toEqual({});
  });

  it('a slide preset pins what it leaves out; a video preset does not', () => {
    expect(presetPlateColors(PRESETS[2]!.colors)).toEqual({ ...PRESETS[2]!.colors, text: 'brand' });
    expect(presetPlateColors(PRESETS[2]!.colors, false)).toEqual(PRESETS[2]!.colors);
    expect(mergePlateColors({ background: '#070b14', text: '#ff0000' }, presetPlateColors({}))).toEqual({});
  });

  it('plate keys override the video default key by key', () => {
    expect(mergePlateColors({ background: '#070b14', accent: 'teal' }, { accent: 'amber' })).toEqual({ background: '#070b14', accent: 'amber' });
  });

  it('resolves exactly like the pipeline', () => {
    const none = resolvePlateColors(BRAND, {}, {});
    expect(none.set).toBe(false);
    expect(none.vars['--ink']).toBe(BRAND.ink);

    const r = resolvePlateColors(BRAND, { background: 'amber', accent: '#ff00aa', accent2: 'gold' }, null);
    expect(r.colors.ink).toBe('#7ac943');
    expect(r.colors.gold).toBe('#ff00aa');
    expect(r.colors.teal).toBe(BRAND.gold);

    const paper = resolvePlateColors(BRAND, { background: '#f5f1e8' }, null);
    expect(paper.colors.text).toBe('#11141a');
    expect(contrast(paper.colors.muted, paper.colors.ink)).toBeGreaterThanOrEqual(3);
    expect(paper.vars['--shade']).toBe('#0a0a0a');
    expect(resolvePlateColors(BRAND, { background: '#070b14' }, null).colors.text).toBe(BRAND.text);
  });

  it('labels contrast, names swatches and spots presets', () => {
    expect(contrastLabel(7.2)).toEqual({ text: '7.2:1 · AAA', ok: true });
    expect(contrastLabel(2.1).ok).toBe(false);
    expect(swatchHex('gold', BRAND)).toBe(BRAND.gold);
    expect(swatchHex('#123456', BRAND)).toBe('#123456');
    expect(matchingPreset({}, PRESETS)).toBe('brand');
    expect(matchingPreset({ background: '#070b14', accent: 'gold', accent2: 'teal' }, PRESETS)).toBe('midnight');
    expect(matchingPreset({ background: '#070b14' }, PRESETS)).toBeNull();
    expect(matchingPreset({ ...PRESETS[2]!.colors, text: 'brand' }, PRESETS)).toBe('paper');
  });
});

import { describe, expect, it } from 'vitest';

import { STAGE_RENDER_CSS } from '@/features/editor/engine/plate';
import { ICON_ALIAS, ICON_BODY, ICON_META } from '@/ui/icons.gen';
import { legacyModule } from './legacySource';

describe('the editor paints plates under the render\u2019s own CSS', () => {
  it('matches renderCss.js, so the stage cannot drift from the encode', () => {
    const legacy = legacyModule<{ RENDER_CSS: string }>('renderCss.js', ['RENDER_CSS']);
    expect(STAGE_RENDER_CSS).toBe(legacy.RENDER_CSS);
  });
});

describe('icon tables match kit/lib/shared', () => {
  it('the icon table matches icons.js', () => {
    type LegacyIcons = {
      ICON_BODY: Record<string, string>;
      ICON_META: Record<string, { viewBox: string; present?: Record<string, string> }>;
      ALIAS: Record<string, string>;
    };
    const gen = legacyModule<Omit<LegacyIcons, 'ALIAS'>>('icons.gen.js', ['ICON_BODY', 'ICON_META']);
    const legacy = legacyModule<LegacyIcons>('icons.js', ['ICON_BODY', 'ICON_META', 'ALIAS'], gen);
    expect(ICON_BODY).toEqual(legacy.ICON_BODY);
    expect(ICON_ALIAS).toEqual(legacy.ALIAS);
    for (const [id, meta] of Object.entries(legacy.ICON_META)) {
      expect(ICON_META[id], id).toEqual({ viewBox: meta.viewBox, present: meta.present ?? {} });
    }
  });
});

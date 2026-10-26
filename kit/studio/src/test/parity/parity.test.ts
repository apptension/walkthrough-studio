import { describe, expect, it } from 'vitest';

import { ICON_ALIAS, ICON_BODY, ICON_META } from '@/ui/icons.gen';
import { legacyModule } from './legacySource';

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

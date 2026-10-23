import type { HtmlPlate } from '@/api/types';

export type PlateQcView = { kind: 'none' } | { kind: 'clipped' | 'bad'; names: string };

/** `renderPlateQcBanner(plates)` as a view: failed encodes win over clipped copy. */
export function plateQcView(plates: readonly HtmlPlate[]): PlateQcView {
  const bad = plates.filter((p) => p.encode && p.encode.ok === false);
  const clipped = plates.filter((p) => (p.encode?.notes || []).some((note) => note.startsWith('Copy clips')));
  if (bad.length) return { kind: 'bad', names: bad.map((p) => p.label || p.id).join(', ') };
  if (clipped.length) return { kind: 'clipped', names: clipped.map((p) => p.label || p.id).join(', ') };
  return { kind: 'none' };
}

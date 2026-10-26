import type { HtmlPlate } from '@/api/types';

export type PlateQcView = { kind: 'none' } | { kind: 'bad'; names: string };

/**
 * Failed plate encodes. Copy that still clips is a writing problem, so it lives on the
 * plate's copy editor rather than here.
 */
export function plateQcView(plates: readonly HtmlPlate[]): PlateQcView {
  const bad = plates.filter((p) => p.encode && p.encode.ok === false);
  if (bad.length) return { kind: 'bad', names: bad.map((p) => p.label || p.id).join(', ') };
  return { kind: 'none' };
}

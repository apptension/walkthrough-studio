/**
 * Which section layout the stage and the inspector are looking at. Sections are the stretches
 * between chapter marks; a live clip maps to the section that contains its start.
 */
import type { Clip, DeckLayouts, DeckSection, LayoutRow, LayoutText } from './types';
import { ed } from './state';

export const layoutPack = (): DeckLayouts | undefined => ed.deck?.layouts;

export function sectionForClip(c: Clip | null | undefined): DeckSection | null {
  const sections = layoutPack()?.sections;
  if (!c || c.kind !== 'live' || !sections?.length) return null;
  const span = Math.max(0, c.recTo - c.recFrom);
  const t = c.recFrom + Math.min(0.15, span / 2);
  return sections.find((s) => t >= s.from - 1e-3 && t < s.to - 1e-6) || sections.find((s) => t >= s.from - 1e-3 && t <= s.to + 1e-3) || null;
}

/** The section under the playhead, which is the clip `renderFrame` just landed on. */
export const sectionAtPlayhead = (): DeckSection | null => sectionForClip(ed.seq[ed.cur] || null);

/** True once any section leaves the video's camera frame. Cards then cover the whole output. */
export const layoutsAreCustom = (): boolean => Boolean(layoutPack()?.sections?.some((s) => s.custom));

export function layoutRow(section: DeckSection): LayoutRow {
  const row = section.layout;
  return row
    ? { key: section.key, placement: row.placement, size: row.size, text: { ...row.text } }
    : { key: section.key, placement: 'fill', size: 'medium', text: { on: false } };
}

/** Keep a title or body only when it differs from the chapter's own words. */
export function layoutText(on: boolean, title: string, body: string, source?: { title: string; body: string }): LayoutText {
  const text: LayoutText = { on };
  const t = title.replace(/\s+/g, ' ').trim().slice(0, 80);
  const b = body.replace(/\s+/g, ' ').trim().slice(0, 240);
  if (t && t !== (source?.title || '').trim()) text.title = t;
  if (b && b !== (source?.body || '').trim()) text.body = b;
  return text;
}

export function upsertLayout(rows: LayoutRow[] | undefined, key: string, row: LayoutRow | null): LayoutRow[] {
  const next = (rows || []).filter((r) => r.key !== key);
  if (row && row.placement !== 'fill') next.push(row);
  return next;
}

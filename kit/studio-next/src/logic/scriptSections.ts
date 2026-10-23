/** Opening, Story, and Closing start folded so the first screen is the header, not every beat. */

export const SCENARIO_EDITABLE_NOTE = 'This draft stays editable.';

export interface SectionCollapsed {
  opening: boolean;
  story: boolean;
  closing: boolean;
}

export function defaultSectionCollapsed(): SectionCollapsed {
  return { opening: true, story: true, closing: true };
}

/** A beat stays in the list; collapse only hides it until that section is opened. */
export function sceneVisible(kind: string, collapsed: SectionCollapsed = defaultSectionCollapsed()): boolean {
  if (kind === 'open') return !collapsed.opening;
  if (kind === 'close') return !collapsed.closing;
  if (kind === 'chapter' || kind === 'step' || kind === 'plate') return !collapsed.story;
  return true;
}

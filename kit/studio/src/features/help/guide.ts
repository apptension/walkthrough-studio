import { openDialog } from '@/desk/store';

/** The Studio guide (`#helpDialog`) — the guide half of `kit/studio/help.js`. */

export const GUIDE_SECTIONS = ['guideHow', 'guideDesk', 'guideWords', 'guideKeys'] as const;
export type GuideSection = (typeof GUIDE_SECTIONS)[number];

export const GUIDE_NAV: ReadonlyArray<{ id: GuideSection; label: string }> = [
  { id: 'guideHow', label: 'How it works' },
  { id: 'guideDesk', label: 'The desk' },
  { id: 'guideWords', label: 'Words' },
  { id: 'guideKeys', label: 'Shortcuts' },
];

/** Modifier glyph for shortcut keycaps — ⌘ on Apple, Ctrl elsewhere. */
export function modKeyGlyph(platform = typeof navigator !== 'undefined' ? navigator.platform || '' : ''): string {
  return /Mac|iPhone|iPad|Macintosh/i.test(platform) ? '⌘' : 'Ctrl';
}

export const HELP_SUB = 'Brief → script → direction → record → cut → deliver. Jump a section, or open a stage.';

/** `showBuildVersion` prefixed the guide's subtitle with the build. */
export function helpSub(version: string | null): string {
  return version ? `${version} · ${HELP_SUB}` : HELP_SUB;
}

/**
 * Which section the scroll position belongs to. Biased toward the upper third
 * so a jumped section stays selected while its heading sits at the top; the
 * last section is pinned once the body is scrolled to the end.
 */
export function sectionFromScroll(
  body: { scrollTop: number; clientHeight: number; scrollHeight: number; offsetTop: number },
  offsets: Partial<Record<GuideSection, number>>,
): GuideSection {
  const last = GUIDE_SECTIONS[GUIDE_SECTIONS.length - 1] as GuideSection;
  if (body.scrollTop + body.clientHeight >= body.scrollHeight - 12) return last;
  const top = body.scrollTop + Math.min(72, body.clientHeight * 0.28);
  let active: GuideSection = GUIDE_SECTIONS[0];
  for (const id of GUIDE_SECTIONS) {
    const at = offsets[id];
    if (at == null) continue;
    if (at - body.offsetTop <= top) active = id;
  }
  return active;
}

export function openHelp(): void {
  openDialog('help', true);
}

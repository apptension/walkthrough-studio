import type { Direction, VideoSummary } from '@/api/types';

const DEFAULT_ROLES = [
  { id: 'ink', label: 'Ink' },
  { id: 'surface', label: 'Surface' },
  { id: 'gold', label: 'Accent' },
  { id: 'amber', label: 'Secondary' },
  { id: 'teal', label: 'Support' },
];

/** The five colour roles, in the order every swatch row draws them. */
export const rolesOf = (direction: Direction | null) => direction?.roles || DEFAULT_ROLES;

/** `#paceNote`: how long narration held the last take. `null` keeps the note hidden. */
export function paceNote(pace: Direction['pace'], live: VideoSummary['livePace']): { text: string; tone: string } | null {
  const pct = live ? Math.round((live.narrationHoldShare || 0) * 100) : 0;
  const bound = Boolean(live && (live.narrationHoldSec ?? 0) >= 3);
  if (!live || !bound) return null;
  return {
    text: `Last take: narration held the tour ${live.narrationHoldSec}s (${pct}%)${live.id !== pace.id ? ` at pace ${live.id}` : ''}${
      pct >= 20 ? ' — a faster pace cannot shorten this; trim those lines or raise voice speed.' : '.'
    }`,
    tone: pct >= 20 ? 'warn' : '',
  };
}

import type { Direction, VideoSummary } from '@/api/types';

/** Static markup marks only the default button until the first render marks them all. */
export function radioAria(on: boolean, marked: boolean): 'true' | 'false' | undefined {
  if (on) return 'true';
  return marked ? 'false' : undefined;
}

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

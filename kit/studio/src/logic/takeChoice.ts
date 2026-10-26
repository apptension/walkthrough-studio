/**
 * The pure parts of `kit/studio/takeChoice.js`: the remembered choice per
 * sequence and the one-line summary of a guided take. `TakeChoice.tsx` renders
 * the card itself.
 */

export type TakeChoice = 'own' | 'bot' | 'again';

export interface TakeChapter {
  t: number;
  title: string;
}

export interface GuidedTake {
  url: string;
  poster?: string;
  seconds: number;
  chapters?: TakeChapter[];
  cuts?: number;
  cutSec?: number;
}

export interface GuidedTour {
  take?: GuidedTake | null;
  steps?: number;
}

export const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const PREF = (slug: string) => `wt.takeChoice.${slug}`;

export function rememberedTakeChoice(slug: string | null | undefined): 'own' | 'bot' | null {
  try {
    const v = localStorage.getItem(PREF(slug ?? 'null'));
    return v === 'own' || v === 'bot' ? v : null;
  } catch {
    return null;
  }
}

export function rememberTakeChoice(slug: string | null | undefined, choice: string): void {
  try {
    if (choice === 'own' || choice === 'bot') localStorage.setItem(PREF(slug ?? 'null'), choice);
  } catch {
    /* private mode */
  }
}

/** One line on what the recording holds. */
export function takeFacts(tour: GuidedTour | null | undefined): string {
  const take = tour?.take;
  if (!take) return '';
  const bits = [clock(take.seconds), plural(take.chapters?.length || 0, 'chapter')];
  if (tour.steps) bits.push(plural(tour.steps, 'step'));
  if (take.cuts) bits.push(`${plural(take.cuts, 'pause')} cut (${Math.round(take.cutSec ?? 0)}s)`);
  return bits.join(' · ');
}

/** Which option the card pre-selects. */
export function preferredTakeChoice(tour: GuidedTour | null | undefined, slug: string | null | undefined): 'own' | 'bot' {
  const take = tour?.take;
  const replayable = Boolean(tour?.steps);
  return !take ? 'bot' : !replayable ? 'own' : rememberedTakeChoice(slug) || 'own';
}

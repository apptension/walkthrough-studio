import type { BranchIdea, BranchRequest } from '@/api/types';

/** What the director has typed into the branch brief. */
export interface BranchDraft {
  title: string;
  angle: string;
  outcome: string;
}

export const EMPTY_BRANCH: BranchDraft = { title: '', angle: '', outcome: '' };

/** The brief as a suggestion fills it in. */
export function draftFromIdea(idea: BranchIdea): BranchDraft {
  return {
    title: idea.title,
    angle: idea.angle ?? '',
    outcome: idea.outcome ?? '',
  };
}

/**
 * Whether a draft still matches the suggestion it came from. Editing any field
 * turns a picked suggestion back into the director's own angle, which is what
 * decides between sending an `ideaId` and sending a whole idea.
 */
export function matchesIdea(draft: BranchDraft, idea: BranchIdea | undefined): boolean {
  if (!idea) return false;
  return (
    draft.title.trim() === idea.title &&
    draft.angle.trim() === (idea.angle ?? '') &&
    draft.outcome.trim() === (idea.outcome ?? '')
  );
}

/** How the brief describes itself above the form. */
export function briefMode(draft: BranchDraft, picked: BranchIdea | undefined): string {
  if (matchesIdea(draft, picked)) return 'From suggestion';
  if (draft.title.trim()) return 'Your own angle';
  return 'Pick a suggestion or write your own';
}

/**
 * The create request.
 *
 * An untouched suggestion travels as its id, so the server keeps the rest of
 * what it knows about that angle. Anything else carries a full idea, with the
 * same defaults the legacy desk sent: a 90-second feature cut whose must-show
 * list falls back to the angle, or to the title when there is no angle.
 */
export function branchRequest(draft: BranchDraft, picked: BranchIdea | undefined): BranchRequest {
  const title = draft.title.trim();
  const angle = draft.angle.trim();
  const outcome = draft.outcome.trim();
  const base = { title, angle, outcome, purpose: 'feature' };

  if (matchesIdea(draft, picked) && picked) return { ...base, ideaId: picked.id };

  return {
    ...base,
    idea: {
      title,
      angle,
      outcome,
      purpose: 'feature',
      lengthSec: 90,
      mustShow: angle ? [angle] : [title],
      plates: ['features', 'callout'],
      source: 'custom',
    },
  };
}

/** The line under the ideas list: how many, and where they came from. */
export function ideasSummary(count: number, agent: boolean | undefined): string {
  if (count === 0) return 'No ideas yet — write your own';
  const plural = count === 1 ? 'idea' : 'ideas';
  return `${count} ${plural}${agent ? ' · includes agent' : ' · from this story'}`;
}

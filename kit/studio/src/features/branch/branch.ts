import { create } from 'zustand';

import type { BranchIdea, BranchIdeas, BranchResult, JobAccepted } from '@/api/types';
import { api } from '@/desk/api';
import { watchJob } from '@/desk/jobs';
import { desk, openDialog } from '@/desk/store';
import { toast } from '@/desk/toast';
import { openVideo } from '@/desk/video';

import { branchRequest, draftFromIdea, EMPTY_BRANCH, ideasSummary, matchesIdea, type BranchDraft } from './model';

/** The branch sheet — `kit/studio/branch.js`. */

interface BranchSheetState {
  source: string;
  ideas: BranchIdea[];
  selectedId: string | null;
  draft: BranchDraft;
  status: string;
  discovering: boolean;
  creating: boolean;
  /** Bumped when the title field should take focus. */
  focusTitle: number;
}

export const useBranchSheet = create<BranchSheetState>()(() => ({
  source: 'this overview',
  ideas: [],
  selectedId: null,
  draft: EMPTY_BRANCH,
  status: 'Loading ideas…',
  discovering: false,
  creating: false,
  focusTitle: 0,
}));

const sheet = useBranchSheet;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sourceSlug(): string {
  return desk.get().slug || '';
}

export function selectedIdea(s: Pick<BranchSheetState, 'ideas' | 'selectedId'>): BranchIdea | undefined {
  return s.selectedId ? s.ideas.find((i) => i.id === s.selectedId) : undefined;
}

export type BriefModeKind = 'idea' | 'custom' | '';

/** `paintMode()`: the label, `#branchBrief[data-mode]` and whether "Write your own" is lit. */
export function briefModeView(s: Pick<BranchSheetState, 'ideas' | 'selectedId' | 'draft'>): { label: string; mode: BriefModeKind } {
  if (selectedIdea(s)) return { label: 'From suggestion', mode: 'idea' };
  if (s.draft.title.trim()) return { label: 'Your own angle', mode: 'custom' };
  return { label: 'Pick a suggestion or write your own', mode: '' };
}

export function selectIdea(id: string): void {
  const idea = sheet.getState().ideas.find((i) => i.id === id);
  sheet.setState(idea ? { selectedId: id, draft: draftFromIdea(idea) } : { selectedId: id });
}

export function startCustom({ focus = true } = {}): void {
  sheet.setState((s) => ({ selectedId: null, draft: EMPTY_BRANCH, focusTitle: focus ? s.focusTitle + 1 : s.focusTitle }));
}

/** Editing the brief after picking an idea turns it into a custom branch. */
export function editDraft(patch: Partial<BranchDraft>): void {
  const s = sheet.getState();
  const draft = { ...s.draft, ...patch };
  const idea = selectedIdea(s);
  if (s.selectedId && !matchesIdea(draft, idea)) sheet.setState({ draft, selectedId: null });
  else sheet.setState({ draft });
}

export async function loadIdeas(): Promise<void> {
  const slug = sourceSlug();
  if (!slug) return;
  sheet.setState({ status: 'Loading ideas…' });
  try {
    const r = await api<BranchIdeas>(`/api/video/${encodeURIComponent(slug)}/branch/ideas`);
    const ideas = r.ideas || [];
    sheet.setState({ ideas, status: ideasSummary(ideas.length, r.agent) });
    const s = sheet.getState();
    const first = ideas[0];
    if (!s.selectedId && first && !s.draft.title.trim()) selectIdea(first.id);
  } catch (err) {
    sheet.setState({ status: message(err) });
    toast('Could not load ideas', message(err), 'err');
  }
}

interface DiscoverResult {
  ideas?: BranchIdea[] | { ideas?: BranchIdea[] };
  job?: JobAccepted['job'] | null;
}

export async function discover(): Promise<void> {
  const slug = sourceSlug();
  if (!slug || sheet.getState().discovering) return;
  sheet.setState({ discovering: true, status: 'Discovering with the agent…' });
  try {
    const r = await api<DiscoverResult>(`/api/video/${encodeURIComponent(slug)}/branch/discover`, { method: 'POST', body: {} });
    const found = Array.isArray(r.ideas) ? r.ideas : r.ideas?.ideas;
    if (found) sheet.setState({ ideas: found });
    if (r.job?.id) {
      toast('Agent exploring', 'Ideas will refresh when the pass finishes');
      await watchJob(r.job.id, { surface: 'session' }).catch(() => null);
      await loadIdeas();
    } else {
      await loadIdeas();
      const n = sheet.getState().ideas.length;
      toast('Ideas ready', `${n} feature angle${n === 1 ? '' : 's'}`);
    }
  } catch (err) {
    toast('Discover failed', message(err), 'err');
    sheet.setState({ status: message(err) });
  } finally {
    sheet.setState({ discovering: false });
  }
}

export async function createBranch(): Promise<void> {
  const slug = sourceSlug();
  if (!slug) return;
  const s = sheet.getState();
  if (!s.draft.title.trim()) {
    toast('Name the video', 'Pick a suggestion or type a title below', 'warn');
    sheet.setState({ focusTitle: s.focusTitle + 1 });
    return;
  }
  const body = branchRequest(s.draft, selectedIdea(s));
  sheet.setState({ creating: true });
  try {
    const r = await api<BranchResult>(`/api/video/${encodeURIComponent(slug)}/branch`, { method: 'POST', body });
    openDialog('branch', false);
    toast('Branch created', `${r.title || r.slug} · drafting the focused script`);
    await openVideo(r.slug);
    if (r.job?.id) {
      watchJob(r.job.id, { surface: 'session' })
        .then(() => {
          toast('Branch draft ready', 'Review the script, then record');
          return openVideo(r.slug);
        })
        .catch((err: unknown) => {
          if (!/cancel/i.test(message(err))) toast('Branch draft', message(err), 'warn');
        });
    }
  } catch (err) {
    toast('Branch not created', message(err), 'err');
  } finally {
    sheet.setState({ creating: false });
  }
}

export function openBranch(): void {
  const slug = sourceSlug();
  if (!slug) {
    toast('Open a video first', 'Branch copies the current project', 'warn');
    return;
  }
  sheet.setState({ source: desk.get().video?.title || slug, selectedId: null, draft: EMPTY_BRANCH });
  openDialog('branch', true);
  void loadIdeas();
}

import type { Brief, ReviewLeg, Story } from '@/api/types';
import type { SectionCollapsed } from '@/logic/scriptSections';

import type { LintNote, Script, ScriptScene } from './types';

/** Pure pieces of the script sheet in `kit/studio/workflow.js`. */

/** Mirrors kit/lib/plateTypes.mjs — used only until the script payload (which carries the catalog) loads. */
export const PLATE_TYPE_FALLBACK: ReadonlyArray<{ type: string; label: string; hint: string }> = [
  { type: 'features', label: 'Features', hint: 'Capability grid' },
  { type: 'journey', label: 'Journey', hint: 'Ordered tour path' },
  { type: 'process', label: 'Process', hint: 'How it works' },
  { type: 'timeline', label: 'Timeline', hint: 'Milestones on a rail' },
  { type: 'checklist', label: 'Checklist', hint: 'Outcomes ticked off' },
  { type: 'logos', label: 'Logos', hint: 'Integration wall' },
  { type: 'orbit', label: 'Orbit', hint: 'Orbiting logos' },
  { type: 'testimonials', label: 'Testimonials', hint: 'Quote flood' },
  { type: 'quote', label: 'Quote', hint: 'Hero quote' },
  { type: 'stats', label: 'Stats', hint: 'Hard numbers' },
  { type: 'kpi', label: 'KPI board', hint: 'Dashboard tiles' },
  { type: 'metric', label: 'Metric', hint: 'One number' },
  { type: 'callout', label: 'Callout', hint: 'Thesis + bullets' },
  { type: 'statement', label: 'Statement', hint: 'Kinetic type' },
  { type: 'compare', label: 'Compare', hint: 'Before / after' },
  { type: 'faq', label: 'FAQ', hint: 'Questions answered' },
  { type: 'pricing', label: 'Pricing', hint: 'Plans side by side' },
  { type: 'team', label: 'People', hint: 'Roles with avatars' },
  { type: 'showcase', label: 'Showcase', hint: 'Interface shot with callouts' },
  { type: 'bento', label: 'Bento', hint: 'Editorial board' },
];

/** Row-editor placeholders by column; `<type>.<column>` wins over the plain column name. */
const PLATE_ROW_PLACEHOLDER: Record<string, string> = {
  label: 'Label',
  note: 'Note',
  icon: 'Icon',
  asset: 'Asset file',
  quote: 'Quote',
  author: 'Author',
  role: 'Role',
  value: 'Value',
  text: 'Bullet',
  date: 'Date (Q2 · 2025 · Now)',
  delta: 'Delta (+12% · −3)',
  period: 'per user / month',
  lines: 'Lines · separated · by dots',
  'pricing.label': 'Plan name',
  'pricing.value': 'Price ($12)',
  'pricing.note': 'Who it is for',
  'team.label': 'Name or role',
  'team.note': 'What they get',
  'team.asset': 'Photo file (optional)',
  'kpi.label': 'Metric name',
  'timeline.label': 'Milestone',
};

export function rowPlaceholder(plateType: string | undefined, field: string): string {
  const faq = plateType === 'faq';
  return (
    PLATE_ROW_PLACEHOLDER[`${plateType}.${field}`] ||
    (faq && field === 'label' ? 'Question' : faq && field === 'note' ? 'Answer' : PLATE_ROW_PLACEHOLDER[field] || field)
  );
}

const KIND_LABEL: Record<string, string> = { open: 'Open', plate: 'Plate', chapter: 'Chapter', step: 'Caption', close: 'Close' };

export function sceneKindLabel(s: ScriptScene): string {
  return s.kind === 'plate' && s.plate?.typeLabel ? s.plate.typeLabel : KIND_LABEL[s.kind] || s.kind;
}

export function sceneRole(s: ScriptScene): string {
  return s.kind === 'chapter' ? 'Chapter' : s.kind === 'step' ? 'Caption' : s.kind === 'open' ? 'Open' : s.kind === 'close' ? 'Close' : 'Plate';
}

export function scenePreviewTitle(s: ScriptScene): string {
  if (s.kind === 'plate') return String(s.plateTitle || s.title || s.plateId || 'Plate');
  return String(s.title || sceneRole(s));
}

export type SectionId = keyof SectionCollapsed;

export function sectionOf(kind: string): SectionId {
  return kind === 'open' ? 'opening' : kind === 'close' ? 'closing' : 'story';
}

/** A scaffold's "No narration" notes are noise until the real draft lands. */
export function sceneIssues(s: ScriptScene, scaffold: boolean): LintNote[] {
  return (scaffold ? (s.issues || []).filter((x) => !x.message.startsWith('No narration')) : s.issues) || [];
}

export function worstLevel(issues: LintNote[]): '' | 'error' | 'warn' | 'info' {
  if (issues.some((x) => x.level === 'error')) return 'error';
  if (issues.some((x) => x.level === 'warn')) return 'warn';
  return issues.length ? 'info' : '';
}

export function canDragScene(s: ScriptScene): boolean {
  if (s.kind === 'plate') return Boolean(s.editable?.place && s.plateId);
  if (s.kind === 'chapter' || s.kind === 'step') return Boolean(s.editable?.move && s.flowIndex != null);
  return false;
}

export function sceneClassName(s: ScriptScene, scaffold: boolean): string {
  const worst = worstLevel(sceneIssues(s, scaffold));
  const hasVo = Boolean((s.narration || '').trim());
  return `script-scene kind-${s.kind}${s.plateType ? ` plate-${s.plateType}` : ''}${worst ? ` has-${worst}` : ''}${
    hasVo ? ' has-vo' : ' no-vo'
  }${canDragScene(s) ? ' is-draggable' : ''}`;
}

/** The pace select: 0.80× to 1.30× in 0.05 steps. */
export function speedOptions(selected: number | null | undefined): Array<{ value: number; label: string; selected: boolean }> {
  const cur = selected == null ? 1 : Number(selected);
  const speeds: number[] = [];
  for (let s = 0.8; s <= 1.3 + 1e-6; s = Math.round((s + 0.05) * 100) / 100) speeds.push(s);
  return speeds.map((s) => ({
    value: s,
    selected: Math.abs(s - cur) < 0.01,
    label: s < 0.97 ? `${s.toFixed(2)}× slower` : s > 1.03 ? `${s.toFixed(2)}× quicker` : `${s.toFixed(2)}× natural`,
  }));
}

export interface TimingView {
  card: boolean;
  tight: boolean;
  fit: number;
  hold: number;
  vo: number;
}

export function timingView(s: ScriptScene): TimingView {
  const hold = Number(s.holdSec || 0);
  const vo = Number(s.narrationSec || 0);
  return {
    card: s.timingKind === 'card' && Boolean(s.editable?.hold),
    tight: vo > 0 && hold > 0 && vo > hold + 0.6,
    fit: Math.max(hold, vo),
    hold,
    vo,
  };
}

/** One entry in `#scriptScenes`, in order: section headers sit before the first scene of their part. */
export type SceneListItem =
  | { type: 'section'; id: SectionId; label: string; hint: string; count: number }
  | { type: 'scene'; scene: ScriptScene; index: number };

export function sceneListItems(scenes: ScriptScene[]): SceneListItem[] {
  const out: SceneListItem[] = [];
  let openDone = false;
  let storyOpen = false;
  let closeDone = false;
  const isStory = (k: string) => k === 'chapter' || k === 'step' || k === 'plate';
  const storyCount = scenes.filter((s) => isStory(s.kind)).length;
  scenes.forEach((s, i) => {
    if (s.kind === 'open' && !openDone) {
      out.push({ type: 'section', id: 'opening', label: 'Opening', hint: 'Brand intro — first impression', count: 0 });
      openDone = true;
    }
    if (isStory(s.kind) && !storyOpen) {
      out.push({ type: 'section', id: 'story', label: 'Story', hint: 'Chapters, captions and plates in cut order', count: storyCount });
      storyOpen = true;
    }
    if (s.kind === 'close' && !closeDone) {
      out.push({ type: 'section', id: 'closing', label: 'Closing', hint: 'Recap before the end card', count: 0 });
      closeDone = true;
    }
    out.push({ type: 'scene', scene: s, index: i });
  });
  return out;
}

export interface SceneVisibility {
  /** `li.hidden` per scene key. */
  sceneHidden: Map<string, boolean>;
  /** `is-section-collapsed` per scene key. */
  sceneCollapsed: Map<string, boolean>;
  sectionHidden: Map<SectionId, boolean>;
  composerHidden: boolean;
  /** "No issues" placeholder. */
  empty: boolean;
}

/** `syncSectionCollapseClasses()` + `applyIssueFilter()`. */
export function sceneVisibility(items: SceneListItem[], collapsed: SectionCollapsed, onlyIssues: boolean, scaffold: boolean): SceneVisibility {
  const sceneHidden = new Map<string, boolean>();
  const sceneCollapsed = new Map<string, boolean>();
  const sectionHidden = new Map<SectionId, boolean>();
  let section: SectionId | null = null;
  let anyMatch = false;
  let shown = 0;
  const closeSection = () => {
    if (section) sectionHidden.set(section, onlyIssues && !anyMatch);
  };
  for (const item of items) {
    if (item.type === 'section') {
      closeSection();
      section = item.id;
      anyMatch = false;
      continue;
    }
    const s = item.scene;
    const count = sceneIssues(s, scaffold).length;
    const byCollapse = section ? Boolean(collapsed[section]) : false;
    const byIssues = onlyIssues && count === 0;
    sceneCollapsed.set(s.key, byCollapse);
    sceneHidden.set(s.key, byIssues || byCollapse);
    if (!(byIssues || byCollapse)) shown++;
    if (!byIssues) anyMatch = true;
  }
  closeSection();
  return { sceneHidden, sceneCollapsed, sectionHidden, composerHidden: onlyIssues, empty: onlyIssues && !shown };
}

export function totalsLength(estSec: number): string {
  const mm = Math.floor(estSec / 60);
  const ss = String(estSec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function totalsText(script: Script, drafting: boolean): string {
  const t = script.totals;
  if (drafting) return 'Writing chapters, plates and narration from your brief…';
  if (script.scaffold) return 'Starter template · waiting for a real draft';
  return `${t.chapters} chapters · ${t.plates} plates · ${t.words} words · ~${totalsLength(t.estSec)}`;
}

export function approvedMeta(r: Pick<ReviewLeg, 'effective' | 'approvedAt' | 'approvedBy'>, errors: number, drafting: boolean, when: (iso: string | null | undefined) => string): string {
  if (r.effective === 'approved') return `Approved ${when(r.approvedAt)}${r.approvedBy ? ` by ${r.approvedBy}` : ''}`;
  if (r.effective === 'changed') return `Approved ${when(r.approvedAt)} — sources changed since`;
  if (!drafting && errors) return `${errors} blocking issue(s)`;
  return '';
}

/** The `<details>` line pinned at the top of the lint list. */
export function briefDetail(brief: Brief, story: Pick<Story, 'label' | 'framework'> | null | undefined): string {
  return (
    [
      story && `Story: ${story.label} — ${story.framework}`,
      brief.outcome && `Outcome: ${brief.outcome}`,
      brief.story?.mustShow?.length &&
        `Show: ${brief.story.mustShow.map((beat) => String(beat).split(/\s+[·•|]?\s*how:|\s+[—–]\s+/i)[0]?.trim() ?? '').join(' → ')}`,
    ]
      .filter(Boolean)
      .join(' · ') || 'Pinned with the project.'
  );
}

/** Lint notes that don't belong to a scene. */
export function globalLint(script: Script): LintNote[] {
  return script.lint.filter((l) => !script.scenes.some((s) => s.key === l.key));
}

/* ---------- drag reorder ---------- */

/** Nearest chapter scene at or before this key (plates resolve via their `before`). */
export function chapterSceneNear(scenes: ScriptScene[], key: string): ScriptScene | null {
  const i = scenes.findIndex((s) => s.key === key);
  if (i < 0) return null;
  const at = scenes[i] as ScriptScene;
  if (at.kind === 'chapter') return at;
  if (at.kind === 'plate' && at.before) return scenes.find((s) => s.kind === 'chapter' && s.title === at.before) || null;
  for (let j = i; j >= 0; j--) if (scenes[j]?.kind === 'chapter') return scenes[j] ?? null;
  return scenes.find((s) => s.kind === 'chapter') || null;
}

export type DropEdge = 'before' | 'after';

export function callTargetIndex(scenes: ScriptScene[], from: ScriptScene | undefined, to: ScriptScene | undefined, edge: DropEdge): number | null {
  if (from?.flowIndex == null) return null;
  let dest: ScriptScene | null | undefined = to;
  if (to?.kind === 'plate') dest = chapterSceneNear(scenes, to.key);
  if (dest?.flowIndex == null) return null;
  let toIndex = dest.flowIndex;
  if (edge === 'after') toIndex = dest.flowIndex + 1;
  if (from.flowIndex < toIndex) toIndex -= 1;
  const max = Math.max(0, (from.flowCount || 1) - 1);
  return Math.max(0, Math.min(toIndex, max));
}

/** among index for plate-move (excludes the dragged plate, matching server clamp). */
export function plateAmongIndex(scenes: ScriptScene[], beforeTitle: string, dropPlateKey: string | null, edge: DropEdge, fromKey: string): number {
  const siblings = scenes.filter((s) => s.kind === 'plate' && s.before === beforeTitle);
  let among: number;
  if (!dropPlateKey) {
    among = siblings.length;
  } else {
    const idx = siblings.findIndex((s) => s.key === dropPlateKey);
    among = idx < 0 ? siblings.length : edge === 'before' ? idx : idx + 1;
  }
  const fromIdx = siblings.findIndex((s) => s.key === fromKey);
  if (fromIdx >= 0 && fromIdx < among) among -= 1;
  return Math.max(0, among);
}

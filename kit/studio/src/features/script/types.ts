import type { ReviewSummary } from '@/api/types';

/** `GET /api/video/:slug/script`. */

export type LintLevel = 'error' | 'warn' | 'info';

export interface LintNote {
  level: LintLevel;
  message: string;
  /** The scene the note belongs to, matching `ScriptScene.key`. */
  key: string;
}

/**
 * `open`, `plate`, `chapter`, `step` and `close` are what the engine emits
 * today; `SCENE_KIND_LABEL` names those and the kind prints raw otherwise.
 */
export type ScriptSceneKind = string;

export interface ScriptScene {
  kind: ScriptSceneKind;
  key: string;
  title: string;
  titleLines: string[];
  eyebrow: string;
  onScreen: string;
  sub: string;
  narrationKind: string;
  narrationKey: string;
  voiced: boolean;
  holdSec: number;
  holdDefault: number;
  timingKind: string;
  editable: Record<string, boolean>;
  narration: string;
  narrationWords: number;
  narrationSpeed: number | null;
  narrationSec: number;
  issues: LintNote[];
  plateId?: string;
  plateType?: string;
  plateTitle?: string;
  /** The chapter a plate appears before. */
  before?: string;
  /** Chapter titles a plate can be placed before. */
  chapters?: string[];
  plate?: ScenePlate;
  flowLine?: number | null;
  flowIndex?: number | null;
  flowCount?: number | null;
  dynamic?: boolean;
  holdMs?: number | null;
  holdExplicit?: boolean;
  steps?: Array<{ label?: string; note?: string }>;
}

/** The plate copy a plate scene carries for inline editing. */
export interface ScenePlate {
  type?: string;
  typeLabel?: string;
  listKey?: string | null;
  fields?: string[];
  rows?: Array<Record<string, string | number | null | undefined>>;
  body?: string;
  quote?: string;
  author?: string;
  role?: string;
  value?: string;
  unit?: string;
  note?: string;
  progress?: number | null;
  left?: { label?: string; items?: string[] };
  right?: { label?: string; items?: string[] };
}

export interface ScriptTotals {
  scenes: number;
  chapters: number;
  plates: number;
  narrated: number;
  words: number;
  estSec: number;
  errors: number;
  warnings: number;
}

export interface Script {
  scenes: ScriptScene[];
  chapters: string[];
  plateTypes: Array<{ type: string; label: string; hint: string; fields: string[]; list?: string | null; shape?: string }>;
  lint: LintNote[];
  orphans: string[];
  scaffold: boolean;
  hash: string;
  totals: ScriptTotals;
}

export interface ScriptPayload {
  script: Script;
  review: ReviewSummary;
}

export const SCENE_KIND_LABEL: Record<string, string> = {
  open: 'Open',
  plate: 'Plate',
  chapter: 'Chapter',
  step: 'Caption',
  close: 'Close',
};

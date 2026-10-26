import type { HtmlPlate, Job, Scene } from '@/api/types';

import type { QueueItem } from './store';

/**
 * Seams between the desk engine and the two subsystems that own their own
 * runtime: the Editor (`kit/studio/editor.js`) and the plate HTML preview
 * (the plate functions in `kit/studio/app.js`). Each feature registers its
 * implementation on mount; the engine calls through these, the way the legacy
 * controller called `editor?.onEnter()` and friends.
 */

export interface EditorSelection {
  kind: string;
  scene?: Scene | null;
}

export interface EditorBridge {
  readonly active: boolean;
  readonly selection: EditorSelection | null;
  readonly hasScenes: boolean;
  onEnter(opts: { programT: number }): void;
  onLeave(): void;
  refresh(): Promise<void>;
  resetForProject(): void;
  renderClips(): void;
  onPlateDirty(): void;
  selectLive(scene: Scene): void;
  /** `editor.paintLookVars(vars, titleReveal)`: paint Direction look tokens on the stage before a rebuild lands. */
  paintLookVars?(vars: Record<string, string>, titleReveal: string | null): void;
  /** `editor.tuneAtmosphere(opacity, speed)`: repaint the live plate's WebGL field in place — Presence/Speed need no rebuild. */
  tuneAtmosphere?(opacity: number | undefined, speed: number | undefined): void;
  /** The atmosphere pattern id baked into the plate frame on stage right now, or `null` off-stage. */
  frameAtmosphere?(): string | null;
}

export interface PlateBridge {
  rebuildPlateHtmlPreview(opts?: { selectFirst?: boolean; plateId?: string | null }): Promise<unknown>;
  /** `applyRebuiltPlates(plates, { reload })`: pick up plates a save already rebuilt, without a second rebuild round trip. */
  applyRebuiltPlates?(plates: HtmlPlate[], opts?: { reload?: boolean }): void;
  openPlateFromScene(scene: Scene): Promise<void>;
  fitFhdPreview(): void;
  ensureFhdFitObserver(): void;
  previewPlateAfterEdit(plateId: string): Promise<unknown>;
  approvePlateOnly(): Promise<void>;
  savePlateCopyEdits(): Promise<void>;
  /** `showPlateHtml(plate)`: load one plate into the Plate HTML pane. */
  showPlateHtml(plateId: string): void;
  /** `editCurrentPlate(scene)`: open the Editor on a scene (a timeline region or scene chip click). */
  editCurrentPlate?(scene?: Scene | null): void;
  /** `loadPlateFrame(plateId, { force })`: reload one plate into the stage iframe. */
  loadPlateFrame?(plateId: string, opts?: { force?: boolean }): Promise<unknown>;
  /** `askAiForCurrentScene({ motion })`: pin the Feedback note to the current plate scene. */
  askAiForCurrentScene?(opts?: { motion?: boolean }): Promise<void>;
  /** `openMotionForCurrentScene()`: the Motion tab for the current plate scene. */
  openMotionForCurrentScene?(): void;
  /** `inferPlateIdFromFeedback(note)`: the plate a director note names, if any. */
  inferPlateIdFromFeedback?(note: string): string | null;
  discardPlateCopyEdits?(): Promise<void>;
  replayPlateInline?(): void;
}

export interface FeedbackBridge {
  /** `runImproveJob(item, { signal })` from the Feedback rail. */
  runImproveJob(item: QueueItem, opts: { signal: AbortSignal }): Promise<void>;
  hideProposal(): void;
  resetThinkSteps(): void;
  setSessionIdle(): void;
  /** `startImprove(goal)`: queue an agent pass from the director note in `improve.note`. */
  startImprove?(goal: string): void;
  /** `setThinkStep(step)`: advance the rail's Think → Decide pipe (`rebuildPlateHtmlPreview` marks `html` / `preview`). */
  setThinkStep?(step: string | null): void;
  /** The rail's headline after `stopAllWork` (`#sessionTitle` = reason, `Ready for new work`). */
  sessionStopped?(reason: string): void;
}

/** The guided-take cards in the Render bay (`guideCard.js`, `takeChoice.js`). */
export interface BayBridge {
  showGuide(slug: string): void;
  hideGuide(): void;
  askTake(slug: string, opts: { signal?: AbortSignal | undefined }): Promise<'own' | 'bot' | 'again'>;
}

/**
 * The stage bar and its sheets (`workflow.js`, `projects.js`, `branch.js`) —
 * what the legacy controller reached as `workflow?.openScript?.()` and the
 * project wizard's `open()`.
 */
export interface WorkflowBridge {
  openScript(opts?: { section?: string }): void;
  openCut(): void;
  openProjectNew(): void;
  openProjectSettings(): void;
  openBranch(): void;
  openCommandMenu(): void;
  openHelp(): void;
  /** `workflow.followAgentJob(job, title)`: keep the script sheet live while an agent rewrites sources. */
  followAgentJob?(job: Job, title: string): Promise<boolean>;
  /** A stage-bar click (`#stageBar .pstage[data-stage]`), as the Studio guide's stage buttons fire it. */
  openStage?(stage: string): void;
}

export const bridges: {
  editor: EditorBridge | null;
  plate: PlateBridge | null;
  feedback: FeedbackBridge | null;
  bay: BayBridge | null;
  workflow: WorkflowBridge | null;
} = { editor: null, plate: null, feedback: null, bay: null, workflow: null };

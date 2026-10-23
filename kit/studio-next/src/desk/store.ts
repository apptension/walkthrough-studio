import { create } from 'zustand';

import type { Job, VideoIndex, VideoSummary, Scene, CaptionCue, AgentAuth, HtmlPlate, QcSeverity } from '@/api/types';
import type { RenderAction } from './action';

/** A QC finding queued for Feedback so the rail can show chips while the note is applied. */
export interface QcPendingFinding {
  severity: QcSeverity;
  code: string;
  message: string;
}

/**
 * The desk's runtime state — the typed successor of the legacy `state` object
 * in `kit/studio/app.js`, plus the bits of view state the legacy controllers
 * wrote straight into the DOM (status line, busy buttons, the Render bay's
 * running headline, overlays).
 *
 * The engine modules in `src/desk/` own every write; components only read and
 * call engine functions. Values that never drive a render (timers, abort
 * controllers, media elements) live in `runtime.ts` instead.
 */

export type MonitorMode = 'program' | 'live' | 'plate' | 'compare';
export type LeftTab = 'render' | 'versions' | 'deliver';
export type RightTab = 'feedback' | 'inspector' | 'motion' | 'review';
export type Surface = 'render' | 'session';
/** `ok`, `warn`, `run` or `err` — the server's job states pass through unchanged too. */
export type StatusKind = string;

export type QueueKind = 'make' | 'step' | 'improve';

export interface ResumePipeline {
  mode: string;
  fromStep: string;
  slug: string | null;
  label: string;
}

export interface QueueItem {
  qid: string;
  slug: string | null;
  label: string;
  kind: QueueKind;
  mode?: string | undefined;
  step?: string | undefined;
  force?: boolean | undefined;
  goal?: string | undefined;
  note?: string | undefined;
  plateId?: string | null | undefined;
  motion?: boolean | undefined;
  presets?: string[] | undefined;
  fromStep: string | null;
  resumePipeline: ResumePipeline | null;
}

export type StepStatus = 'todo' | 'run' | 'done' | 'fail';

export interface PipelineStep {
  id: string;
  label: string;
  status: StepStatus;
}

export interface PipelineFailure {
  mode: string;
  slug: string | null;
  stepId: string;
  label: string;
  error: string;
  log: string;
}

export interface ProgramBuildOverlay {
  show: boolean;
  tone?: string;
  title?: string;
  detail?: string;
  screenshot?: string;
  log?: string;
}

export interface SignInWait {
  title?: string;
  next?: string;
}

/** The Render bay's pill/headline/reason while a pipeline owns them. */
export interface BayOverride {
  pillClass: string;
  pillText: string;
  headline: string;
  reason: string;
}

export interface LivePreviewView {
  /** Latest decoded frame (a blob URL while capturing), or null when nothing to show. */
  src: string | null;
  url: string | null;
  recording: boolean;
  repairing: boolean;
  warming: boolean;
  badge: string | null;
  /** Live tab visible in the monitor head. */
  tab: boolean;
  onAir: boolean;
  /** Activity thumbnail in the Render bay. */
  thumb: boolean;
}

export interface Toast {
  id: number;
  title: string;
  detail: string;
  kind: 'ok' | 'err' | 'warn' | 'info';
  out: boolean;
}

export interface Transport {
  t: number;
  d: number;
  playing: boolean;
  buffered: number;
}

export type DialogId = 'command' | 'help' | 'script' | 'cut' | 'project' | 'branch';

export interface DeskState {
  /* —— sequence —— */
  slug: string | null;
  video: VideoSummary | null;
  index: VideoIndex | null;
  agentAuth: AgentAuth | null;
  version: string | null;
  cues: CaptionCue[];
  chapters: Array<{ title: string; start: number; kind?: string }>;
  duration: number;
  ytText: string;
  scenes: Scene[];
  currentScene: Scene | null;
  htmlPlates: HtmlPlate[];
  activePlateId: string | null;
  action: RenderAction | null;

  /* —— jobs —— */
  queue: QueueItem[];
  running: QueueItem | null;
  jobBusy: boolean;
  job: Job | null;
  jobId: string | null;
  activeSurface: Surface | null;
  stopRequested: boolean;
  pipeline: PipelineStep[] | null;
  pipelineFailure: PipelineFailure | null;
  pipelineStartedAt: number | null;
  /** Job painted into the Render bay's Activity card. */
  renderJob: Job | null;
  /** Job painted into the Feedback session rail. */
  sessionJob: Job | null;
  renderLogExpanded: boolean;
  activityExpanded: boolean;
  activityDismissed: boolean;
  hasActivity: boolean;
  isRendering: boolean;

  /* —— monitor —— */
  monitorMode: MonitorMode;
  compare: boolean;
  compareId: string;
  previewingPlate: string | null;
  monitorLabel: { text: string; hint: string };
  live: LivePreviewView;
  liveWarmupKey: string | null;
  liveWarmingUp: boolean;
  signInWait: SignInWait | null;
  programBuild: ProgramBuildOverlay | null;
  recordFailureDismissed: string | null;
  transport: Transport;
  captionsOn: boolean;
  /** Program has a master loaded (`#player` visible, `#noVideo` hidden). */
  programLoaded: boolean;
  lastChapter: number | null;
  chapterToast: { title: string; on: boolean };
  scrubbing: boolean;
  plateDirty: boolean;
  proposalOpen: boolean;
  editingPlateId: string | null;
  motionApplied: boolean;
  platesPreviewed: boolean;

  /* —— chrome —— */
  status: { kind: StatusKind; text: string };
  busy: Record<string, boolean>;
  bay: BayOverride | null;
  leftTab: LeftTab;
  rightTab: RightTab;
  dialogs: Partial<Record<DialogId, boolean>>;
  toasts: Toast[];
  boot: { status: string; leaving: boolean; gone: boolean };
  /** Boot threw: the desk is replaced by the error, like the legacy `Studio failed:` page. */
  bootError: string | null;
  /** The editor timeline is folded to its toolbar (`body.tl-collapsed`). */
  tlCollapsed: boolean;
  busyOverlay: { shown: boolean; leaving: boolean; label: string; detail: string };
  versionSelection: string[];
  showCheckpoints: boolean;
  /** The Feedback rail's director note and the plate an "Ask AI" pinned it to (`#improveNote`, `#btnImprove` dataset). */
  improve: ImproveTarget;
  /** Selected QC finding keys in Review (`qcFindingKey`). */
  qcKeys: string[];
  /** Bumped when opening QC from a version card so Review can scroll to the section. */
  qcFocus: number;
  /** Findings that seeded the current Feedback note (chips until the note is cleared). */
  qcPending: QcPendingFinding[];
  /** The critic agent job while it reviews the cut (Story review shows its stream). */
  criticJob: Job | null;
  /** A right tab was picked at least once — legacy `#toolsPanel` has no `data-tab` until then. */
  rightTabPicked: boolean;
  /** Bumps on every right-tab pick, so re-picking the shown tab still runs `swapPanelBodies`. */
  rightTabSeq: number;
  /** Deliver → Reel safe area (`#reelToggle` shows `#safeAreaOverlay`). */
  reelSafeArea: boolean;
}

export interface ImproveTarget {
  note: string;
  goal: string;
  plateId: string | null;
  label: string;
}

export const IMPROVE_DEFAULT: Omit<ImproveTarget, 'note'> = { goal: 'full', plateId: null, label: 'Apply with smart scope' };

export const initialLive: LivePreviewView = {
  src: null,
  url: null,
  recording: false,
  repairing: false,
  warming: false,
  badge: null,
  tab: false,
  onAir: false,
  thumb: false,
};

export function initialDeskState(): DeskState {
  return {
    slug: null,
    video: null,
    index: null,
    agentAuth: null,
    version: null,
    cues: [],
    chapters: [],
    duration: 0,
    ytText: '',
    scenes: [],
    currentScene: null,
    htmlPlates: [],
    activePlateId: null,
    action: null,

    queue: [],
    running: null,
    jobBusy: false,
    job: null,
    jobId: null,
    activeSurface: null,
    stopRequested: false,
    pipeline: null,
    pipelineFailure: null,
    pipelineStartedAt: null,
    renderJob: null,
    sessionJob: null,
    renderLogExpanded: false,
    activityExpanded: false,
    activityDismissed: false,
    hasActivity: false,
    isRendering: false,

    monitorMode: 'program',
    compare: false,
    compareId: '',
    previewingPlate: null,
    monitorLabel: { text: 'Program', hint: 'The rendered master' },
    live: initialLive,
    liveWarmupKey: null,
    liveWarmingUp: false,
    signInWait: null,
    programBuild: null,
    recordFailureDismissed: null,
    transport: { t: 0, d: 0, playing: false, buffered: 0 },
    captionsOn: false,
    programLoaded: false,
    lastChapter: null,
    chapterToast: { title: '', on: false },
    scrubbing: false,
    plateDirty: false,
    proposalOpen: false,
    editingPlateId: null,
    motionApplied: false,
    platesPreviewed: false,

    status: { kind: '', text: 'Loading…' },
    busy: {},
    bay: null,
    leftTab: 'render',
    rightTab: 'feedback',
    dialogs: {},
    toasts: [],
    boot: { status: 'Starting…', leaving: false, gone: false },
    bootError: null,
    tlCollapsed: false,
    busyOverlay: { shown: false, leaving: false, label: 'Opening sequence', detail: '' },
    versionSelection: [],
    showCheckpoints: false,
    improve: { note: '', ...IMPROVE_DEFAULT },
    qcKeys: [],
    qcFocus: 0,
    qcPending: [],
    criticJob: null,
    rightTabPicked: false,
    rightTabSeq: 0,
    reelSafeArea: false,
  };
}

export const useDesk = create<DeskState>()(() => initialDeskState());

/** Engine-side accessors: read the latest state, merge a patch. */
export const desk = {
  get: useDesk.getState,
  set: (patch: Partial<DeskState> | ((s: DeskState) => Partial<DeskState>)) => useDesk.setState(patch),
  reset: () => useDesk.setState(initialDeskState(), true),
};

/** `buttonBusy(btn, on)` — the `.busy` class plus `disabled` on a named button. */
export function setButtonBusy(id: string, on: boolean): void {
  desk.set((s) => (Boolean(s.busy[id]) === on ? {} : { busy: { ...s.busy, [id]: on } }));
}

export function setStatus(kind: StatusKind, text: string): void {
  desk.set({ status: { kind, text } });
}

export function openDialog(id: DialogId, open = true): void {
  desk.set((s) => ({ dialogs: { ...s.dialogs, [id]: open } }));
}

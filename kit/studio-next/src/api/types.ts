/**
 * Types for the Walkthrough Studio HTTP surface (`kit/lib/studio.mjs`).
 *
 * These mirror `videoSummary()`, `jobView()` and the option catalogues the
 * server hands down. Where the server returns an open-ended record (brand
 * colours, atmosphere labels, per-chapter overlays) the type stays a record
 * rather than being frozen into a union the server can outgrow.
 */

/* ------------------------------------------------------------------ shared */

export type Tone = 'ok' | 'warn' | 'err';

export interface Language {
  code: string;
  name: string;
}

export interface Chapter {
  title: string;
  start: number;
}

export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

export interface Lockup {
  file: string;
  label: string;
  kind?: string;
}

/* ------------------------------------------------------------------ health */

export type AgentProvider = 'cursor' | 'claude';

export interface AgentRunner {
  provider: AgentProvider;
  label: string;
  bin: string | null;
  available: boolean;
  authenticated: boolean;
  via: string | null;
  soft: boolean;
  message: string;
}

export interface AgentAuth {
  preference: AgentProvider | null;
  provider: AgentProvider | null;
  runners: Record<AgentProvider, AgentRunner>;
  active: AgentRunner | null;
  available: boolean;
  switchable?: boolean;
}

export interface Health {
  ok: boolean;
  version: string;
  agent: boolean;
  agentAuth: AgentAuth;
}

/* -------------------------------------------------------------------- jobs */

export type JobStatus =
  | 'queued'
  | 'running'
  | 'recording'
  | 'repairing'
  | 'waiting'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'cancelling'
  | 'needs-agent';

export type JobKind = 'make' | 'step' | 'improve' | 'draft' | 'branch' | 'guide' | 'discover';

/** A sign-in prompt the recorder is waiting on; `field` says what it asks for. */
export interface JobQuestion {
  id: string;
  /** `confirm`, `password`, `email`, or any other field id the job asks for. */
  field?: string;
  prompt?: string;
}

export interface JobLogLine {
  t: number;
  line: string;
}

export interface JobStreamEntry {
  kind: string;
  text: string;
  at?: number;
  /** `lib/agentStream.mjs` entry fields the live feed paints from. */
  id?: number;
  title?: string;
  done?: boolean;
  ok?: boolean;
  t?: number;
}

export interface Job {
  id: string;
  status: JobStatus;
  kind?: JobKind;
  slug?: string;
  step?: string;
  phase?: string;
  label?: string;
  activity?: string;
  activityAt?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  captureStartedAt?: number | string;
  error?: string;
  /** Why it failed, or the agent's sign-in hint for `needs-agent`. */
  message?: string;
  provider?: string;
  question?: JobQuestion | null;
  /** Set by the critic agent job when its review lands. */
  critic?: { findings: number; score: number | null };
  log: JobLogLine[];
  stream?: { entries: JobStreamEntry[]; rev?: number } | null;
}

/* ------------------------------------------------------------------ review */

export type ReviewStatus = 'approved' | 'draft' | 'changes' | 'changes-requested' | 'pending' | 'changed' | 'none';

export interface ReviewEntry {
  at: string;
  status: ReviewStatus;
  /** What the server actually writes into `history[]`: `approved`, `changes-requested`, … */
  action?: string;
  note?: string;
  by?: string | null;
  version?: string;
}

export interface ReviewLeg {
  status: ReviewStatus;
  /** `status`, adjusted for drift the server detected after approval. */
  effective: ReviewStatus;
  history: ReviewEntry[];
  note?: string;
  approvedAt?: string | null;
  approvedBy?: string | null;
  hash?: string;
  currentHash?: string;
  scriptHash?: string;
  version?: string;
  versionName?: string | null;
}

export interface ReviewSummary {
  script: ReviewLeg;
  cut: ReviewLeg;
}

/* --------------------------------------------------------------- freshness */

export interface PlateHealth {
  bad: boolean;
  issues: string[];
  byId: Record<string, { ok?: boolean; issues?: string[] }>;
}

export interface FreshnessSource {
  key: 'config' | 'narration' | 'flow' | 'brand';
  mtime: number;
  newerThanDelivery: boolean;
  newerThanLive: boolean;
}

export interface Freshness {
  fresh: boolean;
  stale: boolean;
  needsRecord: boolean;
  startUrl: string;
  loginRequired: boolean;
  plateHealth: PlateHealth;
  reason: string;
  sourceAt: number | null;
  deliveryAt: number | null;
  liveAt: number | null;
  newestSource: FreshnessSource['key'] | null;
  sources: FreshnessSource[];
}

/** `recordFailureView()` — shared with the server via `kit/studio/recordFailure.js`. */
export interface RecordFailure {
  reason: string;
  url: string;
  next: string;
  technical: string;
  message: string;
  screenshot: string;
}

/* ------------------------------------------------------------------- brand */

export interface BrandFoundation {
  name: string;
  platform: string;
  font: string;
  accent: string;
  logo: string;
  colors: Record<string, string>;
  ready: boolean;
  placeholder: boolean;
  issues: string[];
  discovery: { at?: string; url?: string } | null;
  lockups: Lockup[];
}

/* --------------------------------------------------------------- direction */

export interface PresetInfo {
  label: string;
  hint?: string;
}

export interface ScaleOption extends PresetInfo {
  id: string;
  recommended: boolean;
  colors: Record<string, string>;
  swatches: string[];
}

export interface CameraSettings {
  zoom: string;
  frame: string;
  background: string;
  padding: string;
  corners: string;
  shadow: string;
  curve: string;
  motion: string;
}

export interface CursorSettings {
  style: string;
  size: string;
  glide: boolean;
  hideIdle: boolean;
  hand: boolean;
  loop: boolean;
}

export interface Pace extends PresetInfo {
  id: string;
  tempo: number;
  custom?: boolean;
}

export interface Motion {
  energy: string;
  atmosphere: string;
  atmosphereOpacity: number;
  atmosphereSpeed: number;
  titleReveal: string;
  depth: string;
  sheen: boolean;
  enterMs: number;
  staggerMs: number;
  pushScale: number;
  /**
   * The engine carries a long tail of per-transition timings (`tWipeL`,
   * `tTrace`, `cardPop`, …) that the UI passes through without reading. They
   * stay open rather than being enumerated here.
   */
  [key: string]: string | number | boolean | undefined;
}

export interface Direction {
  palette: string;
  scale: string;
  focus: string;
  logo: string;
  look: string;
  looks: Record<string, PresetInfo & { camera: Partial<CameraSettings>; cursor: Partial<CursorSettings>; keys: boolean }>;
  lockups: Lockup[];
  scales: ScaleOption[];
  roles: Array<{ id: string; label: string }>;
  camera: CameraSettings;
  cursor: CursorSettings;
  keys: boolean;
  pace: Pace;
  paces: Record<string, PresetInfo & { tempo: number }>;
  motion: Motion;
  overlays: Overlays;
  approvedAt: string | null;
  colors: Record<string, string>;
  swatches: string[];
}

export interface DirectionOptions {
  palettes: Record<string, PresetInfo>;
  focus: Record<string, PresetInfo>;
  transitions: Record<string, PresetInfo & { xfade: string | null; motion?: string }>;
  camera: Record<keyof CameraSettings, string[]>;
  cursor: { style: string[]; size: string[] };
}

export interface MotionOptions {
  energies: string[];
  atmospheres: string[];
  atmosphereLabels: Record<string, string>;
  titleReveals: string[];
  titleRevealLabels: Record<string, string>;
  depths: string[];
  lookVars: Record<string, Record<string, Record<string, string>>>;
}

export interface Overlays {
  preset: string;
  paper?: string;
  chapter: Record<string, string | number | boolean>;
  caption: Record<string, string | number | boolean>;
  chapters: Record<string, Record<string, unknown>>;
  catalog?: {
    presets: Array<PresetInfo & { id: string }>;
    atmospheres: Array<PresetInfo & { id: string }>;
    seats: string[];
    aligns: string[];
    energies: string[];
    backdrops: Array<PresetInfo & { id: string }>;
  };
}

export interface Transitions {
  style: string;
  duration: number;
  xfade: string | null;
}

/* ------------------------------------------------------------------- story */

export interface StoryBeat {
  id: string;
  where: string;
  job: string;
  covered: boolean | null;
  /** Plate types that carry this beat. */
  plates?: string[];
}

export interface Story {
  purpose: string;
  explicit: boolean;
  label: string;
  framework: string;
  hint: string;
  beats: StoryBeat[];
  options: Array<{ id: string; label: string; short: string; framework: string; hint: string }>;
}

/* ----------------------------------------------------------------- quality */

export type QcSeverity = 'fail' | 'warn' | 'info';

export interface QcFinding {
  severity: QcSeverity;
  code: string;
  message: string;
  holdSec?: number;
  share?: number;
  pace?: string;
  heldFor?: string[];
}

export interface Qc {
  status: string;
  summary: Record<QcSeverity, number>;
  findings: QcFinding[];
  url: string;
}

/** `lib/critic.mjs` / `lib/narrative.mjs` rank findings high → low. */
export type CriticSeverity = 'high' | 'medium' | 'low';

export interface CriticFinding {
  id?: string;
  severity: QcSeverity | CriticSeverity;
  code?: string;
  title?: string;
  message: string;
  at?: number;
  scope?: string;
  persona?: string;
  action?: string;
  target?: string;
  issue?: string;
  suggestion?: string;
  frame?: { at?: number | null; path?: string | null } | null;
  /** `agent` — written by the critic agent; `rules` — the automatic rule pass. */
  source?: 'agent' | 'rules';
  evidence?: string;
}

/** The critic agent's read of the cut (`mergeAgentReview` in `lib/critic.mjs`). */
export interface CriticAgentReview {
  summary: string;
  score: number | null;
  strengths: string[];
  generatedAt?: string;
}

export interface Critic {
  agent?: CriticAgentReview | null;
  status?: string;
  score?: number;
  summary?: string;
  findings: CriticFinding[];
  generatedAt?: string;
  /** `criticSummary()` in `lib/studio.mjs`. */
  fingerprint?: string;
  purpose?: string | null;
  high?: number;
  medium?: number;
  low?: number;
  stale?: boolean;
}

/* ------------------------------------------------------- scenes and plates */

export type SceneKind = 'plate' | 'live' | 'chapter';

/** The join into a scene, as `scenes()` reports it. */
export interface SceneTransition {
  type: string;
  xfade?: string;
  motion?: string;
  dur: number;
  card?: boolean;
}

export interface Scene {
  index: number;
  id: string;
  kind: SceneKind;
  title: string;
  type: string;
  start: number;
  end: number;
  dur: number;
  transitionIn: SceneTransition | null;
  join: string | null;
  cleanFrom: number | null;
  cleanTo: number | null;
  editable: boolean;
  plateId: string | null;
  renderOnly: string | null;
  htmlUrl: string | null;
  mp4Url: string | null;
}

export interface HtmlPlate {
  id: string;
  label: string;
  type: string;
  htmlUrl: string;
  path: string;
  mp4Url: string | null;
  /** Chapter / caption live cards (`overlay:<kind>:<n>`). */
  liveCard?: boolean;
  encode: {
    ok: boolean;
    status: string;
    warnings: string[];
    notes: string[];
    [key: string]: unknown;
  } | null;
}

/* ------------------------------------------------- versions and deliveries */

export interface Version {
  id: string;
  number: number;
  name: string;
  title: string;
  label: string;
  kind: string;
  trigger: string;
  note: string;
  createdAt: string;
  durationSec: number | null;
  sizeMB: number | null;
  chapters: number;
  hasAudio: boolean;
  hasCritic: boolean;
  hasCaptions: boolean;
  hasDeliver: boolean;
  qcStatus: string | null;
  displayName: string;
  bytes?: number;
}

export interface ExportItem {
  id: string;
  label: string;
  sizeMB: number;
  url: string;
  stale: boolean;
}

export interface ExportPreset extends PresetInfo {
  width: number;
  height?: number;
  kind: string;
}

export interface Deliver {
  slug: string;
  title: string;
  generatedAt: string;
  durationSec: number;
  sizeMB: number;
  posterAtSec: number;
  posterSource: string;
  qcStatus: string;
  captionCues: number;
  chapterCount: number;
  stills: string[];
  files: string[];
  dirUrl: string | null;
  readmeUrl: string | null;
}

export interface Captions {
  srtUrl: string | null;
  vttUrl: string | null;
  cueCount: number | null;
  hash: string | null;
  language: string;
  languageName: string;
}

export interface Asset {
  name: string;
  url: string;
  sizeMB: number;
  kind: string;
}

/* ------------------------------------------------------------------- brief */

export interface Brief {
  version: number;
  createdAt: string;
  title: string;
  product: string;
  audience: string;
  outcome: string;
  lengthSec: number;
  tone: string;
  brand: { id: string; mode: string; name: string; url: string; appUrl: string };
  app: {
    startUrl: string;
    appUrl: string;
    marketingUrl: string | null;
    loginRequired: boolean;
    envVars: string[];
    sourcePath: string;
    notes: string;
  };
  story: { mustShow: string[]; keyMessages: string[]; mustSay: string[]; avoid: string[] };
  proof: { plates: string[]; stats: unknown[]; quotes: unknown[]; logos: unknown[] };
}

/* ------------------------------------------------------------------- video */

/** `agent` or `guided` today; the server may add more, so this stays open. */
export type CaptureMode = string;

export interface OutputFrame {
  format: string;
  width: number;
  height: number;
  label: string;
}

export interface CaptureMark {
  start: number;
  title: string;
  kind: string;
}

/** The full `GET /api/video/:slug` payload. */
export interface VideoSummary {
  slug: string;
  title: string;
  audience: string;
  language: Language;
  brand: string;
  brandFoundation: BrandFoundation;
  direction: Direction;
  directionOptions: DirectionOptions;
  motion: Motion;
  motionOptions: MotionOptions;
  story: Story;
  critic: Critic | null;
  livePace: {
    id: string;
    tempo: number;
    override: boolean;
    shifts?: number;
    narrationHoldSec?: number;
    narrationHoldShare?: number;
  } | null;
  transitions: Transitions;
  review: ReviewSummary;
  hasFlow: boolean;
  captureMode: CaptureMode;
  output: OutputFrame;
  guidedTour: { at?: string; steps?: number; marks?: number } | null;
  /** Script scenes with hold timing, when the summary carries them (voice-hold warning). */
  script?: { scenes?: Array<{ holdSec?: number | null; narrationSec?: number | null }> } | null;
  brief: Brief | null;
  lineage: { parent?: string; children?: string[]; role?: string; folderId?: string; branchedFrom?: string } | null;
  interstitials: Array<{ id: string; type: string; before: string; title: string; overrides: string[] }>;
  plateAccents: Record<string, string[]>;
  plateStyles: Record<string, number>;
  editSummary: string;
  hasDelivery: boolean;
  deliveryUrl: string | null;
  freshness: Freshness;
  recordFailure: RecordFailure | null;
  previewUrl: string | null;
  liveUrl: string | null;
  captureMarks: CaptureMark[];
  signInWait: { url?: string; note?: string } | null;
  durationSec: number | null;
  sizeMB: number | null;
  chapters: Chapter[];
  hasCritic: boolean;
  criticUrl: string | null;
  contactSheet: string | null;
  reviewUrl: string | null;
  posterUrl: string | null;
  posterMeta: { atSec: number; source: string; setAt: string; refreshedAt?: string } | null;
  handoffZipUrl: string | null;
  captions: Captions;
  qc: Qc | null;
  deliver: Deliver | null;
  exports: ExportItem[];
  exportPresets: Record<string, ExportPreset>;
  youtubeChaptersUrl: string | null;
  versions: Version[];
  assets: Asset[];
  htmlPlates: HtmlPlate[];
  overlays: Overlays;
  scenes: Scene[];
  hasDraft: boolean;
  source: { config: boolean; narration: boolean; flow: boolean };
}

/** A project that failed to load — the index keeps the row so it can be fixed. */
export interface VideoError {
  slug: string;
  title: string;
  error: string;
}

export type VideoEntry = VideoSummary | VideoError;

export function isVideoError(entry: VideoEntry): entry is VideoError {
  // Healthy rows from `/api/videos` still carry `error: null`. Only a real message means the project failed to load.
  const message = (entry as { error?: unknown }).error;
  return typeof message === 'string' && message.length > 0;
}

export interface Folder {
  id: string;
  title: string;
  slugs: string[];
  rootSlug?: string;
  /** Members grouped by `listFoldersWithVideos()` — root first, then branches. */
  videos?: VideoEntry[];
}

export interface VideoIndex {
  videos: VideoEntry[];
  folders: Folder[];
  /** Summaries no folder claimed (`listFoldersWithVideos().loose`). */
  loose: VideoEntry[];
  agent: boolean;
  agentAuth: AgentAuth;
}

/* ---------------------------------------------------------- brand packs */

export interface Brand {
  id: string;
  name: string;
  accent: string;
  url: string;
  placeholder: boolean;
  ready: boolean;
  issues: string[];
}

/* ------------------------------------------------------- new production */

/** The subset of `createProject()`'s input the wizard collects. */
export interface CreateProjectRequest {
  title: string;
  language: string;
  product?: string;
  audience?: string;
  outcome?: string;
  app: {
    startUrl: string;
    appUrl?: string;
    marketingUrl?: string;
    loginRequired?: boolean;
    notes?: string;
  };
  brand: { mode: 'existing'; id: string } | { mode: 'new'; name: string; url?: string };
  capture?: { mode?: CaptureMode };
  output?: { format?: 'landscape' | 'portrait' };
  story?: { lengthSec?: number; tone?: string; mustShow?: string[]; keyMessages?: string[] };
}

export interface CreateProjectResult {
  ok: boolean;
  slug: string;
  brand: string;
  /** The brand pack is a placeholder, so discovery has to run before plates. */
  needsDiscovery: boolean;
  envVars: string[];
}

/* ----------------------------------------------------------------- actions */

export type RunStep =
  | 'full'
  | 'quick'
  | 'guided'
  | 'plates'
  | 'record'
  | 'produce'
  | 'audio'
  | 'validate'
  | 'deliver'
  | 'export';

export interface RunRequest {
  step: RunStep;
  force?: boolean;
  presets?: string[];
}

export type ImproveGoal = 'full' | 'script' | 'voice' | 'plates' | 'brand' | 'scene' | 'motion';

export interface ImproveRequest {
  goal: ImproveGoal;
  note?: string;
  snapshot?: boolean;
  plateId?: string;
}

export interface JobAccepted {
  job: { id: string };
}

/* ------------------------------------------------------------------ branch */

/**
 * A focused video the desk can spin out of an overview. The server suggests
 * these from the brief, and the agent can add more.
 */
export interface BranchIdea {
  id: string;
  title: string;
  purpose: string;
  angle?: string;
  outcome?: string;
  mustShow?: string[];
  keyMessages?: string[];
  mustSay?: string[];
  lengthSec?: number;
  plates?: string[];
  /** `brief` for the server's own heuristics, `agent` for a discovered one. */
  source?: string;
}

export interface BranchIdeas {
  ideas: BranchIdea[];
  /** Whether any of these came from an agent pass rather than the brief. */
  agent?: boolean;
  generatedAt?: string;
  source?: string;
}

export interface BranchRequest {
  title: string;
  angle?: string;
  outcome?: string;
  purpose: string;
  /** Either the id of a suggestion, or a whole idea the director wrote. */
  ideaId?: string;
  idea?: Omit<BranchIdea, 'id'>;
}

export interface BranchResult {
  ok: boolean;
  slug: string;
  title?: string;
  job?: { id: string } | null;
}

/**
 * Shapes of the Editor deck (`GET /api/video/:slug/edit`) as `kit/studio/editor.js` reads them.
 * Every field is optional where the server may omit it — the legacy code guards with `|| []`.
 */

import type { OutputSize, StageRect } from '@/logic/stageLayout';

export interface SpeedRamp {
  from: number;
  to: number;
  rate: number;
}

export interface DeckZoom {
  id: string;
  t: number;
  dur: number;
  zoom: number;
  /** Recording marks only: capture CSS pixels. */
  x?: number;
  y?: number;
  /** Set on a plate mark: the clip it belongs to. `t` is then that plate's own clock. */
  clip?: string;
  /** Plate marks: the aim as a fraction of the delivered frame. */
  nx?: number;
  ny?: number;
}

export interface Span {
  from: number;
  to: number;
}

export interface DeckLens {
  id: string;
  t: number;
  dur: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  zoom?: number;
  label?: string;
  /** Set on a plate mark: the clip it belongs to. `t` is then that plate's own clock. */
  clip?: string;
  /** Plate marks: centre and size as fractions of the delivered frame. */
  nx?: number;
  ny?: number;
  nw?: number;
  nh?: number;
}

export interface LensOff {
  t: number;
  [key: string]: unknown;
}

export interface MusicRideDesk {
  from: number;
  to: number;
  gainDb: number;
}

export interface MusicDesk {
  offset: number;
  gainDb: number;
  mute: boolean;
  loop?: boolean;
  fadeIn: number;
  fadeOut: number;
  rides: MusicRideDesk[];
}

export interface VoiceDesk {
  key: string;
  text?: string;
  at?: number | null;
  nudge?: number;
  gainDb?: number;
  mute?: boolean;
  trimStart?: number;
  trimEnd?: number;
  fadeIn?: number;
  fadeOut?: number;
  speed?: number;
  take?: number;
  takes?: number;
  takeSources?: Record<string, string>;
  [key: string]: unknown;
}

export type MasterDesk = Record<string, number | string | undefined>;

export interface AudioDesk {
  music: MusicDesk;
  voice: VoiceDesk[];
  master: MasterDesk;
}

export interface CardTiming {
  key: string;
  t: number;
  dur: number;
  /** A duplicated card: the key of the card whose copy and look it shows. */
  copyOf?: string;
  /** A card the Editor wrote rather than the script: it carries its own copy. */
  kind?: 'caption' | 'chapter';
  label?: string;
  body?: string;
}

export interface Trim {
  id: string;
  trimStart?: number;
  trimEnd?: number;
  [key: string]: unknown;
}

/** A plate's own clock (`edit.plateTimes`): trims cut intro/outro, hold freezes the settled frame. */
export interface PlateTime {
  id: string;
  trimStart?: number;
  trimEnd?: number;
  hold?: number;
  rate?: number;
}

/** How a plate scene plays after its timing (server `timePlateScenes`). */
export interface SceneTiming {
  trimStart: number;
  trimEnd: number;
  hold: number;
  rate: number;
}

export interface DeckEdit {
  speed: SpeedRamp[];
  zooms: DeckZoom[];
  zoomSkips: Span[];
  lenses: DeckLens[];
  lensOff: LensOff[];
  transitions: Record<string, unknown>;
  audio: AudioDesk | null;
  cards: CardTiming[];
  /** Per-section stage placement. A missing key keeps the video's camera frame. */
  layouts?: LayoutRow[];
  order: string[];
  omit: string[];
  /** Duplicated sections, `<source id>+<n>`; each plays again right after its source. */
  repeats?: string[];
  trims: Trim[];
  plateTimes?: PlateTime[];
  cuts: Span[];
}

export interface Piece {
  from: number;
  to: number;
  rate: number;
  cleanFrom: number;
  cleanTo: number;
}

export interface DeckLive {
  exists?: boolean;
  url?: string;
  durationSec?: number;
  cleanSec?: number;
  width?: number;
  height?: number;
  pieces?: Piece[];
  overlaysMode?: string;
}

export interface DeckMark {
  kind?: string;
  t: number;
  dur?: number | null;
  label?: string;
  key?: string;
  copyOf?: string;
  /** Written in the Editor — there is no script call behind it. */
  added?: boolean;
  body?: string;
  x?: number;
  y?: number;
}

export interface ZoomPoint {
  t: number;
  cx: number;
  cy: number;
}

export interface ZoomShot {
  start: number;
  end: number;
  zoom: number;
  source: string;
  id?: string;
  points?: ZoomPoint[];
  /** Set when the shot sits on a plate: `start`/`end` are then that plate's own clock. */
  clip?: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LensPathPoint {
  at: number;
  rect: Rect;
}

export interface Lens {
  key: string;
  id?: string;
  /** Set when the magnifier sits on a plate rather than the recording. */
  clip?: string;
  source: string;
  label?: string;
  t: number;
  dur: number;
  rect: Rect;
  path?: LensPathPoint[] | null;
  zoom: number;
  /** Magnification the render lands on after its whole-pixel crop — what the stage paints with. */
  zoomExact?: number;
  diameter: number;
  S: number;
}

export interface RecordedLens {
  t: number;
  dur: number;
  label?: string;
  rect: Rect;
  off?: boolean;
  zoom?: number;
  diameter?: number;
  S?: number;
}

export interface JoinEnd {
  id: string;
  kind: string;
  title: string;
}

export interface Join {
  key: string;
  prev?: JoinEnd;
  next?: JoinEnd;
  at?: number;
  type?: string;
  dur?: number;
  card?: boolean;
  pinned?: { style?: string; duration?: number } | null;
  /** Slide → slide only: whether the shared background can run straight through, and why not. */
  carry?: { ok: boolean; why: string };
}

export interface DeckScene {
  index?: number;
  id: string;
  kind: string;
  title: string;
  type?: string | null;
  start?: number;
  end?: number;
  dur: number;
  hardCut?: boolean;
  transitionIn?: { dur?: number } | null;
  recFrom?: number | null;
  recTo?: number | null;
  cleanFrom?: number | null;
  cleanTo?: number | null;
  plateId?: string | null;
  /** Set on a section the Editor duplicated (`edit.repeats`): the id it plays again. */
  repeatOf?: string;
  htmlUrl?: string | null;
  mp4Url?: string | null;
  /** Plates: the rendered length before any retime, the settled frame an extension holds, and the tail hold. */
  naturalDur?: number;
  holdAt?: number;
  /** Source second the plate's exit has cleared — where the server sizes its transition pad. */
  clearAt?: number;
  padOut?: number;
  timing?: SceneTiming | null;
}

export interface PlateStyleVar {
  name: string;
  label: string;
  type: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: Array<string | { id: string; label?: string }>;
  [key: string]: unknown;
}

export interface StyleGroup {
  id: string;
  label: string;
  icon?: string;
  vars: PlateStyleVar[];
  types?: string[];
  [key: string]: unknown;
}

export interface DeckPlate {
  id: string;
  label?: string;
  type?: string | null;
  htmlUrl?: string | null;
  mp4Url?: string | null;
  style?: Record<string, string>;
  motion?: Record<string, string | undefined>;
  overrides?: string[];
  layout?: string | null;
  /** The plate the script chose, once this one was swapped or recomposed. */
  swap?: PlateOrigin | null;
  [key: string]: unknown;
}

export interface PlateOrigin {
  type: string;
  label: string | null;
  layout: string | null;
}

export interface PlateLibrary {
  shelves: Array<{ id: string; label: string }>;
  types: Array<{ type: string; label: string; hint: string; shelf: string }>;
}

export interface Labelled {
  label: string;
  hint?: string;
  [key: string]: unknown;
}

export interface VoiceClip {
  key: string;
  kind: string;
  text?: string;
  textOverride?: string | null;
  written?: string;
  start: number;
  writtenStart: number;
  nudge?: number;
  at?: number | null;
  markAt?: number | null;
  dur: number;
  full: number;
  trimStart: number;
  trimEnd: number;
  fadeIn?: number;
  fadeOut?: number;
  speed?: number | null;
  spokenSpeed?: number;
  take?: number;
  takes?: number;
  cachedTakes?: number[];
  takeSources?: Record<string, string>;
  source?: string | null;
  gainDb?: number;
  mute?: boolean;
  notes?: string[];
  url?: string;
  moved?: boolean;
  long?: number;
  late?: number;
}

export interface Narrator {
  voiceId?: string;
  name?: string;
  model?: string;
  source?: string;
  built?: { voiceId?: string; name?: string } | null;
  stale?: boolean;
  mode?: string;
  [key: string]: unknown;
}

export interface MixLevelsDesk {
  voiceLufs?: number;
  plateLufs?: number;
  bedLufs?: number;
  targetLufs?: number;
  truePeakDb?: number;
  duckRatio?: number;
  duck?: { threshold?: number; ratio?: number; attackMs?: number; releaseMs?: number };
  [key: string]: unknown;
}

export interface DeckAudio {
  desk?: AudioDesk;
  levels?: MixLevelsDesk;
  defaults?: MixLevelsDesk;
  voiceName?: string;
  narrator?: Narrator;
  voiceClips?: VoiceClip[];
  music?: { url?: string; durationSec?: number; source?: string; prompt?: string; generatedAt?: string } | null;
  musicPrompt?: string;
  windows?: Array<{ start: number; end: number }>;
  stale?: boolean;
  mixed?: boolean;
  [key: string]: unknown;
}

export interface Ranges {
  speed: [number, number];
  zoom: [number, number];
  transitionDuration: [number, number];
  minRampSec: number;
  minZoomSec: number;
  lensZoom: [number, number];
  minLensSec: number;
  cardDur: [number, number];
  gain: [number, number];
  nudge: [number, number];
  musicOffset: [number, number];
  master: Record<string, [number, number]>;
  voiceFade: [number, number];
  voiceMinSec: number;
  voiceSpeed: [number, number];
  voiceTextMax: number;
  [key: string]: unknown;
}

export interface Frame {
  w: number;
  h: number;
  x: number;
  y: number;
  radius: number;
  background: string;
  shadow: string;
}

export interface LayoutText {
  on: boolean;
  title?: string;
  body?: string;
}

export interface LayoutRow {
  key: string;
  placement: string;
  size: string;
  text: LayoutText;
}

export interface DeckSection {
  key: string;
  from: number;
  to: number;
  no: number;
  custom: boolean;
  layout: { placement: string; size: string; text: LayoutText } | null;
  copy: { title: string; body: string };
  /** Chapter title and card body, before this section's own wording. */
  source?: { title: string; body: string };
  stage: StageRect;
  panel: { x: number; y: number; w: number; h: number; side: string } | null;
  textOn: boolean;
  htmlUrl: string | null;
}

export interface DeckLayouts {
  placements: Record<string, { label: string; hint: string }>;
  sizes: string[];
  sections: DeckSection[];
}

export interface Deck {
  slug?: string;
  deck?: DeckEdit;
  layouts?: DeckLayouts;
  summary?: string;
  stale?: boolean;
  audioStale?: boolean;
  rendered?: boolean;
  space?: { cssW?: number; cssH?: number; output?: OutputSize | null; stage?: StageRect | null; [key: string]: unknown };
  live?: DeckLive;
  marks?: DeckMark[];
  zoomShots?: ZoomShot[];
  zoomPlan?: { skipped?: number; targets?: number; manual?: number };
  zoomTiming?: { in?: number; out?: number; pan?: number; curve?: string; motion?: string };
  lensTiming?: { in: number; out: number; curve?: string };
  curves?: Record<string, Labelled>;
  motions?: Record<string, Labelled>;
  zoomLevels?: Record<string, number>;
  conflicts?: Array<{ from: number; to: number; marks?: DeckMark[]; [key: string]: unknown }>;
  joins?: Array<Join | null>;
  scenes?: DeckScene[];
  naturalIds?: string[];
  omitted?: Array<{ id: string; title?: string; kind?: string; [key: string]: unknown }>;
  plates?: DeckPlate[];
  plateLibrary?: PlateLibrary;
  styleGroups?: StyleGroup[];
  transitionStyles?: Record<string, Labelled>;
  transitions?: { style?: string; duration?: number; xfade?: string | null };
  camera?: Record<string, string>;
  frame?: Frame | null;
  lenses?: Lens[];
  recordedLenses?: RecordedLens[];
  /** Camera moves placed on plates — plate clock, frame fractions, never auto. */
  plateZooms?: DeckZoom[];
  /** The delivered frame plate marks are fractions of. */
  plateFrame?: { width: number; height: number };
  lensRim?: string;
  brandColors?: Record<string, string>;
  cursor?: Record<string, string | boolean>;
  cursorOptions?: Record<string, Array<string | { id: string; label?: string }>>;
  pace?: { id?: string; tempo?: number; label?: string; hint?: string; custom?: boolean };
  ranges?: Ranges;
  audio?: DeckAudio;
  music?: { durationSec?: number; [key: string]: unknown };
  line?: { synthesized?: boolean; [key: string]: unknown };
  key?: string;
  [key: string]: unknown;
}

/** One brick on the clips track (`ed.seq`). */
export interface Clip {
  i: number;
  id: string;
  kind: 'live' | 'plate';
  plateId: string | null;
  type: string | null;
  title: string;
  at: number;
  dur: number;
  overlap: number;
  recFrom: number;
  recTo: number;
  join: Join | null;
  repeatOf?: string;
  /** Plates: natural length, settled frame and timing — the stage seeks through these. */
  naturalDur?: number;
  holdAt?: number;
  /** Source second the plate's exit has cleared — where the server sizes its transition pad. */
  clearAt?: number;
  padOut?: number;
  timing?: SceneTiming | null;
}

/** `ed.sel` — what the inspector shows. */
export interface Selection {
  type: string;
  i?: number;
  id?: string;
  key?: string;
  clipId?: string | undefined;
  from?: number;
  to?: number;
  cardId?: string | null;
  markT?: number;
  markDur?: number;
}

export interface Clock {
  toClean: (t: number) => number;
  fromClean: (c: number) => number;
}

/** A live-card / plate row in `state.htmlPlates` as the editor reads it. */
export interface PlateRow {
  id: string;
  label?: string;
  type?: string;
  kind?: string;
  htmlUrl?: string | null;
  mp4Url?: string | null;
  liveCard?: boolean;
  markKey?: string | null;
  chapterNo?: number;
  flowIndex?: number;
  look?: Record<string, unknown> | null;
  lookScope?: string[];
  holdMs?: number;
  /** Last render's measurement. `notes` carries lines that still clip. */
  encode?: { notes?: string[] } | null;
}

/** A field of the plate in the iframe (`listPlateFields`). */
export interface PlateField {
  path: string;
  kind?: string;
  source?: string;
  dirty?: boolean;
}

/** `plateSelectionDetail()` — the focused field and its accent state. */
export interface FieldDetail {
  path?: string | null;
  kind?: string | null;
  source?: string | null;
  dirty?: boolean;
  accent?: 'on' | 'off' | 'mixed' | null;
}

/** One ElevenLabs voice from `GET /api/video/:slug/narrators`. */
export interface NarratorVoice {
  voiceId: string;
  name: string;
  category?: string;
  previewUrl?: string;
  labels?: Record<string, string | undefined>;
}

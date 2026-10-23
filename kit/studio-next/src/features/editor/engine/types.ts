/**
 * Shapes of the Editor deck (`GET /api/video/:slug/edit`) as `kit/studio/editor.js` reads them.
 * Every field is optional where the server may omit it — the legacy code guards with `|| []`.
 */

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
  x: number;
  y: number;
}

export interface Span {
  from: number;
  to: number;
}

export interface DeckLens {
  id: string;
  t: number;
  dur: number;
  x: number;
  y: number;
  w: number;
  h: number;
  zoom?: number;
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
}

export interface Trim {
  id: string;
  trimStart?: number;
  trimEnd?: number;
  [key: string]: unknown;
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
  order: string[];
  omit: string[];
  trims: Trim[];
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
  source: string;
  label?: string;
  t: number;
  dur: number;
  rect: Rect;
  path?: LensPathPoint[] | null;
  zoom: number;
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
  htmlUrl?: string | null;
  mp4Url?: string | null;
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
  [key: string]: unknown;
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

export interface Deck {
  slug?: string;
  deck?: DeckEdit;
  summary?: string;
  stale?: boolean;
  audioStale?: boolean;
  rendered?: boolean;
  space?: { cssW?: number; cssH?: number; [key: string]: unknown };
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
  styleGroups?: StyleGroup[];
  transitionStyles?: Record<string, Labelled>;
  transitions?: { style?: string; duration?: number; xfade?: string | null };
  camera?: Record<string, string>;
  frame?: Frame | null;
  lenses?: Lens[];
  recordedLenses?: RecordedLens[];
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

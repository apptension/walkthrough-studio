import type { HtmlPlate, VideoSummary } from '@/api/types';
import { desk } from '@/desk/store';

import { createAudioPreview } from './audioPreview';
import type { AudioDesk, Clip, Clock, Deck, DeckEdit, Lens, NarratorVoice, PlateRow, Selection, VoiceClip, ZoomShot } from './types';
import { clockFromPieces } from './util';

/**
 * The Editor's private state — the `ed` object inside `initEditor()` in `kit/studio/editor.js`.
 * Nothing here drives a React render: the editor paints its own DOM, as the legacy one did.
 */

export interface MicRecord {
  key: string;
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  mime: string;
}

export interface Aim {
  cx: number;
  cy: number;
}

export interface LensAim {
  x: number;
  y: number;
  w: number;
  h: number;
  zoom?: number | undefined;
}

export interface Hud {
  rate: number;
  zoom: number;
  lens: { zoom: number } | null;
}

/** What the listener is auditioning before it is saved (`ed.hear`). */
export interface Hear {
  music?: Partial<AudioDesk['music']>;
  master?: Record<string, number>;
  voice?: { key: string; [key: string]: unknown };
}

export interface PlateFieldState {
  path: string;
  kind: string;
  source: string;
  dirty: boolean;
  accent: 'on' | 'off' | 'mixed' | null;
}

export interface EdState {
  deck: Deck | null;
  seq: Clip[];
  clock: Clock | null;
  total: number;
  t: number;
  cur: number;
  playing: boolean;
  lastTs: number;
  raf: number;
  stopAt: number | null;
  loop: boolean;
  loopClip: Clip | null;
  fx: boolean;
  textMode: boolean;
  /** Look & reveal background edits: 'chapter' saves for the selected card's chapter, 'video' for all. */
  lookScope: 'chapter' | 'video';
  /** When set, text mode is editing a chapter/caption template (overlay:…) over a live clip. */
  liveCardId: string | null;
  /** Overlay id currently composited for preview (motion mode), if any. */
  compositeCardId: string | null;
  /** Hold length (ms) last applied to the composited card’s CSS exit timing. */
  compositeHoldMs: number | null;
  /** Last motion-seek ms applied to the composited card (skip redundant seeks). */
  compositeSeekMs: number | null;
  /** Last live-card id under the playhead — used to refresh Edit text / coach without every frame. */
  cardHint: string;
  /** Focused plate copy field while editing. */
  plateField: PlateFieldState | null;
  /** Plate id that needs animation resync after text mode / in-flight load finishes. */
  needsPlateResync: string | null;
  /** Bumps to cancel an in-flight enterText when Done / play / leave wins the race. */
  textGen: number;
  sel: Selection | null;
  zoomScale: number;
  pps: number;
  undo: DeckEdit[];
  redo: DeckEdit[];
  loadingPlate: string | null;
  missing: Set<string>;
  /** Plates whose HTML changed while the frame showed something else — reload them on the next visit. */
  stalePlates: Set<string>;
  stall: boolean;
  dirtyRender: boolean;
  styleTimers: Map<string, ReturnType<typeof setTimeout>>;
  pendingStyle: Map<string, string | null>;
  active: boolean;
  drag: Drag | null;
  preSeek: string | null;
  /** Latest recording-time target while scrubbing; chase it across in-flight seeks. */
  wantRec: number | null;
  sound: boolean;
  hear: Hear | null;
  regenerating: string | null;
  micRecord: MicRecord | null;
  narratorPick: string | null;
  /** The narrator sample playing from the Mix panel (`Listen`). */
  sample: HTMLAudioElement | null;
  /** The narrator list, or the error the listing failed with. */
  voices: NarratorVoice[] | { error: string } | null;
  plateReqGen: number;
  liveSeeked: boolean;
  liveKick: boolean;
  liveArm: boolean;
  stallFor: number;
  playWhenReady: boolean;
  hud: Hud | null;
  aim: Aim | null;
  aimZoom: number | null;
  lensAim: LensAim | null;
  loupeBuf: HTMLCanvasElement | null;
  flipFrom: Map<string | undefined, number> | null;
  settleTimer: ReturnType<typeof setTimeout> | undefined;
}

/** `ed.drag` — one pointer gesture on the timeline. */
export interface Drag {
  type: string;
  edge?: string;
  mode?: string;
  key?: string;
  cardId?: string | null;
  clip?: Clip | null;
  start?: number;
  dur?: number;
  x0: number;
  t0?: number;
  el?: HTMLElement | null;
  moved: boolean;
  clipI?: number | null;
  from?: number;
  to?: number;
  i?: number;
  lane?: string;
  a?: number;
  splice?: number;
  removed?: number;
  offset?: number;
  fade?: number;
  written?: number;
  item?: FxItem;
  voice?: VoiceClip;
  els?: HTMLElement[];
  span?: Array<[number, number]>;
  w?: number;
  at?: number;
  ids?: string[];
  newT?: number;
  newDur?: number;
  newStart?: number;
  newTrimStart?: number;
  newTrimEnd?: number;
  newNudge?: number;
  newOffset?: number;
  newFade?: number;
  newFrom?: number;
  newTo?: number;
}

export interface FxItem {
  kind: 'ramp' | 'skip' | 'lens' | 'zoom';
  i?: number;
  key?: string;
  lens?: Lens;
  shot?: ZoomShot;
  from: number;
  to: number;
  min: number;
  auto?: boolean;
  fixed?: boolean;
}

export function initialEd(): EdState {
  return {
    deck: null,
    seq: [],
    clock: clockFromPieces([]),
    total: 0,
    t: 0,
    cur: -1,
    playing: false,
    lastTs: 0,
    raf: 0,
    stopAt: null,
    loop: false,
    loopClip: null,
    fx: true,
    textMode: false,
    lookScope: 'chapter',
    liveCardId: null,
    compositeCardId: null,
    compositeHoldMs: null,
    compositeSeekMs: null,
    cardHint: '',
    plateField: null,
    needsPlateResync: null,
    textGen: 0,
    sel: null,
    zoomScale: 1,
    pps: 20,
    undo: [],
    redo: [],
    loadingPlate: null,
    missing: new Set(),
    stalePlates: new Set(),
    stall: false,
    dirtyRender: false,
    styleTimers: new Map(),
    pendingStyle: new Map(),
    active: false,
    drag: null,
    preSeek: null,
    wantRec: null,
    sound: true,
    hear: null,
    regenerating: null,
    micRecord: null,
    narratorPick: null,
    sample: null,
    voices: null,
    plateReqGen: 0,
    liveSeeked: false,
    liveKick: false,
    liveArm: false,
    stallFor: 0,
    playWhenReady: false,
    hud: null,
    aim: null,
    aimZoom: null,
    lensAim: null,
    loupeBuf: null,
    flipFrom: null,
    settleTimer: undefined,
  };
}

export const ed: EdState = initialEd();

/** Tests start from a clean editor. */
export function resetEdForTests(): void {
  Object.assign(ed, initialEd());
}

export const preview = createAudioPreview();

export const timers = { stylePreview: 0 as ReturnType<typeof setTimeout> | 0 };

export const slug = (): string | null => desk.get().slug;
export const video = (): HTMLVideoElement | null => document.getElementById('livePlayer') as HTMLVideoElement | null;
export const live = (): NonNullable<Deck['live']> => ed.deck?.live || {};
// The take's CSS size — the space every zoom, lens and mark is stored in.
export const liveW = (): number => live().width || ed.deck?.space?.cssW || 1;
export const liveH = (): number => live().height || ed.deck?.space?.cssH || 1;
export const deckEdit = (): DeckEdit =>
  ed.deck?.deck || {
    speed: [],
    zooms: [],
    zoomSkips: [],
    lenses: [],
    lensOff: [],
    transitions: {},
    audio: null,
    cards: [],
    layouts: [],
    order: [],
    omit: [],
    repeats: [],
    trims: [],
    cuts: [],
  };

export const audioDesk = (): AudioDesk =>
  deckEdit().audio || { music: { offset: 0, gainDb: 0, mute: false, fadeIn: 1.2, fadeOut: 2.6, rides: [] }, voice: [], master: {} };

/** Rows of `state.htmlPlates` as the editor reads them (live cards carry extra fields). */
export const htmlPlates = (): PlateRow[] => desk.get().htmlPlates;

/** `state.htmlPlates = rows` (and `state.video.htmlPlates`). */
export function setHtmlPlates(rows: PlateRow[], { video: alsoVideo = true } = {}): void {
  const plates = rows as unknown as HtmlPlate[];
  const v = desk.get().video;
  desk.set(alsoVideo && v ? { htmlPlates: plates, video: { ...v, htmlPlates: plates } } : { htmlPlates: plates });
}

export function patchVideo(patch: Partial<VideoSummary>): void {
  const v = desk.get().video;
  if (v) desk.set({ video: { ...v, ...patch } });
}

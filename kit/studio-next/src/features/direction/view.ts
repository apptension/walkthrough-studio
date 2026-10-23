import { create } from 'zustand';

import type { Direction, Motion, Overlays, Transitions } from '@/api/types';
import { desk } from '@/desk/store';
import type { CaptureSettings as CaptureSettingsBase, CaptureSpace, OutputShape } from '@/logic/captureSize';
import { asText } from '@/logic/text';

/**
 * The Direction tab (`#rightMotion`) as state: what `setEnergy`, `renderEffects`,
 * `setAtmosphere`, `renderTransitions`, `renderOverlays`, `renderDirection` and
 * `renderCaptureSize` in `kit/studio/app.js` wrote into the DOM. The writers below are
 * called where legacy called them, so the controls keep legacy's timing: a pick stays
 * on screen until the next render, a focused slider is never overwritten.
 */

/** `GET/POST /api/video/:slug/capture` — `CaptureSettings` plus what the picker reads. */
export interface CaptureSettings extends CaptureSettingsBase {
  current?: CaptureSettingsBase['current'] & { label?: string };
  outputs: Array<OutputShape & { format: string }>;
  space?: CaptureSpace | null;
}

export interface AtmosphereChoice {
  id: string;
  name: string;
  em: string;
  title: string;
}

export interface SelectChoice {
  id: string;
  label: string;
}

/** Empty-desk title reveals. A loaded video replaces these from `motionOptions`. */
export const STATIC_REVEALS: AtmosphereChoice[] = [
  { id: 'rise', name: 'Rise', em: 'masked lift', title: 'Rise · masked lift' },
  { id: 'cascade', name: 'Cascade', em: 'character flip', title: 'Cascade · character flip' },
  { id: 'wipe', name: 'Wipe', em: 'line unmask', title: 'Wipe · line unmask' },
  { id: 'focus', name: 'Focus', em: 'blur resolve', title: 'Focus · blur resolve' },
  { id: 'veil', name: 'Veil', em: 'soft settle', title: 'Veil · soft settle' },
  { id: 'ink', name: 'Ink', em: 'bleed reveal', title: 'Ink · bleed reveal' },
  { id: 'slit', name: 'Slit', em: 'light band', title: 'Slit · light band' },
  { id: 'iris', name: 'Iris', em: 'radial open', title: 'Iris · radial open' },
  { id: 'embers', name: 'Embers', em: 'spark dissolve', title: 'Embers · spark dissolve' },
];

/** `#atmosphereGrid` as the HTML ships it, before `renderAtmosphereGrid` rebuilds it. */
export const STATIC_ATMOSPHERES: AtmosphereChoice[] = [
  { id: 'none', name: 'None', em: 'Flat', title: 'Flat brand vignette' },
  { id: 'schedule', name: 'Schedule', em: 'Timeline bars', title: 'Drifting resource-timeline bars' },
  { id: 'aurora', name: 'Aurora', em: 'Colour ribbons', title: 'Slow colour ribbons' },
  { id: 'mesh', name: 'Mesh', em: 'Gradient mesh', title: 'Breathing gradient mesh' },
  { id: 'particles', name: 'Particles', em: 'Bokeh dust', title: 'Soft bokeh particles' },
  { id: 'grid', name: 'Grid', em: 'Perspective', title: 'Perspective grid with light pulses' },
  { id: 'waves', name: 'Waves', em: 'Flow lines', title: 'Flowing line waves' },
];

export type OverlaySelect = 'chapterAtm' | 'captionAtm' | 'chapterBackdrop' | 'captionBackdrop';

export interface OverlayDraft {
  preset: string;
  chapterAtm: string;
  captionAtm: string;
  chapterBackdrop: string;
  captionBackdrop: string;
  seat: string;
  align: string;
}

export interface CursorToggles {
  keys: boolean;
  glide: boolean;
  hand: boolean;
  idle: boolean;
  loop: boolean;
}

export interface SizeForm {
  w: string;
  h: string;
  dpr: string;
  mobile: boolean;
}

export interface DirectionView {
  /* —— #energyGrid —— */
  energy: string;
  /** Static markup carries `aria-checked` on the default button only, until the first `setEnergy`. */
  energyMarked: boolean;

  /* —— #atmosphereGrid + sliders + effects —— */
  atmospheres: AtmosphereChoice[];
  atmosphere: string;
  atmosphereMarked: boolean;
  slidersHidden: boolean;
  opacity: string;
  opacityOut: string;
  speed: string;
  speedOut: string;
  titleReveal: string;
  reveals: AtmosphereChoice[];
  /** Static markup marks the default reveal only, until the first `renderEffects`. */
  revealMarked: boolean;
  depth: string;
  sheen: boolean;

  /* —— #transitionGrid —— */
  transition: string;
  transitionMarked: boolean;
  duration: string;
  durationOut: string;

  /* —— live cards —— */
  overlay: OverlayDraft;
  /** Options `fillOverlayAtmospheres` wrote; `null` keeps the HTML's own options. */
  overlayOptions: Record<OverlaySelect, SelectChoice[] | null>;

  /* —— renderDirection —— */
  direction: Direction | null;
  toggles: CursorToggles;

  /* —— #sizeSection —— */
  capture: CaptureSettings | null;
  sizeHidden: boolean;
  customOpen: boolean;
  sizeForm: SizeForm;
  sizeError: string | null;
}

export function initialDirectionView(): DirectionView {
  return {
    energy: 'clear',
    energyMarked: false,
    atmospheres: STATIC_ATMOSPHERES,
    atmosphere: 'aurora',
    atmosphereMarked: false,
    slidersHidden: false,
    opacity: '0.6',
    opacityOut: '0.60',
    speed: '1',
    speedOut: '1.0×',
    titleReveal: 'rise',
    reveals: STATIC_REVEALS,
    revealMarked: false,
    depth: 'flat',
    sheen: true,
    transition: 'directed',
    transitionMarked: false,
    duration: '0.6',
    durationOut: '0.6s',
    overlay: {
      preset: 'plateMatch',
      chapterAtm: 'waves',
      captionAtm: 'waves',
      chapterBackdrop: 'auto',
      captionBackdrop: 'auto',
      seat: 'bottom-center',
      align: 'left',
    },
    overlayOptions: { chapterAtm: null, captionAtm: null, chapterBackdrop: null, captionBackdrop: null },
    direction: null,
    toggles: { keys: false, glide: false, hand: false, idle: false, loop: false },
    capture: null,
    sizeHidden: false,
    customOpen: false,
    sizeForm: { w: '', h: '', dpr: '1', mobile: false },
    sizeError: null,
  };
}

export const useDirectionView = create<DirectionView>()(() => initialDirectionView());

export const directionView = {
  get: useDirectionView.getState,
  set: (patch: Partial<DirectionView> | ((s: DirectionView) => Partial<DirectionView>)) => useDirectionView.setState(patch),
  reset: () => useDirectionView.setState(initialDirectionView(), true),
};

const focused = (id: string) => typeof document !== 'undefined' && document.activeElement?.id === id;

export function setEnergy(energy: string): void {
  directionView.set({ energy, energyMarked: true });
}

export function setAtmosphere(id: string): void {
  directionView.set({ atmosphere: id, atmosphereMarked: true, slidersHidden: id === 'none' });
}

/** `renderAtmosphereGrid`: one button per engine atmosphere, labelled `Name · hint`. */
export function renderAtmosphereGrid(activeId: string): void {
  const opts = desk.get().video?.motionOptions;
  const ids = opts?.atmospheres;
  if (!ids?.length) return;
  const labels = opts?.atmosphereLabels || {};
  directionView.set({
    atmosphereMarked: true,
    atmosphere: activeId,
    atmospheres: ids.map((atm) => {
      const full = labels[atm] || atm;
      const dot = full.indexOf(' · ');
      return {
        id: atm,
        name: dot === -1 ? full : full.slice(0, dot),
        em: dot === -1 ? '' : full.slice(dot + 3),
        title: full,
      };
    }),
  });
}

function splitLabel(full: string, id: string): AtmosphereChoice {
  const dot = full.indexOf(' · ');
  return {
    id,
    name: dot === -1 ? full : full.slice(0, dot),
    em: dot === -1 ? '' : full.slice(dot + 3),
    title: full,
  };
}

/** One button per title-reveal template (`#revealGrid`). */
export function renderRevealGrid(activeId: string): void {
  const opts = desk.get().video?.motionOptions;
  const ids = opts?.titleReveals;
  if (!opts || !ids?.length) return;
  const labels = opts.titleRevealLabels || {};
  directionView.set({
    revealMarked: true,
    titleReveal: activeId,
    reveals: ids.map((id) => splitLabel(labels[id] || id, id)),
  });
}

/** `renderEffects(motion)`: mirror the resolved effects layer into the controls. */
export function renderEffects(motion: Motion | null | undefined): void {
  if (!motion) return;
  const atm = motion.atmosphere || 'none';
  renderAtmosphereGrid(atm);
  setAtmosphere(atm);
  const patch: Partial<DirectionView> = {};
  if (!focused('atmosphereOpacity') && motion.atmosphereOpacity != null) {
    patch.opacity = String(motion.atmosphereOpacity);
    patch.opacityOut = Number(motion.atmosphereOpacity).toFixed(2);
  }
  if (!focused('atmosphereSpeed') && motion.atmosphereSpeed != null) {
    patch.speed = String(motion.atmosphereSpeed);
    patch.speedOut = `${Number(motion.atmosphereSpeed).toFixed(1)}×`;
  }
  if (motion.titleReveal) patch.titleReveal = motion.titleReveal;
  if (motion.depth) patch.depth = motion.depth;
  patch.sheen = motion.sheen !== false;
  directionView.set(patch);
  renderRevealGrid(motion.titleReveal || directionView.get().titleReveal || 'rise');
}

export function renderTransitions(transitions: Pick<Transitions, 'style' | 'duration'> | null | undefined): void {
  if (!transitions) return;
  directionView.set({
    transition: transitions.style,
    transitionMarked: true,
    ...(focused('transitionDuration') ? {} : { duration: String(transitions.duration) }),
    durationOut: `${Number(transitions.duration).toFixed(1)}s`,
  });
}

type Choice = string | { id: string; label?: string };

/** `fillOverlayAtmospheres(id, choices, value)`: replace the options and keep the value when it survives. */
function fillOverlay(key: OverlaySelect, choices: Choice[] | undefined, value: string, view: DirectionView, patch: Partial<DirectionView>) {
  if (!choices?.length) return;
  const cur = value || view.overlay[key];
  const options = choices.map((c) =>
    typeof c === 'string' ? { id: c, label: c } : { id: c.id, label: c.label || c.id },
  );
  patch.overlayOptions = { ...(patch.overlayOptions ?? view.overlayOptions), [key]: options };
  const next = options.some((o) => o.id === cur) ? cur : (options[0]?.id ?? '');
  patch.overlay = { ...(patch.overlay ?? view.overlay), [key]: next };
}

const str = (v: unknown): string | undefined => (v == null ? undefined : asText(v));

export function renderOverlays(overlays: Overlays | null | undefined): void {
  const look = overlays || desk.get().video?.overlays;
  if (!look) return;
  const view = directionView.get();
  const patch: Partial<DirectionView> = {};
  const atmospheres = look.catalog?.atmospheres;
  fillOverlay('chapterAtm', atmospheres, str(look.chapter?.atmosphere) || 'waves', view, patch);
  fillOverlay('captionAtm', atmospheres, str(look.caption?.atmosphere) || 'waves', view, patch);
  for (const slot of ['chapter', 'caption'] as const) {
    const key = slot === 'chapter' ? 'chapterBackdrop' : 'captionBackdrop';
    const value = str(look[slot]?.backdrop) || 'auto';
    const paperName = look.paper === '#ffffff' ? 'white' : 'black';
    const choices = (look.catalog?.backdrops || [])
      .filter((c) => c.id !== 'custom')
      .map((c) => (c.id === 'auto' ? { ...c, label: `Auto · ${paperName}` } : c));
    fillOverlay(key, value.startsWith('#') ? [...choices, { id: value, label: `Custom ${value}` }] : choices, value, view, patch);
  }
  const overlay = { ...(patch.overlay ?? view.overlay) };
  if (!focused('overlayPreset')) overlay.preset = look.preset || 'plateMatch';
  if (!focused('overlayCaptionSeat')) overlay.seat = str(look.caption?.seat) || 'bottom-center';
  if (!focused('overlayCaptionAlign')) overlay.align = str(look.caption?.align) || 'left';
  patch.overlay = overlay;
  directionView.set(patch);
}

/** `renderDirection(direction)`: the toggles follow it; the markup renders from `view.direction`. */
export function renderDirection(direction: Direction | null | undefined): void {
  if (!direction) return;
  renderOverlays(desk.get().video?.overlays || direction.overlays);
  const cursor = direction.cursor || { style: 'classic', size: 'm', glide: false, hideIdle: false, loop: false };
  directionView.set({
    direction,
    toggles: {
      keys: Boolean(direction.keys),
      glide: Boolean(cursor.glide),
      hand: typeof cursor.hand === 'boolean' ? cursor.hand : cursor.style === 'arrow',
      idle: Boolean(cursor.hideIdle),
      loop: Boolean(cursor.loop),
    },
  });
}

export function renderCaptureSize(settings: CaptureSettings): void {
  const { customOpen } = directionView.get();
  const cur = settings.current;
  directionView.set({
    capture: settings,
    sizeHidden: false,
    ...(customOpen
      ? {}
      : {
          sizeForm: {
            w: String(cur?.width ?? ''),
            h: String(cur?.height ?? ''),
            dpr: String(cur?.dpr),
            mobile: Boolean(cur?.mobile),
          },
        }),
  });
}

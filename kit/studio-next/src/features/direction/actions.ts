import type { Direction, HtmlPlate, Motion, Overlays, Transitions, VideoSummary } from '@/api/types';
import { decideAction } from '@/desk/action';
import { api, enc } from '@/desk/api';
import { bridges } from '@/desk/bridge';
import { enqueueJob } from '@/desk/jobs';
import { showRightTab } from '@/desk/panels';
import { desk, setButtonBusy } from '@/desk/store';
import { toast } from '@/desk/toast';
import { loadVideo } from '@/desk/video';
import { renderHtmlPlatePicker } from '@/features/feedback/proposal';
import { showProposal } from '@/features/feedback/session';
import { customBody, screenQuery } from '@/logic/captureSize';

import {
  directionView,
  renderCaptureSize,
  renderDirection,
  renderEffects,
  renderOverlays,
  renderTransitions,
  setEnergy,
  type CaptureSettings,
} from './view';

/**
 * Direction tab behaviour from `kit/studio/app.js`: the motion live loop, transitions,
 * live cards, `saveDirection`, the recording size and the dock buttons.
 */

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
const slug = () => desk.get().slug ?? '';
const encSlug = () => enc(slug());

function patchVideo(patch: Partial<VideoSummary>): void {
  desk.set((s) => (s.video ? { video: { ...s.video, ...patch } } : {}));
}

interface MotionBody {
  energy: string;
  atmosphere?: string;
  atmosphereOpacity: number;
  atmosphereSpeed: number;
  titleReveal: string;
  depth: string;
  sheen: boolean;
}

interface MotionResponse {
  motion: Motion;
  direction?: Direction;
}

interface DirectionResponse {
  direction: Direction;
  motion: Motion;
  transitions: Transitions;
}

/* ———————————————————————————————————————————— motion */

/** `collectMotionBody()`: everything the Motion & transitions panel sends to POST /motion. */
export function collectMotionBody(): MotionBody {
  const v = directionView.get();
  return {
    energy: v.energy || 'clear',
    ...(v.atmosphere ? { atmosphere: v.atmosphere } : {}),
    atmosphereOpacity: Number(v.opacity),
    atmosphereSpeed: Number(v.speed),
    titleReveal: v.titleReveal,
    depth: v.depth,
    sheen: v.sheen,
  };
}

/** CSS look tokens for a motion patch — paints the Editor stage before the rebuild lands. */
export function paintMotionLiveOptimistic(motion: MotionBody): void {
  const table = desk.get().video?.motionOptions?.lookVars || {};
  const editor = bridges.editor;
  if (!editor?.paintLookVars) return;
  const vars: Record<string, string> = {};
  const sheen = motion.sheen === false ? 'off' : 'on';
  for (const [key, val] of [
    ['energy', motion.energy],
    ['depth', motion.depth],
    ['sheen', sheen],
    ['titleReveal', motion.titleReveal],
  ] as const) {
    Object.assign(vars, table[key]?.[val] || {});
  }
  editor.paintLookVars(vars, motion.titleReveal || null);
}

let motionLiveTimer: ReturnType<typeof setTimeout> | undefined;
let motionLiveGen = 0;

/** Drop a pending live save (Apply motion saves the same body itself). */
export function cancelMotionLive(): void {
  clearTimeout(motionLiveTimer);
  motionLiveGen += 1;
}

/**
 * Direction effects land on the Editor the moment they change: CSS picks paint at once, then a
 * debounced save rebuilds plate HTML (atmosphere, opacity, speed) and force-reloads the stage.
 */
export function scheduleMotionLive(): void {
  desk.set({ motionApplied: false, platesPreviewed: false });
  paintMotionLiveOptimistic(collectMotionBody());
  clearTimeout(motionLiveTimer);
  const gen = ++motionLiveGen;
  motionLiveTimer = setTimeout(() => void applyMotionLive(gen), 320);
}

export async function applyMotionLive(gen = motionLiveGen): Promise<void> {
  if (!desk.get().slug) return;
  try {
    const r = await api<MotionResponse>(`/api/video/${encSlug()}/motion`, { method: 'POST', body: collectMotionBody() });
    if (gen !== motionLiveGen) return;
    desk.set({ motionApplied: true });
    patchVideo({ motion: r.motion, ...(r.direction ? { direction: r.direction } : {}) });
    renderEffects(r.motion);
    if (r.direction) renderDirection(r.direction);
    const s = desk.get();
    await bridges.plate?.rebuildPlateHtmlPreview({
      selectFirst: false,
      plateId: bridges.editor?.active ? null : s.activePlateId,
    });
    if (gen !== motionLiveGen) return;
    desk.set({ platesPreviewed: true });
  } catch (err) {
    if (gen === motionLiveGen) toast('Look not saved', errMessage(err), 'err');
  }
}

export function pickEnergy(energy: string): void {
  setEnergy(energy);
  scheduleMotionLive();
}

/* ———————————————————————————————————————————— transitions */

let transitionSaveTimer: ReturnType<typeof setTimeout> | undefined;

export function saveTransitions(patch: Partial<Pick<Transitions, 'style' | 'duration'>>): void {
  clearTimeout(transitionSaveTimer);
  transitionSaveTimer = setTimeout(() => void flushTransitions(patch), 250);
}

async function flushTransitions(patch: Partial<Pick<Transitions, 'style' | 'duration'>>): Promise<void> {
  try {
    const r = await api<{ transitions: Transitions }>(`/api/video/${encSlug()}/transitions`, { method: 'PUT', body: patch });
    renderTransitions(r.transitions);
    patchVideo({ transitions: r.transitions });
    // The Editor draws joins from the edit deck — refresh so the stage matches without a render.
    await loadVideo(slug());
    if (bridges.editor?.active) await bridges.editor.refresh();
    toast('Transitions updated', `${r.transitions.style} · ${r.transitions.duration}s · live on the stage`, 'ok');
  } catch (err) {
    toast('Transitions failed', errMessage(err), 'err');
  }
}

export function pickTransition(style: string): void {
  renderTransitions({ ...(desk.get().video?.transitions || { duration: 0.6 }), style });
  saveTransitions({ style });
}

/* ———————————————————————————————————————————— plate layouts */

interface LayoutResponse {
  layout: string | null;
  plates?: HtmlPlate[];
}

/** POST /plates/:id/layout, then show the rebuilt plate so the new composition is on screen. */
export async function pickPlateLayout(plateId: string, layout: string): Promise<void> {
  try {
    const r = await api<LayoutResponse>(`/api/video/${encSlug()}/plates/${enc(plateId)}/layout`, {
      method: 'POST',
      body: { layout },
    });
    const v = desk.get().video;
    if (v) {
      const next = r.layout || layout;
      patchVideo(
        plateId === 'open' || plateId === 'close'
          ? { plateLayouts: { ...(v.plateLayouts || { open: 'classic', close: 'classic' }), [plateId]: next } }
          : { interstitials: v.interstitials.map((i) => (i.id === plateId ? { ...i, layout: next } : i)) },
      );
      if (r.plates) patchVideo({ htmlPlates: r.plates });
    }
    if (r.plates) renderHtmlPlatePicker(r.plates);
    if (desk.get().activePlateId === plateId) await bridges.plate?.loadPlateFrame?.(plateId, { force: true });
    else bridges.plate?.showPlateHtml(plateId);
    if (bridges.editor?.active) await bridges.editor.refresh();
    toast('Layout set', `${plateId} · ${r.layout || layout} — render plates to encode`, 'ok');
  } catch (err) {
    toast('Layout not saved', errMessage(err), 'err');
  }
}

/* ———————————————————————————————————————————— live cards */

export async function applyOverlaysLook(): Promise<void> {
  const o = directionView.get().overlay;
  const body = {
    preset: o.preset || 'plateMatch',
    chapter: { atmosphere: o.chapterAtm || 'waves', backdrop: o.chapterBackdrop || null },
    caption: {
      atmosphere: o.captionAtm || 'waves',
      backdrop: o.captionBackdrop || null,
      seat: o.seat || 'bottom-center',
      align: o.align || 'left',
    },
  };
  setButtonBusy('btnOverlaysApply', true);
  try {
    const r = await api<{ overlays: Overlays; direction?: Direction; plates?: HtmlPlate[] }>(
      `/api/video/${encSlug()}/overlays`,
      { method: 'POST', body },
    );
    const v = desk.get().video;
    if (v) {
      patchVideo({
        overlays: r.overlays,
        direction: r.direction || v.direction,
        htmlPlates: r.plates || v.htmlPlates,
      });
    }
    renderOverlays(r.overlays);
    renderHtmlPlatePicker(r.plates || desk.get().htmlPlates);
    const active = desk.get().activePlateId;
    if (active?.startsWith('overlay:')) await bridges.plate?.loadPlateFrame?.(active, { force: true });
    else if (!active && (r.plates || []).some((p) => p.liveCard)) {
      const first = (r.plates || []).find((p) => p.liveCard);
      if (first) bridges.plate?.showPlateHtml(first.id);
    }
    toast('Live cards updated', r.overlays?.preset || 'look saved');
  } catch (err) {
    toast('Live cards failed', errMessage(err), 'err');
  } finally {
    setButtonBusy('btnOverlaysApply', false);
  }
}

/** Open one chapter / caption card in the Plate HTML pane and bring Direction up. */
export function previewLiveCard({ kind, flowIndex }: { kind: string; flowIndex: number }): void {
  const id = `overlay:${kind}:${flowIndex}`;
  const card = (desk.get().htmlPlates || []).find((p) => p.id === id);
  if (!card) {
    toast('Card not ready', 'Rebuild plates / open Direction → Apply live cards first', 'warn');
    return;
  }
  bridges.plate?.showPlateHtml(card.id);
  showRightTab('motion');
}

/* ———————————————————————————————————————————— direction */

export async function saveDirection(patch: Record<string, unknown>, { quiet = false } = {}): Promise<DirectionResponse> {
  try {
    const r = await api<DirectionResponse>(`/api/video/${encSlug()}/direction`, { method: 'PUT', body: patch });
    patchVideo({ direction: r.direction, motion: r.motion, transitions: r.transitions });
    renderDirection(r.direction);
    renderTransitions(r.transitions);
    if (!quiet) toast('Direction updated', 'Preview scenes, then approve before recording', 'ok');
    return r;
  } catch (err) {
    toast('Direction failed', errMessage(err), 'err');
    throw err;
  }
}

/**
 * Keep the Editor stage in step with Direction: refresh the edit deck (inset frame, brand
 * colours, joins) and, when the plate HTML itself changed, force-reload the plate on stage.
 */
export async function syncEditorAfterDirection({ plates = false } = {}): Promise<void> {
  if (plates) {
    await bridges.plate?.rebuildPlateHtmlPreview({ selectFirst: !desk.get().activePlateId && !bridges.editor?.active });
  }
  if (bridges.editor?.active) await bridges.editor.refresh();
}

/** Camera keys that reshape the Editor's live inset frame (not just the next recording). */
const FRAME_CAMERA_KEYS = new Set(['frame', 'background', 'padding', 'corners', 'shadow']);

export async function pickPalette(scale: string): Promise<void> {
  const r = await saveDirection({ scale }, { quiet: true });
  await syncEditorAfterDirection({ plates: true });
  toast('Color scale set', `${r.direction.scale} · five plate roles updated`, 'ok');
}

export async function setScaleColors(colors: Record<string, string>): Promise<void> {
  const r = await saveDirection({ scale: 'custom', colors }, { quiet: true });
  await syncEditorAfterDirection({ plates: true });
  toast('Colors set', `${r.direction.colors.gold} accent · this video only`, 'ok');
}

export async function pickLogo(logo: string): Promise<void> {
  const r = await saveDirection({ logo }, { quiet: true });
  await syncEditorAfterDirection({ plates: true });
  toast('Logo set', r.direction.logo, 'ok');
}

const LOGO_EXT = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp']);
const LOGO_MAX = 1_500_000;

function readFileBytes(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that logo'));
    reader.readAsArrayBuffer(file);
  });
}

function fileBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Upload a logo for this video and select it. The shared brand pack is unchanged. */
export async function uploadLogo(file: File): Promise<void> {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!LOGO_EXT.has(ext)) {
    toast('Logo not added', 'Use an SVG, PNG, JPEG, or WebP', 'err');
    return;
  }
  if (file.size > LOGO_MAX) {
    toast('Logo too large', 'Keep it under 1.5 MB', 'err');
    return;
  }
  try {
    const data = fileBase64(await readFileBytes(file));
    const r = await api<DirectionResponse>(`/api/video/${encSlug()}/logo`, { method: 'POST', body: { name: file.name, data } });
    patchVideo({ direction: r.direction, motion: r.motion, transitions: r.transitions });
    renderDirection(r.direction);
    await syncEditorAfterDirection({ plates: true });
    toast('Logo set', 'Uploaded for this video', 'ok');
  } catch (err) {
    toast('Logo not added', errMessage(err), 'err');
    throw err;
  }
}

export function pickFocus(focus: string): void {
  const direction = desk.get().video?.direction;
  renderDirection({ ...(direction ?? ({} as Direction)), focus, approvedAt: null });
  void saveDirection({ focus }).catch(() => {});
}

export async function pickLook(look: string): Promise<void> {
  const r = await saveDirection({ look }, { quiet: true });
  // Look presets reshape the inset frame on the Editor stage immediately.
  await syncEditorAfterDirection();
  toast('Look applied', `${r.direction.looks[r.direction.look]?.label} · live on the stage`, 'ok');
}

export async function pickCamera(group: { camera?: string; cursor?: string }, value: string): Promise<void> {
  const patch = group.camera ? { camera: { [group.camera]: value } } : { cursor: { [group.cursor ?? '']: value } };
  const r = await saveDirection(patch, { quiet: true });
  const cam = r.direction.camera;
  if (group.camera && FRAME_CAMERA_KEYS.has(group.camera)) {
    await syncEditorAfterDirection();
    toast('Frame set', `${cam.frame}${cam.frame === 'inset' ? ` · ${cam.background}` : ''} · live on the stage`, 'ok');
  } else if (group.camera === 'zoom') {
    // Auto zoom re-plans from this recording's click marks — refresh so the Editor stage matches.
    await syncEditorAfterDirection();
    toast('Auto zoom set', `${cam.zoom} · live on the stage`, 'ok');
  } else if (group.camera === 'curve' || group.camera === 'motion') {
    // Curve and move length shape every zoom and loupe — the stage previews them live.
    await syncEditorAfterDirection();
    toast('Motion set', `${cam.curve} · ${cam.motion} · live on the stage`, 'ok');
  } else {
    toast('Cursor set', `${r.direction.cursor.style} · ${r.direction.cursor.size.toUpperCase()} · next recording`, 'ok');
  }
}

export async function toggleKeys(on: boolean): Promise<void> {
  const r = await saveDirection({ keys: on }, { quiet: true });
  toast('Keystrokes', `${r.direction.keys ? 'shown' : 'hidden'} · next recording`, 'ok');
}

export const CURSOR_TOGGLES = [
  { id: 'glideToggle', toggle: 'glide', key: 'glide', label: 'Smooth glide' },
  { id: 'handToggle', toggle: 'hand', key: 'hand', label: 'Hand on click' },
  { id: 'idleToggle', toggle: 'idle', key: 'hideIdle', label: 'Hide when idle' },
  { id: 'loopToggle', toggle: 'loop', key: 'loop', label: 'Loop cursor' },
] as const;

export async function toggleCursor(key: 'glide' | 'hand' | 'hideIdle' | 'loop', label: string, on: boolean): Promise<void> {
  const r = await saveDirection({ cursor: { [key]: on } }, { quiet: true });
  toast(label, `${r.direction.cursor[key] ? 'on' : 'off'} · next recording`, 'ok');
}

export async function setPace(value: string): Promise<void> {
  if (!value) return;
  const r = await saveDirection({ pace: value }, { quiet: true });
  if (r) toast('Live pace set', `${r.direction.pace.label} · ${r.direction.pace.tempo}× — re-record to apply`, 'ok');
}

/* ———————————————————————————————————————————— recording size */

export async function loadCaptureSize(forSlug = slug()): Promise<void> {
  try {
    const q = screenQuery();
    const r = await api<CaptureSettings>(`/api/video/${enc(forSlug)}/capture${q ? `?${q}` : ''}`);
    const current = desk.get().slug;
    if (current && current !== forSlug) return;
    renderCaptureSize(r);
  } catch {
    directionView.set({ sizeHidden: true });
  }
}

interface CaptureResponse extends CaptureSettings {
  freshness: VideoSummary['freshness'];
  output: VideoSummary['output'];
  plates?: HtmlPlate[];
}

export async function saveCaptureSize(body: Record<string, unknown>): Promise<CaptureResponse | null> {
  try {
    const r = await api<CaptureResponse>(`/api/video/${encSlug()}/capture`, {
      method: 'POST',
      body: { ...body, screen: directionView.get().capture?.screen || null },
    });
    directionView.set({ customOpen: false });
    renderCaptureSize(r);
    const v = desk.get().video;
    if (v) {
      const next = { ...v, freshness: r.freshness, output: r.output };
      desk.set({ video: next, action: decideAction(next) });
    }
    bridges.plate?.fitFhdPreview();
    if (r.plates) renderHtmlPlatePicker(r.plates);
    // The stage geometry (output shape, take placement) comes from the edit deck.
    if (bridges.editor?.active) await bridges.editor.refresh();
    const what = body.output ? (body.output === 'portrait' ? 'Vertical 9:16 video' : 'Landscape 16:9 video') : r.current?.label;
    toast('Recording size saved', r.space?.takeMatches ? String(what) : `${what} — re-record to apply`, 'ok');
    return r;
  } catch (err) {
    toast('Could not change the size', errMessage(err) || String(err), 'warn');
    return null;
  }
}

/** `#sizeOptions` click: a preset row, or open the custom form. */
export function pickSize(row: { size: string; w?: number; h?: number; dpr?: number }): void {
  if (row.size === 'custom-open') {
    directionView.set({ customOpen: true, sizeError: null });
    const settings = directionView.get().capture;
    if (settings) renderCaptureSize(settings);
    document.getElementById('sizeW')?.focus();
    return;
  }
  directionView.set({ customOpen: false });
  const id = row.size;
  void saveCaptureSize(
    id === 'screen' || id === 'custom' ? { preset: id, width: Number(row.w), height: Number(row.h), dpr: Number(row.dpr) } : { preset: id },
  );
}

export function submitCustomSize(): void {
  const f = directionView.get().sizeForm;
  const r = customBody({ width: f.w, height: f.h, dpr: f.dpr, mobile: f.mobile, touch: f.mobile });
  directionView.set({ sizeError: r.error || null });
  if (r.body) void saveCaptureSize({ ...r.body });
}

/* ———————————————————————————————————————————— dock */

export async function applyMotion(): Promise<void> {
  setButtonBusy('btnMotion', true);
  // Legacy reads an undeclared `energy` here (a ReferenceError toasts "Motion failed"); the
  // picked template is what it means.
  const energy = directionView.get().energy;
  try {
    if (!desk.get().video?.hasDraft) {
      await api(`/api/video/${encSlug()}/draft/snapshot`, { method: 'POST', body: {} });
    }
    cancelMotionLive();
    const r = await api<MotionResponse>(`/api/video/${encSlug()}/motion`, { method: 'POST', body: collectMotionBody() });
    desk.set({ motionApplied: true });
    patchVideo({ motion: r.motion });
    renderEffects(r.motion);
    if (r.direction) {
      patchVideo({ direction: r.direction });
      renderDirection(r.direction);
    }
    await bridges.plate?.rebuildPlateHtmlPreview({ selectFirst: !desk.get().activePlateId && !bridges.editor?.active });
    desk.set({ platesPreviewed: true });
    showProposal({
      title: 'Motion template applied',
      reason: `${energy} on all plates — review live HTML, then Approve & Render.`,
      steps: [
        { label: `Motion → ${energy}`, status: 'done' },
        { label: 'HTML rebuilt', status: 'done' },
        { label: 'Awaiting approve', status: 'run' },
      ],
    });
    toast('Live preview updated', energy);
  } catch (err) {
    toast('Motion failed', errMessage(err), 'err');
  } finally {
    setButtonBusy('btnMotion', false);
  }
}

export async function previewPlates(): Promise<void> {
  setButtonBusy('btnPreviewPlates', true);
  try {
    if (!desk.get().motionApplied) {
      const r = await api<MotionResponse>(`/api/video/${encSlug()}/motion`, { method: 'POST', body: collectMotionBody() });
      if (r.direction) {
        patchVideo({ direction: r.direction });
        renderDirection(r.direction);
      }
      desk.set({ motionApplied: true });
    }
    // Fast path: live HTML. Queue MP4 encode so it doesn't steal the poller.
    await bridges.plate?.rebuildPlateHtmlPreview({ selectFirst: true });
    enqueueJob({ kind: 'step', step: 'plates', force: true, label: 'Render brand plates' });
    desk.set({ platesPreviewed: true });
    showRightTab('motion');
    showProposal({
      title: 'Plate preview ready',
      reason: 'Live HTML is in the center. Approve & Render to encode the full sequence.',
      steps: [
        { label: 'HTML preview', status: 'done' },
        { label: 'Awaiting approve', status: 'run' },
      ],
    });
    toast('Live HTML ready', 'Use Plate HTML mode');
  } catch (err) {
    toast('Plate preview failed', errMessage(err), 'err');
  } finally {
    setButtonBusy('btnPreviewPlates', false);
  }
}

/** Resolves once the busy state clears; rejects (after its toast) when the save fails. */
export async function approveDirection(): Promise<void> {
  setButtonBusy('btnApproveDirection', true);
  try {
    const r = await saveDirection({ approve: true }, { quiet: true });
    toast('Direction approved', `${r.direction.palette} palette · ${r.direction.focus} focus`, 'ok');
    await loadVideo(slug());
  } finally {
    setButtonBusy('btnApproveDirection', false);
  }
}

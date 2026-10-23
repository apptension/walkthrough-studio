import type { VideoSummary } from '@/api/types';
import { activityThumbVisible, programPreview } from '@/logic/liveWatch';
import { liveTabVisible, needsProgramRestore, normalizeMonitorMode } from '@/logic/monitorMode';
import { marksForProgram, programSourceForStep } from '@/logic/programBuild';

import { bridges } from './bridge';
import { bust } from './format';
import { runtime } from './runtime';
import { desk, type ProgramBuildOverlay, type SignInWait } from './store';
import { toast } from './toast';
import { api } from './api';

/**
 * The Program monitor's engine: which pane owns the stage, what `#player` is
 * pointed at, and the transport readout. Ported from the monitor functions in
 * `kit/studio/app.js` (`setMonitorMode`, `ensureProgramMaster`,
 * `startPlayback`, `updateTransport`, `paintLivePreview`, …).
 */

export function activePlayer(): HTMLVideoElement | null {
  return desk.get().compare ? runtime.playerA : runtime.player;
}

/**
 * Start a program video from a click. A play() issued before the file can
 * play, or from the last frame, rejects and the button looks dead.
 * One generation token so a second loadVideo/play cannot reset and restart mid-start.
 */
export function startPlayback(el: HTMLVideoElement | null, { fromStart = false } = {}): void {
  if (!el) return;
  if (!el.currentSrc && !el.getAttribute('src')) {
    toast('Nothing to play', 'Render a sequence first', 'warn');
    return;
  }
  const gen = ++runtime.programPlayGen;
  const atEnd = el.ended || (Number.isFinite(el.duration) && el.duration > 0 && el.currentTime >= el.duration - 0.05);
  if (fromStart || atEnd) {
    try {
      el.currentTime = 0;
    } catch {
      /* metadata not in yet */
    }
  }
  const go = () => {
    if (gen !== runtime.programPlayGen) return;
    const pending = el.play() as Promise<void> | undefined;
    pending?.catch((err: unknown) => {
      if (gen !== runtime.programPlayGen) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      el.addEventListener(
        'canplay',
        () => {
          if (gen !== runtime.programPlayGen) return;
          el.play().catch(() => {});
        },
        { once: true },
      );
    });
  };
  if (el.readyState >= 2) go();
  else el.addEventListener('canplay', go, { once: true });
}

/** After a finished render: play once from the top, cancelling any prior pending play. */
export function startProgramPlayback(el: HTMLVideoElement | null): void {
  startPlayback(el, { fromStart: true });
}

export function setMonitorLabel(text = 'Program', hint = ''): void {
  const mode = desk.get().monitorMode;
  const fallback =
    mode === 'plate'
      ? 'Inline edit · timeline paused on this plate'
      : mode === 'compare'
        ? 'A/B against a saved version'
        : 'The rendered master';
  desk.set({ monitorLabel: { text, hint: hint || fallback } });
}

/** Point `#player` at the delivery master when Program shows a plate preview (or any stand-in). */
export function ensureProgramMaster({ force = false, play = false, preserveTime = true } = {}): boolean {
  const s = desk.get();
  const deliveryUrl = s.video?.deliveryUrl;
  const player = runtime.player;
  if (!player || !deliveryUrl) return false;
  const playerSrc = player.currentSrc || player.getAttribute('src') || '';
  if (!needsProgramRestore({ monitorMode: 'program', previewingPlate: s.previewingPlate, playerSrc, deliveryUrl, force })) {
    return false;
  }
  const t = preserveTime ? Number(player.currentTime) || 0 : 0;
  desk.set({ previewingPlate: null, programLoaded: true });
  player.pause();
  player.src = bust(deliveryUrl);
  const afterLoad = () => {
    if (preserveTime && t > 0.05) {
      try {
        player.currentTime = Math.min(t, player.duration || t);
      } catch {
        /* ignore */
      }
    }
    if (play) startPlayback(player);
    updateTransport();
  };
  if (player.readyState >= 1) afterLoad();
  else player.addEventListener('loadedmetadata', afterLoad, { once: true });
  setMonitorLabel('Program');
  return true;
}

export function setMonitorMode(input: string, { keepPreview = false } = {}): void {
  const mode = normalizeMonitorMode(input);
  const s = desk.get();
  if (mode !== 'plate' && s.plateDirty && !warnedDirty) {
    // Leaving plate mode with unsaved edits — keep dirty until save/discard; warn once.
    warnedDirty = true;
    toast('Unsaved plate edits', 'Save or Discard before leaving Plate HTML', 'warn');
  }
  desk.set({ monitorMode: mode, compare: mode === 'compare' });
  if (mode !== 'live') desk.set((st) => ({ live: { ...st.live, warming: false } }));
  if (mode !== 'plate') bridges.editor?.onLeave();
  const player = runtime.player;
  if (mode === 'program') {
    setMonitorLabel(desk.get().previewingPlate && keepPreview ? 'Preview' : 'Program');
    if (!keepPreview) ensureProgramMaster();
  } else if (mode === 'live') {
    setMonitorLabel('Live', 'Page capture — Program returns to the master');
    player?.pause();
  } else if (mode === 'plate') {
    setMonitorLabel('Editor', 'Changes save as you go · Render to bake them into the video');
    const programT = player?.currentTime || 0;
    bridges.editor?.onEnter({ programT });
    player?.pause();
    runtime.playerA?.pause();
    bridges.plate?.ensureFhdFitObserver();
    requestAnimationFrame(() => requestAnimationFrame(() => bridges.plate?.fitFhdPreview()));
  } else {
    setMonitorLabel('Compare', 'A/B against a saved version');
    player?.pause();
  }
  updateTransport();
  bridges.editor?.onPlateDirty();
}

let warnedDirty = false;

/** A saved or discarded plate edit re-arms the one-time "unsaved edits" warning. */
export function resetPlateDirtyWarning(): void {
  warnedDirty = false;
}

export function setCompare(on: boolean): void {
  const s = desk.get();
  const versions = s.video?.versions ?? [];
  if (on && !versions.length) {
    toast('Save a snapshot first', 'Then use Compare', 'warn');
    desk.set({ compare: false });
    return;
  }
  if (on) {
    setMonitorMode('compare');
    syncCompare();
  } else {
    // previewingPlate is a URL stand-in on the Program player — not “open the Editor”.
    // Only return to plate mode when a draft proposal is still waiting for HTML review.
    const backToPlate = Boolean(s.proposalOpen && s.htmlPlates.length);
    setMonitorMode(backToPlate ? 'plate' : 'program');
  }
}

export function syncCompare(): void {
  const s = desk.get();
  const v = s.video;
  const a = runtime.playerA;
  const b = runtime.playerB;
  if (!v?.deliveryUrl || !a || !b) return;
  const t = runtime.player?.currentTime || 0;
  a.src = `${v.deliveryUrl}?t=${Date.now()}`;
  a.muted = false;
  const id = s.compareId;
  if (id) b.src = `/version-media/${s.slug}/${id}/${s.slug}.mp4`;
  else b.removeAttribute('src');
  const seek = () => {
    try {
      a.currentTime = t;
      if (id) b.currentTime = t;
    } catch {
      /* ignore */
    }
  };
  a.addEventListener('loadedmetadata', seek, { once: true });
  if (id) b.addEventListener('loadedmetadata', seek, { once: true });
}

export function seekTo(sec: number): void {
  const s = desk.get();
  const d = activePlayer()?.duration || s.duration || 0;
  const t = Math.min(Math.max(0, sec), d || sec);
  if (s.compare) {
    if (runtime.playerA) runtime.playerA.currentTime = t;
    if (runtime.playerB) runtime.playerB.currentTime = t;
  } else if (runtime.player) {
    runtime.player.currentTime = t;
  }
  updateTransport();
}

function chapterAt(t: number) {
  let cur = null;
  for (const c of desk.get().chapters) if (c.start <= t + 0.05) cur = c;
  return cur;
}

/** Transport readout, chapter toast, compare sync and the scene bar — `updateTransport()`. */
export function updateTransport(): void {
  const s = desk.get();
  const player = activePlayer();
  if (!player) return;
  const t = player.currentTime || 0;
  const d = player.duration || s.duration || 0;
  let buffered = s.transport.buffered;
  if (player.buffered?.length) {
    try {
      buffered = player.buffered.end(player.buffered.length - 1);
    } catch {
      /* ignore */
    }
  }
  const playing = !player.paused && !player.ended;
  const patch: Partial<ReturnType<typeof desk.get>> = { duration: d, transport: { t, d, playing, buffered } };

  const ch = chapterAt(t);
  if (ch && s.lastChapter !== ch.start) {
    patch.lastChapter = ch.start;
    patch.chapterToast = { title: String(ch.title || ''), on: true };
    if (runtime.chapterTimer) clearTimeout(runtime.chapterTimer);
    runtime.chapterTimer = setTimeout(
      () => desk.set((st) => ({ chapterToast: { ...st.chapterToast, on: false } })),
      1400,
    );
  }
  desk.set(patch);

  if (s.compare && runtime.playerB) {
    const b = runtime.playerB;
    if (Math.abs((b.currentTime || 0) - t) > 0.35) b.currentTime = t;
  }
  updateSceneFromTime(t);
}

/** `updateSceneFromTime(t)` — which scene the scene bar names. */
export function updateSceneFromTime(t: number): void {
  const s = desk.get();
  const scenes = s.scenes;
  if (!scenes.length) {
    if (s.currentScene) desk.set({ currentScene: null });
    return;
  }
  let cur = scenes.find((sc) => t >= sc.start - 0.05 && t < sc.end - 0.02) ?? scenes[scenes.length - 1] ?? null;
  // In plate editor, keep the scene bar pinned to the plate being edited
  if (s.monitorMode === 'plate' && s.activePlateId) {
    const pinned = scenes.find((sc) => sc.plateId === s.activePlateId);
    if (pinned) cur = pinned;
  } else if (s.editingPlateId) {
    const locked = scenes.find((sc) => sc.plateId === s.editingPlateId);
    if (locked && s.proposalOpen) cur = locked;
  }
  if (cur !== s.currentScene) desk.set({ currentScene: cur });
}

/** Seek Program to a plate's scene and pin the timeline highlight on it. */
export function syncTimelineToPlate(plateId: string): void {
  const s = desk.get();
  const scene = s.scenes.find((sc) => sc.plateId === plateId || sc.id === plateId);
  if (!scene) return;
  const player = runtime.player;
  player?.pause();
  const t = Math.min(scene.end - 0.05, scene.start + 0.08);
  try {
    if (player) player.currentTime = t;
  } catch {
    /* ignore seek before metadata */
  }
  desk.set({ currentScene: scene });
  updateSceneFromTime(t);
  const d = player?.duration || s.duration || 0;
  desk.set((st) => ({ transport: { ...st.transport, t, d } }));
}

/* ------------------------------------------------------------- live capture */

interface LivePaintOpts {
  recording?: boolean;
  repairing?: boolean;
  warmingUp?: boolean;
}

/** `paintLivePreview(v, opts)` — the Live pane, its badge, the Live tab and the Activity thumb. */
export function paintLivePreview(v: VideoSummary | null, { recording = false, repairing = false, warmingUp = false }: LivePaintOpts = {}): void {
  const s = desk.get();
  const view = programPreview({
    recording,
    repairing,
    previewUrl: v?.previewUrl || (recording ? s.live.url : null),
    hasLive: Boolean(v?.freshness?.liveAt),
    hasDelivery: Boolean(v?.hasDelivery || v?.deliveryUrl),
  });
  const onLivePane = s.monitorMode === 'live';
  const thumbOn = activityThumbVisible({ recording, repairing });
  const warm = onLivePane && recording && warmingUp && view.show;
  const show = liveTabVisible({ recording, repairing });
  const onAir = recording || view.badge === 'Live';
  const url = view.show && view.url ? view.url : null;
  // Keep a frame that is already showing. Replacing `src` on the job poll aborts
  // the JPEG that is still downloading, and once a navigation makes that download
  // slower than the poll the picture never advances. The live-frame pump swaps in
  // a decoded frame; this paint only sets the first URL for a clip.
  const sameClip = Boolean(url && url === s.live.url && s.live.src);
  desk.set({
    live: {
      url: url ?? s.live.url,
      src: url ? (sameClip ? s.live.src : bust(url)) : null,
      recording,
      repairing,
      warming: warm,
      badge: view.badge || null,
      tab: show,
      onAir: show && onAir,
      thumb: Boolean(url) && thumbOn,
    },
  });
  if (show) {
    // Enter Live once when capture starts — do not re-enter every preview tick.
    if ((recording || repairing) && desk.get().monitorMode === 'program') setMonitorMode('live', { keepPreview: true });
  } else if (desk.get().monitorMode === 'live') {
    setMonitorMode('program', { keepPreview: true });
  }
  if ((recording || repairing) && desk.get().monitorMode === 'live') {
    const hint = view.badge === 'Repairing' || repairing ? 'Repairing the flow, then capture starts again' : 'Recording the page now';
    setMonitorLabel('Live', hint);
  }
}

export function paintSignInWait(wait: SignInWait | null): void {
  desk.set({ signInWait: wait ? { title: wait.title || 'This page is waiting for you', next: wait.next || '' } : null });
}

export function paintProgramBuild(overlay: ProgramBuildOverlay | null): void {
  desk.set({ programBuild: overlay?.show ? overlay : null });
}

/** Swap Program to the newest output after a pipeline step, without waiting for the last one. */
export async function publishProgramStep(step: string, slug: string): Promise<void> {
  const v = await api<VideoSummary>(`/api/video/${encodeURIComponent(slug)}`);
  const s = desk.get();
  if (s.slug && s.slug !== slug) return;
  const player = runtime.player;
  const time = Number(player?.currentTime) || 0;
  const video = { ...(s.video ?? {}), ...v };
  desk.set({
    video,
    scenes: v.scenes ?? [],
    chapters: marksForProgram({ chapters: v.chapters, captureMarks: v.captureMarks }),
  });
  const choice = programSourceForStep({
    step,
    hasLive: Boolean(v.liveUrl),
    liveUrl: v.liveUrl,
    hasDelivery: Boolean(v.deliveryUrl),
    deliveryUrl: v.deliveryUrl,
  });
  if (!('src' in choice) || !choice.src || !player) return;
  // Step previews must not leave Live covering Program after capture ends.
  if (normalizeMonitorMode(desk.get().monitorMode) === 'live') setMonitorMode('program', { keepPreview: true });
  desk.set({ programLoaded: true });
  ++runtime.programPlayGen; // cancel any in-flight post-render play handshake
  player.pause();
  player.src = bust(choice.src);
  player.onloadedmetadata = () => {
    if (choice.preserveTime && time > 0.05) {
      try {
        player.currentTime = Math.min(time, player.duration || time);
      } catch {
        /* the new file can be shorter than the previous playhead */
      }
    }
    if (choice.play) startPlayback(player);
  };
}

/** Play a plate MP4 on the Program player as a stand-in for the master. */
export function playPlatePreview(url: string, label = 'Plate'): void {
  if (!url) return;
  setCompare(false);
  desk.set({ previewingPlate: url });
  if (normalizeMonitorMode(desk.get().monitorMode) !== 'program') setMonitorMode('program', { keepPreview: true });
  const player = runtime.player;
  if (!player) return;
  player.pause();
  player.src = url + (url.includes('?') ? '&' : '?') + `t=${Date.now()}`;
  desk.set({ programLoaded: true });
  startPlayback(player);
  setMonitorLabel(`Preview · ${label}`, 'Plate encode — Program tab or Play restores the master');
  toast('Plate preview', `${label} · Play / Program returns to the master`);
  updateTransport();
}

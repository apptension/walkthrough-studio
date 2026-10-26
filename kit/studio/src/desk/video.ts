import { requestText } from '@/api/client';
import type { CaptionCue, VideoIndex, VideoSummary } from '@/api/types';
import { normalizeMonitorMode } from '@/logic/monitorMode';
import { capturedTour } from '@/logic/recordFailure';
import { slugGroups } from '@/logic/slugOptions';

import { decideAction } from './action';
import { api, enc } from './api';
import { bridges } from './bridge';
import { bust } from './format';
import {
  paintLivePreview,
  setCompare,
  setMonitorLabel,
  setMonitorMode,
  startProgramPlayback,
  syncCompare,
  updateSceneFromTime,
  updateTransport,
} from './monitor';
import { runtime } from './runtime';
import { clearRunStatus, desk } from './store';
import { toast } from './toast';

/**
 * Opening, reloading and switching sequences — `loadVideo`, `refreshSummary`,
 * `openVideo` and the boot / busy veils from `kit/studio/app.js`.
 */

/* ------------------------------------------------------------ boot + busy */

let booting = true;
let busyGen = 0;

export function setBootStatus(text: string): void {
  if (text) desk.set((s) => ({ boot: { ...s.boot, status: text } }));
}

export function dismissBoot(): void {
  booting = false;
  desk.set((s) => ({ boot: { ...s.boot, leaving: true } }));
  setTimeout(() => desk.set((s) => ({ boot: { ...s.boot, gone: true } })), 520);
}

/** Full-screen while the app boots. After that, a workspace veil once a load is actually noticeable. */
export function setBusy(on: boolean, label = 'Opening sequence', detail = ''): void {
  if (booting) {
    if (on) setBootStatus(detail || label);
    return;
  }
  desk.set((s) => ({ busyOverlay: { ...s.busyOverlay, label: label || s.busyOverlay.label, detail: detail || '' } }));
  const gen = ++busyGen;
  if (on) {
    setTimeout(() => {
      if (gen !== busyGen) return;
      desk.set((s) => ({ busyOverlay: { ...s.busyOverlay, shown: true } }));
    }, 160);
    return;
  }
  if (!desk.get().busyOverlay.shown) return;
  desk.set((s) => ({ busyOverlay: { ...s.busyOverlay, leaving: true } }));
  setTimeout(() => {
    if (gen !== busyGen) return;
    desk.set((s) => ({ busyOverlay: { ...s.busyOverlay, shown: false, leaving: false } }));
  }, 220);
}

/* ---------------------------------------------------------------- slug */

export function qsSlug(): string | null {
  return new URLSearchParams(location.search).get('slug');
}

export function setSlug(slug: string): void {
  if (desk.get().slug !== slug) desk.set({ versionSelection: [] });
  desk.set({ slug });
  const u = new URL(location.href);
  u.searchParams.set('slug', slug);
  history.replaceState(null, '', u);
}

/** `sequenceName(slug)`: the `#slugSelect` option label for a slug, whitespace collapsed; the slug when it has no option. */
export function sequenceName(slug: string): string {
  const index = desk.get().index;
  const option = index ? slugGroups(index).flatMap((g) => g.options).find((o) => o.value === slug) : undefined;
  return option?.label.replace(/\s+/g, ' ').trim() || slug || '';
}

export async function refreshVideoIndex(): Promise<VideoIndex> {
  const data = await api<VideoIndex>('/api/videos');
  desk.set({ index: data });
  return data;
}

export async function openVideo(slug: string): Promise<void> {
  // Always reload the index so new branches / folders appear after create.
  const data = await refreshVideoIndex();
  if (!data.videos.some((v) => v.slug === slug)) {
    throw new Error(`Sequence "${slug}" is not in the project list`);
  }
  setSlug(slug);
  await loadVideo(slug);
}

/* ------------------------------------------------------------ summary */

/**
 * Everything the legacy `renderActionCard` / `renderVersions` / `renderScenes`
 * calls did to *state* when a summary landed (the painting is the components').
 */
export function applySummary(v: VideoSummary): void {
  const action = decideAction(v);
  const s = desk.get();
  const alive = new Set((v.versions ?? []).map((ver) => ver.id));
  desk.set({
    video: v,
    action,
    scenes: v.scenes ?? [],
    htmlPlates: v.htmlPlates ?? [],
    versionSelection: s.versionSelection.filter((id) => alive.has(id)),
  });
  if (!s.jobBusy) clearRunStatus();
  // A busy bay keeps the pipeline's headline; only the pill says Rendering.
  if (s.jobBusy && s.bay) desk.set({ bay: { ...s.bay, pillClass: 'render-pill run', pillText: 'Rendering' } });
  const versions = v.versions ?? [];
  if (s.compare && (!versions.length || (s.compareId && !versions.some((ver) => ver.id === s.compareId)))) {
    setCompare(false);
  }
  if (!s.compareId || !versions.some((ver) => ver.id === s.compareId)) {
    desk.set({ compareId: versions[0]?.id ?? '' });
  }
  updateSceneFromTime(runtime.player?.currentTime || 0);
}

/** Re-read the summary without touching the player (approvals, narration edits). */
export async function refreshSummary(): Promise<void> {
  const slug = desk.get().slug;
  if (!slug) return;
  const v = await api<VideoSummary>(`/api/video/${slug}`);
  applySummary(v);
}

async function loadCaptions(slug: string): Promise<void> {
  try {
    const data = await api<{ clips?: CaptionCue[] }>(`/api/video/${enc(slug)}/captions`);
    desk.set({ cues: data.clips ?? [] });
  } catch {
    desk.set({ cues: [] });
  }
}

export async function loadVideo(slug: string, { play = false } = {}): Promise<void> {
  // Callers set state.slug before loadVideo — compare against the loaded video, not the picker.
  const prev = desk.get().video;
  const switched = Boolean(prev?.slug && prev.slug !== slug);
  setBusy(true, 'Opening sequence', sequenceName(slug));
  try {
    if (switched) {
      // Drop plate-edit / compare leftovers from the previous sequence before the new payload lands.
      desk.set({ plateDirty: false, previewingPlate: null, lastChapter: null, ytText: '', compare: false });
      bridges.editor?.resetForProject();
    }

    const v = await api<VideoSummary>(`/api/video/${enc(slug)}`);
    // Picker may have moved on while we were fetching.
    const current = desk.get().slug;
    if (current && current !== slug) return;
    desk.set({ chapters: v.chapters ?? [], duration: v.durationSec || 0, lastChapter: null });
    applySummary(v);
    await bridges.editor?.refresh();

    // Heal a stuck legacy mode (e.g. 'html') that hid every pane without re-entering the Editor.
    const mode = desk.get().monitorMode;
    const healed = normalizeMonitorMode(mode);
    if (healed !== mode) {
      desk.set({ monitorMode: healed });
      if (healed !== 'plate') bridges.editor?.onLeave();
    }
    if (!desk.get().proposalOpen && desk.get().monitorMode !== 'plate') {
      desk.set({ previewingPlate: null });
      setMonitorLabel('Program');
    }
    paintLivePreview(v, { recording: false });

    const player = runtime.player;
    if (v.deliveryUrl && capturedTour({ hasLive: Boolean(v.freshness?.liveAt), recordFailed: Boolean(v.recordFailure) })) {
      const m = desk.get().monitorMode;
      if (play && normalizeMonitorMode(m) !== 'program' && m !== 'compare') setMonitorMode('program', { keepPreview: true });
      const now = desk.get().monitorMode;
      if (player && (now === 'program' || now === 'compare')) {
        desk.set({ previewingPlate: null });
        player.pause();
        player.src = `${v.deliveryUrl}?t=${Date.now()}`;
      }
      if (player) player.poster = v.posterUrl || '';
      bumpLoadStamp();
      desk.set({ programLoaded: true });
      if (play) startProgramPlayback(player);
    } else {
      if (player) {
        player.removeAttribute('src');
        player.load();
      }
      desk.set({ programLoaded: false });
    }

    await loadCaptions(slug);
    const after = desk.get().slug;
    if (after && after !== slug) return;

    if (v.youtubeChaptersUrl) {
      const text = await requestText(v.youtubeChaptersUrl).catch(() => '');
      desk.set({ ytText: text });
    } else desk.set({ ytText: '' });

    if (desk.get().compare) syncCompare();
    updateTransport();
  } catch (err) {
    toast('Could not open sequence', err instanceof Error ? err.message : String(err), 'err');
    throw err;
  } finally {
    setBusy(false);
  }
}

/** The caption track the master carries (`<track>` under `#player`). */
export function captionTrack(v: VideoSummary | null): { src: string; label: string; srclang: string } | null {
  if (!v?.captions?.vttUrl) return null;
  return {
    src: bust(v.captions.vttUrl, loadStamp),
    label: v.language?.name || v.captions.languageName || 'English',
    srclang: v.language?.code || v.captions.language || 'en',
  };
}

let loadStamp = Date.now();
/** New `?t=` for the caption track on every load, like the legacy re-appended `<track>`. */
export function bumpLoadStamp(): void {
  loadStamp = Date.now();
}

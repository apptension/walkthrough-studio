import type { VideoSummary, Version } from '@/api/types';
import { api } from '@/desk/api';
import { ask } from '@/desk/ask';
import { formatBytes } from '@/desk/format';
import { playPlatePreview, setCompare } from '@/desk/monitor';
import { showLeftTab } from '@/desk/panels';
import { desk } from '@/desk/store';
import { toast } from '@/desk/toast';
import { loadVideo } from '@/desk/video';

import { versionDisplayName } from './versions';

/**
 * History actions from the legacy `wire()`: save a version (`snapshot`),
 * pick / delete versions, clean intermediates, and the play / compare /
 * restore buttons on each card.
 */

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `#btnSnapshot` / `#btnSnapshotSide`: name a version of the whole cut. */
export async function snapshotVersion(): Promise<void> {
  try {
    const suggested = `Saved snapshot`;
    const title = await ask({
      kind: 'prompt',
      title: 'Save a version',
      detail: 'A named checkpoint of the whole cut — play it, compare it or restore it later.',
      label: 'Title',
      value: suggested,
      ok: 'Save version',
    });
    if (title === null) return;
    const slug = desk.get().slug;
    const r = await api<{ version?: { name?: string; title?: string } }>(`/api/video/${slug}/versions/snapshot`, {
      method: 'POST',
      body: {
        title: (title || suggested).trim() || suggested,
        trigger: 'manual',
        kind: 'release',
        note: 'manual save',
      },
    });
    await loadVideo(slug ?? '');
    showLeftTab('versions');
    const ver = r.version;
    toast(ver?.name ? `${ver.name} saved` : 'Version saved', ver?.title || '');
  } catch (err) {
    toast('Save failed', errorMessage(err), 'err');
  }
}

export function setVersionSelected(id: string, on: boolean): void {
  desk.set((s) => {
    const has = s.versionSelection.includes(id);
    if (on === has) return {};
    return { versionSelection: on ? [...s.versionSelection, id] : s.versionSelection.filter((x) => x !== id) };
  });
}

/** `#togSelectAllVersions`: every visible card on or off. */
export function selectVersions(ids: readonly string[], on: boolean): void {
  for (const id of ids) setVersionSelected(id, on);
}

export function pruneVersionSelection(versions: readonly Version[]): void {
  const alive = new Set(versions.map((ver) => ver.id));
  desk.set((s) => ({ versionSelection: s.versionSelection.filter((id) => alive.has(id)) }));
}

interface DeletePlanVersion {
  id: string;
  name: string;
  title: string;
  kind: string;
  bytes?: number;
  sizeLabel?: string;
}

interface DeletePlan {
  versions?: DeletePlanVersion[];
  missing?: string[];
  totalBytes?: number;
  totalLabel?: string;
  summary?: Partial<VideoSummary>;
}

export async function deleteSelectedVersions(): Promise<void> {
  const slug = desk.get().slug;
  if (!slug) return;
  const ids = [...desk.get().versionSelection];
  if (!ids.length) return;
  try {
    const plan = await api<DeletePlan>(`/api/video/${slug}/versions/delete`, {
      method: 'POST',
      body: { confirm: false, ids },
    });
    if (!plan.versions?.length) {
      toast('Nothing to delete', plan.missing?.length ? 'Those versions are already gone' : 'Select versions first');
      pruneVersionSelection(desk.get().video?.versions ?? []);
      return;
    }
    const lines = plan.versions.map(
      (ver) => `· ${ver.name} · ${ver.title}${ver.kind === 'checkpoint' ? ' · checkpoint' : ''} · ${ver.sizeLabel || formatBytes(ver.bytes)}`,
    );
    const ok = await ask({
      title: plan.versions.length === 1 ? 'Delete this version?' : `Delete ${plan.versions.length} versions?`,
      detail: [
        `${plan.versions.length} version${plan.versions.length === 1 ? '' : 's'} · ${plan.totalLabel || formatBytes(plan.totalBytes)}`,
        '',
        ...lines,
        '',
        'Removed from History permanently. The current master and live.mp4 stay.',
      ].join('\n'),
      ok: plan.versions.length === 1 ? 'Delete version' : `Delete ${plan.versions.length}`,
      tone: 'warn',
    });
    if (!ok) return;
    const done = await api<DeletePlan>(`/api/video/${slug}/versions/delete`, {
      method: 'POST',
      body: { confirm: true, ids: plan.versions.map((ver) => ver.id) },
    });
    const gone = new Set((done.versions ?? []).map((ver) => ver.id));
    desk.set((s) => ({ versionSelection: s.versionSelection.filter((id) => !gone.has(id)) }));
    if (done.summary) {
      const current = desk.get().video;
      const merged = { ...(current ?? {}), ...done.summary, versions: done.summary.versions || current?.versions } as VideoSummary;
      desk.set({ video: merged });
    }
    await loadVideo(slug);
    toast(
      done.versions?.length === 1 ? 'Version deleted' : `${done.versions?.length || 0} versions deleted`,
      done.totalLabel || formatBytes(done.totalBytes),
    );
  } catch (err) {
    toast('Delete failed', errorMessage(err), 'err');
  }
}

interface FilePlan {
  files?: Array<{ name: string; bytes?: number }>;
  totalBytes?: number;
  totalLabel?: string;
}

export function confirmFilePlan(plan: FilePlan, { title, ok, keepNote }: { title: string; ok: string; keepNote: string }): Promise<boolean> {
  const files = plan.files || [];
  const preview = files.slice(0, 8).map((file) => `· ${file.name} · ${formatBytes(file.bytes)}`);
  const more = files.length > 8 ? `\n· …and ${files.length - 8} more` : '';
  const body = [
    `${files.length} file${files.length === 1 ? '' : 's'} · ${plan.totalLabel || formatBytes(plan.totalBytes)}`,
    '',
    ...preview,
    more.trim(),
    '',
    keepNote,
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n')
    .trim();
  return ask({ title, detail: body, ok, tone: 'warn' });
}

export async function cleanIntermediates(): Promise<void> {
  const slug = desk.get().slug;
  if (!slug) return;
  try {
    const plan = await api<FilePlan>(`/api/video/${slug}/cleanup`, { method: 'POST', body: { confirm: false } });
    if (!plan.files?.length) {
      toast('Nothing to clean', 'No plates, slices, or premaster audio on disk');
      return;
    }
    const ok = await confirmFilePlan(plan, {
      title: 'Clean intermediate files?',
      ok: 'Delete files',
      keepNote: 'These regenerate on the next render. The current master, live.mp4, and History stay.',
    });
    if (!ok) return;
    const done = await api<FilePlan & { files: Array<{ name: string }> }>(`/api/video/${slug}/cleanup`, {
      method: 'POST',
      body: { confirm: true },
    });
    toast(
      'Intermediates deleted',
      `${done.files.length} file${done.files.length === 1 ? '' : 's'} · ${done.totalLabel || formatBytes(done.totalBytes)}`,
    );
  } catch (err) {
    toast('Cleanup failed', errorMessage(err), 'err');
  }
}

function findVersion(id: string): Version | undefined {
  return (desk.get().video?.versions ?? []).find((x) => x.id === id);
}

/** The card actions (`#versions` click: play / compare / restore). */
export async function versionAction(act: string, id: string): Promise<void> {
  const slug = desk.get().slug;
  if (act === 'play') {
    const verUrl = `/version-media/${slug}/${id}/${slug}.mp4`;
    const ver = findVersion(id);
    playPlatePreview(verUrl, ver ? `Snapshot · ${versionDisplayName(ver)}` : `Snapshot · ${id}`);
  } else if (act === 'compare') {
    desk.set({ compareId: id });
    setCompare(true);
    const ver = findVersion(id);
    toast('Compare', ver ? `Current vs ${versionDisplayName(ver)}` : 'Current vs version');
  } else if (act === 'restore') {
    const ver = findVersion(id);
    await api(`/api/video/${slug}/versions/${id}/restore`, { method: 'POST', body: {} });
    await loadVideo(slug ?? '');
    toast(ver ? `${ver.name} restored` : 'Settings restored', 'Press Render to rebuild');
  }
}

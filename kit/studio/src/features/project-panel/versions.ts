import type { Version } from '@/api/types';
import { formatBytes } from '@/desk/format';

/**
 * History helpers from `kit/studio/app.js`: `formatVersionWhen`,
 * `versionDisplayName`, `versionBytes`, the count line and the
 * `syncVersionsToolbar` view.
 */

export function formatVersionWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function versionDisplayName(ver: Partial<Version>): string {
  if (ver.displayName) return ver.displayName;
  if (ver.name && ver.title) return `${ver.name} · ${ver.title}`;
  return ver.title || ver.label || ver.name || ver.id || '';
}

export function versionBytes(ver: Partial<Version> | null | undefined): number {
  if (Number.isFinite(ver?.bytes)) return ver?.bytes ?? 0;
  if (Number.isFinite(ver?.sizeMB)) return Math.round((ver?.sizeMB ?? 0) * 1024 * 1024);
  return 0;
}

export function visibleVersions(versions: Version[], showCheckpoints: boolean): Version[] {
  return showCheckpoints ? versions : versions.filter((ver) => ver.kind !== 'checkpoint');
}

/** `#versionCount`. */
export function versionCountText(versions: Version[], showCheckpoints: boolean): string {
  if (!versions.length) return 'No versions yet';
  const releases = versions.filter((ver) => ver.kind !== 'checkpoint');
  const checkpoints = versions.filter((ver) => ver.kind === 'checkpoint');
  if (!showCheckpoints && checkpoints.length) {
    return `${releases.length} version${releases.length === 1 ? '' : 's'} · ${checkpoints.length} checkpoint${checkpoints.length === 1 ? '' : 's'} hidden`;
  }
  return `${versions.length} in history · latest ${versions[0]?.name || '—'}`;
}

export interface VersionsToolbarView {
  hasSelection: boolean;
  meta: string;
  deleteDisabled: boolean;
  deleteText: string;
  allChecked: boolean;
  allIndeterminate: boolean;
  allDisabled: boolean;
}

/** `syncVersionsToolbar(visible)` as a view. */
export function versionsToolbar(all: Version[], visible: Version[], selection: readonly string[]): VersionsToolbarView {
  const picked = new Set(selection);
  const selected = all.filter((ver) => picked.has(ver.id));
  const visibleSelected = visible.filter((ver) => picked.has(ver.id));
  const totalBytes = selected.reduce((sum, ver) => sum + versionBytes(ver), 0);
  const n = selected.length;
  const hiddenSelected = n - visibleSelected.length;
  let meta: string;
  if (!all.length) meta = 'Save a version to manage History';
  else if (!n) meta = 'Nothing selected';
  else if (hiddenSelected > 0) meta = `${n} selected · ~${formatBytes(totalBytes)} · ${hiddenSelected} hidden`;
  else meta = `${n} selected · ~${formatBytes(totalBytes)}`;
  const allOn = visible.length > 0 && visibleSelected.length === visible.length;
  return {
    hasSelection: n > 0,
    meta,
    deleteDisabled: n === 0,
    deleteText: n ? `Delete (${n})` : 'Delete',
    allChecked: allOn,
    allIndeterminate: visibleSelected.length > 0 && !allOn,
    allDisabled: !visible.length,
  };
}

/** The meta line of one version card: when · duration · size. */
export function versionMetaBits(ver: Version, fmtShort: (sec: number) => string): { metaBits: string; size: string } {
  const when = formatVersionWhen(ver.createdAt);
  const dur = Number.isFinite(ver.durationSec) ? fmtShort(ver.durationSec ?? 0) : '—';
  const size = ver.sizeMB != null ? `${ver.sizeMB} MB` : '';
  return { metaBits: [when, dur, size].filter(Boolean).join(' · '), size };
}

const QC_LABEL: Partial<Record<string, string>> = { warn: 'QC warnings', fail: 'QC failed', bad: 'QC failed' };

export function versionQcLabel(status: string | null | undefined): string | undefined {
  return status ? QC_LABEL[status] : undefined;
}

/** Notes the pipeline writes (`studio …`, `cli …`, `auto …`) stay off the card. */
export function versionNoteShown(note: string | null | undefined): boolean {
  return Boolean(note && !/^(studio|cli|auto)/i.test(note));
}

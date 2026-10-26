import { api, enc } from '@/desk/api';
import { enqueueJob } from '@/desk/jobs';
import { desk, setButtonBusy } from '@/desk/store';
import { toast } from '@/desk/toast';

/** `downloadHandoffZip`, `syncHandoffDownloadLinks` and the export picks from `kit/studio/app.js`. */

export const DEFAULT_EXPORT_PICK = ['square', 'vertical', 'gif'];

/** The `href` / `download` a handoff zip link carries once the zip exists. */
export function handoffZipLink(zipUrl: string, slug: string, stamp = Date.now()): { href: string; download: string } {
  return { href: `${zipUrl}?t=${stamp}&download=1`, download: `${slug}-handoff.zip` };
}

export async function downloadHandoffZip({ buildIfMissing = true }: { buildIfMissing?: boolean } = {}): Promise<void> {
  setButtonBusy('btnBuildHandoffZip', true);
  setButtonBusy('btnExportMedia', true);
  try {
    const s = desk.get();
    if (!s.video?.deliver && buildIfMissing) {
      toast('Building handoff…', 'Poster, captions, stills, zip');
      enqueueJob({ kind: 'step', step: 'deliver', force: false, label: 'Export handoff pack' });
      return;
    }
    const slug = s.slug ?? '';
    const r = await api<{ zipUrl: string; sizeMB: number }>(`/api/video/${enc(slug)}/deliverables/zip`, {
      method: 'POST',
      body: {},
    });
    desk.set((d) => (d.video ? { video: { ...d.video, handoffZipUrl: r.zipUrl } } : {}));
    const link = handoffZipLink(r.zipUrl, slug);
    const a = document.createElement('a');
    a.href = link.href;
    a.download = link.download;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Downloading zip', `${r.sizeMB} MB`);
  } catch (err) {
    toast('Zip failed', err instanceof Error ? err.message : String(err), 'err');
  } finally {
    setButtonBusy('btnBuildHandoffZip', false);
    setButtonBusy('btnExportMedia', false);
  }
}

/** `btnExportFormats`: cut the picked social formats from the master. */
export function exportFormats(pick: string[] | null): void {
  const presets = pick || DEFAULT_EXPORT_PICK;
  if (!presets.length) {
    toast('Pick a format', 'Choose at least one format to export', 'warn');
    return;
  }
  enqueueJob({
    kind: 'step',
    step: 'export',
    presets,
    label: `Export ${presets.length} format${presets.length === 1 ? '' : 's'}`,
  });
}

export async function copyYoutubeChapters(): Promise<void> {
  const text = desk.get().ytText;
  if (!text) return;
  await navigator.clipboard.writeText(text.trim() + '\n');
  toast('Copied', 'YouTube chapters');
}

export function setReelSafeArea(on: boolean): void {
  desk.set({ reelSafeArea: on });
  toast('Reel safe area', on ? 'Vertical interface overlap shown on Program' : 'Preview hidden', 'ok');
}

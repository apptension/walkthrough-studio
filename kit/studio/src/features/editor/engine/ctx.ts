import { api } from '@/desk/api';
import { enqueueJob, requestMake } from '@/desk/jobs';
import { desk } from '@/desk/store';
import { toast } from '@/desk/toast';
import { saveDirection } from '@/features/direction/actions';

import { refresh } from './data';
import { errMessage } from './util';

/**
 * The `ctx` callbacks `initEditor()` received from `kit/studio/app.js#initStages`.
 * `renderOverlays` has no counterpart: the Live cards panel renders from `video.overlays`.
 */

export { requestMake, saveDirection };

/** `ctx.requestAudio`. */
export function requestAudio(): void {
  enqueueJob({ kind: 'step', step: 'audio', label: 'Mix voice and music' });
}

/** `ctx.requestMusicFit`. */
export async function requestMusicFit({ prompt }: { prompt?: string | null } = {}): Promise<void> {
  const slug = desk.get().slug;
  if (!slug) return;
  try {
    if (prompt != null) {
      const r = await api(`/api/video/${encodeURIComponent(slug)}/music/prompt`, {
        method: 'POST',
        body: { prompt },
      });
      // Apply the saved prompt into the live deck without a second round-trip.
      if (desk.get().slug === slug && r) await refresh();
    }
  } catch (err) {
    toast('Could not save music prompt', errMessage(err), 'err');
    return;
  }
  if (desk.get().slug !== slug) return;
  const hint = String(prompt || '').trim();
  enqueueJob({
    kind: 'step',
    step: 'music',
    force: true,
    label: hint ? `Compose music · ${hint.slice(0, 40)}${hint.length > 40 ? '…' : ''}` : 'Compose music to fit the cut',
  });
  enqueueJob({ kind: 'step', step: 'mix', label: 'Mix with the new bed' });
}

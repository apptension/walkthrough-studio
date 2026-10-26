import type { VideoSummary } from '@/api/types';
import { api } from '@/desk/api';
import { clockShort } from '@/desk/format';
import { activePlayer, setMonitorMode } from '@/desk/monitor';
import { desk, setButtonBusy, setStatus } from '@/desk/store';
import { toast } from '@/desk/toast';

/** `setPosterFromCurrentFrame` from `kit/studio/app.js`: grab the Program frame as poster.jpg. */
export async function setPosterFromCurrentFrame(): Promise<void> {
  const s = desk.get();
  const v = s.video;
  if (!v?.hasDelivery) {
    toast('No delivery yet', 'Render the sequence first', 'warn');
    return;
  }
  if (s.monitorMode === 'plate') {
    toast('Switch to Program', 'Scrub to the frame you want, then Set poster', 'warn');
    setMonitorMode('program');
    return;
  }
  const atSec = activePlayer()?.currentTime || 0;
  setButtonBusy('btnSetPoster', true);
  try {
    const r = await api<{ summary?: Partial<VideoSummary>; posterUrl?: string | null; meta?: VideoSummary['posterMeta'] }>(
      `/api/video/${s.slug}/poster`,
      { method: 'POST', body: { atSec } },
    );
    const current = desk.get().video ?? v;
    desk.set({
      video: r.summary
        ? { ...current, ...r.summary }
        : { ...current, posterUrl: r.posterUrl ?? null, posterMeta: r.meta ?? null },
    });
    toast('Poster set', `Frame at ${clockShort(atSec)}`);
    setStatus('ok', `Poster @ ${clockShort(atSec)}`);
  } catch (err) {
    toast('Poster failed', err instanceof Error ? err.message : String(err), 'err');
  } finally {
    setButtonBusy('btnSetPoster', false);
  }
}

/** `renderPoster(v)` as a view. `stamp` busts the image cache on every paint. */
export function posterView(v: VideoSummary | null, stamp: number) {
  const meta = v?.posterMeta;
  const atSec = meta?.atSec;
  return {
    src: v?.posterUrl ? `${v.posterUrl}?t=${stamp}` : null,
    metaLine:
      meta && Number.isFinite(atSec)
        ? `Frame ${clockShort(atSec)} · ${meta.source === 'manual' ? 'set in Studio' : 'auto on Export'}`
        : null,
  };
}

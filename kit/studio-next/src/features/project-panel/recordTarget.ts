import { api } from '@/desk/api';
import { desk } from '@/desk/store';
import { loadVideo } from '@/desk/video';

/**
 * `saveRecordTarget` from `kit/studio/app.js`: the capture line's start URL and
 * sign-in flag. Resolves with what `#recordTargetStatus` shows next — `null`
 * hides it, `undefined` leaves it as it is.
 */
export async function saveRecordTarget({ startUrl: raw, loginRequired }: { startUrl: string; loginRequired: boolean }): Promise<string | null | undefined> {
  const slug = desk.get().slug;
  if (!slug) return undefined;
  const startUrl = raw.trim();
  const fresh = desk.get().video?.freshness;
  const currentUrl = fresh?.startUrl || '';
  const currentLogin = Boolean(fresh?.loginRequired);
  if (startUrl === currentUrl && loginRequired === currentLogin) return null;
  if (!/^https?:\/\//i.test(startUrl)) return 'Use a full http(s) URL.';
  try {
    await api(`/api/video/${slug}/record-target`, {
      method: 'PUT',
      body: { startUrl, loginRequired },
    });
    await loadVideo(slug);
    return desk.get().video?.freshness?.needsRecord ? 'Saved. The next render re-records.' : 'Saved.';
  } catch (err) {
    return (err instanceof Error ? err.message : '') || 'Could not save.';
  }
}

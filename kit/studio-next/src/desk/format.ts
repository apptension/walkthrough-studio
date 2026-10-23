/** Time and size formatting shared by every desk surface, kept verbatim from `kit/studio/app.js`. */

/** `00:00:00` clock for elapsed job time. */
export function fmt(sec: number): string {
  if (!Number.isFinite(sec)) return '00:00:00';
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** `m:ss` transport clock; `0:00` when unknown. */
export function fmtShort(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00';
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** `m:ss` for durations in summaries; `—` when unknown. */
export function clockShort(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function formatBytes(bytes: unknown): string {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Seconds a job has been running (or ran), from its own timestamps. */
export function elapsedSec(job: { startedAt?: string | null; createdAt?: string | null; finishedAt?: string | null } | null | undefined): number {
  const start = job?.startedAt || job?.createdAt;
  if (!start) return 0;
  const end = job.finishedAt ? Date.parse(job.finishedAt) : Date.now();
  return Math.max(0, Math.floor((end - Date.parse(start)) / 1000));
}

/** `?t=` cache-buster appended the way the legacy desk does. */
export function bust(url: string, stamp: number | string = Date.now()): string {
  return `${url}${url.includes('?') ? '&' : '?'}t=${stamp}`;
}

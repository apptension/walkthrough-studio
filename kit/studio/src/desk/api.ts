import { request, type RequestOptions } from '@/api/client';

/**
 * `api(path, { method, body })` with the legacy desk's contract: JSON in, JSON
 * out, and a thrown `Error` carrying the server's `{ error }` message.
 */
export function api<T = Record<string, unknown>>(
  path: string,
  opts: { method?: RequestOptions['method']; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  return request<T>(path, {
    method: opts.method ?? 'GET',
    body: opts.body,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
}

export const enc = encodeURIComponent;

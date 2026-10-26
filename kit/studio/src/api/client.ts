/**
 * The one place that talks to the Studio server.
 *
 * Everything else goes through `src/api/queries.ts`; ESLint blocks bare `fetch`
 * elsewhere so a stray request cannot skip the error contract below.
 */

/** A non-2xx reply, carrying the server's own `{ error }` message. */
export class ApiError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(message: string, status: number, path: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
  }

  /** 404 on a project means "it is gone", not "the desk is broken". */
  get isMissing(): boolean {
    return this.status === 404;
  }

  /** Retrying a 4xx will fail the same way; a 5xx or a dropped socket may not. */
  get isRetryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Serialised as JSON. Omit for GET. */
  body?: unknown;
  signal?: AbortSignal;
  /** Appended as a query string, skipping null/undefined. */
  query?: Record<string, string | number | boolean | null | undefined>;
}

function withQuery(path: string, query: RequestOptions['query']): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
}

type MutationListener = (url: string) => void;
const mutationListeners = new Set<MutationListener>();

/** Called with the URL after every successful POST / PUT / DELETE. Returns the unsubscribe. */
export function onMutation(fn: MutationListener): () => void {
  mutationListeners.add(fn);
  return () => mutationListeners.delete(fn);
}

/**
 * The legacy `api()` helper threw `new Error(data.error || res.statusText)`.
 * This keeps that message but wraps it so callers can branch on status without
 * string-matching.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, query } = options;
  const url = withQuery(path, query);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body == null ? undefined : { 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError('Studio server is not reachable', 0, url);
  }

  // 204 and empty bodies are legal; the server also answers some POSTs with no
  // payload at all.
  const text = await response.text();
  const data: unknown = text ? safeJson(text) : null;

  if (!response.ok) {
    const message =
      (typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
        ? data.error
        : null) ?? response.statusText;
    throw new ApiError(message || `Request failed (${response.status})`, response.status, url);
  }

  if (method !== 'GET') for (const fn of mutationListeners) fn(url);
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Plain text endpoints: YouTube chapter markers, README, critic markdown. */
export async function requestText(path: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new ApiError(response.statusText, response.status, path);
  return response.text();
}

/** Binary media (the Editor's audio preview decodes voice and music files). Null when missing. */
export async function requestArrayBuffer(path: string): Promise<ArrayBuffer | null> {
  const response = await fetch(path);
  if (!response.ok) return null;
  return response.arrayBuffer();
}

/** A media file that changes in place (the live preview JPEG): never served from cache. */
export async function requestBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(path, { cache: 'no-store', signal });
  if (!response.ok) throw new ApiError(response.statusText, response.status, path);
  return response.blob();
}

/**
 * Side-channel JSON the engine writes next to the media (`live-preview.json`,
 * `sign-in-wait.json`). Missing or unreadable means "nothing to show", never an error.
 */
export async function requestJsonOrNull<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path);
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Fire-and-forget POST that survives the page unloading (stop work on tab close). */
export function postKeepalive(path: string, body: unknown = {}): void {
  fetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
  }).catch(() => {});
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  text: requestText,
};

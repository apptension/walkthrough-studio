import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '@/test/msw/server';

import { ApiError, api, request } from './client';

describe('request', () => {
  it('returns the parsed body on success', async () => {
    server.use(http.get('/api/thing', () => HttpResponse.json({ ok: true, name: 'thing' })));
    await expect(request<{ name: string }>('/api/thing')).resolves.toEqual({
      ok: true,
      name: 'thing',
    });
  });

  it('treats an empty body as null rather than a parse error', async () => {
    server.use(http.post('/api/thing', () => new HttpResponse(null, { status: 204 })));
    await expect(api.post('/api/thing', {})).resolves.toBeNull();
  });

  it('sends JSON only when there is a body', async () => {
    let seen: string | null = 'unset';
    server.use(
      http.post('/api/thing', ({ request: req }) => {
        seen = req.headers.get('content-type');
        return HttpResponse.json({ ok: true });
      }),
    );

    await api.post('/api/thing');
    expect(seen).toBeNull();

    await api.post('/api/thing', { a: 1 });
    expect(seen).toBe('application/json');
  });

  it('appends a query string, skipping null and undefined', async () => {
    let url = '';
    server.use(
      http.get('/api/thing', ({ request: req }) => {
        url = new URL(req.url).search;
        return HttpResponse.json({ ok: true });
      }),
    );
    await api.get('/api/thing', { query: { a: 1, b: 'two', c: null, d: undefined, e: false } });
    expect(url).toBe('?a=1&b=two&e=false');
  });
});

describe('ApiError', () => {
  it('carries the server\u2019s own message', async () => {
    server.use(
      http.get('/api/thing', () => HttpResponse.json({ error: 'no such video' }, { status: 404 })),
    );
    await expect(api.get('/api/thing')).rejects.toThrow('no such video');
  });

  it('falls back to the status when the body says nothing useful', async () => {
    server.use(http.get('/api/thing', () => new HttpResponse('boom', { status: 500 })));
    await expect(api.get('/api/thing')).rejects.toThrow(/500|Internal/);
  });

  it('classifies a 404 as missing and not retryable', () => {
    const error = new ApiError('gone', 404, '/api/thing');
    expect(error.isMissing).toBe(true);
    expect(error.isRetryable).toBe(false);
  });

  it('classifies a 5xx and a dead socket as retryable', () => {
    expect(new ApiError('boom', 503, '/x').isRetryable).toBe(true);
    expect(new ApiError('unreachable', 0, '/x').isRetryable).toBe(true);
  });

  it('reports an unreachable server as status 0, not as a crash', async () => {
    server.use(http.get('/api/thing', () => HttpResponse.error()));
    const error = await api.get('/api/thing').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).message).toBe('Studio server is not reachable');
  });

  it('lets an abort through untouched, so a cancelled query is not an error', async () => {
    const controller = new AbortController();
    server.use(http.get('/api/thing', () => HttpResponse.json({ ok: true })));
    const pending = api.get('/api/thing', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow(/abort/i);
  });
});

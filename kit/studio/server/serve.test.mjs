// @vitest-environment node
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createStudioServer, isProxied, parseArgs, resolveAsset } from './serve.mjs';

/** A stand-in for the legacy studio, so the proxy has something to reach. */
function fakeStudio() {
  return createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ saw: req.url, method: req.method }));
  });
}

function listen(server) {
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server.address().port)));
}

function close(server) {
  return new Promise((done) => server.close(() => done(undefined)));
}

describe('parseArgs', () => {
  it('defaults to the port next to the legacy desk', () => {
    expect(parseArgs([])).toEqual({ port: 4749, origin: 'http://127.0.0.1:4747' });
  });

  it('takes a port and an origin', () => {
    expect(parseArgs(['--port', '5000', '--origin', 'http://localhost:9'])).toEqual({
      port: 5000,
      origin: 'http://localhost:9',
    });
  });

  it('refuses a port that is not one', () => {
    expect(() => parseArgs(['--port', 'eighty'])).toThrow(/Bad --port/);
  });
});

describe('isProxied', () => {
  it.each(['/api', '/api/videos', '/media/demo/final.mp4', '/logo.svg', '/icons.svg'])(
    'hands %s to the studio',
    (path) => expect(isProxied(path)).toBe(true),
  );

  it.each(['/', '/assets/app.js', '/apiary', '/media-kit'])('keeps %s for itself', (path) =>
    expect(isProxied(path)).toBe(false),
  );
});

describe('resolveAsset', () => {
  it('confines a climb to dist instead of letting it reach the repo', () => {
    // `..` in an absolute path normalises away, so traversal lands back inside
    // dist rather than escaping it. The `null` guard behind this is kept as
    // defence in depth in case that ever stops being true.
    expect(resolveAsset('/../../.env')).toMatch(/\/studio\/dist\/\.env$/);
    expect(resolveAsset('/assets/../../package.json')).toMatch(/\/studio\/dist\/package\.json$/);
  });

  it('resolves a normal asset inside dist', () => {
    expect(resolveAsset('/assets/app.js')).toMatch(/\/dist\/assets\/app\.js$/);
  });
});

describe('the server', () => {
  let studio;
  let desk;
  let base;

  beforeAll(async () => {
    studio = fakeStudio();
    const studioPort = await listen(studio);
    desk = createStudioServer({ origin: `http://127.0.0.1:${studioPort}` });
    base = `http://127.0.0.1:${await listen(desk)}`;
  });

  afterAll(async () => {
    await close(desk);
    await close(studio);
  });

  it('passes an API call through to the studio untouched', async () => {
    const answer = await fetch(`${base}/api/videos?x=1`);
    await expect(answer.json()).resolves.toEqual({ saw: '/api/videos?x=1', method: 'GET' });
  });

  it('passes a media request through as well', async () => {
    const answer = await fetch(`${base}/media/demo/final.mp4`);
    await expect(answer.json()).resolves.toEqual({ saw: '/media/demo/final.mp4', method: 'GET' });
  });

  it('never serves a file from outside dist, however the path is spelled', async () => {
    const answer = await fetch(`${base}/..%2f..%2fpackage.json`);
    const body = await answer.text();
    // Either the app shell or a 404 — never this package's own manifest.
    expect(body).not.toContain('"@walkthrough/studio"');
  });

  it('says what to do when there is no build to serve', async () => {
    // The suite runs against a source checkout, so dist/ is usually absent;
    // either way the answer has to be actionable rather than a bare 404.
    const answer = await fetch(`${base}/`);
    expect([200, 404]).toContain(answer.status);
    if (answer.status === 404) expect(await answer.text()).toMatch(/npm run build/);
  });

  it('reports an unreachable studio as a gateway failure', async () => {
    const orphan = createStudioServer({ origin: 'http://127.0.0.1:1' });
    const port = await listen(orphan);
    const answer = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(answer.status).toBe(502);
    await expect(answer.json()).resolves.toMatchObject({ error: expect.stringContaining('unreachable') });
    await close(orphan);
  });
});

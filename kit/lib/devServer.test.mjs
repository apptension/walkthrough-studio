import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createDevHub, devWatchKind, injectDevClient } from './devServer.mjs';

const kitDir = '/repo/kit';

test('watch kinds restart the server, restyle css, and ignore tests', () => {
  assert.equal(devWatchKind(`${kitDir}/lib/studio.mjs`, { kitDir }), 'restart');
  assert.equal(devWatchKind(`${kitDir}/cli.mjs`, { kitDir }), 'restart');
  assert.equal(devWatchKind(`${kitDir}/lib/studio.test.mjs`, { kitDir }), 'ignore');
  assert.equal(devWatchKind(`${kitDir}/studio/src/styles/studio.css`, { kitDir }), 'ignore');
  assert.equal(devWatchKind(`${kitDir}/studio/src/main.tsx`, { kitDir }), 'ignore');
  assert.equal(devWatchKind(`${kitDir}/studio/src/main.test.tsx`, { kitDir }), 'ignore');
  assert.equal(devWatchKind(`${kitDir}/studio/.DS_Store`, { kitDir }), 'ignore');
  assert.equal(devWatchKind('/elsewhere/app.js', { kitDir }), 'ignore');
});

test('html responses gain the dev client once', () => {
  const html = injectDevClient('<html><body><p>Hi</p></body></html>');
  assert.match(html, /<script src="\/__dev\/client.js"><\/script>\s*<\/body>/);
  assert.equal(injectDevClient(html), html);
});

test('dev hub serves health, accepts browser logs, and broadcasts css saves', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wt-dev-'));
  const localKit = join(root, 'kit');
  const studioDir = join(localKit, 'studio');
  mkdirSync(studioDir, { recursive: true });
  writeFileSync(join(studioDir, 'styles.css'), 'body{}\n');
  const logs = [];
  const hub = createDevHub({ studioDir, kitDir: localKit, log: (line) => logs.push(line) });
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    hub.handle(req, res, url);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const controller = new AbortController();
  try {
    const health = await fetch(`http://127.0.0.1:${port}/__dev/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.ok, true);

    const client = await fetch(`http://127.0.0.1:${port}/__dev/client.js`);
    assert.match(await client.text(), /EventSource\('\/__dev\/events'\)/);

    const posted = await fetch(`http://127.0.0.1:${port}/__dev/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'error', text: 'boom', href: '/studio' }),
    });
    assert.equal(posted.status, 204);
    assert.ok(logs.some((line) => line.includes('error') && line.includes('boom') && line.includes('/studio')));

    const seen = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for css event')), 3000);
      fetch(`http://127.0.0.1:${port}/__dev/events`, { signal: controller.signal })
        .then(async (res) => {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buf += decoder.decode(chunk.value, { stream: true });
            if (buf.includes('"type":"css"') && buf.includes('styles.css')) {
              clearTimeout(timer);
              resolve(buf);
              await reader.cancel();
              break;
            }
          }
        })
        .catch((err) => {
          if (err.name === 'AbortError') return;
          clearTimeout(timer);
          reject(err);
        });
      setTimeout(() => {
        writeFileSync(join(studioDir, 'styles.css'), 'body{color:red}\n');
      }, 120);
    });
    assert.match(seen, /studio\/styles\.css/);
    assert.ok(logs.some((line) => line.startsWith('__WTDEV__\tcss') && line.includes('styles.css')));
  } finally {
    controller.abort();
    hub.close();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => setTimeout(resolve, 200));
    rmSync(root, { recursive: true, force: true });
  }
});

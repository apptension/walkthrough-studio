import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { openStartUrl, startUrlCandidates } from './startUrl.mjs';

test('a non-local host is unchanged', () => {
  assert.deepEqual(startUrlCandidates('https://example.com/tour'), ['https://example.com/tour']);
});

test('localhost is tried on 127.0.0.1 first, against a v4-only listener', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200);
    res.end(req.url);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const opened = await openStartUrl(`http://localhost:${port}/walk`, { timeoutMs: 800 });
    assert.equal(opened.url, `http://127.0.0.1:${port}/walk`);
    assert.deepEqual(opened.attempts, [`http://127.0.0.1:${port}/walk`, `http://localhost:${port}/walk`]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an unreachable port fails with the attempted URL and does not wait 30s', async () => {
  const started = Date.now();
  await assert.rejects(
    () => openStartUrl('http://localhost:59999/missing', { timeoutMs: 250 }),
    (err) => {
      assert.match(err.message, /http:\/\/localhost:59999\/missing/);
      assert.match(err.message, /127\.0\.0\.1:59999/);
      return true;
    }
  );
  assert.ok(Date.now() - started < 5000);
});

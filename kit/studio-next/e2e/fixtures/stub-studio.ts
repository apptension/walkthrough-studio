/**
 * A stand-in for the legacy studio server, for end-to-end runs.
 *
 * It answers the same routes with the same shapes the desk reads, built from
 * the very factories the unit tests use — one definition of "what the server
 * sends", so an e2e run cannot drift from the component tests.
 *
 * Run it with vite-node, so the `@/` alias and the TypeScript types resolve:
 *   npx vite-node e2e/fixtures/stub-studio.ts -- --port 4846
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { Job } from '@/api/types';
import { makeHealth, makeIndex, makeJob, makeScript, makeVideo } from '@/test/factories';

interface Route {
  method: string;
  pattern: RegExp;
  handle: (match: RegExpMatchArray, body: unknown) => unknown;
}

/** Jobs the desk has started, so progress can advance across polls. */
const jobs = new Map<string, { job: Job; polls: number }>();
let jobSeq = 0;

function startJob(): { job: { id: string } } {
  const id = `job-${++jobSeq}`;
  jobs.set(id, { job: makeJob({ id, status: 'running', step: 'plan'}), polls: 0 });
  return { job: { id } };
}

/**
 * Walk a job forward on each poll so the progress bar and the pipeline both
 * move, and the run finishes on its own as a real one would.
 */
function pollJob(id: string): Job {
  const entry = jobs.get(id);
  if (!entry) return makeJob({ id, status: 'done', step: 'deliver' });

  entry.polls += 1;
  const steps = ['plan', 'script', 'record', 'plates', 'produce', 'deliver'] as const;
  const index = Math.min(entry.polls, steps.length - 1);
  const done = entry.polls > steps.length;

  // The desk reads progress off the step, so advancing the step is all it takes.
  entry.job = makeJob({
    id,
    status: done ? 'done' : 'running',
    step: steps[index] ?? 'deliver',
  });
  return entry.job;
}

const ok = () => ({ ok: true });

const routes: Route[] = [
  { method: 'GET', pattern: /^\/api\/health$/, handle: () => makeHealth() },
  { method: 'GET', pattern: /^\/api\/videos$/, handle: () => makeIndex() },
  { method: 'GET', pattern: /^\/api\/brands$/, handle: () => ({ brands: [] }) },
  { method: 'GET', pattern: /^\/api\/video\/([^/]+)\/script$/, handle: () => makeScript() },
  { method: 'GET', pattern: /^\/api\/video\/([^/]+)\/captions$/, handle: () => ({ clips: [] }) },
  { method: 'GET', pattern: /^\/api\/video\/([^/]+)\/plates$/, handle: () => ({ plates: [] }) },
  {
    method: 'GET',
    pattern: /^\/api\/video\/([^/]+)\/versions$/,
    handle: () => ({ versions: makeVideo().versions }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/video\/([^/]+)\/scenes$/,
    handle: () => ({ scenes: makeVideo().scenes }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/video\/([^/]+)$/,
    handle: (match) => makeVideo({ slug: decodeURIComponent(match[1] ?? 'demo') }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/video\/([^/]+)\/branch\/ideas$/,
    handle: () => ({ agent: false, ideas: [] }),
  },
  { method: 'GET', pattern: /^\/api\/jobs\/([^/]+)$/, handle: (match) => pollJob(match[1] ?? '') },
  { method: 'POST', pattern: /^\/api\/jobs\/([^/]+)\/cancel$/, handle: (match) => {
      jobs.delete(match[1] ?? '');
      return ok();
    } },
  {
    method: 'POST',
    pattern: /^\/api\/jobs\/([^/]+)\/answer$/,
    handle: () => ({ ok: true, continue: true }),
  },
  { method: 'POST', pattern: /^\/api\/video\/([^/]+)\/run$/, handle: () => startJob() },
  { method: 'POST', pattern: /^\/api\/video\/([^/]+)\/improve$/, handle: () => startJob() },
  {
    method: 'POST',
    pattern: /^\/api\/projects$/,
    handle: () => ({ ok: true, slug: 'new-video', brand: 'walkthrough-studio', envVars: [] }),
  },
  { method: 'POST', pattern: /^\/api\/.*$/, handle: ok },
  { method: 'PUT', pattern: /^\/api\/.*$/, handle: ok },
];

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((done) => {
    let raw = '';
    req.on('data', (chunk) => (raw += String(chunk)));
    req.on('end', () => {
      try {
        done(raw ? JSON.parse(raw) : null);
      } catch {
        done(null);
      }
    });
  });
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

const server = createServer((req, res) => {
  void (async () => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const route = routes.find((r) => r.method === req.method && r.pattern.test(pathname));
    if (!route) {
      send(res, 404, { error: `No stub for ${req.method} ${pathname}` });
      return;
    }
    const match = pathname.match(route.pattern) ?? ([] as unknown as RegExpMatchArray);
    send(res, 200, route.handle(match, await readBody(req)));
  })();
});

const portFlag = process.argv.indexOf('--port');
const port = portFlag === -1 ? 4846 : Number(process.argv[portFlag + 1]);
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`stub studio → http://127.0.0.1:${port}\n`);
});

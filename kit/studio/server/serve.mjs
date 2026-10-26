#!/usr/bin/env node
/**
 * Serve the built desk.
 *
 * `vite dev` proxies the kit server; this does the same thing for `dist/`, so a
 * built bundle can be opened against a running studio. Static files come from
 * `dist/`, everything the kit server owns is proxied, and any other path falls
 * through to `index.html` because the desk is a single page.
 *
 * Usage: node server/serve.mjs [--port 4749] [--origin http://127.0.0.1:4747]
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../dist', import.meta.url)));

/** Paths the kit server owns. Everything else is the desk. */
const PROXIED = ['/api', '/media', '/version-media', '/logo.svg', '/icons.svg'];

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

export function parseArgs(argv) {
  const args = { port: 4749, origin: process.env.STUDIO_ORIGIN ?? 'http://127.0.0.1:4747' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--port') args.port = Number(argv[++i]);
    else if (flag === '--origin') args.origin = String(argv[++i]);
  }
  if (!Number.isInteger(args.port) || args.port <= 0) throw new Error(`Bad --port: ${args.port}`);
  return args;
}

export function isProxied(pathname) {
  return PROXIED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Resolve a URL path to a file inside `dist/`, or null if it escapes the root.
 * `..` is normalised away before the prefix check, so no request can reach a
 * file the build did not produce.
 */
export function resolveAsset(pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0] ?? '/');
  const candidate = resolve(join(ROOT, normalize(decoded)));
  if (candidate !== ROOT && !candidate.startsWith(`${ROOT}/`)) return null;
  return candidate;
}

async function sendFile(res, file, { immutable = false } = {}) {
  const info = await stat(file);
  if (!info.isFile()) throw new Error('not a file');
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'content-length': info.size,
    // Vite fingerprints everything under /assets/, so those can be cached hard
    // while index.html must always be revalidated.
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

function proxy(req, res, origin) {
  const target = new URL(req.url ?? '/', origin);
  const upstream = httpRequest(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: `Studio server unreachable: ${error.message}` }));
  });
  req.pipe(upstream);
}

export function createStudioServer({ origin }) {
  return createServer((req, res) => {
    void (async () => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

      if (isProxied(pathname)) {
        proxy(req, res, origin);
        return;
      }

      const asset = resolveAsset(pathname);
      if (!asset) {
        res.writeHead(403).end('Forbidden');
        return;
      }

      try {
        await sendFile(res, asset, { immutable: pathname.startsWith('/assets/') });
      } catch {
        // The desk is one page: anything that is not a file is a route.
        try {
          await sendFile(res, join(ROOT, 'index.html'));
        } catch {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Run `npm run build` first — dist/index.html is missing.');
        }
      }
    })();
  });
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { port, origin } = parseArgs(process.argv.slice(2));
  createStudioServer({ origin }).listen(port, '127.0.0.1', () => {
    process.stdout.write(`studio → http://127.0.0.1:${port}  (api → ${origin})\n`);
  });
}

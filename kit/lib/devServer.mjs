/**
 * Dev mode for Walkthrough Studio.
 *
 * The server watches kit/studio and tells open browsers to restyle or reload.
 * The ./studio launcher watches kit/lib and kit/cli.mjs and restarts this process.
 * Browser warnings and errors are posted back and printed on the server stdout
 * with a __WTDEV__ marker the launcher renders in its log.
 */
import { existsSync, statSync, watch, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

const DEV_CLIENT = `(() => {
  if (window.__wtDev) return;
  window.__wtDev = true;

  const send = (level, text) => {
    const body = JSON.stringify({
      level,
      text: String(text == null ? '' : text).slice(0, 2000),
      href: location.pathname + location.search,
    });
    fetch('/__dev/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  };

  const format = (value) => {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  };

  for (const level of ['error', 'warn']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      orig(...args);
      send(level, args.map(format).join(' '));
    };
  }

  window.addEventListener('error', (event) => {
    const where = event.filename ? ' (' + event.filename + ':' + event.lineno + ')' : '';
    send('error', (event.message || 'Script error') + where);
  });
  window.addEventListener('unhandledrejection', (event) => {
    send('error', 'unhandledrejection ' + format(event.reason));
  });

  const restyle = () => {
    const stamp = String(Date.now());
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      let url;
      try { url = new URL(link.href, location.href); } catch { continue; }
      if (url.origin !== location.origin) continue;
      url.searchParams.set('dev', stamp);
      link.href = url.pathname + url.search;
    }
  };

  const connect = () => {
    let closed = false;
    const es = new EventSource('/__dev/events');
    const giveUp = () => {
      if (closed) return;
      closed = true;
      es.close();
      const wait = () => {
        fetch('/__dev/health', { cache: 'no-store' })
          .then((res) => { if (res.ok) location.reload(); else setTimeout(wait, 300); })
          .catch(() => setTimeout(wait, 300));
      };
      setTimeout(wait, 200);
    };
    es.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'css') restyle();
      else if (msg.type === 'reload') {
        closed = true;
        es.close();
        location.reload();
      }
    };
    es.onerror = giveUp;
  };

  connect();
})();
`;

export function devWatchKind(file, { kitDir }) {
  const rel = relative(kitDir, file).split(sep).join('/');
  if (!rel || rel.startsWith('..')) return 'ignore';
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  if (!base || base === '.DS_Store' || base.endsWith('~') || base.startsWith('.')) return 'ignore';
  if (rel === 'node_modules' || rel.startsWith('node_modules/') || rel.includes('/node_modules/')) return 'ignore';
  if (/\.test\.(mjs|js)$/.test(rel)) return 'ignore';
  if (rel === 'cli.mjs') return 'restart';
  if (rel.startsWith('lib/') && rel.endsWith('.mjs')) return 'restart';
  if (rel.startsWith('studio/')) {
    if (rel.endsWith('.css')) return 'css';
    return 'reload';
  }
  return 'ignore';
}

export function injectDevClient(html) {
  const source = String(html);
  if (source.includes('/__dev/client.js')) return source;
  const tag = '<script src="/__dev/client.js"></script>';
  const at = source.lastIndexOf('</body>');
  if (at >= 0) return `${source.slice(0, at)}${tag}\n${source.slice(at)}`;
  return `${source}\n${tag}\n`;
}

function readBody(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('too big'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function safeWatch(target, options, listener) {
  try {
    const watcher = watch(target, options, (...args) => {
      try {
        listener(...args);
      } catch {
        /* a save can race a delete */
      }
    });
    watcher.on('error', () => {});
    return watcher;
  } catch {
    return null;
  }
}

export function watchPaths(target, onFile) {
  if (!existsSync(target)) return () => {};
  const watchers = [];
  const stop = () => {
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
    }
  };
  const add = (watcher) => {
    if (watcher) watchers.push(watcher);
  };

  if (!statSync(target).isDirectory()) {
    add(safeWatch(target, {}, () => onFile(target)));
    return stop;
  }

  const arm = (dir, name) => {
    if (!name) return;
    const raw = name.toString();
    onFile(isAbsolute(raw) ? raw : join(dir, raw));
  };

  const recursive = safeWatch(target, { recursive: true }, (_event, name) => arm(target, name));
  if (recursive) {
    add(recursive);
    return stop;
  }

  const walk = (dir) => {
    add(safeWatch(dir, {}, (_event, name) => arm(dir, name)));
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === 'tmp' || entry.name.startsWith('.')) continue;
      walk(join(dir, entry.name));
    }
  };
  walk(target);
  return stop;
}

export function createDevHub({ studioDir, kitDir, log = (line) => console.log(line) } = {}) {
  const clients = new Set();
  const pending = new Map();
  let timer = null;

  const broadcast = (message) => {
    const payload = `data: ${JSON.stringify(message)}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    }
  };

  const flush = () => {
    timer = null;
    const css = [];
    const reload = [];
    for (const [file, kind] of pending) {
      const rel = relative(kitDir, file).split(sep).join('/');
      if (kind === 'css') css.push(rel);
      else if (kind === 'reload') reload.push(rel);
    }
    pending.clear();
    if (reload.length) {
      log(`__WTDEV__\treload\t\t${reload.join(', ')}`);
      broadcast({ type: 'reload', files: reload });
      return;
    }
    if (css.length) {
      log(`__WTDEV__\tcss\t\t${css.join(', ')}`);
      broadcast({ type: 'css', files: css });
    }
  };

  const stopWatch = watchPaths(studioDir, (file) => {
    try {
      if (existsSync(file) && statSync(file).isDirectory()) return;
    } catch {
      return;
    }
    const kind = devWatchKind(file, { kitDir });
    if (kind !== 'css' && kind !== 'reload') return;
    pending.set(file, kind);
    clearTimeout(timer);
    timer = setTimeout(flush, 80);
  });

  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/__dev/')) return false;

    if (url.pathname === '/__dev/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write(':\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return true;
    }

    if (url.pathname === '/__dev/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    if (url.pathname === '/__dev/client.js' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(DEV_CLIENT);
      return true;
    }

    if (url.pathname === '/__dev/log' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const level = String(body.level || 'log').slice(0, 16);
        const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
        const href = String(body.href || '').replace(/\s+/g, ' ').slice(0, 300);
        if (text) log(`__WTDEV__\t${level}\t${href}\t${text}`);
        res.writeHead(204);
        res.end();
      } catch {
        if (!res.headersSent) {
          res.writeHead(400);
          res.end('bad');
        }
      }
      return true;
    }

    res.writeHead(404);
    res.end('Not found');
    return true;
  }

  return {
    handle,
    close() {
      clearTimeout(timer);
      stopWatch();
      for (const res of clients) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
      clients.clear();
    },
  };
}

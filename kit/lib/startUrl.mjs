/**
 * Localhost often resolves to IPv6 first while the dev server listens on 127.0.0.1.
 * Try the IPv4 address first, then the original host, and fail in a few seconds.
 */
import http from 'node:http';
import https from 'node:https';

export function startUrlCandidates(startUrl) {
  let url;
  try {
    url = new URL(startUrl);
  } catch {
    return [String(startUrl || '')];
  }
  if (url.hostname !== 'localhost') return [startUrl];
  const v4 = new URL(startUrl);
  v4.hostname = '127.0.0.1';
  if (url.port) v4.port = url.port;
  const first = v4.href;
  return first === startUrl ? [startUrl] : [first, startUrl];
}

function requestOnce(url, timeoutMs) {
  const lib = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, { rejectUnauthorized: false }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timed out opening ${url}`));
    });
    req.on('error', reject);
  });
}

export async function openStartUrl(startUrl, { timeoutMs = 2500, request = requestOnce } = {}) {
  const attempts = startUrlCandidates(startUrl);
  let last;
  for (const url of attempts) {
    try {
      await request(url, timeoutMs);
      return { url, attempts };
    } catch (err) {
      last = err;
    }
  }
  const error = new Error(`Could not open ${startUrl} (tried ${attempts.join(', ')})`);
  error.attempts = attempts;
  error.cause = last;
  throw error;
}

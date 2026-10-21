/** Quiet capture line and a queue that does not stack the same step twice. */

export function captureSummary(url, loginRequired) {
  const raw = String(url || '').trim();
  if (!raw) return 'No start URL yet';
  let shown = raw;
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
    shown = `${parsed.host}${path}`;
  } catch {
    /* keep the raw value when it is not a URL yet */
  }
  return loginRequired ? `${shown} · signs in` : shown;
}

export function queueKey(item) {
  return [item?.slug || '', item?.kind || '', item?.step || '', item?.mode || '', item?.goal || ''].join('|');
}

/** An improve note can repeat. The same render step for the same sequence should not. */
export function shouldEnqueue(queue, item) {
  if (!item || item.kind === 'improve') return true;
  const key = queueKey(item);
  return !(queue || []).some((queued) => queueKey(queued) === key);
}

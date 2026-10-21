/**
 * The one way the Studio shows what an agent (Cursor CLI or Claude Code) or a kit step is doing.
 *
 * `paintAgentStream(host, job)` renders `job.stream.entries` (see lib/agentStream.mjs) into `host`:
 * every entry keeps its whole text, new characters type in instead of popping, the feed stays
 * pinned to the newest line unless the reader scrolls up, and the same markup serves the render
 * bay, the session rail, the script draft banner and the new-video wizard.
 */

const LABELS = { think: 'Thinking', say: 'Agent', error: 'Problem' };
const controllers = new WeakMap();
const revealing = new Set();
let frame = 0;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Light inline markdown: `code`, **bold**, and line breaks via pre-wrap. */
function format(text) {
  return escapeHtml(text)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/error\.png/g, '<button type="button" class="as-shot" data-shot="error.png">Open screenshot</button>');
}

function tick() {
  frame = 0;
  for (const item of revealing) {
    const target = item.entry.text.length;
    const backlog = target - item.shown;
    if (backlog <= 0) {
      item.shown = target;
      revealing.delete(item);
      paintText(item);
      continue;
    }
    // Small deltas type at reading pace; a large backlog catches up within ~half a second.
    item.shown += Math.min(120, Math.max(1, Math.ceil(backlog / 14)));
    paintText(item);
  }
  for (const ctl of new Set([...revealing].map((i) => i.ctl))) ctl.follow();
  if (revealing.size) frame = requestAnimationFrame(tick);
}

function schedule(item) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    item.shown = item.entry.text.length;
    paintText(item);
    return;
  }
  revealing.add(item);
  if (!frame) frame = requestAnimationFrame(tick);
}

function paintText(item) {
  const { body, entry } = item;
  const visible = entry.text.slice(0, item.shown);
  const newest = entry.id === item.ctl.lastId;
  const typing = newest && (item.shown < entry.text.length || (!entry.done && item.ctl.live));
  body.innerHTML = format(visible) + (typing ? '<span class="as-caret" aria-hidden="true"></span>' : '');
}

function glyph(entry, live) {
  if (entry.kind === 'tool') {
    if (entry.ok === false) return '<span class="as-glyph fail">✕</span>';
    if (!entry.done && live) return '<span class="as-glyph spin" aria-hidden="true"></span>';
    return '<span class="as-glyph ok">✓</span>';
  }
  if (entry.kind === 'error') return '<span class="as-glyph fail">!</span>';
  return '<span class="as-glyph dot" aria-hidden="true"></span>';
}

function createController(host, opts) {
  host.classList.add('agent-stream');
  if (opts.variant) host.classList.add(`agent-stream--${opts.variant}`);
  host.setAttribute('role', 'log');
  host.setAttribute('aria-live', 'polite');
  host.innerHTML = '<ol class="as-list"></ol><p class="as-empty">Waiting for the first words…</p><button type="button" class="as-latest" hidden>Latest ↓</button>';
  const list = host.querySelector('.as-list');
  const latest = host.querySelector('.as-latest');
  const ctl = {
    host,
    list,
    items: new Map(),
    pinned: true,
    live: false,
    jobId: null,
    rev: -1,
    follow() {
      if (ctl.pinned) host.scrollTop = host.scrollHeight;
      latest.hidden = ctl.pinned;
    },
    reset() {
      for (const item of ctl.items.values()) revealing.delete(item);
      ctl.items.clear();
      list.innerHTML = '';
      ctl.rev = -1;
      ctl.pinned = true;
    },
  };
  host.addEventListener('scroll', () => {
    ctl.pinned = host.scrollHeight - host.scrollTop - host.clientHeight < 48;
    latest.hidden = ctl.pinned;
  });
  latest.addEventListener('click', () => {
    ctl.pinned = true;
    ctl.follow();
  });
  host.addEventListener('click', (event) => {
    const button = event.target.closest?.('.as-shot');
    if (!button) return;
    const slug = host.dataset.slug;
    if (!slug) return;
    const existing = button.parentElement.querySelector('.as-shot-img');
    if (existing) {
      existing.remove();
      return;
    }
    const img = document.createElement('img');
    img.className = 'as-shot-img';
    img.alt = 'Page when this step failed';
    img.src = `/media/${encodeURIComponent(slug)}/error.png`;
    button.after(img);
  });
  return ctl;
}

function renderEntry(ctl, entry, { instant }) {
  let item = ctl.items.get(entry.id);
  if (!item) {
    const li = document.createElement('li');
    li.dataset.id = String(entry.id);
    li.innerHTML = '<span class="as-mark"></span><div class="as-main"><span class="as-label"></span><div class="as-text"></div></div>';
    ctl.list.appendChild(li);
    item = { ctl, li, body: li.querySelector('.as-text'), entry, shown: instant ? entry.text.length : 0 };
    ctl.items.set(entry.id, item);
  }
  item.entry = entry;
  const label = entry.kind === 'tool' ? entry.title || 'Tool' : LABELS[entry.kind] || '';
  item.li.className = `as-entry as-${entry.kind}${!entry.done && ctl.live ? ' is-live' : ''}${entry.ok === false ? ' is-fail' : ''}`;
  item.li.querySelector('.as-mark').innerHTML = glyph(entry, ctl.live);
  const labelEl = item.li.querySelector('.as-label');
  labelEl.textContent = label;
  labelEl.hidden = !label;
  if (item.shown > entry.text.length) item.shown = entry.text.length;
  if (!ctl.live) item.shown = entry.text.length;
  if (item.shown < entry.text.length) schedule(item);
  else paintText(item);
}

/**
 * Paint a job's stream into `host`. Safe to call on every poll; only changed entries repaint.
 * @param {HTMLElement} host
 * @param {object|null} job
 * @param {{ variant?: 'rail'|'bay'|'banner'|'wizard', limit?: number }} [opts]
 */
export function paintAgentStream(host, job, opts = {}) {
  if (!host) return;
  let ctl = controllers.get(host);
  if (!ctl) {
    ctl = createController(host, opts);
    controllers.set(host, ctl);
  }
  if (!job) {
    ctl.reset();
    ctl.jobId = null;
    host.classList.add('is-empty');
    return;
  }
  const fresh = ctl.jobId !== job.id;
  if (fresh) {
    ctl.reset();
    ctl.jobId = job.id;
  }
  ctl.live = job.status === 'running' || job.status === 'queued' || job.status === 'cancelling';
  if (job.slug) host.dataset.slug = job.slug;
  host.classList.toggle('is-live', ctl.live);
  const stream = job.stream || { rev: 0, entries: [] };
  let entries = stream.entries || [];
  if (opts.limit && entries.length > opts.limit) entries = entries.slice(-opts.limit);
  host.classList.toggle('is-empty', entries.length === 0);
  if (stream.rev === ctl.rev && !fresh && ctl.wasLive === ctl.live) return;
  ctl.rev = stream.rev;
  ctl.wasLive = ctl.live;

  const keep = new Set(entries.map((e) => e.id));
  for (const [id, item] of ctl.items) {
    if (!keep.has(id)) {
      revealing.delete(item);
      item.li.remove();
      ctl.items.delete(id);
    }
  }
  // Opening a job mid-run: history lands at once, only the newest entries type in.
  const firstPaint = ctl.items.size === 0;
  const previousLast = ctl.items.get(ctl.lastId);
  ctl.lastId = entries.at(-1)?.id ?? null;
  if (previousLast && previousLast.entry.id !== ctl.lastId) paintText(previousLast);
  entries.forEach((entry, i) => {
    renderEntry(ctl, entry, { instant: firstPaint && i < entries.length - 2 });
  });
  ctl.follow();
}

/** The newest readable sentence in a job's stream, for one-line headlines. */
export function latestStreamText(job) {
  const entries = job?.stream?.entries || [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (e.kind === 'say' || e.kind === 'think' || e.kind === 'error') return e.text.replace(/\s+/g, ' ').trim();
    if (e.kind === 'tool') return `${e.title}${e.text ? ` · ${e.text.split('\n')[0]}` : ''}`;
  }
  return '';
}

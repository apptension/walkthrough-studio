import type { Job, JobStreamEntry } from '@/api/types';

/**
 * The one way the Studio shows what an agent or a kit step is doing — a 1:1
 * port of `kit/studio/agentStream.js`. `paintAgentStream(host, job)` renders
 * `job.stream.entries` into `host`: every entry keeps its whole text, new
 * characters type in, and the feed stays pinned to the newest line unless the
 * reader scrolls up. The host is a React-owned element with no React children;
 * this module owns its contents, as the legacy controller did.
 */

const LABELS: Partial<Record<string, string>> = { think: 'Thinking', say: 'Agent', error: 'Problem' };

export type StreamVariant = 'rail' | 'bay' | 'banner' | 'wizard';

interface StreamEntry extends JobStreamEntry {
  id: number;
}

interface Item {
  ctl: Controller;
  li: HTMLLIElement;
  body: HTMLElement;
  entry: StreamEntry;
  shown: number;
}

interface Controller {
  host: HTMLElement;
  list: HTMLOListElement;
  items: Map<number, Item>;
  pinned: boolean;
  live: boolean;
  wasLive?: boolean;
  jobId: string | null;
  rev: number;
  lastId: number | null;
  follow(): void;
  reset(): void;
}

type StreamJob = Pick<Job, 'id' | 'status' | 'slug' | 'stream'>;

const controllers = new WeakMap<HTMLElement, Controller>();
const revealing = new Set<Item>();
let frame = 0;

function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** Light inline markdown: `code`, **bold**, and line breaks via pre-wrap. */
export function format(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/error\.png/g, '<button type="button" class="as-shot" data-shot="error.png">Open screenshot</button>');
}

function tick(): void {
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

function schedule(item: Item): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    item.shown = item.entry.text.length;
    paintText(item);
    return;
  }
  revealing.add(item);
  if (!frame) frame = requestAnimationFrame(tick);
}

function paintText(item: Item): void {
  const { body, entry } = item;
  const visible = entry.text.slice(0, item.shown);
  const newest = entry.id === item.ctl.lastId;
  const typing = newest && (item.shown < entry.text.length || (!entry.done && item.ctl.live));
  body.innerHTML = format(visible) + (typing ? '<span class="as-caret" aria-hidden="true"></span>' : '');
}

function glyph(entry: StreamEntry, live: boolean): string {
  if (entry.kind === 'tool') {
    if (entry.ok === false) return '<span class="as-glyph fail">✕</span>';
    if (!entry.done && live) return '<span class="as-glyph spin" aria-hidden="true"></span>';
    return '<span class="as-glyph ok">✓</span>';
  }
  if (entry.kind === 'error') return '<span class="as-glyph fail">!</span>';
  return '<span class="as-glyph dot" aria-hidden="true"></span>';
}

function createController(host: HTMLElement, opts: { variant?: StreamVariant }): Controller {
  host.classList.add('agent-stream');
  if (opts.variant) host.classList.add(`agent-stream--${opts.variant}`);
  host.setAttribute('role', 'log');
  host.setAttribute('aria-live', 'polite');
  host.innerHTML =
    '<ol class="as-list"></ol><p class="as-empty">Waiting for the first words…</p><button type="button" class="as-latest" hidden>Latest ↓</button>';
  const list = host.querySelector<HTMLOListElement>('.as-list');
  const latest = host.querySelector<HTMLButtonElement>('.as-latest');
  if (!list || !latest) throw new Error('agent stream markup missing');
  const ctl: Controller = {
    host,
    list,
    items: new Map(),
    pinned: true,
    live: false,
    jobId: null,
    rev: -1,
    lastId: null,
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
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('.as-shot');
    if (!button) return;
    const slug = host.dataset['slug'];
    if (!slug) return;
    const existing = button.parentElement?.querySelector('.as-shot-img');
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

function renderEntry(ctl: Controller, entry: StreamEntry, { instant }: { instant: boolean }): void {
  let item = ctl.items.get(entry.id);
  if (!item) {
    const li = document.createElement('li');
    li.dataset['id'] = String(entry.id);
    li.innerHTML = '<span class="as-mark"></span><div class="as-main"><span class="as-label"></span><div class="as-text"></div></div>';
    ctl.list.appendChild(li);
    const body = li.querySelector<HTMLElement>('.as-text');
    if (!body) return;
    item = { ctl, li, body, entry, shown: instant ? entry.text.length : 0 };
    ctl.items.set(entry.id, item);
  }
  item.entry = entry;
  const label = entry.kind === 'tool' ? entry.title || 'Tool' : LABELS[entry.kind] || '';
  item.li.className = `as-entry as-${entry.kind}${!entry.done && ctl.live ? ' is-live' : ''}${entry.ok === false ? ' is-fail' : ''}`;
  const mark = item.li.querySelector('.as-mark');
  if (mark) mark.innerHTML = glyph(entry, ctl.live);
  const labelEl = item.li.querySelector<HTMLElement>('.as-label');
  if (labelEl) {
    labelEl.textContent = label;
    labelEl.hidden = !label;
  }
  if (item.shown > entry.text.length) item.shown = entry.text.length;
  if (!ctl.live) item.shown = entry.text.length;
  if (item.shown < entry.text.length) schedule(item);
  else paintText(item);
}

/** Paint a job's stream into `host`. Safe to call on every poll; only changed entries repaint. */
export function paintAgentStream(
  host: HTMLElement | null,
  job: StreamJob | null,
  opts: { variant?: StreamVariant; limit?: number } = {},
): void {
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
  const status: string = job.status;
  ctl.live = status === 'running' || status === 'queued' || status === 'cancelling';
  if (job.slug) host.dataset['slug'] = job.slug;
  host.classList.toggle('is-live', ctl.live);
  const stream = job.stream || { rev: 0, entries: [] };
  let entries = (stream.entries || []).map((e, i) => ({ ...e, id: e.id ?? i + 1, text: e.text ?? '' }));
  if (opts.limit && entries.length > opts.limit) entries = entries.slice(-opts.limit);
  host.classList.toggle('is-empty', entries.length === 0);
  const rev = stream.rev ?? 0;
  if (rev === ctl.rev && !fresh && ctl.wasLive === ctl.live) return;
  ctl.rev = rev;
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
  const previousLast = ctl.lastId != null ? ctl.items.get(ctl.lastId) : undefined;
  ctl.lastId = entries.at(-1)?.id ?? null;
  if (previousLast && previousLast.entry.id !== ctl.lastId) paintText(previousLast);
  const live = ctl;
  entries.forEach((entry, i) => {
    renderEntry(live, entry, { instant: firstPaint && i < entries.length - 2 });
  });
  ctl.follow();
}

/** The newest readable sentence in a job's stream, for one-line headlines. */
export function latestStreamText(job: Pick<Job, 'stream'> | null | undefined): string {
  const entries = job?.stream?.entries || [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (!e) continue;
    if (e.kind === 'say' || e.kind === 'think' || e.kind === 'error') return e.text.replace(/\s+/g, ' ').trim();
    if (e.kind === 'tool') return `${e.title}${e.text ? ` · ${e.text.split('\n')[0]}` : ''}`;
  }
  return '';
}

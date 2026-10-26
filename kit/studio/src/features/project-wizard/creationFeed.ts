import { create } from 'zustand';

import type { ExploreFeed, ExploreScreen, JobStreamEntry } from '@/api/types';
import { api } from '@/desk/api';
import type { Script, ScriptScene } from '@/features/script/types';

/**
 * The live material behind the creation view's stage: what the agent is
 * thinking and doing, the screens the explore agent reached, and the
 * storyboard as the draft agent writes it. Everything is read from files and
 * job streams the run already produces; nothing here steers the agents.
 */

/* ---------- agent pulse ---------- */

export interface AgentAction {
  id: string;
  icon: string;
  verb: string;
  object: string;
  done: boolean;
}

export interface AgentPulse {
  /** The agent's newest sentence about what it is doing, in its own words. */
  thought: string;
  /** Newest first. */
  actions: AgentAction[];
}

const WRITE_TOOL = /^(write|edit|multi ?edit|str ?replace|notebook ?edit)$/i;
const SEARCH_TOOL = /^(grep|glob|search|codebase ?search|list|ls|find)/i;
const SKIP_TOOL = /^(get mcp tools|todo|todowrite|update todos)$/i;
const MAX_ACTIONS = 8;

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const unquote = (s: string) => s.replace(/^["'“]|["'”]$/g, '');

/** The first sentence or two, short enough for a caption. */
export function firstSentences(text: string, max = 170): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const parts = flat.match(/[^.!?…]+[.!?…]+(\s|$)|[^.!?…]+$/g) || [flat];
  let out = '';
  for (const p of parts) {
    if (out && (out + p).length > max) break;
    out += p;
  }
  return clip(out.trim(), max);
}

function hostPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

/** A browse CLI call (`cli.mjs browse <slug> <verb> …`) in words. */
function browseAction(cmd: string): Omit<AgentAction, 'id' | 'done'> | null {
  const m = cmd.match(/\bbrowse\s+\S+\s+(\w+)\s*(.*)$/);
  if (!m) return null;
  const verb = m[1] || '';
  const rest = (m[2] || '').trim();
  const url = rest.match(/--url\s+(\S+)/)?.[1];
  switch (verb) {
    case 'look':
      return url ? { icon: 'ui-open', verb: 'Opened', object: hostPath(url) } : { icon: 'ui-eye', verb: 'Looked at', object: 'the screen' };
    case 'click':
      return { icon: 'ui-cursor', verb: 'Clicked', object: `control ${rest.split(/\s+/)[0] || ''}`.trim() };
    case 'hover':
      return { icon: 'ui-cursor', verb: 'Hovered', object: `control ${rest.split(/\s+/)[0] || ''}`.trim() };
    case 'type':
    case 'fill':
      return { icon: 'ui-text', verb: 'Typed into', object: `control ${rest.split(/\s+/)[0] || ''}`.trim() };
    case 'select':
      return { icon: 'ui-list', verb: 'Picked an option in', object: `control ${rest.split(/\s+/)[0] || ''}`.trim() };
    case 'scroll':
      return { icon: 'ui-walk', verb: 'Scrolled', object: rest.split(/\s+/)[0] || 'down' };
    case 'drag':
      return { icon: 'ui-grip', verb: 'Dragged', object: 'on the canvas' };
    case 'note':
      return { icon: 'ui-note', verb: 'Noted', object: clip(unquote(rest), 120) };
    case 'back':
      return { icon: 'ui-chevron-left', verb: 'Went', object: 'back' };
    case 'goto':
    case 'open':
      return { icon: 'ui-open', verb: 'Opened', object: hostPath(rest.split(/\s+/)[0] || '') };
    case 'map':
      return { icon: 'ui-branch', verb: 'Reviewed', object: 'the product map' };
    case 'login':
    case 'signin':
      return { icon: 'ui-lock', verb: 'Signed in', object: '' };
    default:
      return { icon: 'ui-walk', verb: verb.charAt(0).toUpperCase() + verb.slice(1), object: clip(rest, 60) };
  }
}

function toolAction(title: string, text: string): Omit<AgentAction, 'id' | 'done'> | null {
  const first = text.split('\n')[0]?.trim() || '';
  if (SKIP_TOOL.test(title)) return null;
  if (/^read$/i.test(title)) {
    return /\.(png|jpe?g|webp|gif)$/i.test(first) ? { icon: 'ui-eye', verb: 'Studied', object: 'the screenshot' } : { icon: 'ui-book', verb: 'Read', object: baseName(first) };
  }
  if (WRITE_TOOL.test(title)) return { icon: 'ui-pencil', verb: /edit|replace/i.test(title) ? 'Edited' : 'Wrote', object: baseName(first) };
  if (/^delete$/i.test(title)) return { icon: 'ui-trash', verb: 'Removed', object: baseName(first) };
  if (/^plan$/i.test(title)) {
    const steps = text.split('\n').filter((l) => l.trim()).length;
    return { icon: 'ui-checklist-done', verb: 'Planned', object: steps > 1 ? `${steps} steps` : clip(first.replace(/^[·•-]\s*/, ''), 80) };
  }
  if (SEARCH_TOOL.test(title)) return { icon: 'ui-search', verb: 'Searched', object: clip(first, 60) };
  if (/^(shell|bash|terminal|run)/i.test(title)) {
    const browse = browseAction(first);
    if (browse) return browse;
    const cli = first.match(/cli\.mjs\s+([\w-]+)/)?.[1];
    if (cli) return { icon: 'ui-pipeline', verb: 'Ran', object: cli.replace(/-/g, ' ') };
    return { icon: 'ui-pipeline', verb: 'Ran', object: clip(first.split(/\s+/).slice(0, 3).join(' '), 48) };
  }
  if (/fetch|web/i.test(title)) return { icon: 'ui-search', verb: 'Looked up', object: clip(first, 60) };
  return { icon: 'ui-sparkle', verb: title || 'Worked', object: clip(baseName(first), 60) };
}

const PROGRESSIVE: Record<string, string> = { Wrote: 'Writing', Edited: 'Editing', Read: 'Reading', Ran: 'Running', Searched: 'Searching', Opened: 'Opening' };

/** What the agent said last and the moves it made, newest first. */
export function agentPulse(entries: readonly JobStreamEntry[] | null | undefined): AgentPulse {
  let thought = '';
  const actions: AgentAction[] = [];
  const list = entries || [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e) continue;
    const text = String(e.text || '').trim();
    if ((e.kind === 'think' || e.kind === 'say') && text) thought = firstSentences(text);
    if (e.kind === 'tool') {
      const a = toolAction(String(e.title || ''), text);
      const done = e.done !== false;
      if (a) actions.push({ ...a, verb: done ? a.verb : (PROGRESSIVE[a.verb] ?? a.verb), id: `${e.id ?? i}`, done });
    }
  }
  return { thought, actions: actions.slice(-MAX_ACTIONS).reverse() };
}

/* ---------- storyboard ---------- */

export interface StoryCard {
  key: string;
  kind: 'open' | 'chapter' | 'plate' | 'close';
  /** 1-based chapter number, chapters only. */
  n: number;
  title: string;
  eyebrow: string;
  line: string;
  plateType: string;
  /** Caption beats that follow a chapter before the next card. */
  beats: number;
}

export interface StoryTotals {
  chapters: number;
  plates: number;
  beats: number;
  words: number;
  estSec: number;
}

const EMPTY_TOTALS: StoryTotals = { chapters: 0, plates: 0, beats: 0, words: 0, estSec: 0 };

/** Template copy from `templates/new-video` — never shown as if the agent wrote it. */
const PLACEHOLDER = /^(first line of the promise|second line with an|first chapter|short recap line|the payoff|chapter title from flow|caption title from flow|one sentence (on|over)|what the viewer)/i;
const STORY_KINDS = new Set(['open', 'chapter', 'plate', 'close']);

const isPlaceholder = (s: ScriptScene) => PLACEHOLDER.test((s.title || '').replace(/\*/g, '').trim());

/** The script as storyboard cards; empty while it is still the untouched scaffold. */
export function storyCards(script: Pick<Script, 'scenes'> & { scaffold?: boolean } | null | undefined): StoryCard[] {
  if (!script || script.scaffold) return [];
  const cards: StoryCard[] = [];
  let n = 0;
  for (const s of script.scenes || []) {
    if (s.kind === 'step') {
      const last = cards.at(-1);
      if (last && last.kind === 'chapter') last.beats += 1;
      continue;
    }
    if (!STORY_KINDS.has(s.kind) || isPlaceholder(s)) continue;
    const kind = s.kind as StoryCard['kind'];
    cards.push({
      key: s.key || `${kind}:${cards.length}`,
      kind,
      n: kind === 'chapter' ? ++n : 0,
      title: (s.title || s.plateTitle || s.plateId || '').replace(/\*/g, ''),
      eyebrow: (s.eyebrow || s.plate?.typeLabel || '').replace(/\*/g, ''),
      line: String(s.narration || s.onScreen || s.sub || '')
        .replace(/\*/g, '')
        .trim(),
      plateType: s.plateType || s.plate?.type || '',
      beats: 0,
    });
  }
  return cards;
}

export function storyTotals(cards: readonly StoryCard[], script?: Pick<Script, 'totals'> | null): StoryTotals {
  if (!cards.length) return EMPTY_TOTALS;
  const words = cards.reduce((sum, c) => sum + (c.line ? c.line.split(/\s+/).length : 0), 0);
  return {
    chapters: cards.filter((c) => c.kind === 'chapter').length,
    plates: cards.filter((c) => c.kind === 'plate').length,
    beats: cards.reduce((sum, c) => sum + c.beats, 0),
    words: script?.totals?.words || words,
    estSec: script?.totals?.estSec || 0,
  };
}

const STOP = new Set('the a an and or of to in on for with your you our is are this that how it its from by at as be into what why who'.split(' '));
const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );

/**
 * A screen for each chapter card: the best word overlap with the screen's
 * label, heading and path, else the next unused screen in exploration order.
 */
export function screenFor(cards: readonly StoryCard[], screens: readonly ExploreScreen[]): Map<string, ExploreScreen> {
  const out = new Map<string, ExploreScreen>();
  const shot = screens.filter((s) => s.shot);
  if (!shot.length) return out;
  const used = new Set<string>();
  const words = shot.map((s) => tokens(`${s.label} ${s.heading} ${s.path.replace(/[/-]/g, ' ')} ${s.reachedBy?.label || ''}`));
  let cursor = 0;
  for (const c of cards) {
    if (c.kind !== 'chapter') continue;
    const want = tokens(`${c.title} ${c.line}`);
    let best = -1;
    let score = 0;
    shot.forEach((_, i) => {
      let hit = 0;
      for (const w of want) if (words[i]?.has(w)) hit += 1;
      const s = hit - (used.has(shot[i]?.id || '') ? 0.5 : 0);
      if (hit && s > score) {
        score = s;
        best = i;
      }
    });
    if (best < 0) {
      while (cursor < shot.length && used.has(shot[cursor]?.id || '')) cursor += 1;
      best = cursor < shot.length ? cursor : (c.n - 1) % shot.length;
    }
    const pick = shot[best];
    if (pick) {
      used.add(pick.id);
      out.set(c.key, pick);
    }
  }
  return out;
}

/* ---------- store + polling ---------- */

interface FeedState {
  slug: string;
  brandId: string;
  explore: ExploreFeed | null;
  story: StoryCard[];
  totals: StoryTotals;
  /** Screen the viewer pinned in the scout view; null follows the agent. */
  pinned: string | null;
}

const initial = (): FeedState => ({ slug: '', brandId: '', explore: null, story: [], totals: EMPTY_TOTALS, pinned: null });

export const useCreationFeed = create<FeedState>()(initial);
const store = useCreationFeed;

let exploreSig = '';
let storySig = '';
let exploreBusy = false;
let scriptBusy = false;

const enc = encodeURIComponent;

export const creationFeed = {
  bind(slug: string, brandId = ''): void {
    if (store.getState().slug === slug) {
      if (brandId) store.setState({ brandId });
      return;
    }
    exploreSig = '';
    storySig = '';
    store.setState({ ...initial(), slug, brandId });
  },

  async pollExplore(): Promise<void> {
    const { slug } = store.getState();
    if (!slug || exploreBusy) return;
    exploreBusy = true;
    try {
      const feed = await api<ExploreFeed>(`/api/video/${enc(slug)}/explore-feed`);
      if (store.getState().slug !== slug) return;
      const sig = JSON.stringify(feed);
      if (sig === exploreSig) return;
      exploreSig = sig;
      store.setState({ explore: feed });
    } catch {
      /* the stage keeps the last frame it had */
    } finally {
      exploreBusy = false;
    }
  },

  async pollScript(): Promise<void> {
    const { slug } = store.getState();
    if (!slug || scriptBusy) return;
    scriptBusy = true;
    try {
      const r = await api<{ script: Script }>(`/api/video/${enc(slug)}/script`);
      if (store.getState().slug === slug) creationFeed.acceptScript(r.script);
    } catch {
      /* flow.mjs is mid-write; the next poll reads it */
    } finally {
      scriptBusy = false;
    }
  },

  acceptScript(script: (Pick<Script, 'scenes' | 'totals'> & { scaffold?: boolean }) | null): void {
    const story = storyCards(script);
    const sig = JSON.stringify(story);
    if (sig === storySig) return;
    storySig = sig;
    store.setState({ story, totals: storyTotals(story, script) });
  },

  pin(id: string | null): void {
    store.setState((s) => ({ pinned: s.pinned === id ? null : id }));
  },

  reset(): void {
    exploreSig = '';
    storySig = '';
    store.setState(initial());
  },
};

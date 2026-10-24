/**
 * Chapter/caption marks as the cut sees them, and the one pairing between flow.mjs calls and
 * recorded marks. Every consumer (overlay HTML build, Studio deck, produce bake) reads this so
 * hold lengths and card identity cannot drift between preview and render.
 *
 * Leaf module on purpose: depends only on fs + editDeck. Must never import edit.mjs / motion.mjs
 * (motion → liveCards → here; a back-edge would recreate the FPS TDZ cycle).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyCardEdits, cardMarkKey, normalizeCards } from './editDeck.mjs';

export const CARD_KINDS = Object.freeze(['chapter', 'caption']);

export const isCardMark = (m) => m?.kind === 'chapter' || m?.kind === 'caption';

function readJson(path) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  } catch {
    return null;
  }
}

const byTime = (a, b) => (Number(a.t) || 0) - (Number(b.t) || 0);

/**
 * Raw recording marks on the live.mp4 clock, sorted by t. Falls back to live-meta's embedded
 * timeline for takes without timeline.json. The only reader of that file in the cut pipeline.
 */
export function loadRawTimeline(video) {
  const fromFile = readJson(join(video.out, 'timeline.json'));
  const fromMeta = Array.isArray(fromFile) ? null : readJson(join(video.out, 'live-meta.json'))?.timeline;
  const raw = Array.isArray(fromFile) ? fromFile : Array.isArray(fromMeta) ? fromMeta : [];
  return raw.filter((m) => m && typeof m === 'object').sort(byTime);
}

/** Give every chapter/caption mark its stable `edit.cards` key (other marks pass through). */
export function keyCardMarks(marks) {
  return (marks || []).map((m) => (isCardMark(m) ? { ...m, key: m.key || cardMarkKey(m) } : m));
}

/**
 * Recording marks with `edit.cards` applied — what the timeline shows and what produce bakes.
 * Pass the real `liveDur` when known so moved cards clamp to the reel like the editor does.
 * @returns {object[]} full timeline sorted by t (callers filter with `isCardMark`)
 */
export function loadCardMarks(video, { liveDur = Infinity } = {}) {
  const cards = normalizeCards(video.config?.edit?.cards, { liveDur });
  return applyCardEdits(keyCardMarks(loadRawTimeline(video)), cards).sort(byTime);
}

/**
 * Pair flow.mjs chapter()/say() calls with recorded marks of the same kind.
 * Marks are consumed once, so two calls sharing a title do not collapse onto one mark.
 * Order of preference per call: exact title · title contained in label · next unconsumed in time
 * order (covers titles edited in Studio after the take was recorded).
 * @param {Array<{ kind: string, index: number, title?: string }>} calls flow order
 * @param {object[]} marks recording marks (any kinds; non-card marks ignored)
 * @returns {Map<number, object>} flow call index → mark
 */
export function pairCallsToMarks(calls, marks) {
  const out = new Map();
  for (const kind of CARD_KINDS) {
    const pool = (marks || []).filter((m) => m.kind === kind && !m.copyOf).sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0));
    const taken = new Set();
    const free = () => pool.filter((m) => !taken.has(m));
    for (const call of calls || []) {
      const callKind = call.kind === 'step' ? 'caption' : call.kind;
      if (callKind !== kind) continue;
      const title = String(call.title || '');
      const avail = free();
      const mark =
        avail.find((m) => String(m.label || '') === title) ||
        (title ? avail.find((m) => String(m.label || '').includes(title)) : null) ||
        avail[0] ||
        null;
      if (!mark) continue;
      taken.add(mark);
      out.set(call.index, mark);
    }
  }
  return out;
}

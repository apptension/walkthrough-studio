/**
 * Chapter plates — a chapter is a slide, not a sticker.
 *
 * A `chapter` mark used to be baked as a full-frame card over the recording. The recording was
 * holding still underneath it anyway: `story.chapter()` awaits the card's hold before the flow
 * moves on, so those seconds exist only to host the title. Promoting the chapter to a real plate
 * swaps that dead stretch for a rendered slide, and the chapter gains everything a plate has —
 * layout, background, title reveal, depth, energy, sheen, colours, transitions, trims, zoom,
 * magnifiers and its own place in the cut.
 *
 * The rows here are shaped exactly like `config.interstitials` entries, so the whole plate
 * pipeline (buildPlates → renderPlates → platePaths → plateTarget → the Studio plate inspector)
 * takes them without a special case. They are *derived* from the recording's marks, so no config
 * migration is needed; `plateTarget(config, id, { create: true })` persists a row the moment
 * someone restyles one, and that saved row then wins.
 *
 * Opt out per chapter with `edit.chapterCards: [key]` — that chapter goes back to being an
 * overlay card baked onto the recording.
 */

import { cardMarkKey, normalizeChapterCards } from './editDeck.mjs';
import { loadCardMarks } from './cardMarks.mjs';

/** Chapter cards hold this long when the recording did not say (mirrors cardMotion defaults). */
export const CHAPTER_HOLD = 2.8;

/** The plate type a chapter renders as: kinetic type, one line that lands. */
export const CHAPTER_PLATE_TYPE = 'statement';

const slugPart = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);

/**
 * A stable, filename-safe id for a chapter's plate. `edit.order`, `edit.omit`, `edit.trims` and
 * `edit.plateTimes` all key off it, and it becomes `plate-<id>.mp4`, so it must survive a
 * re-render and never carry a space or colon.
 */
export function chapterPlateId(mark, index = 0) {
  const n = String(mark?.id || '').match(/^chapter-(\d+)$/)?.[1];
  const base = n || String(index + 1);
  const name = slugPart(mark?.label);
  return name ? `ch${base}-${name}` : `ch${base}`;
}

/** How long the recording held still for this card — the stretch the plate replaces. */
export function chapterHold(mark) {
  const d = Number(mark?.dur);
  return Number.isFinite(d) && d > 0 ? d : CHAPTER_HOLD;
}

/**
 * Every chapter that plays as a plate, as interstitial-shaped rows.
 *
 * `marks` are card marks on whichever clock the caller works in (produce passes the cleaned
 * reel, the editor the recording) — `liveAt` and `hold` come back on that same clock.
 * A saved `config.interstitials` row with the same id wins, so restyling a chapter sticks.
 */
export function chapterCoverage(config, marks, { chapterCards = [] } = {}) {
  const off = new Set(normalizeChapterCards(chapterCards.length ? chapterCards : config?.edit?.chapterCards));
  const authored = (config?.interstitials || []).filter((i) => !i.chapter);
  const saved = new Map((config?.interstitials || []).map((i) => [i.id, i]));
  // A hand-authored plate placed `before` a chapter already introduces it; deriving a second
  // slide would say the same thing twice. That plate becomes the chapter's slide instead — the
  // held stretch under the old card is still reclaimed, it just plays the authored plate.
  const introduced = new Map(authored.filter((i) => i.before).map((i) => [String(i.before), i.id]));
  const rows = [];
  const absorbed = new Map();
  const seen = new Set();
  let n = 0;
  for (const m of marks || []) {
    if (m?.kind !== 'chapter' || m.copyOf) continue;
    const key = m.key || cardMarkKey(m);
    const index = n;
    n += 1;
    if (off.has(key)) continue;
    const by = introduced.get(String(m.label || ''));
    if (by) {
      absorbed.set(key, { by, hold: chapterHold(m), label: String(m.label || '') });
      continue;
    }
    let id = chapterPlateId(m, index);
    // A hand-authored interstitial could already own this id; step aside rather than fight it.
    while (seen.has(id) || (saved.has(id) && !saved.get(id)?.chapter)) id = `${id}-${rows.length + 2}`;
    seen.add(id);
    const title = String(m.label || '').trim();
    if (!title) continue;
    const own = saved.get(id);
    rows.push({
      // A saved row carries the user's copy, layout, style and motion; the rest is derived.
      ...(own || {}),
      id,
      type: own?.type || CHAPTER_PLATE_TYPE,
      title: own?.title ?? title,
      ...(own?.eyebrow !== undefined ? {} : { eyebrow: `Chapter ${index + 1}` }),
      ...(own?.sub !== undefined || !m.body ? {} : { sub: String(m.body) }),
      chapter: key,
      // The mark's own label, even if the plate's copy was renamed — narration lines key off it.
      chapterLabel: title,
      liveAt: Number(m.t) || 0,
      hold: chapterHold(m),
    });
  }
  return { rows, absorbed };
}

/** Just the derived plate rows — what the plate pipeline enumerates. */
export function chapterPlateRows(config, marks, opts) {
  return chapterCoverage(config, marks, opts).rows;
}

/** Chapter plate rows for a video, read from its recording marks. */
export function videoChapterPlates(video, { liveDur = Infinity, marks = null } = {}) {
  const list = marks || loadCardMarks(video, { liveDur });
  return chapterPlateRows(video?.config, list);
}

/** True for an interstitial row that stands in for a chapter card. */
export const isChapterPlate = (row) => Boolean(row?.chapter);

/** Chapter keys that play as plates, so the overlay bake can leave them out. */
export function chapterPlateKeys(rows) {
  return new Set((rows || []).filter(isChapterPlate).map((r) => r.chapter));
}

/**
 * Every chapter a plate speaks for — its own derived slide, or the authored plate that
 * introduces it. None of them want a card baked onto the recording as well.
 */
export function coveredChapterKeys(video, { liveDur = Infinity, marks = null } = {}) {
  let coverage;
  try {
    coverage = chapterCoverage(video?.config, marks || loadCardMarks(video, { liveDur }));
  } catch {
    return new Set();
  }
  return new Set([...coverage.rows.map((r) => r.chapter), ...coverage.absorbed.keys()]);
}

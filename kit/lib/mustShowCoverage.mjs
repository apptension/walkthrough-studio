/**
 * Match brief mustShow beats against explored pages, and recraft the journey
 * to what the live product actually exposes — never block on unmet asks.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DANGEROUS =
  /log\s*out|sign\s*out|delete|remove account|destroy|cancel sub|unsubscribe|pay now|checkout|purchase|buy now|empty trash|permanently|wipe data|reset password/i;

export function tokensOf(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !/^(the|and|for|with|from|into|that|this|your|our)$/.test(t));
}

function pageHaystack(page = {}) {
  return [
    page.title,
    page.url,
    page.path,
    ...(page.dom?.headings || []).map((h) => h.text),
    ...(page.dom?.controls || []).map((c) => c.name),
    ...(page.dom?.nav || []).map((n) => n.text || n.name || n.label),
    ...(page.frameworks || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** Score one must-show line against explored pages (0–1). */
export function matchMustShowItem(item, pages = []) {
  const tokens = tokensOf(item);
  if (!tokens.length) return { item, matched: false, score: 0, page: null, evidence: '' };
  let best = { item, matched: false, score: 0, page: null, evidence: '' };
  for (const page of pages) {
    const hay = pageHaystack(page);
    let hits = 0;
    const found = [];
    for (const t of tokens) {
      if (hay.includes(t)) {
        hits += 1;
        found.push(t);
      }
    }
    const score = hits / tokens.length;
    if (score > best.score) {
      best = {
        item,
        matched: score >= 0.4,
        score,
        page: page.url || page.path || null,
        evidence: found.join(', '),
      };
    }
  }
  return best;
}

export function scoreMustShowCoverage(mustShow = [], pages = []) {
  const items = (mustShow || []).map((item) => matchMustShowItem(item, pages));
  const unmet = items.filter((i) => !i.matched).map((i) => i.item);
  const matched = items.filter((i) => i.matched).length;
  const total = items.length || 0;
  return {
    complete: total === 0 ? pages.length > 0 : unmet.length === 0,
    ratio: total ? matched / total : pages.length ? 1 : 0,
    matched,
    total,
    unmet,
    items,
  };
}

function cleanChapterLabel(raw) {
  let s = String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/[|·•].*$/, '')
    .trim();
  if (!s) return '';
  s = s.replace(/\s+[—–-]\s+[A-Z][\w\s]{0,40}$/, '').trim();
  if (s.length > 48) s = s.slice(0, 45).trim() + '…';
  return s;
}

function chapterCandidatesFromPages(pages = []) {
  const out = [];
  const seen = new Set();
  for (const page of pages) {
    const labels = [
      cleanChapterLabel(page.title),
      ...(page.dom?.nav || []).map((n) => cleanChapterLabel(n.text || n.name || n.label)),
      ...(page.dom?.headings || [])
        .filter((h) => h.level <= 2)
        .map((h) => cleanChapterLabel(h.text)),
    ].filter(Boolean);
    for (const label of labels) {
      const key = label.toLowerCase();
      if (seen.has(key) || DANGEROUS.test(label) || label.length < 3) continue;
      seen.add(key);
      out.push(label);
    }
  }
  return out;
}

/**
 * Prefer reachable mustShow; replace unmet beats with discovered destinations.
 * Always returns a non-empty list when pages exist.
 */
export function craftJourneyFromCoverage(mustShow = [], coverage, pages = []) {
  const items = coverage?.items || (mustShow || []).map((item) => matchMustShowItem(item, pages));
  const kept = [];
  const dropped = [];
  for (const row of items) {
    if (row.matched) kept.push(row.item);
    else dropped.push(row.item);
  }

  const seen = new Set(kept.map((k) => k.toLowerCase()));
  const added = [];
  const need = Math.max(mustShow.length || 4, 4);
  if (dropped.length || kept.length < Math.min(3, need)) {
    for (const label of chapterCandidatesFromPages(pages)) {
      if (seen.has(label.toLowerCase())) continue;
      added.push(label);
      seen.add(label.toLowerCase());
      if (kept.length + added.length >= need) break;
    }
  }

  let next = [...kept, ...added].slice(0, 8);
  if (!next.length) {
    next = chapterCandidatesFromPages(pages).slice(0, 5);
  }
  if (!next.length && mustShow.length) next = [...mustShow];

  return {
    mustShow: next,
    dropped,
    added,
    adapted: dropped.length > 0 || added.length > 0 || next.join('\n') !== (mustShow || []).join('\n'),
  };
}

/** Persist adapted mustShow onto brief.json; returns updated brief or null. */
export function applyJourneyRecraft(video, craft) {
  if (!video?.dir || !craft?.adapted) return null;
  const path = join(video.dir, 'brief.json');
  if (!existsSync(path)) return null;
  let brief;
  try {
    brief = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  const previous = [...(brief.story?.mustShow || [])];
  brief.story = brief.story || {};
  brief.story.mustShow = craft.mustShow;
  const noteBits = [];
  if (craft.dropped?.length) noteBits.push(`Could not reach: ${craft.dropped.join('; ')}`);
  if (craft.added?.length) noteBits.push(`Mapped instead: ${craft.added.join('; ')}`);
  if (noteBits.length) {
    brief.app = brief.app || {};
    const line = `Explore recraft — ${noteBits.join('. ')}.`;
    brief.app.notes = [brief.app.notes, line].filter(Boolean).join('\n');
  }
  brief.explore = {
    adaptedAt: new Date().toISOString(),
    previousMustShow: previous,
    mustShow: craft.mustShow,
    dropped: craft.dropped || [],
    added: craft.added || [],
  };
  writeFileSync(path, JSON.stringify(brief, null, 2) + '\n');
  return brief;
}

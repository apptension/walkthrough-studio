/**
 * Rough check of which brief beats the fallback crawl (no agent available) has seen.
 * It only bounds that crawl and reports coverage; deciding what to show, in what order,
 * and how to reach it is the explore agent's job — nothing here rewrites the brief.
 */
import { parseBeat } from './journeyBeats.mjs';

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

/** Score one must-show beat (by its title) against explored pages (0–1). */
export function matchMustShowItem(item, pages = []) {
  const tokens = tokensOf(parseBeat(item).title || item);
  if (!tokens.length) return { item, matched: false, score: 0, page: null, evidence: '' };
  let best = { item, matched: false, score: 0, page: null, evidence: '' };
  for (const page of pages) {
    const hay = pageHaystack(page);
    const found = tokens.filter((t) => hay.includes(t));
    const score = found.length / tokens.length;
    if (score > best.score) {
      best = { item, matched: score >= 0.4, score, page: page.url || page.path || null, evidence: found.join(', ') };
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

import type { AgentModel, AgentModelFamily, AgentModelList } from '@/api/types';

import type { AgentId } from './agentView';

const FAMILY_ORDER: AgentModelFamily[] = ['default', 'claude', 'gpt', 'gemini', 'grok', 'composer', 'other'];

const FAMILY_LABEL: Record<AgentModelFamily, string> = {
  default: 'Recommended',
  claude: 'Claude',
  gpt: 'GPT',
  gemini: 'Gemini',
  grok: 'Grok',
  composer: 'Composer',
  other: 'Other',
};

const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@\-[\]=,]{0,159}$/;

export interface ModelGroup {
  family: AgentModelFamily;
  label: string;
  models: AgentModel[];
}

export function isModelId(s: string): boolean {
  return MODEL_ID_RE.test(s.trim());
}

/** Every whitespace-separated token must appear in the id or the label. */
export function matchesQuery(model: AgentModel, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = `${model.id} ${model.label} ${FAMILY_LABEL[model.family] ?? ''}`.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

/** Filtered models in family order, the default entry first. */
export function groupModels(models: readonly AgentModel[], query = ''): ModelGroup[] {
  const by = new Map<AgentModelFamily, AgentModel[]>();
  for (const m of models) {
    if (!matchesQuery(m, query)) continue;
    const family = FAMILY_ORDER.includes(m.family) ? m.family : 'other';
    const list = by.get(family);
    if (list) list.push(m);
    else by.set(family, [m]);
  }
  return FAMILY_ORDER.filter((f) => by.has(f)).map((family) => ({ family, label: FAMILY_LABEL[family], models: by.get(family) ?? [] }));
}

export function flatModels(groups: readonly ModelGroup[]): AgentModel[] {
  return groups.flatMap((g) => g.models);
}

/**
 * Free-typed id worth offering as a custom model: valid, not already listed, and either
 * id-shaped (has a separator) or matching nothing — a bare "opus" is a search, not an id.
 */
export function customCandidate(models: readonly AgentModel[], query: string): string | null {
  const q = query.trim();
  if (!q || !isModelId(q)) return null;
  if (models.some((m) => m.id.toLowerCase() === q.toLowerCase())) return null;
  if (!/[-.:/[]/.test(q) && models.some((m) => matchesQuery(m, q))) return null;
  return q;
}

const WORD: Record<string, string> = { gpt: 'GPT', xhigh: 'Extra High', claude: '', cursor: '' };

/** "claude-opus-5-5-high" → "Opus 5.5 High" — used before the runner's list has loaded. */
export function prettyModelId(id: string): string {
  const parts = id.split('[')[0]!.split(/[-_]/).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (/^\d+$/.test(p) && prev && /^\d+(\.\d+)?$/.test(prev) && !prev.includes('.')) {
      out[out.length - 1] = `${prev}.${p}`;
      continue;
    }
    const w = WORD[p.toLowerCase()];
    if (w === '') continue;
    out.push(w ?? (/^\d/.test(p) ? p : p[0]!.toUpperCase() + p.slice(1)));
  }
  return out.join(' ') || id;
}

export function defaultModelLabel(id: AgentId): string {
  return id === 'cursor' ? 'Auto' : 'Default';
}

/** What the header chip says for a runner's saved model. */
export function modelChipLabel(id: AgentId, current: string | null | undefined, models?: readonly AgentModel[]): string {
  if (!current) return defaultModelLabel(id);
  return models?.find((m) => m.id === current)?.label || prettyModelId(current);
}

/** Last list per runner, so a reopen paints at once while the server refreshes. */
export const listCache = new Map<AgentId, AgentModelList>();

export function cachedModels(id: AgentId): AgentModel[] | undefined {
  return listCache.get(id)?.models;
}

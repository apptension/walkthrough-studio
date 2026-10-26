import { describe, expect, it } from 'vitest';

import type { AgentModel } from '@/api/types';

import { customCandidate, groupModels, modelChipLabel, prettyModelId } from './agentModels';

const MODELS: AgentModel[] = [
  { id: '', label: 'Auto', family: 'default' },
  { id: 'gpt-5.3-codex', label: 'Codex 5.3', family: 'gpt' },
  { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 1M High', family: 'claude' },
  { id: 'claude-sonnet-5-thinking-high', label: 'Claude Sonnet 5 1M Thinking', family: 'claude' },
];

describe('agent models', () => {
  it('groups in family order with the default first', () => {
    expect(groupModels(MODELS).map((g) => g.family)).toEqual(['default', 'claude', 'gpt']);
  });

  it('matches every token against id and label', () => {
    const groups = groupModels(MODELS, 'claude high');
    expect(groups.flatMap((g) => g.models.map((m) => m.id))).toEqual(['claude-opus-5-5-high', 'claude-sonnet-5-thinking-high']);
    expect(groupModels(MODELS, 'opus 5.5').flatMap((g) => g.models)).toHaveLength(1);
  });

  it('offers a valid unlisted id as custom', () => {
    expect(customCandidate(MODELS, 'my-model')).toBe('my-model');
    expect(customCandidate(MODELS, 'GPT-5.3-codex')).toBeNull();
    expect(customCandidate(MODELS, 'two words')).toBeNull();
    expect(customCandidate(MODELS, '')).toBeNull();
  });

  it('labels the chip from the list, then a prettified id, then the default', () => {
    expect(modelChipLabel('cursor', null)).toBe('Auto');
    expect(modelChipLabel('claude', null)).toBe('Default');
    expect(modelChipLabel('cursor', 'gpt-5.3-codex', MODELS)).toBe('Codex 5.3');
    expect(prettyModelId('claude-opus-5-5-high')).toBe('Opus 5.5 High');
    expect(prettyModelId('gpt-5.3-codex-xhigh')).toBe('GPT 5.3 Codex Extra High');
    expect(prettyModelId('opus')).toBe('Opus');
  });
});

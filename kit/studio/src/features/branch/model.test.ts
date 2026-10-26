import { describe, expect, it } from 'vitest';

import { makeBranchIdea } from '@/test/factories';

import { branchRequest, briefMode, draftFromIdea, EMPTY_BRANCH, ideasSummary, matchesIdea } from './model';

const idea = makeBranchIdea();

describe('draftFromIdea', () => {
  it('fills the brief from a suggestion', () => {
    expect(draftFromIdea(idea)).toEqual({
      title: idea.title,
      angle: idea.angle,
      outcome: idea.outcome,
    });
  });

  it('reads the parts the server left out as empty, not undefined', () => {
    expect(draftFromIdea(makeBranchIdea({ angle: undefined, outcome: undefined }))).toEqual({
      title: idea.title,
      angle: '',
      outcome: '',
    });
  });
});

describe('matchesIdea', () => {
  it('holds while the brief is untouched, ignoring stray whitespace', () => {
    expect(matchesIdea(draftFromIdea(idea), idea)).toBe(true);
    expect(matchesIdea({ ...draftFromIdea(idea), title: ` ${idea.title} ` }, idea)).toBe(true);
  });

  it('breaks the moment any field is edited', () => {
    expect(matchesIdea({ ...draftFromIdea(idea), angle: 'Something else' }, idea)).toBe(false);
    expect(matchesIdea({ ...draftFromIdea(idea), outcome: '' }, idea)).toBe(false);
  });

  it('is false when nothing was picked', () => {
    expect(matchesIdea(draftFromIdea(idea), undefined)).toBe(false);
  });
});

describe('briefMode', () => {
  it('says where the brief came from', () => {
    expect(briefMode(draftFromIdea(idea), idea)).toBe('From suggestion');
    expect(briefMode({ ...EMPTY_BRANCH, title: 'My own' }, idea)).toBe('Your own angle');
    expect(briefMode(EMPTY_BRANCH, undefined)).toBe('Pick a suggestion or write your own');
  });
});

describe('branchRequest', () => {
  it('sends an untouched suggestion as its id, so the server keeps the rest', () => {
    expect(branchRequest(draftFromIdea(idea), idea)).toEqual({
      title: idea.title,
      angle: idea.angle,
      outcome: idea.outcome,
      purpose: 'feature',
      ideaId: idea.id,
    });
  });

  it('sends an edited brief as a whole idea instead', () => {
    const draft = { title: 'Review a cut', angle: 'Stay in the sheet', outcome: 'Approve alone' };

    expect(branchRequest(draft, idea)).toEqual({
      ...draft,
      purpose: 'feature',
      idea: {
        ...draft,
        purpose: 'feature',
        lengthSec: 90,
        mustShow: ['Stay in the sheet'],
        plates: ['features', 'callout'],
        source: 'custom',
      },
    });
  });

  it('falls back to the title when there is no angle to show', () => {
    const request = branchRequest({ title: 'Review a cut', angle: '', outcome: '' }, undefined);
    expect(request.idea?.mustShow).toEqual(['Review a cut']);
  });

  it('trims what the director typed', () => {
    const request = branchRequest({ title: '  Review  ', angle: ' Sheet ', outcome: ' ' }, undefined);
    expect(request.title).toBe('Review');
    expect(request.angle).toBe('Sheet');
    expect(request.outcome).toBe('');
  });
});

describe('ideasSummary', () => {
  it('counts the ideas and says where they came from', () => {
    expect(ideasSummary(8, false)).toBe('8 ideas · from this story');
    expect(ideasSummary(1, true)).toBe('1 idea · includes agent');
    expect(ideasSummary(0, false)).toBe('No ideas yet — write your own');
  });
});

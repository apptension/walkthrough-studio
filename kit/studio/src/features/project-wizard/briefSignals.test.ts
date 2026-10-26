import { describe, expect, it } from 'vitest';

import { BRIEF_EXAMPLES, briefChecks, chapterTitle, descriptionSignals, EMPTY_BRIEF, hostOf, lengthLabel, purposeInfo, snapshotFrom } from './briefSignals';

describe('descriptionSignals', () => {
  it('reads nothing from an empty description', () => {
    expect(descriptionSignals('')).toEqual({ audience: '', goal: false, lengthSec: null, beats: 0, words: 0, score: 0 });
  });

  it('finds audience, goal, length and beats', () => {
    const s = descriptionSignals('Show new admins how to invite a teammate in about a minute, then the settings, then the audit log.');
    expect(s.audience).toBe('new admins');
    expect(s.goal).toBe(true);
    expect(s.lengthSec).toBe(60);
    expect(s.beats).toBe(3);
    expect(s.score).toBe(4);
  });

  it('parses numeric and worded lengths', () => {
    expect(descriptionSignals('A 90 second tour for buyers').lengthSec).toBe(90);
    expect(descriptionSignals('A two minute demo for prospects').lengthSec).toBe(120);
    expect(descriptionSignals('A 1.5 min overview').lengthSec).toBe(90);
    expect(descriptionSignals('Half a minute teaser').lengthSec).toBe(30);
    expect(descriptionSignals('A 10 minute walkthrough for admins').lengthSec).toBe(600);
    expect(descriptionSignals('3 s flash').lengthSec).toBeNull();
  });

  it('counts listed moments as beats', () => {
    expect(descriptionSignals('Show these:\n- inbox\n- reply\n- archive').beats).toBe(4);
    expect(descriptionSignals('Show busy managers how to plan next week').beats).toBe(1);
  });

  it('every example lights all four signals', () => {
    for (const ex of BRIEF_EXAMPLES) expect(descriptionSignals(ex.text).score, ex.id).toBe(4);
  });
});

describe('helpers', () => {
  it('hostOf keeps only full http(s) URLs', () => {
    expect(hostOf('https://app.acme.com/x?y=1')).toBe('app.acme.com');
    expect(hostOf('http://localhost:4747')).toBe('');
    expect(hostOf('app.acme.com')).toBe('');
    expect(hostOf('ftp://acme.com')).toBe('');
  });

  it('lengthLabel', () => {
    expect(lengthLabel(45)).toBe('45s');
    expect(lengthLabel(90)).toBe('1.5 min');
    expect(lengthLabel(120)).toBe('2 min');
    expect(lengthLabel(null)).toBe('');
  });

  it('chapterTitle drops numbering, the why and the how', () => {
    expect(chapterTitle('1. Invite a teammate — one invite covers access · how: click Invite')).toBe('Invite a teammate');
    expect(chapterTitle('- Settings how: open the cog')).toBe('Settings');
  });

  it('purposeInfo falls back to overview', () => {
    expect(purposeInfo('sales').spine).toEqual(['Problem', 'Agitate', 'Solve', 'Prove', 'Ask']);
    expect(purposeInfo('nope').value).toBe('overview');
  });
});

describe('brief snapshot', () => {
  const values = (fields: Record<string, string>, checked: Record<string, string[]> = {}) => ({
    get: (n: string) => fields[n] || '',
    checked: (n: string) => Boolean(checked[n]?.length),
    all: (n: string) => checked[n] || [],
  });

  it('reads the form into a preview', () => {
    const b = snapshotFrom(
      values({ title: 'Invite', audience: 'Admins', mustShow: 'Invite — why\n\nRoles how: click', startUrl: 'https://app.acme.com' }, { purpose: ['feature'], lengthSec: ['90'], brandMode: ['new'], plates: ['stat', 'quote'] }),
    );
    expect(b).toMatchObject({ title: 'Invite', purpose: 'feature', lengthSec: 90, brandMode: 'new', chapters: ['Invite', 'Roles'], plates: ['stat', 'quote'], captureMode: 'agent' });
  });

  it('checks what the agent still needs, in step order', () => {
    const empty = briefChecks(EMPTY_BRIEF);
    expect(empty.every((c) => !c.done)).toBe(true);
    expect(empty[0]).toMatchObject({ id: 'title', step: 0, field: 'title' });
    const guided = briefChecks({ ...EMPTY_BRIEF, captureMode: 'guided' });
    expect(guided.find((c) => c.id === 'chapters')?.done).toBe(true);
    const newBrand = briefChecks({ ...EMPTY_BRIEF, brandMode: 'new', startUrl: 'https://app.acme.com' });
    expect(newBrand.find((c) => c.id === 'brand')).toMatchObject({ done: true, field: 'brandName' });
  });
});

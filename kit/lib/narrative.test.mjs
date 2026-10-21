import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PURPOSES, PURPOSE_IDS, critiqueStory, resolvePurpose, storyBrief } from './narrative.mjs';

test('every purpose has a framework and ends on a payoff or ask beat', () => {
  for (const id of PURPOSE_IDS) {
    const p = PURPOSES[id];
    assert.ok(p.framework.includes('→'), id);
    assert.ok(p.beats.length >= 4, id);
    assert.match(p.beats.at(-1).where, /close/, id);
  }
});

test('resolvePurpose: explicit config wins, then brief, then audience guess', () => {
  assert.equal(resolvePurpose({ purpose: 'sales' }, { purpose: 'feature' }), 'sales');
  assert.equal(resolvePurpose({}, { purpose: 'launch' }), 'launch');
  assert.equal(resolvePurpose({ audience: 'New users in their first week' }), 'onboarding');
  assert.equal(resolvePurpose({ audience: 'Ops leads evaluating tools' }), 'sales');
  assert.equal(resolvePurpose({ purpose: 'nonsense' }), 'overview');
});

test('storyBrief lists the spine beats in order plus messaging rules', () => {
  const text = storyBrief('feature');
  assert.match(text, /Before → After → Bridge/);
  assert.ok(text.indexOf('BEFORE') < text.indexOf('AFTER'));
  assert.match(text, /Messaging rules/);
});

const goodConfig = {
  purpose: 'overview',
  product: 'Acme',
  open: { title: ['See who is free', 'in *seconds*'] },
  close: { title: ['One schedule.', 'Every *team.*'], steps: [] },
  interstitials: [{ type: 'metric', id: 'm', before: 'Plan', title: 'Utilisation', value: '87%' }],
};

test('critiqueStory: a viewer-first script with proof and a CTA passes clean', () => {
  const lines = [
    { key: 'intro', kind: 'intro', text: 'Your Monday schedule lives in three spreadsheets — here is one place instead.' },
    { key: 'Plan', kind: 'line', text: 'You drag a person onto a project and the week updates for everyone.' },
    { key: 'Track', kind: 'line', text: 'Hours you booked become the timesheet, so nobody retypes them.' },
    { key: 'outro', kind: 'outro', text: 'Start with one team this week and retire the spreadsheets.' },
  ];
  const { purpose, findings } = critiqueStory(goodConfig, lines);
  assert.equal(purpose, 'overview');
  assert.deepEqual(findings.map((f) => f.issue), []);
});

test('critiqueStory: flags product-definition open, missing CTA, buzzwords and missing proof beat', () => {
  const config = { ...goodConfig, interstitials: [], open: { title: ['A powerful seamless way to plan everything', 'x'] } };
  const lines = [
    { key: 'intro', kind: 'intro', text: 'Acme is a powerful resource planning platform.' },
    { key: 'a', kind: 'line', text: 'The scheduler shows bookings.' },
    { key: 'b', kind: 'line', text: 'The timesheet shows hours.' },
    { key: 'c', kind: 'line', text: 'The report shows utilisation.' },
    { key: 'outro', kind: 'outro', text: 'That is all for today.' },
  ];
  const issues = critiqueStory(config, lines).findings.map((f) => f.issue).join('\n');
  assert.match(issues, /never addresses the viewer/);
  assert.match(issues, /definition of the product/);
  assert.match(issues, /no next step/);
  assert.match(issues, /"powerful"/);
  assert.match(issues, /"seamless"/);
  assert.match(issues, /PROOF beat has no plate/);
  assert.match(issues, /3 lines start with "the"/);
  assert.match(issues, /longer than five words/);
});

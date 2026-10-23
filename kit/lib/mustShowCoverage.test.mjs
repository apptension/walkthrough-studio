import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchMustShowItem, scoreMustShowCoverage } from './mustShowCoverage.mjs';
import { beatTitle, formatBeat, parseBeat } from './journeyBeats.mjs';

const pages = [
  {
    url: 'https://app.example.com/dashboard',
    path: '/dashboard',
    title: 'Dashboard — Acme',
    dom: {
      headings: [{ level: 1, text: 'Today' }],
      controls: [{ name: 'Invite teammate' }, { name: 'Settings' }],
      nav: [{ text: 'Dashboard' }, { text: 'People' }, { text: 'Settings' }],
    },
  },
  {
    url: 'https://app.example.com/settings',
    path: '/settings',
    title: 'Settings',
    dom: { headings: [{ level: 1, text: 'Workspace settings' }], controls: [{ name: 'Save' }], nav: [{ text: 'Settings' }] },
  },
];

describe('mustShow coverage (fallback crawl bound)', () => {
  it('matches a beat by its title, not its why or how', () => {
    assert.equal(matchMustShowItem('Dashboard — the work that matters today', pages).matched, true);
    assert.equal(matchMustShowItem('Billing invoices and tax IDs', pages).matched, false);
    assert.equal(matchMustShowItem('Rocket console — launch · how: click “Dashboard”', pages).matched, false);
  });

  it('scores coverage and lists unmet beats', () => {
    const coverage = scoreMustShowCoverage(['Open Dashboard', 'Open Settings', 'Launch rocket ship console'], pages);
    assert.equal(coverage.matched, 2);
    assert.equal(coverage.total, 3);
    assert.equal(coverage.complete, false);
    assert.deepEqual(coverage.unmet, ['Launch rocket ship console']);
  });
});

describe('journey beats', () => {
  it('parses and formats the beat shape', () => {
    const beat = parseBeat('Team capacity — see who is free · how: click “People” → hover a bar');
    assert.deepEqual(
      { title: beat.title, why: beat.why, how: beat.how },
      { title: 'Team capacity', why: 'see who is free', how: 'click “People” → hover a bar' }
    );
    assert.equal(formatBeat(beat), 'Team capacity — see who is free · how: click “People” → hover a bar');
    assert.equal(beatTitle('Open Dashboard'), 'Open Dashboard');
    assert.equal(beatTitle('Sign-in page — fast'), 'Sign-in page');
    assert.equal(formatBeat({ title: 'Only title' }), 'Only title');
  });
});

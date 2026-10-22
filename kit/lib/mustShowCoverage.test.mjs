import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  applyJourneyRecraft,
  craftJourneyFromCoverage,
  matchMustShowItem,
  scoreMustShowCoverage,
} from './mustShowCoverage.mjs';

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
    dom: {
      headings: [{ level: 1, text: 'Workspace settings' }],
      controls: [{ name: 'Save' }],
      nav: [{ text: 'Settings' }],
    },
  },
];

describe('mustShow coverage', () => {
  it('matches beats against explored nav and headings', () => {
    const hit = matchMustShowItem('Dashboard — the work that matters today', pages);
    assert.equal(hit.matched, true);
    assert.ok(hit.score >= 0.4);
    const miss = matchMustShowItem('Billing invoices and tax IDs', pages);
    assert.equal(miss.matched, false);
  });

  it('scores coverage and lists unmet beats', () => {
    const coverage = scoreMustShowCoverage(
      ['Open Dashboard', 'Open Settings', 'Launch rocket ship console'],
      pages
    );
    assert.equal(coverage.matched, 2);
    assert.equal(coverage.total, 3);
    assert.equal(coverage.complete, false);
    assert.deepEqual(coverage.unmet, ['Launch rocket ship console']);
  });

  it('recrafts journey by dropping unmet and adding discovered chapters', () => {
    const mustShow = ['Open Dashboard', 'Launch rocket ship console'];
    const coverage = scoreMustShowCoverage(mustShow, pages);
    const craft = craftJourneyFromCoverage(mustShow, coverage, pages);
    assert.equal(craft.adapted, true);
    assert.ok(craft.mustShow.includes('Open Dashboard'));
    assert.ok(!craft.mustShow.includes('Launch rocket ship console'));
    assert.ok(craft.dropped.includes('Launch rocket ship console'));
    assert.ok(craft.added.length >= 1);
  });

  it('writes adapted mustShow onto brief.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-explore-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'brief.json'),
      JSON.stringify({ title: 'T', story: { mustShow: ['A', 'Missing feature XYZ'] }, app: { notes: '' } }, null, 2)
    );
    const coverage = scoreMustShowCoverage(['Open Dashboard', 'Missing feature XYZ'], pages);
    const craft = craftJourneyFromCoverage(['Open Dashboard', 'Missing feature XYZ'], coverage, pages);
    const brief = applyJourneyRecraft({ dir }, craft);
    assert.ok(brief);
    const saved = JSON.parse(readFileSync(join(dir, 'brief.json'), 'utf8'));
    assert.deepEqual(saved.story.mustShow, craft.mustShow);
    assert.ok(saved.explore?.adaptedAt);
    assert.match(saved.app.notes, /Explore recraft/);
  });
});

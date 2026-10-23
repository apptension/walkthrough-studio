import assert from 'node:assert/strict';

import { test } from 'vitest';

import { critiqueSpokenFrames, directorNoteForFinding, formatSampleList, namedControls } from './frameCheck';

const clean = {
  key: 'Export',
  line: 'Open the Export button to share the board.',
  holdSec: 6,
  narrationSec: 2,
  frame: { at: 12.4, path: 'critic-frames/Export.jpg', text: 'Board  Export  Share' },
};

test('a line that names a control missing from the frame becomes a finding', () => {
  const findings = critiqueSpokenFrames([
    { ...clean, frame: { at: 4.2, path: 'critic-frames/Export.jpg', text: 'Dashboard  Settings' } },
  ]);
  const missing = findings.find((f) => /Export/.test(f.issue));
  assert.ok(missing);
  assert.equal(missing.frame.path, 'critic-frames/Export.jpg');
  assert.equal(missing.frame.at, 4.2);
  assert.equal(missing.apply, null);
  assert.doesNotMatch(missing.suggestion, /Upgrade|workspace today|new feature/);
});

test('a beat shorter than its line becomes a finding and records the sampled frame', () => {
  const findings = critiqueSpokenFrames([
    { ...clean, holdSec: 2, narrationSec: 8 },
  ]);
  const short = findings.find((f) => /holds/.test(f.issue));
  assert.ok(short);
  assert.match(short.issue, /8\.0s/);
  assert.equal(short.frame.path, 'critic-frames/Export.jpg');
  assert.equal(short.frame.at, 12.4);
});

test('a fixture whose frame matches the line stays clean', () => {
  assert.deepEqual(critiqueSpokenFrames([clean]), []);
});

test('a missing control is not invented when no frame was sampled', () => {
  const findings = critiqueSpokenFrames([
    { ...clean, frame: { at: null, path: null, text: '' } },
  ]);
  assert.equal(findings.some((f) => /Export/.test(f.issue) && /does not show/.test(f.issue)), false);
});

test('Fix with AI sends that finding as a director note', () => {
  const [finding] = critiqueSpokenFrames([
    { ...clean, frame: { at: 4.2, path: 'critic-frames/Export.jpg', text: 'Dashboard' } },
  ]);
  const note = directorNoteForFinding(finding!);
  assert.match(note, /Export/);
  assert.match(note, /critic-frames\/Export\.jpg/);
  assert.match(note, /4\.2s/);
  assert.match(note, /flagged by the implementer/);
  assert.equal(note.includes('Upgrade your workspace'), false);
});

test('named controls come only from the line', () => {
  assert.deepEqual(namedControls('Open the Export button and the Billing page.'), ['Export', 'Billing']);
  assert.deepEqual(namedControls('Save "Quarterly review" before you leave.'), ['Quarterly review']);
});

test('the report records which frame was sampled', () => {
  const line = formatSampleList([{ key: 'Export', at: 12.4, path: 'critic-frames/Export.jpg' }]);
  assert.match(line, /Export/);
  assert.match(line, /critic-frames\/Export\.jpg/);
  assert.match(line, /12\.4s/);
});

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  CaptureStallError,
  buildStallReport,
  classifyStall,
  clearStallReport,
  createStallWatchdog,
  formatStallNote,
  readStallReport,
  writeStallReport,
} from './captureStall.mjs';

describe('classifyStall', () => {
  it('spots fill hangs and recommends typeInto', () => {
    const c = classifyStall({ lastLabel: 'Describe your idea', lastAction: 'fill', idleMs: 45_000 });
    assert.equal(c.kind, 'fill');
    assert.match(c.summary, /Describe your idea/);
    assert.ok(c.hints.some((h) => /typeInto|placeholder/i.test(h)));
  });

  it('spots click/nav hangs', () => {
    const c = classifyStall({ lastLabel: 'Open Contact', lastAction: 'click', idleMs: 45_000 });
    assert.equal(c.kind, 'click');
    assert.ok(c.hints.some((h) => /noWaitAfter|domcontentloaded/i.test(h)));
  });
});

describe('createStallWatchdog', () => {
  it('fires after idleMs with no story marks', async () => {
    let hit = null;
    const wd = createStallWatchdog({
      idleMs: 40,
      actionMs: 10_000,
      onStall: (s) => {
        hit = s;
      },
    });
    wd.start();
    wd.touchMark('Open Contact');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(hit, null);
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(hit);
    assert.equal(hit.lastLabel, 'Open Contact');
    assert.equal(hit.reason, 'idle');
    wd.stop();
  });

  it('fires when one action exceeds actionMs even if marks keep coming is N/A — action alone', async () => {
    let hit = null;
    const wd = createStallWatchdog({
      idleMs: 10_000,
      actionMs: 35,
      onStall: (s) => {
        hit = s;
      },
    });
    wd.start();
    wd.touchMark('Describe your idea');
    wd.beginAction('fill');
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(hit);
    assert.equal(hit.reason, 'action');
    assert.equal(hit.lastAction, 'fill');
    wd.stop();
  });

  it('endAction clears the action deadline', async () => {
    let hit = null;
    const wd = createStallWatchdog({ idleMs: 10_000, actionMs: 40, onStall: (s) => (hit = s) });
    wd.start();
    wd.beginAction('fill');
    wd.endAction();
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(hit, null);
    wd.stop();
  });

  it('stop prevents a pending stall', async () => {
    let hit = null;
    const wd = createStallWatchdog({ idleMs: 30, actionMs: 30, onStall: (s) => (hit = s) });
    wd.start();
    wd.stop();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(hit, null);
  });
});

describe('stall report IO', () => {
  it('writes and clears capture-stall.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-stall-'));
    const video = { out: dir, slug: 'demo' };
    const report = buildStallReport(
      {
        lastLabel: 'Describe your idea',
        lastAction: 'pressSequentially',
        idleMs: 45000,
        url: 'https://example.com/form',
      },
      { slug: 'demo' }
    );
    writeStallReport(video, report);
    const read = readStallReport(video);
    assert.equal(read.kind, 'fill');
    assert.match(formatStallNote(read), /typeInto|placeholder/i);
    assert.ok(new CaptureStallError(read).message.includes('Describe your idea'));
    clearStallReport(video);
    assert.equal(readStallReport(video), null);
    rmSync(dir, { recursive: true, force: true });
  });
});

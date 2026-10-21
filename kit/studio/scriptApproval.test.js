import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finishScriptApproval, planScriptApproval, scriptApproveLabel } from './scriptApproval.js';

test('approve and close shows the signed-off screens and then closes', () => {
  assert.equal(scriptApproveLabel('draft'), 'Approve and close');
  assert.equal(scriptApproveLabel('changed'), 'Re-approve and close');
  const plan = planScriptApproval({ ok: true, chapters: 4, plates: 2, approvedAt: '2026-10-21T12:00:00.000Z' });
  assert.match(plan.proof, /4 chapters/);
  assert.match(plan.proof, /2 plates/);
  assert.match(plan.proof, /Approved/);
  const dialog = { open: true, close() { this.open = false; } };
  assert.equal(finishScriptApproval(dialog, plan), true);
  assert.equal(dialog.open, false);
});

test('a rejected approve leaves the sheet open', () => {
  const plan = planScriptApproval({ ok: false, error: 'Script has 2 blocking issue(s)' });
  assert.equal(plan.close, false);
  const dialog = { open: true, close() { this.open = false; } };
  assert.equal(finishScriptApproval(dialog, plan), false);
  assert.equal(dialog.open, true);
});

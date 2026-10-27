import { describe, expect, it } from 'vitest';

import {
  beginEditOrigin,
  beforeSelectionCommit,
  contentFieldFocused,
  editOrigin,
  endEditOrigin,
  planBakeStaleContent,
  planContentFieldSync,
  planContentSave,
  flushQueuedInspectorRepaint,
  paintInspectorUnlessContentTyping,
  plateContentContextClip,
  plateContentSettleTarget,
  shouldHoldInspectorForContentFocus,
  isContentSaveResponseValid,
  isDeckMutationStillValid,
  maySeekProgramAfterEditorLeave,
} from './plateContentSave';

describe('planContentSave', () => {
  it('treats copy typing as live-only — no bake, no remount, no plate-list swap', () => {
    expect(planContentSave({ paintLive: true, repaint: true })).toEqual({
      reload: false,
      repaint: false,
      applyPlates: false,
      live: true,
    });
  });

  it('bakes and reloads only for structural content edits', () => {
    expect(planContentSave({ paintLive: false, repaint: true })).toEqual({
      reload: true,
      repaint: true,
      applyPlates: true,
      live: false,
    });
  });
});

describe('planContentFieldSync', () => {
  it('does not remount when the Content pane caused the stage selection echo', () => {
    expect(
      planContentFieldSync({ origin: 'pane', openSlot: 'items.0', targetSlot: 'items.1', path: 'items.1.label' }),
    ).toEqual({ remount: false, patchPath: null });
  });

  it('patches in place when the stage stays on the open record', () => {
    expect(
      planContentFieldSync({ origin: 'stage', openSlot: 'items.0', targetSlot: 'items.0', path: 'items.0.label' }),
    ).toEqual({ remount: false, patchPath: 'items.0.label' });
  });

  it('remounts only when the stage opens a different record', () => {
    expect(
      planContentFieldSync({ origin: 'stage', openSlot: 'items.0', targetSlot: 'items.1', path: 'items.1.label' }),
    ).toEqual({ remount: true, patchPath: 'items.1.label' });
  });
});

describe('edit origin', () => {
  it('tracks pane vs stage so echoes can be ignored', () => {
    beginEditOrigin('pane');
    expect(editOrigin()).toBe('pane');
    endEditOrigin();
    expect(editOrigin()).toBeNull();
  });
});

describe('contentFieldFocused', () => {
  it('is true for Content, plate copy, and layout fields inside the inspector', () => {
    document.body.innerHTML = `
      <div id="inspectorRoot">
        <input data-cnt-path="items.0.label" data-cnt-kind="text" />
        <input type="range" data-cnt-path="opacity" data-cnt-kind="number" />
        <textarea data-field-src></textarea>
        <input data-layout-title />
      </div>
      <input id="other" />`;
    const cnt = document.querySelector<HTMLInputElement>('[data-cnt-path][data-cnt-kind="text"]')!;
    const num = document.querySelector<HTMLInputElement>('[data-cnt-kind="number"]')!;
    const copy = document.querySelector<HTMLTextAreaElement>('[data-field-src]')!;
    const layout = document.querySelector<HTMLInputElement>('[data-layout-title]')!;
    const other = document.querySelector<HTMLInputElement>('#other')!;
    cnt.focus();
    expect(contentFieldFocused(document)).toBe(true);
    num.focus();
    expect(contentFieldFocused(document)).toBe(true);
    copy.focus();
    expect(contentFieldFocused(document)).toBe(true);
    layout.focus();
    expect(contentFieldFocused(document)).toBe(true);
    other.focus();
    expect(contentFieldFocused(document)).toBe(false);
  });
});

describe('planBakeStaleContent', () => {
  it('defers while a Content field has focus so leave-plate bake is not dropped', () => {
    expect(planBakeStaleContent({ focused: true })).toBe('defer');
    expect(planBakeStaleContent({ focused: false })).toBe('bake');
  });

  it('bakes after enough deferrals so a stuck caret cannot strand stale HTML', () => {
    expect(planBakeStaleContent({ focused: true, attempts: 14 })).toBe('defer');
    expect(planBakeStaleContent({ focused: true, attempts: 15 })).toBe('bake');
  });
});

describe('paintInspectorUnlessContentTyping', () => {
  it('queues a repaint while a Content field is focused', () => {
    document.body.innerHTML = `<div id="inspectorRoot"><input data-cnt-path="a" /></div>`;
    document.querySelector('input')!.focus();
    let painted = 0;
    paintInspectorUnlessContentTyping(() => {
      painted += 1;
    });
    expect(painted).toBe(0);
    document.body.querySelector('input')!.blur();
    flushQueuedInspectorRepaint(() => {
      painted += 1;
    });
    expect(painted).toBe(1);
  });
});

describe('maySeekProgramAfterEditorLeave', () => {
  it('seeks Program only when not previewing a plate', () => {
    expect(maySeekProgramAfterEditorLeave(1.2, 'program', null)).toBe(true);
    expect(maySeekProgramAfterEditorLeave(1.2, 'plate', null)).toBe(false);
    expect(maySeekProgramAfterEditorLeave(null, 'program', null)).toBe(false);
    expect(maySeekProgramAfterEditorLeave(1.2, 'program', 'intro')).toBe(false);
  });
});

describe('beforeSelectionCommit', () => {
  it('drains pending copy, settles the leaving plate, then allows commit', async () => {
    const order: string[] = [];
    await beforeSelectionCommit({
      hasPending: true,
      settlePlateId: 'intro',
      drainPending: () => {
        order.push('drain');
        return Promise.resolve();
      },
      settlePlate: (id) => {
        order.push(`settle:${id}`);
        return Promise.resolve();
      },
    });
    expect(order).toEqual(['drain', 'settle:intro']);
  });

  it('settles without drain when only stale copy remains', async () => {
    const order: string[] = [];
    await beforeSelectionCommit({
      hasPending: false,
      settlePlateId: 'features',
      drainPending: () => {
        order.push('drain');
        return Promise.resolve();
      },
      settlePlate: (id) => {
        order.push(`settle:${id}`);
        return Promise.resolve();
      },
    });
    expect(order).toEqual(['settle:features']);
  });
});

describe('isDeckMutationStillValid', () => {
  it('requires slug, epoch, and deck generation to match', () => {
    expect(isDeckMutationStillValid('demo', 1, 'demo', 1, 3, 3)).toBe(true);
    expect(isDeckMutationStillValid('demo', 1, 'demo', 1, 3, 4)).toBe(false);
    expect(isDeckMutationStillValid('demo', 1, 'other', 1, 3, 3)).toBe(false);
    expect(isDeckMutationStillValid('demo', 1, 'demo', 2, 3, 3)).toBe(false);
  });
});

describe('isContentSaveResponseValid', () => {
  it('accepts matching slug and epoch', () => {
    expect(isContentSaveResponseValid('demo', 2, 'demo', 2)).toBe(true);
  });

  it('rejects slug or epoch drift (sequence switch / reset)', () => {
    expect(isContentSaveResponseValid('demo', 2, 'other', 2)).toBe(false);
    expect(isContentSaveResponseValid('demo', 2, 'demo', 3)).toBe(false);
    expect(isContentSaveResponseValid('demo', 2, 'other', 3)).toBe(false);
  });
});

describe('plateContentContextClip', () => {
  const open = { id: 'open', kind: 'plate', plateId: 'open' };
  const live = { id: 'live-0', kind: 'live', plateId: null };
  const features = { id: 'features', kind: 'plate', plateId: 'features' };
  const seq = [open, live, features];

  it('uses the selected clip when the playhead sits on another section', () => {
    expect(plateContentContextClip({ type: 'clip', id: 'features' }, seq, open)).toEqual(features);
    expect(plateContentContextClip({ type: 'clip', id: 'features' }, seq, live)).toEqual(features);
  });

  it('falls back to the playhead clip when nothing is selected', () => {
    expect(plateContentContextClip(null, seq, live)).toEqual(live);
    expect(plateContentContextClip({ type: 'mix' }, seq, open)).toEqual(open);
  });
});

describe('plateContentSettleTarget', () => {
  it('settles when leaving a plate for a card, another plate, or null selection', () => {
    expect(plateContentSettleTarget('plate', 'intro', null)).toBe('intro');
    expect(plateContentSettleTarget('plate', 'intro', 'features')).toBe('intro');
    expect(plateContentSettleTarget('plate', 'intro', 'intro')).toBeNull();
    expect(plateContentSettleTarget('live', 'live-0', null)).toBeNull();
    expect(plateContentSettleTarget(undefined, 'intro', null)).toBeNull();
  });
});

describe('shouldHoldInspectorForContentFocus', () => {
  it('holds only for the same selection — a new clip must remount', () => {
    expect(shouldHoldInspectorForContentFocus({ focused: true, prevKey: 'clip:a::design', nextKey: 'clip:a::design' })).toBe(true);
    expect(shouldHoldInspectorForContentFocus({ focused: true, prevKey: 'clip:a::design', nextKey: 'clip:a::mix' })).toBe(false);
    expect(shouldHoldInspectorForContentFocus({ focused: true, prevKey: 'clip:a::design', nextKey: 'clip:b::design' })).toBe(false);
    expect(shouldHoldInspectorForContentFocus({ focused: false, prevKey: 'clip:a:', nextKey: 'clip:a:' })).toBe(false);
  });
});

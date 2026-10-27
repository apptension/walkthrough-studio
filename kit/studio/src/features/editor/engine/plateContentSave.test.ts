import { describe, expect, it } from 'vitest';

import {
  beginEditOrigin,
  contentFieldFocused,
  editOrigin,
  endEditOrigin,
  planBakeStaleContent,
  planContentFieldSync,
  planContentSave,
  shouldHoldInspectorForContentFocus,
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
        <textarea data-field-src></textarea>
        <input data-layout-title />
      </div>
      <input id="other" />`;
    const cnt = document.querySelector<HTMLInputElement>('[data-cnt-path]')!;
    const copy = document.querySelector<HTMLTextAreaElement>('[data-field-src]')!;
    const layout = document.querySelector<HTMLInputElement>('[data-layout-title]')!;
    const other = document.querySelector<HTMLInputElement>('#other')!;
    cnt.focus();
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

describe('shouldHoldInspectorForContentFocus', () => {
  it('holds only for the same selection — a new clip must remount', () => {
    expect(shouldHoldInspectorForContentFocus({ focused: true, prevKey: 'clip:a:', nextKey: 'clip:a:' })).toBe(true);
    expect(shouldHoldInspectorForContentFocus({ focused: true, prevKey: 'clip:a:', nextKey: 'clip:b:' })).toBe(false);
    expect(shouldHoldInspectorForContentFocus({ focused: false, prevKey: 'clip:a:', nextKey: 'clip:a:' })).toBe(false);
  });
});

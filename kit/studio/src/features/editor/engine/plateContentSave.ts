/**
 * Content ↔ stage sync plan.
 *
 * Typing a label is not the same as rebuilding a plate. Keystrokes must stay local (config +
 * in-place paint). A full HTML rebuild / inspector remount is only for structural changes or an
 * explicit bake after the author leaves the field. Mixing those paths is the circular flash:
 * pane types → preview reloads → right side remounts → caret dies.
 */

type EditOrigin = 'pane' | 'stage';

type ContentSavePlan = {
  /** Tear down and reload the plate iframe. */
  reload: boolean;
  /** Remount the inspector HTML (loses caret unless carefully restored). */
  repaint: boolean;
  /** Apply `plates` from the response into desk (new htmlUrl → stage treats the frame as stale). */
  applyPlates: boolean;
  /** Ask the server to skip HTML rebuild — config write + live paint is enough while typing. */
  live: boolean;
};

let origin: EditOrigin | null = null;

/** Mark where an edit started so the other side does not echo it back as a remount. */
export function beginEditOrigin(next: EditOrigin): void {
  origin = next;
}

export function endEditOrigin(): void {
  origin = null;
}

export function editOrigin(): EditOrigin | null {
  return origin;
}

/**
 * Stage → Content: open another record only when the author picked a different tile.
 * Echoes from the Content pane itself must not remount the pane.
 */
export function planContentFieldSync({
  origin: from,
  openSlot,
  targetSlot,
  path,
}: {
  origin: EditOrigin | null;
  openSlot: string | null;
  targetSlot: string | null;
  path: string | null;
}): { remount: boolean; patchPath: string | null } {
  if (!targetSlot || !path) return { remount: false, patchPath: null };
  // Pane typed → stage painted → selection events must not bounce into a remount.
  if (from === 'pane') return { remount: false, patchPath: null };
  if (openSlot === targetSlot) return { remount: false, patchPath: path };
  return { remount: true, patchPath: path };
}

export function planContentSave({
  paintLive,
  repaint,
}: {
  paintLive: boolean;
  repaint: boolean;
}): ContentSavePlan {
  if (paintLive) {
    return {
      reload: false,
      repaint: false,
      applyPlates: false,
      live: true,
    };
  }
  return {
    reload: true,
    repaint: Boolean(repaint),
    applyPlates: true,
    live: false,
  };
}

/** Inspector inputs that must not remount or echo stage selection while the caret is active. */
const INSPECTOR_TYPING =
  '[data-cnt-path], [data-field-src], [data-layout-title], [data-layout-body]';

/** True while a Content / copy / layout field in the inspector owns focus. */
export function contentFieldFocused(root: ParentNode | null = typeof document !== 'undefined' ? document : null): boolean {
  if (!root || typeof document === 'undefined') return false;
  const el = document.activeElement;
  const ins = root.querySelector('#inspectorRoot');
  return Boolean(el instanceof HTMLElement && ins?.contains(el) && el.matches(INSPECTOR_TYPING));
}

/**
 * Bake HTML after live typing only when the Content caret is free. While focused, defer —
 * a silent return used to drop the bake forever when select() left the plate mid-type.
 * After enough deferrals (~6s), bake anyway so a stuck caret cannot strand stale HTML.
 */
export function planBakeStaleContent({
  focused,
  attempts = 0,
}: {
  focused: boolean;
  attempts?: number;
}): 'bake' | 'defer' {
  if (!focused) return 'bake';
  return attempts >= 15 ? 'bake' : 'defer';
}

/**
 * Keep the inspector DOM only while Content typing on the *same* selection.
 * A new clip/card selection must remount — otherwise the caret stays on the old plate,
 * bake stays deferred forever, and the right rail shows the wrong clip.
 */
export function shouldHoldInspectorForContentFocus({
  focused,
  prevKey,
  nextKey,
}: {
  focused: boolean;
  prevKey: string;
  nextKey: string;
}): boolean {
  if (!focused) return false;
  return Boolean(nextKey) && prevKey === nextKey;
}

/**
 * The one shared help tooltip's state (`help.js`): which `i` button it points
 * at, its text, and whether a click pinned it.
 */

export interface HelpState {
  anchor: HTMLButtonElement | null;
  text: string;
  pinned: boolean;
}

let state: HelpState = { anchor: null, text: '', pinned: false };
const listeners = new Set<() => void>();
let showTimer = 0;
let hideTimer = 0;

function emit(next: HelpState) {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeHelp(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function helpState(): HelpState {
  return state;
}

export const helpTips = {
  show(anchor: HTMLButtonElement, text: string, pin = false) {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    emit({ anchor, text, pinned: pin });
  },
  /** Hover: show after 220 ms, or at once when another tip is already open. */
  showSoon(anchor: HTMLButtonElement, text: string) {
    window.clearTimeout(hideTimer);
    showTimer = window.setTimeout(() => helpTips.show(anchor, text), state.anchor ? 0 : 220);
  },
  cancelShow() {
    window.clearTimeout(showTimer);
  },
  cancelHide() {
    window.clearTimeout(hideTimer);
  },
  hide() {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    if (state.anchor) emit({ anchor: null, text: '', pinned: false });
  },
  scheduleHide() {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => helpTips.hide(), 140);
  },
  get current() {
    return state;
  },
};

/** The text label a help button announces: `About <label>`. */
export function helpLabel(text: string): string {
  const trimmed = text.trim();
  return trimmed ? `About ${trimmed}` : 'More about this';
}

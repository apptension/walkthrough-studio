/**
 * The Live pane used to point `<img src>` at a new cache-busted URL on every
 * job poll. Each URL is a full-viewport JPEG; once a navigation made the fetch
 * slower than the poll, the browser aborted every load and the last decoded
 * frame stayed on screen (the click, forever).
 *
 * One load at a time. Marks that arrive while it is in flight collapse into a
 * single follow-up fetch of whatever is newest when the slot frees.
 */

export interface PreviewPump {
  /** A newer file may be on disk. */
  markDirty(): void;
  /** URL to fetch now, or null when idle or a load is already running. */
  take(bust: (stamp: number) => string): string | null;
  /** The in-flight load finished (shown or failed). True when another should start at once. */
  finish(): boolean;
}

export function createPreviewPump(): PreviewPump {
  let dirty = false;
  let loading = false;
  let stamp = 0;
  return {
    markDirty() {
      dirty = true;
    },
    take(bust) {
      if (!dirty || loading) return null;
      dirty = false;
      loading = true;
      stamp += 1;
      return bust(stamp);
    },
    finish() {
      loading = false;
      return dirty;
    },
  };
}

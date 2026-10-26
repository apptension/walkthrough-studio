/** A tab and its pane find each other by these ids (`aria-controls` / `aria-labelledby`). */
export const paneTabId = (base: string, id: string) => `${base}-tab-${id}`;
export const panePaneId = (base: string, id: string) => `${base}-pane-${id}`;

const KEY = 'wt-studio-session-rail-collapsed';

/** Whether the agent/session rail was last left collapsed — remembered like `PanelSection`. */
export function readRailCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function writeRailCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, collapsed ? '1' : '0');
  } catch {
    /* private mode */
  }
}

import { setFaviconMode } from './marks';
import { desk, type LeftTab, type RightTab } from './store';

/** Rail tabs and the render-mode body flag (`showLeftTab`, the `.tools-panel .ptab` click, `setRenderMode`). */

export function showLeftTab(id: LeftTab): void {
  desk.set({ leftTab: id });
}

export function showRightTab(id: RightTab): void {
  desk.set((s) => ({ rightTab: id, rightTabPicked: true, rightTabSeq: s.rightTabSeq + 1 }));
}

export function setRenderMode(on: boolean, mode = 'render'): void {
  desk.set({ isRendering: on });
  if (on) {
    showLeftTab('render');
    setFaviconMode(mode === 'record' ? 'record' : mode === 'export' ? 'export' : 'render');
  } else if (!desk.get().jobBusy && !desk.get().queue.length) {
    setFaviconMode('idle');
  }
}
